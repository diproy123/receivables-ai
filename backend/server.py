"""
AuditLens by AIvoraLabs — AI-Powered Spend Compliance Auditor
v2.5 — F&A hardened + Agentic Triage (F1) + Vendor Risk Scoring (F3)
        tax handling, line item verification, smart duplicate detection,
        contract pricing checks, vendor normalization, multi-invoice PO matching,
        auto-approve/review/block triage, dynamic vendor risk thresholds
"""

import os, json, base64, uuid, asyncio, re, math
from datetime import datetime, timedelta
from pathlib import Path
from difflib import SequenceMatcher
from collections import defaultdict

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import anthropic

# RAG Engine
try:
    from backend.rag_engine import (on_document_uploaded, on_anomaly_detected, on_document_edited,
        get_extraction_context, get_anomaly_context, get_rag_stats, reset_rag, on_anomalies_detected_batch)
    RAG_ENABLED = True
except ImportError:
    try:
        from rag_engine import (on_document_uploaded, on_anomaly_detected, on_document_edited,
            get_extraction_context, get_anomaly_context, get_rag_stats, reset_rag, on_anomalies_detected_batch)
        RAG_ENABLED = True
    except ImportError:
        RAG_ENABLED = False
        async def on_document_uploaded(doc): pass
        async def on_anomaly_detected(anom): pass
        async def on_anomalies_detected_batch(anoms): pass
        async def on_document_edited(doc): pass
        async def get_extraction_context(v, d): return ""
        async def get_anomaly_context(inv): return ""
        def get_rag_stats(): return {"enabled": False}
        async def reset_rag(): pass

# ============================================================
# CONFIG
# ============================================================
BASE_DIR = Path(__file__).parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOAD_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = DATA_DIR / "db.json"
USE_REAL_API = bool(os.environ.get("ANTHROPIC_API_KEY"))

# Configurable thresholds
AMOUNT_TOLERANCE_PCT = float(os.environ.get("AMOUNT_TOLERANCE_PCT", "2"))      # % tolerance for amount matching
PRICE_TOLERANCE_PCT = float(os.environ.get("PRICE_TOLERANCE_PCT", "1"))        # % tolerance for unit price
OVER_INVOICE_PCT = float(os.environ.get("OVER_INVOICE_PCT", "10"))             # % over PO to flag
DUPLICATE_DAYS_WINDOW = int(os.environ.get("DUPLICATE_DAYS_WINDOW", "30"))     # days window for duplicate check
HIGH_SEVERITY_PCT = float(os.environ.get("HIGH_SEVERITY_PCT", "10"))           # % variance for high severity
MED_SEVERITY_PCT = float(os.environ.get("MED_SEVERITY_PCT", "5"))              # % variance for medium severity

# ── F3: Vendor Risk Scoring thresholds ──
RISK_WEIGHT_ANOMALY_RATE = float(os.environ.get("RISK_WEIGHT_ANOMALY_RATE", "0.30"))
RISK_WEIGHT_CORRECTION_FREQ = float(os.environ.get("RISK_WEIGHT_CORRECTION_FREQ", "0.15"))
RISK_WEIGHT_CONTRACT_COMPLIANCE = float(os.environ.get("RISK_WEIGHT_CONTRACT_COMPLIANCE", "0.25"))
RISK_WEIGHT_DUPLICATE_HISTORY = float(os.environ.get("RISK_WEIGHT_DUPLICATE_HISTORY", "0.15"))
RISK_WEIGHT_VOLUME_CONSISTENCY = float(os.environ.get("RISK_WEIGHT_VOLUME_CONSISTENCY", "0.15"))
HIGH_RISK_THRESHOLD = float(os.environ.get("HIGH_RISK_THRESHOLD", "65"))       # Score >= this = high risk
MED_RISK_THRESHOLD = float(os.environ.get("MED_RISK_THRESHOLD", "35"))         # Score >= this = medium risk
RISK_TOLERANCE_TIGHTENING = float(os.environ.get("RISK_TOLERANCE_TIGHTENING", "0.50"))  # Reduce tolerance by 50% for high-risk vendors

# ── F1: Agentic Triage thresholds ──
TRIAGE_AUTO_APPROVE_CONFIDENCE = float(os.environ.get("TRIAGE_AUTO_APPROVE_CONFIDENCE", "85"))
TRIAGE_AUTO_APPROVE_MAX_RISK = float(os.environ.get("TRIAGE_AUTO_APPROVE_MAX_RISK", "30"))
TRIAGE_BLOCK_SEVERITY = os.environ.get("TRIAGE_BLOCK_SEVERITY", "high")        # Block if any anomaly >= this severity
TRIAGE_BLOCK_MIN_RISK_SCORE = float(os.environ.get("TRIAGE_BLOCK_MIN_RISK_SCORE", "70"))  # Block if vendor risk >= this AND has anomalies
TRIAGE_ENABLED = os.environ.get("TRIAGE_ENABLED", "true").lower() == "true"

# Currency-aware auto-approve amount limits (C4 fix: India GTM requires INR calibration)
AUTO_APPROVE_AMOUNT_LIMITS = {
    "USD": 100000, "EUR": 90000, "GBP": 80000,
    "INR": 7500000,  # ~$90K USD equivalent
    "AED": 350000, "JPY": 15000000, "CAD": 130000, "AUD": 150000,
}
DEFAULT_AUTO_APPROVE_LIMIT = 100000

app = FastAPI(title="AuditLens by AIvoraLabs", version="2.5.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ============================================================
# DATABASE (with file locking for concurrency safety)
# ============================================================
import fcntl

EMPTY_DB = {"invoices": [], "purchase_orders": [], "contracts": [], "matches": [], "anomalies": [],
            "activity_log": [], "correction_patterns": [], "vendor_profiles": [], "triage_decisions": []}

def _fresh_db():
    """Return a fresh deep copy of EMPTY_DB to prevent shared list references."""
    return {k: list(v) if isinstance(v, list) else v for k, v in EMPTY_DB.items()}
DB_LOCK_PATH = DATA_DIR / "db.lock"

def load_db():
    if DB_PATH.exists():
        # Shared lock for reads — prevents reading mid-write
        with open(DB_LOCK_PATH, "a+") as lock_file:
            fcntl.flock(lock_file, fcntl.LOCK_SH)
            try:
                with open(DB_PATH) as f:
                    db = json.load(f)
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)
        for k in EMPTY_DB:
            if k not in db: db[k] = []
        return db
    return _fresh_db()

def save_db(db):
    # Use file lock to prevent concurrent write corruption
    with open(DB_LOCK_PATH, "w") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        try:
            with open(DB_PATH, "w") as f:
                json.dump(db, f, indent=2, default=str)
        finally:
            fcntl.flock(lock_file, fcntl.LOCK_UN)

def get_db():
    return load_db()

# ============================================================
# VENDOR NAME NORMALIZATION
# ============================================================
VENDOR_SUFFIXES = re.compile(
    r'\b(inc|incorporated|llc|ltd|limited|pvt|private|co|corp|corporation|'
    r'group|enterprises|solutions|services|systems|technologies|consulting|'
    r'manufacturing|international|intl)\b\.?', re.IGNORECASE)

def normalize_vendor(name: str) -> str:
    """Normalize vendor name for comparison: strip suffixes, punctuation, extra spaces."""
    if not name: return ""
    n = name.lower().strip()
    n = VENDOR_SUFFIXES.sub('', n)
    n = re.sub(r'[.,&\-\'\"]+', ' ', n)
    n = re.sub(r'\s+', ' ', n).strip()
    return n

def vendor_similarity(a: str, b: str) -> float:
    """Score vendor name similarity 0-1. Uses normalized names + fuzzy matching."""
    if not a or not b: return 0
    na, nb = normalize_vendor(a), normalize_vendor(b)
    if na == nb: return 1.0
    if na in nb or nb in na: return 0.85
    return SequenceMatcher(None, na, nb).ratio()

# ============================================================
# CURRENCY HELPERS
# ============================================================
CURRENCY_SYMBOLS = {"USD": "$", "INR": "\u20b9", "EUR": "\u20ac", "GBP": "\u00a3", "AED": "AED ", "JPY": "\u00a5", "CAD": "C$", "AUD": "A$"}

def currency_symbol(code: str) -> str:
    return CURRENCY_SYMBOLS.get(code, code + " ")

def severity_for_amount(amount: float, total: float) -> str:
    """Percentage-based severity — works across currencies."""
    if total <= 0: return "medium"
    pct = (amount / total) * 100
    if pct >= HIGH_SEVERITY_PCT: return "high"
    if pct >= MED_SEVERITY_PCT: return "medium"
    return "low"


# ============================================================
# F3: VENDOR RISK SCORING ENGINE
# ============================================================
def compute_vendor_risk_score(vendor_name: str, db: dict) -> dict:
    """Compute composite risk score (0-100) for a vendor based on 5 weighted factors.
    Higher score = higher risk. Returns score, factor breakdown, risk level, and trend."""
    vn = normalize_vendor(vendor_name)
    if not vn:
        return {"score": 50, "level": "medium", "factors": {}, "trend": "stable", "invoiceCount": 0}

    # ── Gather vendor data ──
    vendor_invoices = [i for i in db.get("invoices", [])
                       if vendor_similarity(i.get("vendor", ""), vendor_name) >= 0.7]
    vendor_anomalies = [a for a in db.get("anomalies", [])
                        if vendor_similarity(a.get("vendor", ""), vendor_name) >= 0.7]
    vendor_corrections = [p for p in db.get("correction_patterns", [])
                          if vendor_similarity(p.get("vendor", ""), vendor_name) >= 0.7]
    vendor_contracts = [c for c in db.get("contracts", [])
                        if vendor_similarity(c.get("vendor", ""), vendor_name) >= 0.7]

    inv_count = len(vendor_invoices)
    if inv_count == 0:
        # New vendor — unknown risk, assign moderate score
        return {"score": 45, "level": "medium", "factors": {
            "anomaly_rate": {"score": 50, "weight": RISK_WEIGHT_ANOMALY_RATE, "detail": "New vendor, no history"},
            "correction_freq": {"score": 30, "weight": RISK_WEIGHT_CORRECTION_FREQ, "detail": "No corrections"},
            "contract_compliance": {"score": 50, "weight": RISK_WEIGHT_CONTRACT_COMPLIANCE, "detail": "Unknown"},
            "duplicate_history": {"score": 30, "weight": RISK_WEIGHT_DUPLICATE_HISTORY, "detail": "No history"},
            "volume_consistency": {"score": 50, "weight": RISK_WEIGHT_VOLUME_CONSISTENCY, "detail": "New vendor"},
        }, "trend": "new", "invoiceCount": 0}

    # ── Factor 1: Anomaly Rate (0-100) ──
    # What % of invoices had non-EPD anomalies?
    real_anomalies = [a for a in vendor_anomalies if a.get("type") != "EARLY_PAYMENT_DISCOUNT"]
    inv_ids_with_anomalies = set(a.get("invoiceId") for a in real_anomalies if a.get("status") == "open")
    resolved_anomalies = [a for a in real_anomalies if a.get("status") in ("resolved", "dismissed")]
    anom_rate = len(inv_ids_with_anomalies) / inv_count if inv_count > 0 else 0
    # Weight by severity: high anomalies count 3x, medium 1.5x
    severity_weight = 0
    for a in real_anomalies:
        if a.get("status") == "open":
            severity_weight += 3 if a.get("severity") == "high" else 1.5 if a.get("severity") == "medium" else 0.5
    severity_adj = min(severity_weight / max(inv_count, 1), 2.0)  # Cap at 2.0
    anomaly_score = min(100, anom_rate * 100 * (1 + severity_adj * 0.5))
    anomaly_detail = f"{len(inv_ids_with_anomalies)}/{inv_count} invoices had anomalies"
    if severity_weight > 0:
        anomaly_detail += f" ({sum(1 for a in real_anomalies if a.get('severity')=='high' and a.get('status')=='open')} high severity)"

    # ── Factor 2: Correction Frequency (0-100) ──
    # How often does AI extraction need human correction for this vendor?
    correction_count = sum(p.get("correctionCount", 1) for p in vendor_corrections)
    correction_rate = correction_count / inv_count if inv_count > 0 else 0
    correction_score = min(100, correction_rate * 40)  # 2.5 corrections per invoice = max score
    correction_detail = f"{correction_count} corrections across {inv_count} invoices"

    # ── Factor 3: Contract Compliance (0-100) ──
    # Is there a valid contract? Is it expired? Are pricing terms defined?
    contract_score = 50  # Default: unknown
    contract_detail = "No contract on file"
    if vendor_contracts:
        best_contract = vendor_contracts[0]
        ct = best_contract.get("contractTerms", {})
        expiry = ct.get("expiry_date")
        has_pricing = bool(best_contract.get("pricingTerms"))

        if expiry:
            try:
                exp_date = datetime.fromisoformat(expiry)
                if exp_date < datetime.now():
                    days_expired = (datetime.now() - exp_date).days
                    contract_score = min(100, 60 + days_expired * 0.2)  # Gets worse the longer expired
                    contract_detail = f"Contract expired {days_expired} days ago"
                else:
                    days_remaining = (exp_date - datetime.now()).days
                    contract_score = 10 if has_pricing else 25
                    contract_detail = f"Active, expires in {days_remaining} days"
                    if has_pricing:
                        contract_detail += ", pricing enforced"
            except:
                contract_score = 40
                contract_detail = "Contract date parse error"
        elif has_pricing:
            contract_score = 20
            contract_detail = "Contract active, pricing terms defined"
        else:
            contract_score = 35
            contract_detail = "Contract exists but no pricing terms"
    else:
        # No contract at all — risky for compliance
        contract_score = 55
        contract_detail = "No contract on file — pricing unverified"

    # ── Factor 4: Duplicate History (0-100) ──
    dup_anomalies = [a for a in vendor_anomalies if a.get("type") == "DUPLICATE_INVOICE"]
    dup_count = len(dup_anomalies)
    dup_score = min(100, dup_count * 30)  # Each duplicate incident is a big red flag
    dup_detail = f"{dup_count} duplicate submissions detected" if dup_count else "No duplicates"

    # ── Factor 5: Volume Consistency (0-100) ──
    # Erratic invoicing patterns suggest problems. Measure coefficient of variation of monthly amounts.
    if inv_count >= 3:
        amounts = [i.get("subtotal", i.get("amount", 0)) for i in vendor_invoices]
        mean_amt = sum(amounts) / len(amounts)
        if mean_amt > 0:
            variance = sum((a - mean_amt) ** 2 for a in amounts) / len(amounts)
            std_dev = math.sqrt(variance)
            cv = std_dev / mean_amt  # Coefficient of variation
            volume_score = min(100, cv * 60)  # CV of 1.67 = max score
            volume_detail = f"Amount CV: {cv:.2f} across {inv_count} invoices"
        else:
            volume_score = 30
            volume_detail = "Cannot assess volume pattern"
    else:
        volume_score = 40
        volume_detail = f"Insufficient data ({inv_count} invoices)"

    # ── Weighted Composite Score ──
    raw_score = (
        anomaly_score * RISK_WEIGHT_ANOMALY_RATE +
        correction_score * RISK_WEIGHT_CORRECTION_FREQ +
        contract_score * RISK_WEIGHT_CONTRACT_COMPLIANCE +
        dup_score * RISK_WEIGHT_DUPLICATE_HISTORY +
        volume_score * RISK_WEIGHT_VOLUME_CONSISTENCY
    )

    # Clamp to 0-100
    final_score = max(0, min(100, round(raw_score, 1)))

    # ── Risk Level ──
    if final_score >= HIGH_RISK_THRESHOLD:
        level = "high"
    elif final_score >= MED_RISK_THRESHOLD:
        level = "medium"
    else:
        level = "low"

    # ── Trend Detection ──
    # Compare anomaly rate of recent invoices (last 3) vs older ones
    trend = "stable"
    if inv_count >= 6:
        sorted_inv = sorted(vendor_invoices, key=lambda x: x.get("extractedAt", ""))
        recent_ids = {i["id"] for i in sorted_inv[-3:]}
        older_ids = {i["id"] for i in sorted_inv[:-3]}
        recent_anom = sum(1 for a in real_anomalies if a.get("invoiceId") in recent_ids and a.get("status") == "open")
        older_anom = sum(1 for a in real_anomalies if a.get("invoiceId") in older_ids and a.get("status") == "open")
        recent_rate = recent_anom / 3
        older_rate = older_anom / max(len(older_ids), 1)
        if recent_rate > older_rate * 1.5:
            trend = "worsening"
        elif recent_rate < older_rate * 0.5:
            trend = "improving"

    return {
        "score": final_score,
        "level": level,
        "trend": trend,
        "invoiceCount": inv_count,
        "totalSpend": round(sum(i.get("amount", 0) for i in vendor_invoices), 2),
        "openAnomalyCount": len([a for a in real_anomalies if a.get("status") == "open"]),
        "totalAnomalyCount": len(real_anomalies),
        "factors": {
            "anomaly_rate": {"score": round(anomaly_score, 1), "weight": RISK_WEIGHT_ANOMALY_RATE, "detail": anomaly_detail},
            "correction_freq": {"score": round(correction_score, 1), "weight": RISK_WEIGHT_CORRECTION_FREQ, "detail": correction_detail},
            "contract_compliance": {"score": round(contract_score, 1), "weight": RISK_WEIGHT_CONTRACT_COMPLIANCE, "detail": contract_detail},
            "duplicate_history": {"score": round(dup_score, 1), "weight": RISK_WEIGHT_DUPLICATE_HISTORY, "detail": dup_detail},
            "volume_consistency": {"score": round(volume_score, 1), "weight": RISK_WEIGHT_VOLUME_CONSISTENCY, "detail": volume_detail},
        }
    }


