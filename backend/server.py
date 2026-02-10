"""
AuditLens by AIvoraLabs — AI-Powered Spend Compliance Auditor
v2.1 — F&A hardened: tax handling, line item verification, smart duplicate detection,
        contract pricing checks, vendor normalization, multi-invoice PO matching
"""

import os, json, base64, uuid, asyncio, re
from datetime import datetime, timedelta
from typing import Optional
from pathlib import Path
from difflib import SequenceMatcher

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import anthropic

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

app = FastAPI(title="AuditLens by AIvoraLabs", version="2.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ============================================================
# DATABASE
# ============================================================
EMPTY_DB = {"invoices": [], "purchase_orders": [], "contracts": [], "matches": [], "anomalies": [], "activity_log": []}

def load_db():
    if DB_PATH.exists():
        with open(DB_PATH) as f:
            db = json.load(f)
        for k in EMPTY_DB:
            if k not in db: db[k] = []
        return db
    return {**EMPTY_DB}

def save_db(db):
    with open(DB_PATH, "w") as f:
        json.dump(db, f, indent=2, default=str)

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
# EXTRACTION PROMPT
# ============================================================
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
async def extract_with_claude(file_path: str, file_name: str, media_type: str) -> dict:
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

    try:
        msg = client.messages.create(model="claude-sonnet-4-20250514", max_tokens=4000,
            messages=[{"role": "user", "content": [content_block, {"type": "text", "text": EXTRACTION_PROMPT}]}])
        text = msg.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"): text = text[:-3]
            text = text.strip()
        result = json.loads(text)
        result["_confidence"] = result.pop("extraction_confidence", 92)
        result["_source"] = "claude_api"
        return result
    except Exception as e:
        print(f"Claude extraction error: {e}")
        return await mock_extraction(file_name)


async def detect_anomalies_with_claude(invoice, po, contract, history) -> list:
    if not USE_REAL_API:
        return detect_anomalies_rule_based(invoice, po, contract, history)

    client = anthropic.Anthropic()
    def clean(d):
        if not d: return "Not available"
        skip = {"rawExtraction", "extractionSource", "extractedAt", "billTo", "shipTo"}
        return json.dumps({k: v for k, v in d.items() if k not in skip}, indent=2, default=str)

    cur = invoice.get("currency", "USD")
    prompt = ANOMALY_PROMPT.format(
        invoice_json=clean(invoice), po_json=clean(po), contract_json=clean(contract),
        currency=cur,
        history_json=json.dumps([{"invoiceNumber": h.get("invoiceNumber"), "vendor": h.get("vendor"),
            "amount": h.get("amount"), "subtotal": h.get("subtotal"), "lineItems": h.get("lineItems", []),
            "issueDate": h.get("issueDate"), "currency": h.get("currency")
        } for h in history[-10:]], indent=2, default=str) if history else "No previous invoices")

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
        return detect_anomalies_rule_based(invoice, po, contract, history)


# ============================================================
# RULE-BASED ANOMALY DETECTION (F&A hardened)
# ============================================================
def detect_anomalies_rule_based(invoice, po, contract, history) -> list:
    anomalies = []
    cur = invoice.get("currency", "USD")
    sym = currency_symbol(cur)
    inv_total = invoice.get("amount", 0)
    inv_subtotal = invoice.get("subtotal") or inv_total  # pre-tax amount

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

    # ── 3. PO COMPARISON (tax-aware) ─────────────────────────
    if po:
        po_amt = po.get("amount", 0)
        # Compare SUBTOTAL (pre-tax) against PO amount (which is typically pre-tax)
        compare_amt = inv_subtotal
        tolerance = po_amt * (AMOUNT_TOLERANCE_PCT / 100)

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
                price_tol = pp * (PRICE_TOLERANCE_PCT / 100)
                if ip > pp + price_tol and pp > 0:
                    d = ip - pp; q = inv_li.get("quantity", 1); risk = d * q
                    anomalies.append({"type": "PRICE_OVERCHARGE",
                        "severity": severity_for_amount(risk, po_amt),
                        "description": f"'{inv_li['description']}': {sym}{ip:,.2f}/unit vs PO {sym}{pp:,.2f}/unit",
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
    if contract and contract.get("pricingTerms"):
        for pt in contract.get("pricingTerms", []):
            contract_item = (pt.get("item") or "").lower().strip()
            contract_rate = pt.get("rate", 0)
            if not contract_item or not contract_rate: continue

            for inv_li in invoice.get("lineItems", []):
                inv_desc = (inv_li.get("description") or "").lower().strip()
                sim = SequenceMatcher(None, contract_item, inv_desc).ratio()
                if sim > 0.6 or contract_item in inv_desc or inv_desc in contract_item:
                    inv_price = inv_li.get("unitPrice", 0)
                    if inv_price > contract_rate * (1 + PRICE_TOLERANCE_PCT / 100):
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
    dup_found = False
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
            dup_found = True
            break

    # ── 6. EARLY PAYMENT DISCOUNT OPPORTUNITY ────────────────
    epd = invoice.get("earlyPaymentDiscount")
    if epd and epd.get("discount_percent") and epd.get("days"):
        savings = inv_total * (epd["discount_percent"] / 100)
        anomalies.append({"type": "EARLY_PAYMENT_DISCOUNT", "severity": "low",
            "description": f"Eligible for {epd['discount_percent']}% discount ({sym}{savings:,.2f}) if paid within {epd['days']} days",
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
            anomalies.append({"type": "TERMS_VIOLATION", "severity": "medium",
                "description": f"Currency mismatch: Invoice in {inv_cur}, PO in {po_cur}. Cannot compare amounts directly.",
                "amount_at_risk": 0, "contract_clause": None,
                "recommendation": f"Verify exchange rate and ensure amounts align. Invoice: {inv_cur}, PO: {po_cur}"})

    return anomalies


# ============================================================
# MOCK EXTRACTION
# ============================================================
async def mock_extraction(file_name: str) -> dict:
    import random
    await asyncio.sleep(1.5)

    vendors = ["Acme Manufacturing Co.", "TechNova Systems", "GlobalParts International", "Meridian Supply Group", "Atlas Industrial Corp."]
    items_pool = [("Server Rack Units (42U)", 2, 4500), ("Managed Network Switch", 5, 1200), ("Cloud License (Annual)", 1, 24000),
        ("Consulting Hours", 40, 175), ("Maintenance Contract", 1, 8500), ("Power Distribution Unit", 4, 850)]

    fn = file_name.lower()
    is_contract = "contract" in fn or "agreement" in fn
    is_credit = "credit" in fn
    is_debit = "debit" in fn
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
        "currency": random.choice(["USD", "INR"]), "notes": None, "bill_to": "Your Company Inc.",
        "_confidence": round(85 + random.random() * 13, 1), "_source": "mock_extraction",
        "pricing_terms": [], "contract_terms": {}, "parties": [], "early_payment_discount": None}

    if is_contract:
        base.update({"document_type": "contract", "document_number": f"AGR-{random.randint(100, 999)}",
            "payment_terms": "Net 30",
            "pricing_terms": [{"item": li["description"], "rate": li["unit_price"], "unit": "per unit"} for li in line_items[:3]],
            "contract_terms": {"effective_date": issue.strftime("%Y-%m-%d"),
                "expiry_date": (issue + timedelta(days=730)).strftime("%Y-%m-%d"),
                "auto_renewal": True, "renewal_notice_days": 60, "liability_cap": 500000},
            "parties": ["Your Company Inc.", vendor]})
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
        "earlyPaymentDiscount": extracted.get("early_payment_discount")}

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
        "claude_api": "connected" if USE_REAL_API else "mock_mode", "version": "2.1.0"}

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
        detected = await detect_anomalies_with_claude(record, mpo, vc, vh)
        for a in detected:
            anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                "invoiceNumber": record.get("invoiceNumber", ""), "vendor": record["vendor"],
                "currency": record.get("currency", "USD"),
                "detectedAt": datetime.now().isoformat(), "status": "open", **a}
            new_anomalies.append(anom)
            db["anomalies"].append(anom)
        if new_anomalies:
            db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "anomalies_detected",
                "documentId": record["id"], "documentNumber": record.get("invoiceNumber"),
                "vendor": record["vendor"], "count": len(new_anomalies),
                "totalRisk": sum(a.get("amount_at_risk", 0) for a in new_anomalies),
                "timestamp": datetime.now().isoformat()})

    save_db(db)
    return {"success": True, "document": record, "new_matches": new_matches,
        "new_anomalies": new_anomalies, "extraction_source": extracted.get("_source", "unknown")}

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
            "total_risk": round(sum(a.get("amount_at_risk", 0) for a in op), 2),
            "savings_opportunities": round(abs(sum(a.get("amount_at_risk", 0) for a in op if a.get("type") == "EARLY_PAYMENT_DISCOUNT")), 2),
            "by_type": {t: sum(1 for a in an if a.get("type") == t) for t in set(a.get("type") for a in an)},
            "by_severity": {"high": sum(1 for a in op if a.get("severity") == "high"),
                "medium": sum(1 for a in op if a.get("severity") == "medium"),
                "low": sum(1 for a in op if a.get("severity") == "low")}}}

