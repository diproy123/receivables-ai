"""
AuditLens — Vendor Intelligence
Vendor normalization, fuzzy matching, risk scoring, profile management.
"""
import re, math
from collections import defaultdict
from difflib import SequenceMatcher
from datetime import datetime

from backend.config import (
    VENDOR_SUFFIXES, CURRENCY_SYMBOLS,
    RISK_WEIGHT_ANOMALY_RATE, RISK_WEIGHT_CORRECTION_FREQ,
    RISK_WEIGHT_CONTRACT_COMPLIANCE, RISK_WEIGHT_DUPLICATE_HISTORY,
    RISK_WEIGHT_VOLUME_CONSISTENCY, HIGH_RISK_THRESHOLD, MED_RISK_THRESHOLD,
    RISK_TOLERANCE_TIGHTENING, DEFAULT_POLICY
)
from backend.db import _n

# ============================================================
# VENDOR NORMALIZATION
# ============================================================
def normalize_vendor(name: str) -> str:
    """Normalize vendor name for matching: lowercase, strip suffixes, trim."""
    if not name:
        return ""
    n = name.lower().strip()
    n = re.sub(r'[.,;:!@#$%^&*()\[\]{}|\\/<>"\']', ' ', n)
    n = re.sub(r'\s+', ' ', n).strip()
    for suffix in VENDOR_SUFFIXES:
        pattern = rf'\b{re.escape(suffix)}\b\.?'
        n = re.sub(pattern, '', n, flags=re.IGNORECASE)
    return re.sub(r'\s+', ' ', n).strip()


def vendor_similarity(a: str, b: str) -> float:
    """Compute normalized similarity between two vendor names (0.0 - 1.0)."""
    if not a or not b:
        return 0.0
    na, nb = normalize_vendor(a), normalize_vendor(b)
    if na == nb:
        return 1.0
    return SequenceMatcher(None, na, nb).ratio()


def currency_symbol(currency: str) -> str:
    """Get the display symbol for a currency code."""
    return CURRENCY_SYMBOLS.get(currency, currency or "$")


def severity_for_amount(amount_at_risk: float, invoice_amount: float) -> str:
    """Determine severity based on risk/invoice ratio."""
    if invoice_amount <= 0:
        return "medium"
    pct = abs(amount_at_risk) / invoice_amount * 100
    if pct >= DEFAULT_POLICY.get("high_severity_threshold_pct", 10):
        return "high"
    elif pct >= DEFAULT_POLICY.get("medium_severity_threshold_pct", 5):
        return "medium"
    return "low"