def get_dynamic_tolerances(vendor_name: str, db: dict) -> dict:
    """Adjust anomaly detection tolerances based on vendor risk.
    Uses continuous linear interpolation: score 0 = full tolerance, score 100 = max tightening.
    NC1 FIX: replaces discrete 3-level steps with smooth gradient."""
    risk = compute_vendor_risk_score(vendor_name, db)
    score = risk["score"]

    # Continuous: tightening scales linearly from 0% (score 0) to RISK_TOLERANCE_TIGHTENING (score 100)
    # Floor at 30% of original tolerance to avoid zero/near-zero thresholds
    tightening = (score / 100.0) * RISK_TOLERANCE_TIGHTENING
    factor = max(0.3, 1.0 - tightening)

    return {
        "amount_tolerance_pct": round(AMOUNT_TOLERANCE_PCT * factor, 3),
        "price_tolerance_pct": round(PRICE_TOLERANCE_PCT * factor, 3),
        "risk_adjusted": score > 15,  # Only flag as adjusted if meaningfully above baseline
        "risk_score": risk["score"],
        "risk_level": risk["level"]
    }


def update_vendor_profile(vendor_name: str, db: dict):
    """Recompute and store/update vendor risk profile. Called after every invoice upload."""
    vn = normalize_vendor(vendor_name)
    if not vn:
        return

    risk = compute_vendor_risk_score(vendor_name, db)
    profiles = db.setdefault("vendor_profiles", [])

    # Find existing profile
    existing = None
    for p in profiles:
        if p.get("vendorNormalized") == vn:
            existing = p
            break

    profile_data = {
        "vendorNormalized": vn,
        "vendorDisplay": vendor_name,
        "riskScore": risk["score"],
        "riskLevel": risk["level"],
        "trend": risk["trend"],
        "invoiceCount": risk["invoiceCount"],
        "totalSpend": risk["totalSpend"],
        "openAnomalies": risk["openAnomalyCount"],
        "totalAnomalies": risk["totalAnomalyCount"],
        "factors": risk["factors"],
        "updatedAt": datetime.now().isoformat(),
    }

    if existing:
        # Track score history for trend visualization
        history = existing.get("scoreHistory", [])
        history.append({"score": existing.get("riskScore", 50), "at": existing.get("updatedAt")})
        if len(history) > 20:
            history = history[-20:]
        profile_data["scoreHistory"] = history
        existing.update(profile_data)
    else:
        profile_data["scoreHistory"] = []
        profile_data["firstSeen"] = datetime.now().isoformat()
        profiles.append(profile_data)


# ============================================================
# F1: AGENTIC INVOICE TRIAGE ENGINE
# ============================================================
def triage_invoice(invoice: dict, anomalies: list, db: dict) -> dict:
    """Classify invoice into AUTO_APPROVE / REVIEW / BLOCK with reasoning.
    Uses multi-factor analysis: anomaly severity, confidence, vendor risk, amount.

    Returns: {lane, reasons[], confidence, vendorRisk, triageAt, autoAction}
    """
    if not TRIAGE_ENABLED:
        return {"lane": "REVIEW", "reasons": ["Triage disabled"], "confidence": 0,
                "vendorRisk": None, "triageAt": datetime.now().isoformat(), "autoAction": None}

    inv_id = invoice.get("id", "")
    confidence = invoice.get("confidence", 0)
    vendor = invoice.get("vendor", "")
    inv_amount = invoice.get("amount", 0)

    # Get vendor risk
    vendor_risk = compute_vendor_risk_score(vendor, db)
    risk_score = vendor_risk["score"]
    risk_level = vendor_risk["level"]

    # Filter anomalies for THIS invoice (open only, exclude EPD which is informational)
    inv_anomalies = [a for a in anomalies
                     if a.get("invoiceId") == inv_id
                     and a.get("status") == "open"
                     and a.get("type") != "EARLY_PAYMENT_DISCOUNT"]
    epd_anomalies = [a for a in anomalies
                     if a.get("invoiceId") == inv_id and a.get("type") == "EARLY_PAYMENT_DISCOUNT"]

    high_anomalies = [a for a in inv_anomalies if a.get("severity") == "high"]
    medium_anomalies = [a for a in inv_anomalies if a.get("severity") == "medium"]
    low_anomalies = [a for a in inv_anomalies if a.get("severity") == "low"]
    total_risk_amount = sum(a.get("amount_at_risk", 0) for a in inv_anomalies if a.get("amount_at_risk", 0) > 0)

    # Match quality
    match = None
    for m in db.get("matches", []):
        if m.get("invoiceId") == inv_id:
            match = m
            break
    match_score = match.get("matchScore", 0) if match else 0
    is_over_invoiced = match.get("overInvoiced", False) if match else False

    reasons = []
    lane = "REVIEW"  # Default

    # ═══════════════════════════════════════════════
    # BLOCK LOGIC — any of these force a block
    # ═══════════════════════════════════════════════
    block = False

    # Rule B1: Any HIGH severity anomaly
    if high_anomalies:
        block = True
        types = list(set(a.get("type", "?") for a in high_anomalies))
        reasons.append(f"BLOCK: {len(high_anomalies)} high-severity anomal{'y' if len(high_anomalies)==1 else 'ies'} ({', '.join(t.replace('_',' ') for t in types)})")

    # Rule B2: Over-invoiced PO
    if is_over_invoiced:
        block = True
        reasons.append("BLOCK: PO over-invoiced — cumulative invoices exceed PO amount")

    # Rule B3: Duplicate invoice detected
    dup_anomalies = [a for a in inv_anomalies if a.get("type") == "DUPLICATE_INVOICE"]
    if dup_anomalies:
        block = True
        reasons.append(f"BLOCK: Potential duplicate invoice detected (confidence: {dup_anomalies[0].get('description', '').split('Confidence: ')[-1] if 'Confidence:' in (dup_anomalies[0].get('description', '')) else 'high'})")

    # Rule B4: High-risk vendor WITH anomalies
    if risk_score >= TRIAGE_BLOCK_MIN_RISK_SCORE and inv_anomalies:
        block = True
        reasons.append(f"BLOCK: High-risk vendor (score: {risk_score:.0f}) with {len(inv_anomalies)} open anomal{'y' if len(inv_anomalies)==1 else 'ies'}")

    # Rule B5: Very low extraction confidence
    if confidence < 60:
        block = True
        reasons.append(f"BLOCK: Low extraction confidence ({confidence:.0f}%) — data unreliable")

    # Rule B6: Risk amount exceeds 20% of invoice
    if inv_amount > 0 and total_risk_amount > inv_amount * 0.20:
        block = True
        risk_pct = (total_risk_amount / inv_amount) * 100
        reasons.append(f"BLOCK: At-risk amount is {risk_pct:.0f}% of invoice total")

    if block:
        lane = "BLOCK"
        auto_action = "on_hold"
        triage_confidence = min(99, 70 + len([r for r in reasons if r.startswith("BLOCK")]) * 8)
    else:
        # ═══════════════════════════════════════════════
        # AUTO-APPROVE LOGIC — all conditions must be met
        # ═══════════════════════════════════════════════
        approve_conditions = []
        approve_fails = []

        # Rule A1: No real anomalies (EPD-only is fine)
        if not inv_anomalies:
            approve_conditions.append("No anomalies detected")
        else:
            approve_fails.append(f"{len(inv_anomalies)} anomal{'y' if len(inv_anomalies)==1 else 'ies'} found")

        # Rule A2: High extraction confidence
        if confidence >= TRIAGE_AUTO_APPROVE_CONFIDENCE:
            approve_conditions.append(f"High confidence ({confidence:.0f}%)")
        else:
            approve_fails.append(f"Confidence below threshold ({confidence:.0f}% < {TRIAGE_AUTO_APPROVE_CONFIDENCE:.0f}%)")

        # Rule A3: Low vendor risk
        if risk_score <= TRIAGE_AUTO_APPROVE_MAX_RISK:
            approve_conditions.append(f"Trusted vendor (risk: {risk_score:.0f})")
        else:
            approve_fails.append(f"Vendor risk above threshold ({risk_score:.0f} > {TRIAGE_AUTO_APPROVE_MAX_RISK:.0f})")

        # Rule A4: PO matched (if invoice has PO reference)
        if invoice.get("poReference"):
            if match and match_score >= 60:
                approve_conditions.append(f"PO matched (score: {match_score})")
            else:
                approve_fails.append(f"PO reference not matched adequately")
        else:
            # No PO reference — depends on whether Missing PO anomaly was raised
            missing_po = [a for a in inv_anomalies if a.get("type") == "MISSING_PO"]
            if not missing_po:
                approve_conditions.append("No PO expected for this document type")

        # Rule A5: Amount sanity — currency-aware (C4 fix)
        inv_currency = invoice.get("currency", "USD")
        approve_limit = AUTO_APPROVE_AMOUNT_LIMITS.get(inv_currency, DEFAULT_AUTO_APPROVE_LIMIT)
        if inv_amount <= approve_limit:
            approve_conditions.append("Amount within auto-approve limit")
        else:
            approve_fails.append(f"Amount exceeds auto-approve limit (>{currency_symbol(inv_currency)}{approve_limit:,.0f})")

        if not approve_fails:
            lane = "AUTO_APPROVE"
            auto_action = "approved"
            reasons = [f"APPROVED: {c}" for c in approve_conditions]
            if epd_anomalies:
                reasons.append(f"NOTE: Early payment discount available")
            triage_confidence = min(99, 80 + len(approve_conditions) * 4)
        else:
            # ═══════════════════════════════════════════════
            # REVIEW — default lane
            # ═══════════════════════════════════════════════
            lane = "REVIEW"
            auto_action = "under_review"
            reasons = [f"REVIEW: {f}" for f in approve_fails]
            if approve_conditions:
                reasons.append(f"Passed: {', '.join(approve_conditions)}")
            if medium_anomalies:
                types = list(set(a.get("type", "?") for a in medium_anomalies))
                reasons.append(f"Medium anomalies: {', '.join(t.replace('_',' ') for t in types)}")
            triage_confidence = max(40, 70 - len(approve_fails) * 10)

    return {
        "lane": lane,
        "reasons": reasons,
        "confidence": min(99, triage_confidence),
        "vendorRisk": {
            "score": vendor_risk["score"],
            "level": vendor_risk["level"],
            "trend": vendor_risk["trend"],
        },
        "anomalySummary": {
            "total": len(inv_anomalies),
            "high": len(high_anomalies),
            "medium": len(medium_anomalies),
            "low": len(low_anomalies),
            "totalRisk": round(total_risk_amount, 2),
            "hasEPD": len(epd_anomalies) > 0,
        },
        "matchQuality": match_score,
        "triageAt": datetime.now().isoformat(),
        "autoAction": auto_action,
    }


def store_triage_decision(invoice_id: str, triage: dict, db: dict):
    """Store triage decision for audit trail and dashboard metrics."""
    decisions = db.setdefault("triage_decisions", [])
    # Remove previous decision for this invoice (re-triage on edit)
    decisions[:] = [d for d in decisions if d.get("invoiceId") != invoice_id]
    decisions.append({
        "id": str(uuid.uuid4())[:8].upper(),
        "invoiceId": invoice_id,
        **triage,
    })


def apply_triage_action(invoice: dict, triage: dict, db: dict):
    """Apply triage result: update invoice status and log to activity trail.
    NC2 FIX: Transitions allowed from triage-managed statuses, not just initial.
    Terminal statuses (paid, disputed, scheduled) are never overridden by AI."""
    action = triage.get("autoAction")
    lane = triage.get("lane")
    old_status = invoice.get("status", "unpaid")

    # Terminal statuses: human decisions that outrank AI triage
    terminal = {"paid", "disputed", "scheduled"}
    # Triage-managed statuses: AI can transition between these
    triage_managed = {"unpaid", "pending", "on_hold", "under_review", "approved"}

    if old_status in triage_managed and old_status not in terminal:
        if lane == "AUTO_APPROVE" and action == "approved":
            invoice["status"] = "approved"
            invoice["autoApproved"] = True
            invoice["autoApprovedAt"] = datetime.now().isoformat()
        elif lane == "BLOCK" and action == "on_hold":
            invoice["status"] = "on_hold"
            invoice["autoBlocked"] = True
            invoice["autoBlockedAt"] = datetime.now().isoformat()
        elif lane == "REVIEW" and action == "under_review":
            invoice["status"] = "under_review"
            invoice["autoReview"] = True

    # Store triage result on the invoice itself
    invoice["triageLane"] = lane
    invoice["triageReasons"] = triage.get("reasons", [])
    invoice["triageConfidence"] = triage.get("confidence", 0)
    invoice["triageAt"] = triage.get("triageAt")
    invoice["vendorRiskScore"] = triage.get("vendorRisk", {}).get("score", 0)
    invoice["vendorRiskLevel"] = triage.get("vendorRisk", {}).get("level", "unknown")

    # Activity log
    db["activity_log"].append({
        "id": str(uuid.uuid4())[:8],
        "action": f"triage_{lane.lower()}",
        "documentId": invoice["id"],
        "documentNumber": invoice.get("invoiceNumber", ""),
        "vendor": invoice.get("vendor", ""),
        "lane": lane,
        "autoAction": action,
        "triageConfidence": triage.get("confidence", 0),
        "vendorRisk": triage.get("vendorRisk", {}).get("score", 0),
        "anomalyCount": triage.get("anomalySummary", {}).get("total", 0),
        "reasons": triage.get("reasons", [])[:3],  # First 3 reasons for log compactness
        "timestamp": datetime.now().isoformat(),
    })