@app.post("/api/anomalies/{aid}/resolve")
async def resolve_anomaly(aid: str):
    db = get_db()
    for a in db.get("anomalies", []):
        if a["id"] == aid: a["status"] = "resolved"; a["resolvedAt"] = datetime.now().isoformat(); save_db(db); return {"success": True, "anomaly": a}
    raise HTTPException(404)

@app.post("/api/anomalies/{aid}/dismiss")
async def dismiss_anomaly(aid: str):
    db = get_db()
    for a in db.get("anomalies", []):
        if a["id"] == aid: a["status"] = "dismissed"; a["dismissedAt"] = datetime.now().isoformat(); save_db(db); return {"success": True, "anomaly": a}
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
        if i["id"] == iid: i["status"] = "paid"; i["paidAt"] = datetime.now().isoformat(); save_db(db); return {"success": True}
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

    # Vendor spend analysis
    vendor_spend = {}
    for inv in db["invoices"]:
        v = normalize_vendor(inv.get("vendor", ""))
        vendor_spend[v] = vendor_spend.get(v, 0) + inv.get("amount", 0)
    top_vendors = sorted(vendor_spend.items(), key=lambda x: x[1], reverse=True)[:5]

    # Due soon
    due_soon = [i for i in unpaid if i.get("dueDate")]
    due_7d = []
    for i in due_soon:
        try:
            dd = datetime.fromisoformat(i["dueDate"])
            if 0 <= (dd - now).days <= 7: due_7d.append(i)
        except: pass

    # Early payment savings
    epd_savings = 0
    for i in db["invoices"]:
        epd = i.get("earlyPaymentDiscount")
        if epd and i.get("status") == "unpaid":
            epd_savings += i["amount"] * (epd.get("discount_percent", 0) / 100)

    return {"total_ar": round(tar, 2), "unpaid_count": len(unpaid), "total_documents": len(ad),
        "invoice_count": len(db["invoices"]), "po_count": len(db["purchase_orders"]),
        "contract_count": len(db.get("contracts", [])),
        "auto_matched": sum(1 for m in db["matches"] if m["status"] == "auto_matched"),
        "review_needed": sum(1 for m in db["matches"] if m["status"] == "review_needed"),
        "avg_confidence": round(ac, 1), "anomaly_count": len(oa),
        "total_risk": round(sum(a.get("amount_at_risk", 0) for a in oa), 2),
        "high_severity": sum(1 for a in oa if a.get("severity") == "high"),
        "over_invoiced_pos": sum(1 for m in db["matches"] if m.get("overInvoiced")),
        "disputed_count": sum(1 for i in db["invoices"] if i.get("status") == "disputed"),
        "due_in_7_days": len(due_7d), "due_in_7_days_amount": round(sum(i["amount"] for i in due_7d), 2),
        "early_payment_savings": round(epd_savings, 2),
        "top_vendors": [{"vendor": v, "spend": round(s, 2)} for v, s in top_vendors],
        "aging": {"buckets": {k: round(v, 2) for k, v in bk.items()}, "counts": bc},
        "recent_activity": sorted(db.get("activity_log", []), key=lambda x: x.get("timestamp", ""), reverse=True)[:10],
        "api_mode": "claude_api" if USE_REAL_API else "mock_extraction"}

@app.post("/api/reset")
async def reset():
    save_db({**EMPTY_DB}); return {"success": True}

@app.get("/api/export")
async def export(): return get_db()

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
    print(f"Starting AuditLens v2.1 on port {port}")
    print(f"Claude API: {'Connected' if USE_REAL_API else 'Mock Mode'}")
    uvicorn.run(app, host="0.0.0.0", port=port)