# ============================================================
# VENDOR RISK SCORING
# ============================================================
def compute_vendor_risk_score(vendor_name: str, db: dict) -> dict:
    """Compute composite risk score (0-100) for a vendor based on 5 weighted factors.
    Higher score = higher risk. Returns score, factor breakdown, risk level, and trend."""
    vn = normalize_vendor(vendor_name)
    if not vn:
        return {"score": 50, "level": "medium", "factors": {}, "trend": "stable", "invoiceCount": 0,
                "totalSpend": 0, "openAnomalyCount": 0, "totalAnomalyCount": 0}

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
        # New vendor — no invoice history. Default to low-moderate risk.
        contract_score = 55 if not vendor_contracts else 20
        return {"score": round(contract_score * RISK_WEIGHT_CONTRACT_COMPLIANCE + 15, 1),
                "level": "low", "factors": {
            "anomaly_rate": {"score": 0, "weight": RISK_WEIGHT_ANOMALY_RATE, "detail": "New vendor, no invoice history"},
            "correction_freq": {"score": 0, "weight": RISK_WEIGHT_CORRECTION_FREQ, "detail": "No corrections yet"},
            "contract_compliance": {"score": contract_score, "weight": RISK_WEIGHT_CONTRACT_COMPLIANCE,
                                    "detail": "No contract on file" if not vendor_contracts else "Contract exists"},
            "duplicate_history": {"score": 0, "weight": RISK_WEIGHT_DUPLICATE_HISTORY, "detail": "No history"},
            "volume_consistency": {"score": 0, "weight": RISK_WEIGHT_VOLUME_CONSISTENCY, "detail": "No invoices to assess"},
        }, "trend": "new", "invoiceCount": 0,
           "totalSpend": 0, "openAnomalyCount": 0, "totalAnomalyCount": 0}

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
    severity_adj = min(severity_weight / max(inv_count, 1), 2.0)
    anomaly_score = min(100, anom_rate * 100 * (1 + severity_adj * 0.5))
    anomaly_detail = f"{len(inv_ids_with_anomalies)}/{inv_count} invoices had anomalies"
    if severity_weight > 0:
        anomaly_detail += f" ({sum(1 for a in real_anomalies if a.get('severity')=='high' and a.get('status')=='open')} high severity)"

    # ── Factor 2: Correction Frequency (0-100) ──
    correction_count = sum(p.get("correctionCount", 1) for p in vendor_corrections)
    correction_rate = correction_count / inv_count if inv_count > 0 else 0
    correction_score = min(100, correction_rate * 40)
    correction_detail = f"{correction_count} corrections across {inv_count} invoices"

    # ── Factor 3: Contract Compliance (0-100) ──
    contract_score = 50
    contract_detail = "No contract on file"
    if vendor_contracts:
        best_contract = vendor_contracts[0]
        ct = best_contract.get("contractTerms") or {}
        expiry = ct.get("expiry_date")
        has_pricing = bool(best_contract.get("pricingTerms"))

        if expiry:
            try:
                exp_date = datetime.fromisoformat(expiry)
                if exp_date < datetime.now():
                    days_expired = (datetime.now() - exp_date).days
                    contract_score = min(100, 60 + days_expired * 0.2)
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
        contract_score = 55
        contract_detail = "No contract on file — pricing unverified"

    # ── Factor 4: Duplicate History (0-100) ──
    dup_anomalies = [a for a in vendor_anomalies if a.get("type") == "DUPLICATE_INVOICE"]
    dup_count = len(dup_anomalies)
    dup_score = min(100, dup_count * 30)
    dup_detail = f"{dup_count} duplicate submissions detected" if dup_count else "No duplicates"

    # ── Factor 5: Volume Consistency (0-100) ──
    if inv_count >= 3:
        amounts = [i.get("subtotal", i.get("amount", 0)) for i in vendor_invoices]
        mean_amt = sum(amounts) / len(amounts)
        if mean_amt > 0:
            variance = sum((a - mean_amt) ** 2 for a in amounts) / len(amounts)
            std_dev = math.sqrt(variance)
            cv = std_dev / mean_amt
            volume_score = min(100, cv * 60)
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
    final_score = max(0, min(100, round(raw_score, 1)))

    # ── Risk Level ──
    if final_score >= HIGH_RISK_THRESHOLD:
        level = "high"
    elif final_score >= MED_RISK_THRESHOLD:
        level = "medium"
    else:
        level = "low"

    # ── Trend Detection ──
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

    from backend.policy import get_policy
    policy = get_policy()

    return {
        "amount_tolerance_pct": round(policy["amount_tolerance_pct"] * factor, 3),
        "price_tolerance_pct": round(policy["price_tolerance_pct"] * factor, 3),
        "risk_adjusted": score > 15,  # Only flag as adjusted if meaningfully above baseline
        "risk_score": risk["score"],
        "risk_level": risk["level"]
    }


def update_vendor_profile(vendor_name: str, db: dict) -> dict:
    """Update or create a vendor risk profile."""
    risk = compute_vendor_risk_score(vendor_name, db)
    profiles = db.get("vendor_profiles", [])
    existing = next((p for p in profiles if vendor_similarity(p.get("vendor", ""), vendor_name) >= 0.8), None)

    profile = {
        "vendor": vendor_name,
        "vendorNormalized": normalize_vendor(vendor_name),
        "riskScore": risk["score"], "riskLevel": risk["level"],
        "riskTrend": risk["trend"], "factors": risk["factors"],
        "invoiceCount": risk["invoiceCount"],
        "totalRiskExposure": risk["totalRiskExposure"],
        "openAnomalies": risk["openAnomalies"],
        "lastUpdated": datetime.now().isoformat()
    }

    if existing:
        existing.update(profile)
    else:
        profiles.append(profile)
    db["vendor_profiles"] = profiles
    return profile


def find_vendor_contract(vendor_name: str, contracts: list) -> dict:
    """Find the best matching active contract for a vendor."""
    best, best_score = None, 0
    for c in contracts:
        if c.get("status") not in ("active", "pending"):
            continue
        score = vendor_similarity(vendor_name, c.get("vendor", ""))
        if score > best_score and score >= 0.6:
            best, best_score = c, score
    return best