# ============================================================
# EXTRACTION PROMPT
# ============================================================

def build_correction_hints(vendor_name: str, doc_type: str, db: dict) -> str:
    """Build extraction hints from past human corrections for this vendor.
    This is the feedback loop: corrections improve future extractions."""
    patterns = db.get("correction_patterns", [])
    if not patterns:
        return ""

    # Find patterns matching this vendor (fuzzy)
    relevant = []
    for p in patterns:
        if vendor_similarity(vendor_name, p.get("vendor", "")) >= 0.7:
            relevant.append(p)
        elif p.get("vendor") == "_global":  # Global patterns apply to all vendors
            relevant.append(p)

    if not relevant:
        return ""

    hints = ["\n\nCORRECTION HISTORY (learn from past human corrections for this vendor):"]
    for p in relevant[-10:]:  # Last 10 relevant corrections
        field = p.get("field", "")
        wrong = p.get("extracted_value", "")
        correct = p.get("corrected_value", "")
        note = p.get("note", "")
        if field and (wrong or correct):
            hints.append(f"- Field '{field}': AI extracted '{wrong}' but human corrected to '{correct}'.{' ' + note if note else ''}")

    if len(hints) == 1:
        return ""

    hints.append("Apply these learned patterns to improve extraction accuracy.")
    return "\n".join(hints)


def learn_from_correction(doc: dict, field: str, old_value, new_value, db: dict):
    """Record a correction pattern so future extractions can learn from it."""
    if old_value == new_value:
        return

    pattern = {
        "id": str(uuid.uuid4())[:8],
        "vendor": doc.get("vendor", ""),
        "vendorNormalized": doc.get("vendorNormalized", ""),
        "documentType": doc.get("type", ""),
        "field": field,
        "extracted_value": str(old_value) if old_value is not None else "",
        "corrected_value": str(new_value) if new_value is not None else "",
        "note": "",
        "learnedAt": datetime.now().isoformat(),
        "documentId": doc.get("id", ""),
        "correctionCount": 1
    }

    # Check if we already have a similar pattern — increment count instead of duplicating
    existing = db.get("correction_patterns", [])
    for ep in existing:
        if (ep.get("vendorNormalized") == pattern["vendorNormalized"]
            and ep.get("field") == field
            and ep.get("extracted_value") == pattern["extracted_value"]):
            ep["corrected_value"] = pattern["corrected_value"]
            ep["correctionCount"] = ep.get("correctionCount", 1) + 1
            ep["learnedAt"] = pattern["learnedAt"]
            return

    existing.append(pattern)
    # Keep max 200 patterns
    if len(existing) > 200:
        db["correction_patterns"] = existing[-200:]


EXTRACTION_PROMPT = """You are an expert financial document processor. Analyze this document and extract structured data.

Determine if this is an INVOICE, PURCHASE ORDER, CONTRACT, CREDIT NOTE, or DEBIT NOTE, then extract ALL available fields.

Respond ONLY with a valid JSON object (no markdown, no backticks) with this structure:

{
  "document_type": "invoice" or "purchase_order" or "contract" or "credit_note" or "debit_note",
  "document_number": "the document number",
  "vendor_name": "company/vendor name",
  "currency": "USD or INR or EUR or GBP — detect from currency symbols ($, Rs, ₹, €, £) or text",
  "subtotal": 10000.00,
  "tax_details": [
    {"type": "GST/CGST/SGST/IGST/VAT/Sales Tax/etc", "rate": 18.0, "amount": 1800.00}
  ],
  "total_amount": 11800.00,
  "issue_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD or null",
  "delivery_date": "YYYY-MM-DD or null",
  "po_reference": "PO number referenced in invoice, or null",
  "original_invoice_ref": "for credit/debit notes — the original invoice number, or null",
  "payment_terms": "Net 30, 2/10 Net 30, etc. or null",
  "early_payment_discount": {"discount_percent": 2.0, "days": 10} or null,
  "line_items": [{"description": "item", "quantity": 5, "unit_price": 100.00, "total": 500.00}],
  "pricing_terms": [{"item": "item name", "rate": 100.00, "unit": "per unit/per hour/per year"}],
  "contract_terms": {
    "effective_date": "YYYY-MM-DD or null",
    "expiry_date": "YYYY-MM-DD or null",
    "auto_renewal": true/false,
    "renewal_notice_days": 60,
    "liability_cap": 500000 or null,
    "warranty_months": 36 or null
  },
  "parties": ["Party A", "Party B"],
  "notes": "any notes",
  "bill_to": "billing address or null",
  "ship_to": "shipping address or null",
  "extraction_confidence": 0-100
}

CRITICAL RULES:
- subtotal = sum of all line_items totals (pre-tax)
- total_amount = subtotal + all taxes
- If the document shows a single total with no tax breakdown, set subtotal = total_amount and tax_details = []
- Detect "2/10 Net 30" style terms as early_payment_discount
- For credit/debit notes, extract original_invoice_ref
- Be precise with numbers. If a field is not visible, use null."""

ANOMALY_PROMPT = """You are an expert F&A auditor. Analyze this invoice against the PO, contract, and history.

INVOICE:
{invoice_json}

PURCHASE ORDER:
{po_json}

CONTRACT:
{contract_json}

PREVIOUS INVOICES FROM THIS VENDOR:
{history_json}

Check for ALL anomaly types:
1. PRICE_OVERCHARGE — unit price exceeds contract rate or PO price
2. QUANTITY_MISMATCH — billed quantity exceeds PO authorized quantity
3. TERMS_VIOLATION — payment terms differ from contract
4. UNAUTHORIZED_ITEM — line items on invoice not present in PO
5. DUPLICATE_INVOICE — same invoice number, or same vendor+amount+date as previous invoice
6. RATE_OVERCHARGE — hourly/daily rates exceed contract rates
7. HOURS_EXCEEDED — billed hours/quantities exceed PO authorization
8. AMOUNT_DISCREPANCY — total differs significantly from PO (account for tax — POs are typically pre-tax, invoices include tax)
9. MISSING_PO — invoice has no PO reference
10. OVER_INVOICED — cumulative invoices against this PO exceed PO total
11. LINE_ITEM_TOTAL_MISMATCH — sum of line items doesn't equal subtotal
12. TAX_RATE_ANOMALY — tax rate seems incorrect for the jurisdiction or item type
13. EARLY_PAYMENT_DISCOUNT — eligible for discount if paid early, flag as opportunity
14. CURRENCY_MISMATCH — invoice currency differs from PO currency

IMPORTANT: When comparing invoice total vs PO total, account for tax. POs are typically pre-tax amounts. Compare invoice SUBTOTAL (pre-tax) against PO total, NOT invoice total (post-tax) vs PO total.

Use the actual currency ({currency}) in descriptions. Do not assume USD.

Severity: high (>10% variance or systematic issue), medium (5-10% or one-off), low (<5% or informational).

Respond ONLY with JSON array:
[{{"type": "PRICE_OVERCHARGE", "severity": "high", "description": "explanation with {currency} amounts", "amount_at_risk": 70.00, "contract_clause": "Section 2", "recommendation": "action"}}]

If no anomalies: []
Be thorough. Check every line item."""


# ============================================================
# CLAUDE API
# ============================================================
async def extract_with_claude(file_path: str, file_name: str, media_type: str, vendor_hint: str = "", doc_type_hint: str = "") -> dict:
    if not USE_REAL_API:
        return await mock_extraction(file_name)

    client = anthropic.Anthropic()
    with open(file_path, "rb") as f:
        b64_data = base64.standard_b64encode(f.read()).decode("utf-8")

    if media_type == "application/pdf":
        content_block = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64_data}}
    else:
        img_type = media_type if media_type in ["image/jpeg", "image/png", "image/gif", "image/webp"] else "image/png"
        content_block = {"type": "image", "source": {"type": "base64", "media_type": img_type, "data": b64_data}}

    # Build prompt with correction hints + RAG context
    db = get_db()
    hints = build_correction_hints(vendor_hint or file_name, doc_type_hint or "auto", db)
    rag_context = await get_extraction_context(vendor_hint or file_name, doc_type_hint or "auto")
    prompt = EXTRACTION_PROMPT + hints + rag_context

    try:
        print(f"[Extract] Calling Claude API for '{file_name}' (media_type={media_type})")
        msg = client.messages.create(model="claude-sonnet-4-20250514", max_tokens=4000,
            messages=[{"role": "user", "content": [content_block, {"type": "text", "text": prompt}]}])
        text = msg.content[0].text.strip()
        print(f"[Extract] Raw response (first 200 chars): {text[:200]}")

        # Strip markdown code fences if present
        if text.startswith("```"):
            first_newline = text.index("\n") if "\n" in text else len(text)
            text = text[first_newline + 1:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        result = json.loads(text)
        result["_confidence"] = result.pop("extraction_confidence", 92)
        result["_source"] = "claude_api"
        print(f"[Extract] Success: type={result.get('document_type')}, vendor={result.get('vendor_name')}")
        return result
    except Exception as e:
        print(f"[Extract] ERROR for '{file_name}': {type(e).__name__}: {e}")
        import traceback; traceback.print_exc()
        return await mock_extraction(file_name)


async def detect_anomalies_with_claude(invoice, po, contract, history, tolerances=None) -> list:
    if not USE_REAL_API:
        return detect_anomalies_rule_based(invoice, po, contract, history, tolerances)

    client = anthropic.Anthropic()
    def clean(d):
        if not d: return "Not available"
        skip = {"rawExtraction", "extractionSource", "extractedAt", "billTo", "shipTo"}
        return json.dumps({k: v for k, v in d.items() if k not in skip}, indent=2, default=str)

    cur = invoice.get("currency", "USD")
    rag_context = await get_anomaly_context(invoice)

    # Inject dynamic tolerances into prompt so Claude adjusts its sensitivity
    tol_context = ""
    if tolerances and tolerances.get("risk_adjusted"):
        tol_context = f"""

VENDOR RISK ADJUSTMENT: This vendor has a risk score of {tolerances.get('risk_score', 0):.0f}/100 ({tolerances.get('risk_level', 'unknown')} risk).
Apply TIGHTER thresholds: amount tolerance {tolerances['amount_tolerance_pct']:.1f}% (normal: {AMOUNT_TOLERANCE_PCT}%), price tolerance {tolerances['price_tolerance_pct']:.1f}% (normal: {PRICE_TOLERANCE_PCT}%).
Be more aggressive flagging anomalies for this vendor."""

    prompt = ANOMALY_PROMPT.format(
        invoice_json=clean(invoice), po_json=clean(po), contract_json=clean(contract),
        currency=cur,
        history_json=json.dumps([{"invoiceNumber": h.get("invoiceNumber"), "vendor": h.get("vendor"),
            "amount": h.get("amount"), "subtotal": h.get("subtotal"), "lineItems": h.get("lineItems", []),
            "issueDate": h.get("issueDate"), "currency": h.get("currency")
        } for h in history[-10:]], indent=2, default=str) if history else "No previous invoices")
    prompt += tol_context + rag_context

    try:
        msg = client.messages.create(model="claude-sonnet-4-20250514", max_tokens=4000,
            messages=[{"role": "user", "content": prompt}])
        text = msg.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"): text = text[:-3]
            text = text.strip()
        result = json.loads(text)
        return result if isinstance(result, list) else []
    except Exception as e:
        print(f"Anomaly detection error: {e}")
        return detect_anomalies_rule_based(invoice, po, contract, history, tolerances)


# ============================================================
# RULE-BASED ANOMALY DETECTION (F&A hardened)
# ============================================================
def detect_anomalies_rule_based(invoice, po, contract, history, tolerances=None) -> list:
    anomalies = []
    cur = invoice.get("currency", "USD")
    sym = currency_symbol(cur)
    inv_total = invoice.get("amount", 0)
    inv_subtotal = invoice.get("subtotal") or inv_total  # pre-tax amount

    # ── F3 Integration: Use dynamic tolerances if provided ──
    amt_tol_pct = (tolerances or {}).get("amount_tolerance_pct", AMOUNT_TOLERANCE_PCT)
    prc_tol_pct = (tolerances or {}).get("price_tolerance_pct", PRICE_TOLERANCE_PCT)
    risk_adjusted = (tolerances or {}).get("risk_adjusted", False)
    risk_note = f" [Tightened: vendor risk {tolerances.get('risk_level', '?')} ({tolerances.get('risk_score', 0):.0f})]" if risk_adjusted else ""

    # ── 1. LINE ITEM TOTAL VERIFICATION ──────────────────────
    li_sum = sum(li.get("total", 0) for li in invoice.get("lineItems", []))
    if li_sum > 0 and inv_subtotal > 0:
        diff = abs(li_sum - inv_subtotal)
        if diff > 0.50:  # Allow for rounding
            anomalies.append({"type": "LINE_ITEM_TOTAL_MISMATCH",
                "severity": severity_for_amount(diff, inv_subtotal),
                "description": f"Sum of line items ({sym}{li_sum:,.2f}) does not match subtotal ({sym}{inv_subtotal:,.2f}). Difference: {sym}{diff:,.2f}",
                "amount_at_risk": round(diff, 2), "contract_clause": None,
                "recommendation": "Verify line item totals. Possible hidden charges or calculation error."})

    # ── 2. MISSING PO CHECK ──────────────────────────────────
    if not po and not invoice.get("poReference"):
        anomalies.append({"type": "MISSING_PO", "severity": "medium",
            "description": f"Invoice {invoice.get('invoiceNumber', '?')} has no purchase order reference.",
            "amount_at_risk": inv_total, "contract_clause": None,
            "recommendation": "Verify this purchase was authorized before payment."})
    elif not po and invoice.get("poReference"):
        # PO reference exists on invoice but no matching PO found in system
        anomalies.append({"type": "MISSING_PO", "severity": "medium",
            "description": f"Invoice references {invoice['poReference']} but no matching PO found in the system.",
            "amount_at_risk": inv_total, "contract_clause": None,
            "recommendation": f"Upload or locate PO {invoice['poReference']} before approving payment."})

    # ── 3. PO COMPARISON (tax-aware) ─────────────────────────
    if po:
        po_amt = po.get("amount", 0)
        # Compare SUBTOTAL (pre-tax) against PO amount (which is typically pre-tax)
        compare_amt = inv_subtotal
        tolerance = po_amt * (amt_tol_pct / 100)

        if po_amt > 0 and compare_amt > po_amt + tolerance:
            diff = compare_amt - po_amt
            anomalies.append({"type": "AMOUNT_DISCREPANCY",
                "severity": severity_for_amount(diff, po_amt),
                "description": f"Invoice subtotal (pre-tax) {sym}{compare_amt:,.2f} exceeds PO {sym}{po_amt:,.2f} by {sym}{diff:,.2f}",
                "amount_at_risk": round(diff, 2), "contract_clause": None,
                "recommendation": f"Review line items. Pre-tax overcharge: {sym}{diff:,.2f}"})

        # Line item comparison
        inv_items = {li.get("description", "").lower().strip(): li for li in invoice.get("lineItems", [])}
        po_items = {li.get("description", "").lower().strip(): li for li in po.get("lineItems", [])}

        for desc, inv_li in inv_items.items():
            # Fuzzy match line item descriptions
            matched = None
            best_sim = 0
            for pd, pli in po_items.items():
                sim = SequenceMatcher(None, desc, pd).ratio()
                if sim > 0.7 and sim > best_sim:
                    matched = pli; best_sim = sim
                elif desc in pd or pd in desc:
                    matched = pli; best_sim = 1.0

            if matched:
                # Quantity check
                iq, pq = inv_li.get("quantity", 0), matched.get("quantity", 0)
                if iq > pq > 0:
                    extra = iq - pq
                    price = inv_li.get("unitPrice", 0)
                    risk = extra * price
                    anomalies.append({"type": "QUANTITY_MISMATCH",
                        "severity": severity_for_amount(risk, po_amt),
                        "description": f"'{inv_li['description']}': Billed {iq} units, PO authorized {pq}. {extra} unauthorized.",
                        "amount_at_risk": round(risk, 2), "contract_clause": None,
                        "recommendation": f"Dispute {extra} extra units ({sym}{risk:,.2f})"})

                # Price check (against PO)
                ip, pp = inv_li.get("unitPrice", 0), matched.get("unitPrice", 0)
                price_tol = pp * (prc_tol_pct / 100)
                if ip > pp + price_tol and pp > 0:
                    d = ip - pp; q = inv_li.get("quantity", 1); risk = d * q
                    anomalies.append({"type": "PRICE_OVERCHARGE",
                        "severity": severity_for_amount(risk, po_amt),
                        "description": f"'{inv_li['description']}': {sym}{ip:,.2f}/unit vs PO {sym}{pp:,.2f}/unit{risk_note}",
                        "amount_at_risk": round(risk, 2), "contract_clause": None,
                        "recommendation": f"Request credit: {sym}{risk:,.2f}"})
            else:
                if inv_li.get("total", 0) > 0:
                    anomalies.append({"type": "UNAUTHORIZED_ITEM",
                        "severity": severity_for_amount(inv_li["total"], po_amt) if po_amt > 0 else "medium",
                        "description": f"'{inv_li['description']}' ({sym}{inv_li['total']:,.2f}) not found in purchase order.",
                        "amount_at_risk": inv_li["total"], "contract_clause": None,
                        "recommendation": "Verify authorization before payment."})

    # ── 4. CONTRACT PRICING CHECK ────────────────────────────
    if contract:
        # Check if contract is expired (F&A critical)
        ct = contract.get("contractTerms", {})
        expiry = ct.get("expiry_date")
        if expiry:
            try:
                exp_date = datetime.fromisoformat(expiry)
                inv_date = datetime.fromisoformat(invoice.get("issueDate", "")) if invoice.get("issueDate") else datetime.now()
                if inv_date > exp_date:
                    days_expired = (inv_date - exp_date).days
                    anomalies.append({"type": "TERMS_VIOLATION", "severity": "high",
                        "description": f"Invoice issued {days_expired} days after contract expired on {expiry}. Billing under expired contract.",
                        "amount_at_risk": inv_total, "contract_clause": f"Contract expired: {expiry}",
                        "recommendation": "Do not pay. Renew contract or negotiate new terms before processing."})
            except: pass

        if contract.get("pricingTerms"):
            for pt in contract.get("pricingTerms", []):
                contract_item = (pt.get("item") or "").lower().strip()
                contract_rate = pt.get("rate", 0)
                if not contract_item or not contract_rate: continue

                for inv_li in invoice.get("lineItems", []):
                    inv_desc = (inv_li.get("description") or "").lower().strip()
                    sim = SequenceMatcher(None, contract_item, inv_desc).ratio()
                    if sim > 0.6 or contract_item in inv_desc or inv_desc in contract_item:
                        inv_price = inv_li.get("unitPrice", 0)
                        if inv_price > contract_rate * (1 + prc_tol_pct / 100):
                            diff = inv_price - contract_rate
                            qty = inv_li.get("quantity", 1)
                            risk = diff * qty
                            anomalies.append({"type": "PRICE_OVERCHARGE",
                                "severity": severity_for_amount(risk, inv_total),
                                "description": f"'{inv_li['description']}': {sym}{inv_price:,.2f}/{pt.get('unit', 'unit')} vs contract rate {sym}{contract_rate:,.2f}/{pt.get('unit', 'unit')}",
                                "amount_at_risk": round(risk, 2),
                                "contract_clause": f"Contract pricing: {pt.get('item')} at {sym}{contract_rate:,.2f}/{pt.get('unit', 'unit')}",
                                "recommendation": f"Vendor overcharging vs contract. Dispute {sym}{risk:,.2f}"})
                        break

    # Contract terms check
    if contract:
        it = (invoice.get("paymentTerms") or "").lower().strip()
        ct = (contract.get("paymentTerms") or "").lower().strip()
        if it and ct and it != ct:
            anomalies.append({"type": "TERMS_VIOLATION", "severity": "medium",
                "description": f"Invoice terms '{invoice.get('paymentTerms')}' differ from contract '{contract.get('paymentTerms')}'",
                "amount_at_risk": 0, "contract_clause": f"Contract: {contract.get('paymentTerms')}",
                "recommendation": "Enforce contract payment terms."})

    # ── 5. SMART DUPLICATE DETECTION ─────────────────────────
    for h in history:
        if h.get("id") == invoice.get("id"): continue

        dup_score = 0
        dup_reasons = []

        # Same invoice number from same vendor = definite duplicate
        if (h.get("invoiceNumber") and invoice.get("invoiceNumber") and
                h["invoiceNumber"].strip().lower() == invoice["invoiceNumber"].strip().lower()):
            dup_score = 100
            dup_reasons.append("identical invoice number")

        else:
            # Same amount check
            h_amt = h.get("amount", 0)
            if h_amt > 0 and inv_total > 0 and abs(h_amt - inv_total) / max(h_amt, inv_total) < 0.02:
                dup_score += 40
                dup_reasons.append("same amount")

            # Same date check
            if h.get("issueDate") and invoice.get("issueDate") and h["issueDate"] == invoice["issueDate"]:
                dup_score += 25
                dup_reasons.append("same date")
            elif h.get("issueDate") and invoice.get("issueDate"):
                try:
                    d1 = datetime.fromisoformat(h["issueDate"])
                    d2 = datetime.fromisoformat(invoice["issueDate"])
                    if abs((d1 - d2).days) <= DUPLICATE_DAYS_WINDOW:
                        dup_score += 10
                        dup_reasons.append(f"within {DUPLICATE_DAYS_WINDOW} days")
                except: pass

            # Same line items check
            h_items = set((li.get("description", "").lower(), li.get("quantity", 0), li.get("unitPrice", 0))
                         for li in h.get("lineItems", []))
            i_items = set((li.get("description", "").lower(), li.get("quantity", 0), li.get("unitPrice", 0))
                         for li in invoice.get("lineItems", []))
            if h_items and i_items and h_items == i_items:
                dup_score += 35
                dup_reasons.append("identical line items")
            elif h_items and i_items and len(h_items & i_items) > len(h_items) * 0.7:
                dup_score += 20
                dup_reasons.append("similar line items")

        if dup_score >= 60:
            anomalies.append({"type": "DUPLICATE_INVOICE",
                "severity": "high" if dup_score >= 80 else "medium",
                "description": f"Likely duplicate of {h.get('invoiceNumber', '?')} ({sym}{h.get('amount', 0):,.2f}). Signals: {', '.join(dup_reasons)}. Confidence: {dup_score}%",
                "amount_at_risk": inv_total, "contract_clause": None,
                "recommendation": "Verify this is not a duplicate payment. Do not process until confirmed."})
            # Report all potential duplicates for the auditor

    # ── 6. EARLY PAYMENT DISCOUNT OPPORTUNITY ────────────────
    epd = invoice.get("earlyPaymentDiscount")
    if epd and epd.get("discount_percent") and epd.get("days"):
        # EPD applies to pre-tax subtotal, not post-tax total
        savings = inv_subtotal * (epd["discount_percent"] / 100)
        anomalies.append({"type": "EARLY_PAYMENT_DISCOUNT", "severity": "low",
            "description": f"Eligible for {epd['discount_percent']}% discount ({sym}{savings:,.2f}) on subtotal if paid within {epd['days']} days",
            "amount_at_risk": round(-savings, 2),  # Negative = savings opportunity
            "contract_clause": f"Terms: {invoice.get('paymentTerms', '')}",
            "recommendation": f"Pay within {epd['days']} days to save {sym}{savings:,.2f}"})

    # ── 7. TAX RATE SANITY CHECK ─────────────────────────────
    tax_details = invoice.get("taxDetails", [])
    if tax_details and inv_subtotal > 0:
        total_tax = sum(t.get("amount", 0) for t in tax_details)
        effective_rate = (total_tax / inv_subtotal) * 100 if inv_subtotal > 0 else 0
        # Flag unusual tax rates
        if effective_rate > 30:
            anomalies.append({"type": "TAX_RATE_ANOMALY", "severity": "medium",
                "description": f"Effective tax rate is {effective_rate:.1f}% ({sym}{total_tax:,.2f} on {sym}{inv_subtotal:,.2f}). Unusually high.",
                "amount_at_risk": round(total_tax, 2), "contract_clause": None,
                "recommendation": "Verify tax calculation. Rate seems excessive."})
        elif effective_rate > 0 and effective_rate < 1:
            anomalies.append({"type": "TAX_RATE_ANOMALY", "severity": "low",
                "description": f"Effective tax rate is only {effective_rate:.1f}%. Unusually low — verify tax is applied correctly.",
                "amount_at_risk": 0, "contract_clause": None,
                "recommendation": "Confirm tax exemption or verify rate."})

    # ── 8. CURRENCY MISMATCH ─────────────────────────────────
    if po:
        po_cur = po.get("currency", "USD")
        inv_cur = invoice.get("currency", "USD")
        if po_cur != inv_cur:
            anomalies.append({"type": "CURRENCY_MISMATCH", "severity": "medium",
                "description": f"Currency mismatch: Invoice in {inv_cur}, PO in {po_cur}. Cannot compare amounts directly.",
                "amount_at_risk": 0, "contract_clause": None,
                "recommendation": f"Verify exchange rate and ensure amounts align. Invoice: {inv_cur}, PO: {po_cur}"})

    return anomalies


# ============================================================
# MOCK EXTRACTION
# ============================================================
async def mock_extraction(file_name: str) -> dict:
    """Mock extraction that returns deterministic data matching test documents.
    If file_name matches a known test document, returns exact data.
    Otherwise falls back to random generation for unknown files."""
    import random
    await asyncio.sleep(1.0)

    fn = file_name.lower().replace(" ", "_")

    # ── Deterministic test document library ──
    TEST_DOCS = _get_test_doc_library()
    for key, doc in TEST_DOCS.items():
        if key in fn:
            print(f"  Mock extraction: matched '{key}' → {doc.get('document_type')} / {doc.get('vendor_name')}")
            doc["_confidence"] = doc.pop("_confidence", 93)
            doc["_source"] = "mock_extraction"
            return doc

    # ── Fallback: random generation for unknown files ──
    print(f"  Mock extraction: no match for '{file_name}', generating random data")
    vendors = ["Acme Manufacturing Co.", "TechNova Systems", "GlobalParts International", "Meridian Supply Group", "Atlas Industrial Corp."]
    items_pool = [("Server Rack Units (42U)", 2, 4500), ("Managed Network Switch", 5, 1200), ("Cloud License (Annual)", 1, 24000),
        ("Consulting Hours", 40, 175), ("Maintenance Contract", 1, 8500), ("Power Distribution Unit", 4, 850)]

    is_contract = "contract" in fn or "agreement" in fn
    is_credit = "credit" in fn or "cn_" in fn
    is_debit = "debit" in fn or "dn_" in fn
    is_invoice = "inv" in fn or "invoice" in fn
    is_po = "po" in fn or "purchase" in fn
    if not any([is_contract, is_credit, is_debit, is_invoice, is_po]):
        is_invoice = random.random() > 0.4; is_po = not is_invoice

    vendor = random.choice(vendors)
    items = random.sample(items_pool, random.randint(1, 4))
    line_items = [{"description": d, "quantity": max(1, q + random.randint(-1, 3)),
        "unit_price": round(p * (0.9 + random.random() * 0.2), 2),
        "total": round(max(1, q + random.randint(-1, 3)) * round(p * (0.9 + random.random() * 0.2), 2), 2)} for d, q, p in items]
    subtotal = sum(li["total"] for li in line_items)
    tax_rate = random.choice([0, 5, 12, 18])
    tax_amt = round(subtotal * tax_rate / 100, 2)
    total = round(subtotal + tax_amt, 2)
    issue = datetime.now() - timedelta(days=random.randint(5, 60))

    base = {"vendor_name": vendor, "subtotal": round(subtotal, 2), "total_amount": total,
        "tax_details": [{"type": "GST", "rate": tax_rate, "amount": tax_amt}] if tax_rate > 0 else [],
        "issue_date": issue.strftime("%Y-%m-%d"), "line_items": line_items,
        "currency": random.choice(["USD", "INR"]), "notes": None, "bill_to": "Acme Corporation",
        "_confidence": round(85 + random.random() * 13, 1), "_source": "mock_extraction",
        "pricing_terms": [], "contract_terms": {}, "parties": [], "early_payment_discount": None}

    if is_contract:
        base.update({"document_type": "contract", "document_number": f"AGR-{random.randint(100, 999)}",
            "payment_terms": "Net 30",
            "pricing_terms": [{"item": li["description"], "rate": li["unit_price"], "unit": "per unit"} for li in line_items[:3]],
            "contract_terms": {"effective_date": issue.strftime("%Y-%m-%d"),
                "expiry_date": (issue + timedelta(days=730)).strftime("%Y-%m-%d"),
                "auto_renewal": True, "renewal_notice_days": 60, "liability_cap": 500000},
            "parties": ["Acme Corporation", vendor]})
    elif is_credit or is_debit:
        base.update({"document_type": "credit_note" if is_credit else "debit_note",
            "document_number": f"{'CN' if is_credit else 'DN'}-{random.randint(1000, 9999)}",
            "original_invoice_ref": f"INV-{random.randint(10000, 99999)}",
            "payment_terms": "Net 30"})
    elif is_invoice:
        terms = random.choice(["Net 30", "Net 45", "2/10 Net 30"])
        epd = {"discount_percent": 2.0, "days": 10} if "2/10" in terms else None
        base.update({"document_type": "invoice", "document_number": f"INV-{random.randint(10000, 99999)}",
            "due_date": (issue + timedelta(days=30)).strftime("%Y-%m-%d"),
            "po_reference": f"PO-2025-{random.randint(1000, 9999)}" if random.random() > 0.3 else None,
            "payment_terms": terms, "early_payment_discount": epd})
    else:
        base.update({"document_type": "purchase_order",
            "document_number": f"PO-2025-{random.randint(1000, 9999)}",
            "delivery_date": (issue + timedelta(days=30)).strftime("%Y-%m-%d"), "payment_terms": "Net 30"})
    return base


def _get_test_doc_library() -> dict:
    """Returns a dictionary of filename-key → extraction data for all test documents.
    Keys are lowercase substrings matched against the uploaded filename."""
    now = datetime.now()
    d = lambda days_ago: (now - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    dfwd = lambda days: (now + timedelta(days=days)).strftime("%Y-%m-%d")

    return {
        # ═══════════════════════ CONTRACTS ═══════════════════════
        "contract_meridian": {
            "document_type": "contract", "document_number": "AGR-2025-001",
            "vendor_name": "Meridian Supply Group LLC", "currency": "USD",
            "subtotal": 200000, "total_amount": 200000,
            "issue_date": d(180), "tax_details": [], "line_items": [],
            "payment_terms": "Net 30", "notes": "Master Supply Agreement",
            "bill_to": None, "early_payment_discount": None,
            "pricing_terms": [
                {"item": "Office Furniture Set", "rate": 1500, "unit": "unit"},
                {"item": "Ergonomic Desk Chair", "rate": 500, "unit": "unit"},
                {"item": "Dell Latitude Laptop", "rate": 1800, "unit": "unit"},
                {"item": "Monitor 27-inch 4K", "rate": 600, "unit": "unit"},
            ],
            "contract_terms": {"effective_date": d(180), "expiry_date": dfwd(365),
                "liability_cap": 200000, "payment_terms": "Net 30", "auto_renewal": True},
            "parties": ["Acme Corporation", "Meridian Supply Group LLC"],
            "_confidence": 95,
        },
        "contract_techvista": {
            "document_type": "contract", "document_number": "AGR-2025-002",
            "vendor_name": "TechVista Solutions Pvt Ltd", "currency": "INR",
            "subtotal": 10000000, "total_amount": 10000000,
            "issue_date": d(120), "tax_details": [], "line_items": [],
            "payment_terms": "Net 45", "notes": "IT Services Agreement",
            "bill_to": None, "early_payment_discount": None,
            "pricing_terms": [
                {"item": "Software Development Services", "rate": 3500, "unit": "hour"},
                {"item": "QA Testing Services", "rate": 2500, "unit": "hour"},
                {"item": "Project Management", "rate": 3000, "unit": "hour"},
            ],
            "contract_terms": {"effective_date": d(120), "expiry_date": dfwd(365),
                "liability_cap": 10000000, "payment_terms": "Net 45"},
            "parties": ["Acme Corporation", "TechVista Solutions Pvt Ltd"],
            "_confidence": 93,
        },
        "contract_pinnacle": {
            "document_type": "contract", "document_number": "AGR-2024-005",
            "vendor_name": "Pinnacle Industrial Services", "currency": "USD",
            "subtotal": 100000, "total_amount": 100000,
            "issue_date": d(400), "tax_details": [], "line_items": [],
            "payment_terms": "Net 30", "notes": "Maintenance Agreement",
            "bill_to": None, "early_payment_discount": None,
            "pricing_terms": [
                {"item": "Annual Maintenance Contract", "rate": 18000, "unit": "unit"},
                {"item": "Emergency Repair Services", "rate": 1200, "unit": "unit"},
            ],
            "contract_terms": {"effective_date": d(400), "expiry_date": d(45),
                "liability_cap": 100000, "payment_terms": "Net 30"},
            "parties": ["Acme Corporation", "Pinnacle Industrial Services"],
            "_confidence": 91,
        },
        "contract_atlas": {
            "document_type": "contract", "document_number": "AGR-2025-004",
            "vendor_name": "Atlas Cloud Infrastructure Inc", "currency": "USD",
            "subtotal": 150000, "total_amount": 150000,
            "issue_date": d(200), "tax_details": [], "line_items": [],
            "payment_terms": "Net 30", "notes": "Cloud Services Agreement",
            "bill_to": None, "early_payment_discount": None,
            "pricing_terms": [
                {"item": "Cloud Compute Instance", "rate": 4000, "unit": "month"},
                {"item": "Managed Database Service", "rate": 1500, "unit": "month"},
                {"item": "CDN & Storage", "rate": 500, "unit": "month"},
            ],
            "contract_terms": {"effective_date": d(200), "expiry_date": dfwd(365),
                "liability_cap": 150000, "payment_terms": "Net 30"},
            "parties": ["Acme Corporation", "Atlas Cloud Infrastructure Inc"],
            "_confidence": 94,
        },

        # ═══════════════════════ PURCHASE ORDERS ═══════════════════════
        "po_meridian_office": {
            "document_type": "purchase_order", "document_number": "PO-2025-1001",
            "vendor_name": "Meridian Supply Group LLC", "currency": "USD",
            "subtotal": 25000, "total_amount": 25000,
            "issue_date": d(60), "delivery_date": d(30), "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Office Furniture Set", "quantity": 10, "unit_price": 1500, "total": 15000},
                {"description": "Ergonomic Desk Chair", "quantity": 20, "unit_price": 500, "total": 10000},
            ],
            "bill_to": None, "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 95,
        },
        "po_meridian_it": {
            "document_type": "purchase_order", "document_number": "PO-2025-1002",
            "vendor_name": "Meridian Supply Group LLC", "currency": "USD",
            "subtotal": 45000, "total_amount": 45000,
            "issue_date": d(90), "delivery_date": d(45), "tax_details": [], "payment_terms": "2/10 Net 30",
            "line_items": [
                {"description": "Dell Latitude Laptop", "quantity": 15, "unit_price": 1800, "total": 27000},
                {"description": "Monitor 27-inch 4K", "quantity": 15, "unit_price": 600, "total": 9000},
                {"description": "Docking Station USB-C", "quantity": 15, "unit_price": 200, "total": 3000},
                {"description": "Wireless Keyboard Mouse Set", "quantity": 15, "unit_price": 80, "total": 1200},
                {"description": "Laptop Bag Premium", "quantity": 15, "unit_price": 120, "total": 1800},
                {"description": "Setup & Configuration", "quantity": 15, "unit_price": 200, "total": 3000},
            ],
            "bill_to": None, "notes": None,
            "early_payment_discount": {"discount_percent": 2, "days": 10},
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 92,
        },
        "po_techvista": {
            "document_type": "purchase_order", "document_number": "PO-2025-2001",
            "vendor_name": "TechVista Solutions Pvt Ltd", "currency": "INR",
            "subtotal": 3500000, "total_amount": 3500000,
            "issue_date": d(45), "delivery_date": d(15), "tax_details": [], "payment_terms": "Net 45",
            "line_items": [
                {"description": "Software Development Services", "quantity": 700, "unit_price": 3500, "total": 2450000},
                {"description": "QA Testing Services", "quantity": 300, "unit_price": 2500, "total": 750000},
                {"description": "Project Management", "quantity": 100, "unit_price": 3000, "total": 300000},
            ],
            "bill_to": None, "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 93,
        },
        "po_atlas": {
            "document_type": "purchase_order", "document_number": "PO-2025-4001",
            "vendor_name": "Atlas Cloud Infrastructure Inc", "currency": "USD",
            "subtotal": 72000, "total_amount": 72000,
            "issue_date": d(40), "delivery_date": d(10), "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Cloud Compute Instance (Annual)", "quantity": 12, "unit_price": 4000, "total": 48000},
                {"description": "Managed Database Service", "quantity": 12, "unit_price": 1500, "total": 18000},
                {"description": "CDN & Storage", "quantity": 12, "unit_price": 500, "total": 6000},
            ],
            "bill_to": None, "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 91,
        },
        "po_pinnacle_maint": {
            "document_type": "purchase_order", "document_number": "PO-2025-6001",
            "vendor_name": "Pinnacle Industrial Services", "currency": "USD",
            "subtotal": 35000, "total_amount": 35000,
            "issue_date": d(55), "delivery_date": d(25), "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Annual Maintenance Contract", "quantity": 1, "unit_price": 20000, "total": 20000},
                {"description": "Emergency Repair Services", "quantity": 10, "unit_price": 1500, "total": 15000},
            ],
            "bill_to": None, "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 88,
        },
        "po_pinnacle_parts": {
            "document_type": "purchase_order", "document_number": "PO-2025-6002",
            "vendor_name": "Pinnacle Industrial Services", "currency": "USD",
            "subtotal": 12000, "total_amount": 12000,
            "issue_date": d(40), "delivery_date": d(10), "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Replacement Parts Kit", "quantity": 6, "unit_price": 2000, "total": 12000},
            ],
            "bill_to": None, "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 90,
        },

        # ═══════════════════════ INVOICES: CLEAN → AUTO_APPROVE ═══════════════════════
        "inv_meridian_office": {
            "document_type": "invoice", "document_number": "INV-2025-001",
            "vendor_name": "Meridian Supply Group LLC", "currency": "USD",
            "subtotal": 25000, "total_amount": 25000,
            "issue_date": d(14), "due_date": dfwd(15), "po_reference": "PO-2025-1001",
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Office Furniture Set", "quantity": 10, "unit_price": 1500, "total": 15000},
                {"description": "Ergonomic Desk Chair", "quantity": 20, "unit_price": 500, "total": 10000},
            ],
            "bill_to": "Acme Corporation", "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 95,
        },
        "inv_techvista_dev_jan": {
            "document_type": "invoice", "document_number": "TV-INV-2025-0042",
            "vendor_name": "TechVista Solutions Pvt Ltd", "currency": "INR",
            "subtotal": 1800000, "total_amount": 2124000,
            "issue_date": d(12), "due_date": dfwd(5), "po_reference": "PO-2025-2001",
            "tax_details": [{"type": "CGST", "rate": 9, "amount": 162000}, {"type": "SGST", "rate": 9, "amount": 162000}],
            "payment_terms": "Net 45",
            "line_items": [
                {"description": "Software Development Services", "quantity": 400, "unit_price": 3500, "total": 1400000},
                {"description": "QA Testing Services", "quantity": 160, "unit_price": 2500, "total": 400000},
            ],
            "bill_to": "Acme Corporation", "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 93,
        },
        "inv_meridian_it_batch": {
            "document_type": "invoice", "document_number": "INV-2025-004",
            "vendor_name": "Meridian Supply Group LLC", "currency": "USD",
            "subtotal": 22500, "total_amount": 22500,
            "issue_date": d(10), "due_date": dfwd(10), "po_reference": "PO-2025-1002",
            "tax_details": [], "payment_terms": "2/10 Net 30",
            "line_items": [
                {"description": "Dell Latitude Laptop", "quantity": 8, "unit_price": 1800, "total": 14400},
                {"description": "Monitor 27-inch 4K", "quantity": 8, "unit_price": 600, "total": 4800},
                {"description": "Docking Station USB-C", "quantity": 8, "unit_price": 200, "total": 1600},
                {"description": "Wireless Keyboard Mouse Set", "quantity": 8, "unit_price": 80, "total": 640},
                {"description": "Laptop Bag Premium", "quantity": 8, "unit_price": 120, "total": 960},
                {"description": "Setup & Configuration", "quantity": 1, "unit_price": 100, "total": 100},
            ],
            "bill_to": "Acme Corporation", "notes": None,
            "early_payment_discount": {"discount_percent": 2, "days": 10},
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 92,
        },

        # ═══════════════════════ INVOICES: REVIEW ═══════════════════════
        "inv_atlas_cloud_overcharge": {
            "document_type": "invoice", "document_number": "AC-INV-2025-0112",
            "vendor_name": "Atlas Cloud Infrastructure Inc", "currency": "USD",
            "subtotal": 76500, "total_amount": 76500,
            "issue_date": d(5), "due_date": dfwd(5), "po_reference": "PO-2025-4001",
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Cloud Compute Instance (Annual)", "quantity": 12, "unit_price": 4250, "total": 51000},
                {"description": "Managed Database Service", "quantity": 12, "unit_price": 1500, "total": 18000},
                {"description": "CDN & Storage", "quantity": 12, "unit_price": 625, "total": 7500},
            ],
            "bill_to": "Acme Corporation", "notes": "Rate adjustment applied per Q1 review",
            "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 91,
        },
        "inv_techvista_feb_igst": {
            "document_type": "invoice", "document_number": "TV-INV-2025-0056",
            "vendor_name": "TechVista Solutions Pvt Ltd", "currency": "INR",
            "subtotal": 1200000, "total_amount": 1416000,
            "issue_date": d(1), "due_date": dfwd(1), "po_reference": "PO-2025-2001",
            "tax_details": [{"type": "IGST", "rate": 18, "amount": 216000}],
            "payment_terms": "Net 45",
            "line_items": [
                {"description": "Software Development Services", "quantity": 300, "unit_price": 3500, "total": 1050000},
                {"description": "Project Management", "quantity": 50, "unit_price": 3000, "total": 150000},
            ],
            "bill_to": "Acme Corporation", "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 92,
        },
        "inv_atlas_no_po": {
            "document_type": "invoice", "document_number": "AC-INV-2025-0145",
            "vendor_name": "Atlas Cloud Infrastructure Inc", "currency": "USD",
            "subtotal": 23000, "total_amount": 23000,
            "issue_date": d(1), "due_date": dfwd(2), "po_reference": None,
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Premium Support Package", "quantity": 1, "unit_price": 18000, "total": 18000},
                {"description": "Data Migration Service", "quantity": 1, "unit_price": 5000, "total": 5000},
            ],
            "bill_to": "Acme Corporation",
            "notes": "Standalone service — no PO required per verbal agreement",
            "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 90,
        },

        # ═══════════════════════ INVOICES: BLOCK ═══════════════════════
        "inv_pinnacle_expired": {
            "document_type": "invoice", "document_number": "PIN-2025-0033",
            "vendor_name": "Pinnacle Industrial Services", "currency": "USD",
            "subtotal": 22500, "total_amount": 22500,
            "issue_date": d(4), "due_date": dfwd(10), "po_reference": "PO-2025-6001",
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Annual Maintenance Contract", "quantity": 1, "unit_price": 20000, "total": 20000},
                {"description": "Emergency Repair Services", "quantity": 1, "unit_price": 2500, "total": 2500},
            ],
            "bill_to": "Acme Corporation", "notes": "Service period: January 2025",
            "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 90,
        },
        "inv_pinnacle_over": {
            "document_type": "invoice", "document_number": "PIN-2025-0041",
            "vendor_name": "Pinnacle Industrial Services", "currency": "USD",
            "subtotal": 14500, "total_amount": 14500,
            "issue_date": d(2), "due_date": dfwd(3), "po_reference": "PO-2025-6002",
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Replacement Parts Kit", "quantity": 6, "unit_price": 2000, "total": 12000},
                {"description": "Expedited Shipping", "quantity": 1, "unit_price": 2500, "total": 2500},
            ],
            "bill_to": "Acme Corporation", "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 89,
        },
        "inv_gulf_freight_original": {
            "document_type": "invoice", "document_number": "GT-2025-0456",
            "vendor_name": "Gulf Trading & Logistics FZE", "currency": "AED",
            "subtotal": 95000, "total_amount": 95000,
            "issue_date": d(25), "due_date": dfwd(5), "po_reference": "PO-2025-7001",
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Freight Forwarding Services", "quantity": 10, "unit_price": 5000, "total": 50000},
                {"description": "Customs Brokerage", "quantity": 10, "unit_price": 2500, "total": 25000},
                {"description": "Warehouse Storage (Monthly)", "quantity": 4, "unit_price": 5000, "total": 20000},
            ],
            "bill_to": "Acme Corporation", "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 88,
        },
        "inv_gulf_freight_duplicate": {
            "document_type": "invoice", "document_number": "GT-2025-0456",
            "vendor_name": "Gulf Trading & Logistics FZE", "currency": "AED",
            "subtotal": 95000, "total_amount": 95000,
            "issue_date": d(2), "due_date": dfwd(5), "po_reference": "PO-2025-7001",
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Freight Forwarding Services", "quantity": 10, "unit_price": 5000, "total": 50000},
                {"description": "Customs Brokerage", "quantity": 10, "unit_price": 2500, "total": 25000},
                {"description": "Warehouse Storage (Monthly)", "quantity": 4, "unit_price": 5000, "total": 20000},
            ],
            "bill_to": "Acme Corporation",
            "notes": "Resubmitted per accounts department request",
            "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 87,
        },

        # ═══════════════════════ CREDIT NOTE ═══════════════════════
        "cn_gulf": {
            "document_type": "credit_note", "document_number": "GT-CN-2025-0012",
            "vendor_name": "Gulf Trading & Logistics FZE", "currency": "AED",
            "subtotal": 15000, "total_amount": 15000,
            "issue_date": d(1), "tax_details": [], "payment_terms": None,
            "original_invoice_ref": "GT-2025-0456",
            "line_items": [
                {"description": "Warehouse Storage Overcharge Refund", "quantity": 2, "unit_price": 5000, "total": 10000},
                {"description": "Customs Brokerage Error Correction", "quantity": 2, "unit_price": 2500, "total": 5000},
            ],
            "bill_to": "Acme Corporation", "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 90,
        },
    }


# ============================================================
# MATCHING (multi-invoice PO, vendor normalization)
# ============================================================
def get_po_fulfillment(po_id, matches, invoices):
    inv_ids = [m["invoiceId"] for m in matches if m.get("poId") == po_id]
    return sum(i.get("subtotal", i["amount"]) for i in invoices if i["id"] in inv_ids), len(inv_ids)

def match_invoice_to_po(invoice, purchase_orders, existing_matches, all_invoices):
    best, best_score = None, 0
    inv_subtotal = invoice.get("subtotal") or invoice.get("amount", 0)

    for po in purchase_orders:
        score, signals = 0, []

        # PO reference
        if invoice.get("poReference") and invoice["poReference"] == po.get("poNumber"):
            score += 50; signals.append("po_reference_exact")

        # Vendor (fuzzy)
        vs = vendor_similarity(invoice.get("vendor"), po.get("vendor"))
        if vs >= 0.95: score += 25; signals.append("vendor_exact")
        elif vs >= 0.7: score += 15; signals.append("vendor_partial")

        # Amount (compare invoice SUBTOTAL vs PO amount — tax-aware)
        pa = po.get("amount", 0)
        already, cnt = get_po_fulfillment(po["id"], existing_matches, all_invoices)
        remaining = pa - already

        if inv_subtotal > 0 and pa > 0:
            target = remaining if remaining > 0 else pa
            dp = abs(inv_subtotal - target) / max(inv_subtotal, target)
            if dp < 0.02: score += 20; signals.append("amount_near_exact")
            elif dp < 0.10: score += 12; signals.append("amount_close")
            elif dp < 0.25: score += 5; signals.append("amount_approximate")
            if remaining > 0 and inv_subtotal <= remaining * 1.1:
                score += 5; signals.append("within_po_budget")

        # Line items
        inv_set = set(li.get("description", "").lower() for li in invoice.get("lineItems", []))
        po_set = set(li.get("description", "").lower() for li in po.get("lineItems", []))
        if inv_set and po_set:
            if len(inv_set & po_set) / max(len(inv_set), len(po_set)) > 0.5:
                score += 10; signals.append("line_items_overlap")

        ns = min(100, score)
        over = (already + inv_subtotal) > pa * (1 + OVER_INVOICE_PCT / 100) if pa > 0 else False

        if ns > best_score and ns >= 40:
            best_score = ns
            best = {"poId": po["id"], "poNumber": po["poNumber"], "poAmount": pa,
                "matchScore": ns, "signals": signals,
                "amountDifference": round(abs(inv_subtotal - (remaining if remaining > 0 else pa)), 2),
                "status": "auto_matched" if ns >= 75 else "review_needed",
                "poAlreadyInvoiced": round(already, 2), "poRemaining": round(remaining, 2),
                "poInvoiceCount": cnt, "overInvoiced": over}
    return best

def find_vendor_contract(vendor, contracts):
    best, best_sim = None, 0
    for c in contracts:
        s = vendor_similarity(vendor, c.get("vendor"))
        if s > best_sim and s >= 0.7:
            best = c; best_sim = s
    return best

def run_matching(db):
    matched_ids = {m["invoiceId"] for m in db["matches"]}
    unmatched = [i for i in db["invoices"] if i["id"] not in matched_ids]
    new = []
    for inv in unmatched:
        r = match_invoice_to_po(inv, db["purchase_orders"], db["matches"] + new, db["invoices"])
        if r:
            new.append({"id": str(uuid.uuid4())[:8].upper(), "invoiceId": inv["id"],
                "invoiceNumber": inv.get("invoiceNumber", ""), "invoiceAmount": inv["amount"],
                "invoiceSubtotal": inv.get("subtotal", inv["amount"]),
                "vendor": inv["vendor"], "matchedAt": datetime.now().isoformat(), **r})
    return new


# ============================================================
# RECORD TRANSFORMATION
# ============================================================
def transform_extracted_to_record(extracted, file_name, file_id):
    dt = extracted.get("document_type", "invoice")
    li = [{"description": l.get("description", "?"), "quantity": l.get("quantity", 1),
        "unitPrice": l.get("unit_price", l.get("unitPrice", 0)), "total": l.get("total", 0)
    } for l in extracted.get("line_items", [])]

    subtotal = extracted.get("subtotal") or extracted.get("total_amount", 0)
    total = extracted.get("total_amount", 0) or subtotal

    tax_details = []
    for t in extracted.get("tax_details", []):
        tax_details.append({"type": t.get("type", "Tax"), "rate": t.get("rate", 0), "amount": t.get("amount", 0)})

    base = {"id": file_id, "type": dt, "documentName": file_name,
        "vendor": extracted.get("vendor_name", "Unknown"),
        "vendorNormalized": normalize_vendor(extracted.get("vendor_name", "")),
        "amount": total, "subtotal": subtotal,
        "taxDetails": tax_details, "totalTax": sum(t["amount"] for t in tax_details),
        "issueDate": extracted.get("issue_date"), "status": "pending", "lineItems": li,
        "confidence": extracted.get("_confidence", 90), "extractionSource": extracted.get("_source", "unknown"),
        "extractedAt": datetime.now().isoformat(), "currency": extracted.get("currency", "USD"),
        "paymentTerms": extracted.get("payment_terms"), "notes": extracted.get("notes"),
        "earlyPaymentDiscount": extracted.get("early_payment_discount"),
        "uploadedFile": f"{file_id}_{file_name}"}

    if dt == "invoice":
        base.update({"status": "unpaid", "invoiceNumber": extracted.get("document_number", f"INV-{file_id}"),
            "poReference": extracted.get("po_reference"), "dueDate": extracted.get("due_date")})
    elif dt == "purchase_order":
        base.update({"status": "open", "poNumber": extracted.get("document_number", f"PO-{file_id}"),
            "deliveryDate": extracted.get("delivery_date")})
    elif dt == "contract":
        base.update({"status": "active", "contractNumber": extracted.get("document_number", f"AGR-{file_id}"),
            "pricingTerms": extracted.get("pricing_terms", []), "contractTerms": extracted.get("contract_terms", {}),
            "parties": extracted.get("parties", [])})
    elif dt in ("credit_note", "debit_note"):
        base.update({"status": "pending",
            "documentNumber": extracted.get("document_number", f"{'CN' if dt == 'credit_note' else 'DN'}-{file_id}"),
            "originalInvoiceRef": extracted.get("original_invoice_ref")})
    return base


# ============================================================
# ROUTES
# ============================================================
@app.get("/api/health")
async def health():
    return {"status": "ok", "product": "AuditLens by AIvoraLabs",
        "claude_api": "connected" if USE_REAL_API else "mock_mode", "version": "2.5.0",
        "features": {"triage": TRIAGE_ENABLED, "vendor_risk": True}}

@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...), document_type: str = Form("auto")):
    ct = file.content_type or "application/octet-stream"
    ext = Path(file.filename or "doc").suffix.lower()
    em = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    if ct == "application/octet-stream" and ext in em: ct = em[ext]

    fid = str(uuid.uuid4())[:8].upper()
    fp = UPLOAD_DIR / f"{fid}_{file.filename}"
    with open(fp, "wb") as f: f.write(await file.read())

    extracted = await extract_with_claude(str(fp), file.filename, ct)
    if document_type in ("invoice", "purchase_order", "contract", "credit_note", "debit_note"):
        extracted["document_type"] = document_type
    record = transform_extracted_to_record(extracted, file.filename, fid)

    db = get_db()
    store = {"invoice": "invoices", "purchase_order": "purchase_orders", "contract": "contracts",
             "credit_note": "invoices", "debit_note": "invoices"}
    db[store.get(record["type"], "invoices")].append(record)

    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "document_uploaded",
        "documentId": fid, "documentType": record["type"],
        "documentNumber": record.get("invoiceNumber") or record.get("poNumber") or record.get("contractNumber") or record.get("documentNumber"),
        "vendor": record["vendor"], "amount": record["amount"], "currency": record.get("currency"),
        "confidence": record["confidence"], "timestamp": datetime.now().isoformat()})

    new_matches, new_anomalies = [], []

    if record["type"] in ("invoice", "purchase_order"):
        new_matches = run_matching(db)
        db["matches"].extend(new_matches)

    if record["type"] == "invoice":
        mpo = None
        for m in db["matches"]:
            if m.get("invoiceId") == record["id"]:
                mpo = next((p for p in db["purchase_orders"] if p["id"] == m.get("poId")), None)
                break
        vc = find_vendor_contract(record["vendor"], db.get("contracts", []))
        vh = [i for i in db["invoices"] if i.get("vendor") and record.get("vendor") and
              vendor_similarity(i["vendor"], record["vendor"]) >= 0.7 and i["id"] != record["id"]]
        # F3: Dynamic tolerances based on vendor risk
        vendor_tols = get_dynamic_tolerances(record["vendor"], db)
        detected = await detect_anomalies_with_claude(record, mpo, vc, vh, tolerances=vendor_tols)
        for a in detected:
            anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                "invoiceNumber": record.get("invoiceNumber", ""), "vendor": record["vendor"],
                "currency": record.get("currency", "USD"),
                "detectedAt": datetime.now().isoformat(), "status": "open", **a}
            new_anomalies.append(anom)
            db["anomalies"].append(anom)

    # Activity log for invoice anomalies
    if record["type"] == "invoice" and new_anomalies:
        db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "anomalies_detected",
            "documentId": record["id"], "documentNumber": record.get("invoiceNumber"),
            "vendor": record["vendor"], "count": len(new_anomalies),
            "totalRisk": sum(a.get("amount_at_risk", 0) for a in new_anomalies if a.get("amount_at_risk", 0) > 0),
            "timestamp": datetime.now().isoformat()})

    # Fix #20: PO-level anomaly checks against contract
    if record["type"] == "purchase_order":
        vc = find_vendor_contract(record["vendor"], db.get("contracts", []))
        if vc:
            sym = currency_symbol(record.get("currency", "USD"))
            po_amt = record.get("amount", 0)
            po_num = record.get("poNumber", record["id"])

            # Check: PO exceeds contract liability cap
            ct = vc.get("contractTerms", {})
            cap = ct.get("liability_cap")
            if cap and po_amt > cap:
                diff = po_amt - cap
                anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                    "invoiceNumber": po_num, "vendor": record["vendor"],
                    "currency": record.get("currency", "USD"), "detectedAt": datetime.now().isoformat(),
                    "status": "open", "type": "AMOUNT_DISCREPANCY", "severity": "high",
                    "description": f"PO amount {sym}{po_amt:,.2f} exceeds contract liability cap {sym}{cap:,.2f} by {sym}{diff:,.2f}.",
                    "amount_at_risk": round(diff, 2), "contract_clause": f"Liability cap: {sym}{cap:,.2f}",
                    "recommendation": "PO exceeds contractual limits. Renegotiate or split into multiple POs."}
                new_anomalies.append(anom); db["anomalies"].append(anom)

            # Check: PO issued against expired contract
            expiry = ct.get("expiry_date")
            if expiry:
                try:
                    exp_date = datetime.fromisoformat(expiry)
                    po_date = datetime.fromisoformat(record.get("issueDate", "")) if record.get("issueDate") else datetime.now()
                    if po_date > exp_date:
                        days_expired = (po_date - exp_date).days
                        anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                            "invoiceNumber": po_num, "vendor": record["vendor"],
                            "currency": record.get("currency", "USD"), "detectedAt": datetime.now().isoformat(),
                            "status": "open", "type": "TERMS_VIOLATION", "severity": "high",
                            "description": f"PO issued {days_expired} days after contract expired on {expiry}.",
                            "amount_at_risk": po_amt, "contract_clause": f"Contract expired: {expiry}",
                            "recommendation": "Renew contract before issuing new purchase orders."}
                        new_anomalies.append(anom); db["anomalies"].append(anom)
                except: pass

            # Check: PO terms differ from contract
            po_terms = (record.get("paymentTerms") or "").lower().strip()
            c_terms = (vc.get("paymentTerms") or "").lower().strip()
            if po_terms and c_terms and po_terms != c_terms:
                anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                    "invoiceNumber": po_num, "vendor": record["vendor"],
                    "currency": record.get("currency", "USD"), "detectedAt": datetime.now().isoformat(),
                    "status": "open", "type": "TERMS_VIOLATION", "severity": "medium",
                    "description": f"PO terms '{record.get('paymentTerms')}' differ from contract '{vc.get('paymentTerms')}'.",
                    "amount_at_risk": 0, "contract_clause": f"Contract: {vc.get('paymentTerms')}",
                    "recommendation": "Align PO terms with contract before sending to vendor."}
                new_anomalies.append(anom); db["anomalies"].append(anom)

    # Activity log for PO anomalies
    if record["type"] == "purchase_order" and new_anomalies:
        db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "anomalies_detected",
            "documentId": record["id"], "documentNumber": record.get("poNumber"),
            "vendor": record["vendor"], "count": len(new_anomalies),
            "totalRisk": sum(a.get("amount_at_risk", 0) for a in new_anomalies if a.get("amount_at_risk", 0) > 0),
            "timestamp": datetime.now().isoformat()})

    # Fix #7: Validate credit/debit notes against original invoice
    if record["type"] in ("credit_note", "debit_note"):
        orig_ref = record.get("originalInvoiceRef")
        cn_amount = record.get("amount", 0)
        sym = currency_symbol(record.get("currency", "USD"))
        dt_label = "Credit note" if record["type"] == "credit_note" else "Debit note"
        doc_num = record.get("documentNumber", record["id"])

        if not orig_ref:
            new_anomalies.append({"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                "invoiceNumber": doc_num, "vendor": record["vendor"],
                "currency": record.get("currency", "USD"), "detectedAt": datetime.now().isoformat(),
                "status": "open", "type": "MISSING_PO", "severity": "medium",
                "description": f"{dt_label} {doc_num} has no original invoice reference.",
                "amount_at_risk": cn_amount, "contract_clause": None,
                "recommendation": "Verify which invoice this note applies to."})
            db["anomalies"].append(new_anomalies[-1])
        else:
            # Find original invoice and cross-check
            orig = next((i for i in db["invoices"]
                if i.get("invoiceNumber", "").strip().lower() == orig_ref.strip().lower()), None)
            if orig and cn_amount > orig.get("amount", 0):
                diff = cn_amount - orig["amount"]
                new_anomalies.append({"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                    "invoiceNumber": doc_num, "vendor": record["vendor"],
                    "currency": record.get("currency", "USD"), "detectedAt": datetime.now().isoformat(),
                    "status": "open", "type": "AMOUNT_DISCREPANCY", "severity": "high",
                    "description": f"{dt_label} amount {sym}{cn_amount:,.2f} exceeds original invoice {orig_ref} amount {sym}{orig['amount']:,.2f} by {sym}{diff:,.2f}.",
                    "amount_at_risk": round(diff, 2), "contract_clause": None,
                    "recommendation": f"Do not process. {dt_label} cannot exceed original invoice."})
                db["anomalies"].append(new_anomalies[-1])
        if new_anomalies:
            db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "anomalies_detected",
                "documentId": record["id"], "documentNumber": record.get("invoiceNumber"),
                "vendor": record["vendor"], "count": len(new_anomalies),
                "totalRisk": sum(a.get("amount_at_risk", 0) for a in new_anomalies if a.get("amount_at_risk", 0) > 0),
                "timestamp": datetime.now().isoformat()})

    save_db(db)

    # Index into RAG for future retrieval
    try:
        await on_document_uploaded(record)
        if new_anomalies:
            await on_anomalies_detected_batch(new_anomalies)
    except Exception as e:
        print(f"RAG indexing error (non-fatal): {e}")

    # ── F3: Update vendor risk profile ──
    db = get_db()  # Reload after save
    update_vendor_profile(record["vendor"], db)

    # ── F1: Triage invoice / credit note / debit note (NS3 FIX) ──
    triage_result = None
    if record["type"] in ("invoice", "credit_note", "debit_note"):
        # Use the DB copy (post-save), not the stale pre-save record
        db_invoice = next((i for i in db["invoices"] if i["id"] == record["id"]), None)
        if db_invoice:
            triage_result = triage_invoice(db_invoice, db.get("anomalies", []), db)
            store_triage_decision(db_invoice["id"], triage_result, db)
            apply_triage_action(db_invoice, triage_result, db)
            record = db_invoice  # Update return value with triage fields

    save_db(db)

    return {"success": True, "document": record, "new_matches": new_matches,
        "new_anomalies": new_anomalies, "extraction_source": extracted.get("_source", "unknown"),
        "triage": triage_result}

@app.get("/api/documents")
async def get_documents():
    db = get_db()
    docs = db["invoices"] + db["purchase_orders"] + db.get("contracts", [])
    return {"documents": sorted(docs, key=lambda x: x.get("extractedAt", ""), reverse=True), "total": len(docs)}

@app.get("/api/invoices")
async def get_invoices():
    return {"invoices": get_db()["invoices"]}

@app.get("/api/purchase-orders")
async def get_pos():
    return {"purchase_orders": get_db()["purchase_orders"]}

@app.get("/api/contracts")
async def get_contracts():
    return {"contracts": get_db().get("contracts", [])}

@app.get("/api/matches")
async def get_matches():
    db = get_db()
    return {"matches": db["matches"], "summary": {"total": len(db["matches"]),
        "auto_matched": sum(1 for m in db["matches"] if m["status"] == "auto_matched"),
        "review_needed": sum(1 for m in db["matches"] if m["status"] == "review_needed")}}

@app.get("/api/anomalies")
async def get_anomalies():
    db = get_db()
    an = db.get("anomalies", [])
    op = [a for a in an if a.get("status") == "open"]
    return {"anomalies": sorted(an, key=lambda x: x.get("detectedAt", ""), reverse=True),
        "summary": {"total": len(an), "open": len(op),
            "resolved": sum(1 for a in an if a.get("status") == "resolved"),
            "dismissed": sum(1 for a in an if a.get("status") == "dismissed"),
            "total_risk": round(sum(a.get("amount_at_risk", 0) for a in op if a.get("amount_at_risk", 0) > 0), 2),
            "savings_opportunities": round(abs(sum(a.get("amount_at_risk", 0) for a in op if a.get("type") == "EARLY_PAYMENT_DISCOUNT")), 2),
            "by_type": {t: sum(1 for a in an if a.get("type") == t) for t in set(a.get("type") for a in an)},
            "by_severity": {"high": sum(1 for a in op if a.get("severity") == "high"),
                "medium": sum(1 for a in op if a.get("severity") == "medium"),
                "low": sum(1 for a in op if a.get("severity") == "low")}}}

@app.post("/api/anomalies/{aid}/resolve")
async def resolve_anomaly(aid: str):
    db = get_db()
    for a in db.get("anomalies", []):
        if a["id"] == aid:
            a["status"] = "resolved"
            a["resolvedAt"] = datetime.now().isoformat()
            # C3 FIX: Cascade — update vendor risk + re-triage affected invoice
            if a.get("vendor"):
                update_vendor_profile(a["vendor"], db)
            inv_id = a.get("invoiceId")
            if inv_id:
                inv = next((i for i in db["invoices"] if i["id"] == inv_id), None)
                if inv:
                    triage = triage_invoice(inv, db.get("anomalies", []), db)
                    store_triage_decision(inv_id, triage, db)
                    apply_triage_action(inv, triage, db)
            save_db(db)
            return {"success": True, "anomaly": a}
    raise HTTPException(404)

@app.post("/api/anomalies/{aid}/dismiss")
async def dismiss_anomaly(aid: str):
    db = get_db()
    for a in db.get("anomalies", []):
        if a["id"] == aid:
            a["status"] = "dismissed"
            a["dismissedAt"] = datetime.now().isoformat()
            # C3 FIX: Cascade — update vendor risk + re-triage affected invoice
            if a.get("vendor"):
                update_vendor_profile(a["vendor"], db)
            inv_id = a.get("invoiceId")
            if inv_id:
                inv = next((i for i in db["invoices"] if i["id"] == inv_id), None)
                if inv:
                    triage = triage_invoice(inv, db.get("anomalies", []), db)
                    store_triage_decision(inv_id, triage, db)
                    apply_triage_action(inv, triage, db)
            save_db(db)
            return {"success": True, "anomaly": a}
    raise HTTPException(404)

@app.post("/api/invoices/{iid}/status")
async def update_invoice_status(iid: str, status: str = Form(...)):
    valid = {"unpaid", "under_review", "approved", "disputed", "scheduled", "paid", "on_hold"}
    if status not in valid: raise HTTPException(400, f"Invalid status. Must be one of: {valid}")
    db = get_db()
    for i in db["invoices"]:
        if i["id"] == iid:
            old = i["status"]; i["status"] = status
            if status == "paid": i["paidAt"] = datetime.now().isoformat()
            if status == "disputed": i["disputedAt"] = datetime.now().isoformat()
            db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "status_changed",
                "documentId": iid, "documentNumber": i.get("invoiceNumber"),
                "vendor": i["vendor"], "from": old, "to": status, "timestamp": datetime.now().isoformat()})
            save_db(db); return {"success": True, "invoice": i}
    raise HTTPException(404)

@app.post("/api/invoices/{iid}/mark-paid")
async def mark_paid(iid: str):
    db = get_db()
    for i in db["invoices"]:
        if i["id"] == iid:
            old = i["status"]; i["status"] = "paid"; i["paidAt"] = datetime.now().isoformat()
            db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "status_changed",
                "documentId": iid, "documentNumber": i.get("invoiceNumber"),
                "vendor": i["vendor"], "from": old, "to": "paid", "timestamp": datetime.now().isoformat()})
            save_db(db); return {"success": True}
    raise HTTPException(404)

@app.post("/api/matches/{mid}/approve")
async def approve_match(mid: str):
    db = get_db()
    for m in db["matches"]:
        if m["id"] == mid: m["status"] = "auto_matched"; save_db(db); return {"success": True}
    raise HTTPException(404)

@app.post("/api/matches/{mid}/reject")
async def reject_match(mid: str):
    db = get_db(); db["matches"] = [m for m in db["matches"] if m["id"] != mid]; save_db(db); return {"success": True}

# ============================================================
# F3: VENDOR RISK API
# ============================================================
@app.get("/api/vendors")
async def get_vendors():
    """List all vendors with risk scores, spend, anomaly data."""
    db = get_db()
    profiles = db.get("vendor_profiles", [])

    # Rebuild any missing profiles
    all_vendors = set()
    for inv in db["invoices"]:
        vn = normalize_vendor(inv.get("vendor", ""))
        if vn:
            all_vendors.add((vn, inv.get("vendor", "")))
    for po in db["purchase_orders"]:
        vn = normalize_vendor(po.get("vendor", ""))
        if vn:
            all_vendors.add((vn, po.get("vendor", "")))

    existing_normalized = {p["vendorNormalized"] for p in profiles}
    for vn, display in all_vendors:
        if vn not in existing_normalized:
            update_vendor_profile(display, db)

    save_db(db)
    profiles = db.get("vendor_profiles", [])

    return {"vendors": sorted(profiles, key=lambda x: x.get("riskScore", 0), reverse=True),
            "total": len(profiles),
            "summary": {
                "high_risk": sum(1 for p in profiles if p.get("riskLevel") == "high"),
                "medium_risk": sum(1 for p in profiles if p.get("riskLevel") == "medium"),
                "low_risk": sum(1 for p in profiles if p.get("riskLevel") == "low"),
                "total_spend": round(sum(p.get("totalSpend", 0) for p in profiles), 2),
            }}

@app.get("/api/vendors/{vendor_name}/risk")
async def get_vendor_risk(vendor_name: str):
    """Get detailed risk profile for a specific vendor."""
    db = get_db()
    risk = compute_vendor_risk_score(vendor_name, db)
    tolerances = get_dynamic_tolerances(vendor_name, db)
    return {"vendor": vendor_name, "risk": risk, "dynamicTolerances": tolerances}

@app.post("/api/vendors/refresh-all")
async def refresh_vendor_profiles():
    """Refresh all vendor risk profiles. Useful after bulk operations."""
    db = get_db()
    vendors_refreshed = set()
    for inv in db["invoices"]:
        vn = normalize_vendor(inv.get("vendor", ""))
        if vn and vn not in vendors_refreshed:
            update_vendor_profile(inv["vendor"], db)
            vendors_refreshed.add(vn)
    save_db(db)
    return {"success": True, "vendorsRefreshed": len(vendors_refreshed)}

# ============================================================
# F1: TRIAGE API
# ============================================================
@app.get("/api/triage")
async def get_triage_overview():
    """Get triage overview: lane counts, auto-approve rate, blocked invoices."""
    db = get_db()
    decisions = db.get("triage_decisions", [])
    invoices = db.get("invoices", [])

    # Build lane counts from invoice records (source of truth after edits)
    auto_approved = [i for i in invoices if i.get("triageLane") == "AUTO_APPROVE"]
    review = [i for i in invoices if i.get("triageLane") == "REVIEW"]
    blocked = [i for i in invoices if i.get("triageLane") == "BLOCK"]
    untriaged = [i for i in invoices if not i.get("triageLane")]
    total_triaged = len(auto_approved) + len(review) + len(blocked)

    return {
        "summary": {
            "totalInvoices": len(invoices),
            "totalTriaged": total_triaged,
            "autoApproved": len(auto_approved),
            "review": len(review),
            "blocked": len(blocked),
            "untriaged": len(untriaged),
            "autoApproveRate": round(len(auto_approved) / max(total_triaged, 1) * 100, 1),
            "blockRate": round(len(blocked) / max(total_triaged, 1) * 100, 1),
            "autoApprovedAmount": round(sum(i.get("amount", 0) for i in auto_approved), 2),
            "blockedAmount": round(sum(i.get("amount", 0) for i in blocked), 2),
            "reviewAmount": round(sum(i.get("amount", 0) for i in review), 2),
        },
        "blocked": [{
            "invoiceId": i["id"],
            "invoiceNumber": i.get("invoiceNumber", ""),
            "vendor": i.get("vendor", ""),
            "amount": i.get("amount", 0),
            "currency": i.get("currency", "USD"),
            "reasons": i.get("triageReasons", []),
            "vendorRisk": i.get("vendorRiskScore", 0),
            "triageAt": i.get("triageAt", ""),
        } for i in blocked],
        "decisions": sorted(decisions, key=lambda x: x.get("triageAt", ""), reverse=True)[:20],
    }

@app.post("/api/invoices/{iid}/retriage")
async def retriage_invoice(iid: str):
    """Manually trigger re-triage for an invoice."""
    db = get_db()
    invoice = None
    for i in db["invoices"]:
        if i["id"] == iid:
            invoice = i
            break
    if not invoice:
        raise HTTPException(404, "Invoice not found")

    triage = triage_invoice(invoice, db.get("anomalies", []), db)
    store_triage_decision(iid, triage, db)
    apply_triage_action(invoice, triage, db)
    save_db(db)
    return {"success": True, "invoice": invoice, "triage": triage}

@app.post("/api/invoices/{iid}/override-triage")
async def override_triage(iid: str, lane: str = Form(...), reason: str = Form("")):
    """Manual override of triage decision by auditor."""
    valid_lanes = {"AUTO_APPROVE", "REVIEW", "BLOCK"}
    if lane not in valid_lanes:
        raise HTTPException(400, f"Lane must be one of: {valid_lanes}")

    db = get_db()
    for i in db["invoices"]:
        if i["id"] == iid:
            old_lane = i.get("triageLane", "NONE")
            # NC3 FIX: Only preserve original AI triage on first override
            if not i.get("triageOriginalLane"):
                i["triageOriginalLane"] = old_lane
                i["triageOriginalReasons"] = i.get("triageReasons", [])
            i["triageLane"] = lane
            i["triageOverride"] = True
            i["triageOverrideAt"] = datetime.now().isoformat()
            i["triageOverrideReason"] = reason
            i["triageReasons"] = [f"MANUAL OVERRIDE: {reason}" if reason else f"MANUAL OVERRIDE to {lane}"]

            # Apply status change — guard terminal statuses (NS2 FIX)
            terminal_statuses = {"paid", "scheduled"}
            action_map = {"AUTO_APPROVE": "approved", "REVIEW": "under_review", "BLOCK": "on_hold"}
            if i["status"] not in terminal_statuses:
                i["status"] = action_map.get(lane, i["status"])

            db["activity_log"].append({
                "id": str(uuid.uuid4())[:8],
                "action": "triage_override",
                "documentId": iid,
                "documentNumber": i.get("invoiceNumber", ""),
                "vendor": i.get("vendor", ""),
                "fromLane": old_lane,
                "toLane": lane,
                "reason": reason,
                "timestamp": datetime.now().isoformat(),
            })
            save_db(db)
            return {"success": True, "invoice": i}
    raise HTTPException(404)

@app.post("/api/documents/{did}/edit-fields")
async def edit_document_fields(did: str, fields: str = Form(...)):
    """Edit extracted fields. Expects JSON string of field:value pairs.
    Editable fields: vendor, amount, subtotal, invoiceNumber, poNumber, contractNumber,
    poReference, paymentTerms, currency, issueDate, dueDate, deliveryDate, lineItems, taxDetails.
    After edit: re-runs matching + anomaly detection for invoices."""
    import json as _json
    try:
        updates = _json.loads(fields)
    except:
        raise HTTPException(400, "Invalid JSON in fields parameter")

    db = get_db()
    # Find doc in any collection
    doc = None
    collection = None
    for coll_name in ["invoices", "purchase_orders", "contracts"]:
        for d in db.get(coll_name, []):
            if d["id"] == did:
                doc = d; collection = coll_name; break
        if doc: break

    if not doc: raise HTTPException(404, "Document not found")

    # Whitelist of editable fields
    editable = {"vendor", "amount", "subtotal", "invoiceNumber", "poNumber", "contractNumber",
        "documentNumber", "poReference", "paymentTerms", "currency", "issueDate", "dueDate",
        "deliveryDate", "notes", "lineItems", "taxDetails", "pricingTerms"}

    changes = {}
    for k, v in updates.items():
        if k in editable:
            old_val = doc.get(k)
            doc[k] = v
            changes[k] = {"old": old_val, "new": v}

    if not changes:
        raise HTTPException(400, "No valid editable fields provided")

    # Recalculate derived fields
    if "lineItems" in changes or "subtotal" in changes:
        li_sum = sum(li.get("total", 0) for li in doc.get("lineItems", []))
        if "subtotal" not in changes and li_sum > 0:
            doc["subtotal"] = li_sum
    if "taxDetails" in changes:
        doc["totalTax"] = sum(t.get("amount", 0) for t in doc.get("taxDetails", []))
    # Fix #1: Always recalculate amount from current subtotal + tax
    doc["amount"] = (doc.get("subtotal") or 0) + (doc.get("totalTax") or 0)
    if "vendor" in changes:
        doc["vendorNormalized"] = normalize_vendor(doc["vendor"])

    # Mark as manually verified
    doc["manuallyVerified"] = True
    doc["verifiedAt"] = datetime.now().isoformat()
    doc["editHistory"] = doc.get("editHistory", [])
    doc["editHistory"].append({"timestamp": datetime.now().isoformat(), "changes": {k: str(v) for k, v in changes.items()}})

    # Log the edit
    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "document_edited",
        "documentId": did, "documentType": doc["type"],
        "documentNumber": doc.get("invoiceNumber") or doc.get("poNumber") or doc.get("contractNumber"),
        "vendor": doc["vendor"], "fieldsChanged": list(changes.keys()),
        "timestamp": datetime.now().isoformat()})

    # ── FEEDBACK LOOP: Learn from corrections ──
    # Record each field correction as a pattern. These patterns are injected
    # into future extraction prompts for the same vendor, so the AI learns
    # from human corrections over time.
    patterns_learned = 0
    for field, change in changes.items():
        if field == "lineItems":
            # Learn from line item corrections individually
            old_lis = change.get("old", []) or []
            new_lis = change.get("new", []) or []
            for i, new_li in enumerate(new_lis):
                if i < len(old_lis):
                    old_li = old_lis[i]
                    for li_field in ["description", "quantity", "unitPrice"]:
                        if str(new_li.get(li_field)) != str(old_li.get(li_field)):
                            learn_from_correction(doc, f"lineItem.{li_field}",
                                old_li.get(li_field), new_li.get(li_field), db)
                            patterns_learned += 1
        else:
            learn_from_correction(doc, field, change.get("old"), change.get("new"), db)
            patterns_learned += 1

    new_anomalies = []

    # Re-run matching + anomaly detection for invoices AND POs (Fix #10)
    if doc["type"] in ("invoice", "purchase_order"):
        if doc["type"] == "invoice":
            # Remove old matches for this invoice only
            db["matches"] = [m for m in db["matches"] if m.get("invoiceId") != did]
        elif doc["type"] == "purchase_order":
            # PO edited — remove all matches pointing to this PO so they re-evaluate
            db["matches"] = [m for m in db["matches"] if m.get("poId") != did]

        # Fix #3: Only remove OPEN anomalies for this invoice; preserve resolved/dismissed
        if doc["type"] == "invoice":
            db["anomalies"] = [a for a in db["anomalies"]
                if not (a.get("invoiceId") == did and a.get("status") == "open")]

        # Re-run matching
        new_matches = run_matching(db)
        db["matches"].extend(new_matches)

        # Re-run anomaly detection (invoices only)
        if doc["type"] == "invoice":
            mpo = None
            for m in db["matches"]:
                if m.get("invoiceId") == doc["id"]:
                    mpo = next((p for p in db["purchase_orders"] if p["id"] == m.get("poId")), None)
                    break
            vc = find_vendor_contract(doc["vendor"], db.get("contracts", []))
            vh = [i for i in db["invoices"] if i.get("vendor") and doc.get("vendor") and
                  vendor_similarity(i["vendor"], doc["vendor"]) >= 0.7 and i["id"] != doc["id"]]
            # F3: Dynamic tolerances based on vendor risk
            vendor_tols = get_dynamic_tolerances(doc["vendor"], db)
            detected = await detect_anomalies_with_claude(doc, mpo, vc, vh, tolerances=vendor_tols)
            for a in detected:
                anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": doc["id"],
                    "invoiceNumber": doc.get("invoiceNumber", ""), "vendor": doc["vendor"],
                    "currency": doc.get("currency", "USD"),
                    "detectedAt": datetime.now().isoformat(), "status": "open", **a}
                new_anomalies.append(anom)
                db["anomalies"].append(anom)

    save_db(db)

    # Re-index in RAG with corrected data
    try:
        await on_document_edited(doc)
        if new_anomalies:
            await on_anomalies_detected_batch(new_anomalies)
    except Exception as e:
        print(f"RAG re-indexing error (non-fatal): {e}")

    # ── F3: Update vendor risk profile after edit ──
    db = get_db()
    update_vendor_profile(doc["vendor"], db)

    # ── F1: Re-triage invoice / CN / DN after edit (NS3 FIX) ──
    triage_result = None
    if doc["type"] in ("invoice", "credit_note", "debit_note"):
        # Use DB copy (post-save), not stale doc reference
        db_invoice = next((i for i in db["invoices"] if i["id"] == doc["id"]), None)
        if db_invoice:
            triage_result = triage_invoice(db_invoice, db.get("anomalies", []), db)
            store_triage_decision(db_invoice["id"], triage_result, db)
            apply_triage_action(db_invoice, triage_result, db)
            doc = db_invoice

    save_db(db)

    return {"success": True, "document": doc, "changes": list(changes.keys()),
        "new_anomalies": new_anomalies, "anomalies_rerun": doc["type"] == "invoice",
        "patterns_learned": patterns_learned, "triage": triage_result}

@app.get("/api/dashboard")
async def get_dashboard():
    db = get_db(); now = datetime.now()
    unpaid = [i for i in db["invoices"] if i.get("status") not in ("paid",)]
    tar = sum(i["amount"] for i in unpaid)
    bk = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0}
    bc = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0}
    for i in unpaid:
        d = i.get("dueDate")
        try: do = (now - datetime.fromisoformat(d)).days if d else 0
        except: do = 0
        k = "current" if do <= 0 else "1_30" if do <= 30 else "31_60" if do <= 60 else "61_90" if do <= 90 else "90_plus"
        bk[k] += i["amount"]; bc[k] += 1

    ad = db["invoices"] + db["purchase_orders"] + db.get("contracts", [])
    ac = (sum(d.get("confidence", 0) for d in ad) / len(ad)) if ad else 0
    oa = [a for a in db.get("anomalies", []) if a.get("status") == "open"]

    # Vendor spend analysis — track display name + spend
    vendor_spend = {}
    vendor_display = {}  # normalized -> best display name
    for inv in db["invoices"]:
        v = normalize_vendor(inv.get("vendor", ""))
        vendor_spend[v] = vendor_spend.get(v, 0) + inv.get("amount", 0)
        # Keep the longest display name (most complete version)
        if v not in vendor_display or len(inv.get("vendor", "")) > len(vendor_display[v]):
            vendor_display[v] = inv.get("vendor", v)
    top_vendors = sorted(vendor_spend.items(), key=lambda x: x[1], reverse=True)[:5]

    # Due soon
    due_soon = [i for i in unpaid if i.get("dueDate")]
    due_7d = []
    for i in due_soon:
        try:
            dd = datetime.fromisoformat(i["dueDate"])
            if 0 <= (dd - now).days <= 7: due_7d.append(i)
        except: pass

    # Early payment savings (on pre-tax subtotal)
    epd_savings = 0
    for i in db["invoices"]:
        epd = i.get("earlyPaymentDiscount")
        if epd and i.get("status") == "unpaid":
            epd_savings += (i.get("subtotal") or i["amount"]) * (epd.get("discount_percent", 0) / 100)

    # ── F1: Triage metrics ──
    triaged_invoices = [i for i in db["invoices"] if i.get("triageLane")]
    triage_auto = [i for i in triaged_invoices if i.get("triageLane") == "AUTO_APPROVE"]
    triage_review = [i for i in triaged_invoices if i.get("triageLane") == "REVIEW"]
    triage_blocked = [i for i in triaged_invoices if i.get("triageLane") == "BLOCK"]
    total_triaged = len(triaged_invoices)
    auto_approve_rate = round(len(triage_auto) / max(total_triaged, 1) * 100, 1)

    # ── F3: Vendor risk metrics ──
    profiles = db.get("vendor_profiles", [])
    high_risk_vendors = [p for p in profiles if p.get("riskLevel") == "high"]
    worsening_vendors = [p for p in profiles if p.get("trend") == "worsening"]

    return {"total_ar": round(tar, 2), "unpaid_count": len(unpaid), "total_documents": len(ad),
        "invoice_count": len(db["invoices"]), "po_count": len(db["purchase_orders"]),
        "contract_count": len(db.get("contracts", [])),
        "auto_matched": sum(1 for m in db["matches"] if m["status"] == "auto_matched"),
        "review_needed": sum(1 for m in db["matches"] if m["status"] == "review_needed"),
        "avg_confidence": round(ac, 1), "anomaly_count": len(oa),
        "total_risk": round(sum(a.get("amount_at_risk", 0) for a in oa if a.get("amount_at_risk", 0) > 0), 2),
        "high_severity": sum(1 for a in oa if a.get("severity") == "high"),
        "over_invoiced_pos": sum(1 for m in db["matches"] if m.get("overInvoiced")),
        "disputed_count": sum(1 for i in db["invoices"] if i.get("status") == "disputed"),
        "due_in_7_days": len(due_7d), "due_in_7_days_amount": round(sum(i["amount"] for i in due_7d), 2),
        "early_payment_savings": round(epd_savings, 2),
        "top_vendors": [{"vendor": vendor_display.get(v, v), "spend": round(s, 2)} for v, s in top_vendors],
        "aging": {"buckets": {k: round(v, 2) for k, v in bk.items()}, "counts": bc},
        "recent_activity": sorted(db.get("activity_log", []), key=lambda x: x.get("timestamp", ""), reverse=True)[:10],
        "verified_count": sum(1 for d in ad if d.get("manuallyVerified")),
        "correction_patterns": len(db.get("correction_patterns", [])),
        "rag_stats": get_rag_stats() if RAG_ENABLED else None,
        "api_mode": "claude_api" if USE_REAL_API else "mock_extraction",
        # F1: Triage metrics
        "triage": {
            "total_triaged": total_triaged,
            "auto_approved": len(triage_auto),
            "review": len(triage_review),
            "blocked": len(triage_blocked),
            "auto_approve_rate": auto_approve_rate,
            "blocked_amount": round(sum(i.get("amount", 0) for i in triage_blocked), 2),
            "auto_approved_amount": round(sum(i.get("amount", 0) for i in triage_auto), 2),
        },
        # F3: Vendor risk metrics
        "vendor_risk": {
            "total_vendors": len(profiles),
            "high_risk": len(high_risk_vendors),
            "worsening": len(worsening_vendors),
            "high_risk_vendors": [{"vendor": p.get("vendorDisplay", ""), "score": p.get("riskScore", 0),
                                   "trend": p.get("trend", "")} for p in high_risk_vendors[:5]],
        }}

@app.get("/api/correction-patterns")
async def get_correction_patterns_endpoint():
    """View all learned correction patterns."""
    db = get_db()
    patterns = db.get("correction_patterns", [])
    by_vendor = {}
    for p in patterns:
        v = p.get("vendor", "Unknown")
        if v not in by_vendor: by_vendor[v] = []
        by_vendor[v].append(p)
    return {"patterns": patterns, "by_vendor": by_vendor,
        "total": len(patterns), "vendors_with_corrections": len(by_vendor)}

@app.get("/api/rag/stats")
async def rag_stats_endpoint():
    """Get RAG engine statistics."""
    return {"enabled": RAG_ENABLED, "stats": get_rag_stats() if RAG_ENABLED else None}

@app.get("/api/rag/vendor/{vendor_name}")
async def rag_vendor_intelligence(vendor_name: str):
    """Get RAG-retrieved intelligence about a specific vendor."""
    if not RAG_ENABLED:
        return {"error": "RAG engine not available"}
    try:
        from backend.rag_engine import retrieve_vendor_intelligence
    except ImportError:
        from rag_engine import retrieve_vendor_intelligence
    return await retrieve_vendor_intelligence(vendor_name)

@app.post("/api/reset")
async def reset():
    save_db(_fresh_db())
    try:
        await reset_rag()
    except: pass
    # Clean up uploaded files
    for fp in UPLOAD_DIR.iterdir():
        try: fp.unlink()
        except: pass
    return {"success": True}

@app.get("/api/export")
async def export(): return get_db()

@app.get("/api/uploads/{filename}")
async def serve_upload(filename: str):
    """Serve original uploaded file for verification panel."""
    # Path traversal protection
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    fp = UPLOAD_DIR / filename
    # Ensure resolved path is within uploads directory
    if not fp.resolve().is_relative_to(UPLOAD_DIR.resolve()):
        raise HTTPException(403, "Access denied")
    if not fp.exists(): raise HTTPException(404, "File not found")
    ext = fp.suffix.lower()
    mt = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".png": "image/png", ".webp": "image/webp", ".tiff": "image/tiff"}.get(ext, "application/octet-stream")
    return FileResponse(fp, media_type=mt)

# ============================================================
# FRONTEND
# ============================================================
@app.get("/logo.jpg")
async def serve_logo(): return FileResponse(FRONTEND_DIR / "logo.jpg", media_type="image/jpeg")

@app.get("/app.js")
async def serve_js(): return FileResponse(FRONTEND_DIR / "app.js", media_type="application/javascript")

@app.get("/")
async def serve_index(): return FileResponse(FRONTEND_DIR / "index.html", media_type="text/html")

@app.get("/{path:path}")
async def serve_static(path: str):
    fp = FRONTEND_DIR / path
    if fp.exists() and fp.is_file(): return FileResponse(fp)
    return FileResponse(FRONTEND_DIR / "index.html", media_type="text/html")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting AuditLens v2.5 on port {port}")
    print(f"Claude API: {'Connected' if USE_REAL_API else 'Mock Mode'}")
    print(f"Triage: {'Enabled' if TRIAGE_ENABLED else 'Disabled'}")
    print(f"Vendor Risk Scoring: Enabled")
    uvicorn.run(app, host="0.0.0.0", port=port)
