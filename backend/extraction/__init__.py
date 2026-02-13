"""
AuditLens — Agentic Ensemble Extraction Pipeline

Architecture:
  Model A: Claude Sonnet 4 (primary — best document understanding)
  Model B: Claude Haiku 4.5 (secondary — different weights = different errors)
  Combiner: Deterministic field-level merge + math validation
  Resolver: On key disagreements, Sonnet re-examines with both outputs + DB context

Every LLM call is stateless and grounded in DB context:
  - Correction history (past human fixes for this vendor)
  - RAG context (similar documents previously processed)
  - Vendor patterns (currency, terms, amounts, tax rates, line items)
  - Open POs and active contracts for reference
"""
import json, asyncio, base64
import time as _time
import anthropic

from backend.config import ENSEMBLE_PRIMARY_MODEL, ENSEMBLE_SECONDARY_MODEL, USE_REAL_API
from backend.db import get_db
from backend.vendor import vendor_similarity, currency_symbol

# Re-export key items for backward compat
__all__ = [
    'extract_with_claude', '_math_validate', '_ensemble_merge',
    '_numeric_close', '_string_match', '_compare_line_items', '_compare_tax',
    '_vendor_cross_reference', '_build_vendor_context', '_build_po_context',
    'build_correction_hints', 'learn_from_correction',
    'EXTRACTION_PROMPT', 'ENSEMBLE_PRIMARY_MODEL', 'ENSEMBLE_SECONDARY_MODEL'
]

# ============================================================
# PROMPTS
# ============================================================
EXTRACTION_PROMPT = """You are a financial document extraction AI. Extract ALL data from this document into structured JSON.

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "document_type": "invoice" or "purchase_order" or "contract" or "credit_note" or "debit_note" or "goods_receipt",
  "document_number": "the document number (GRN number, delivery note number, etc.)",
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
  "po_reference": "PO number referenced in invoice or goods receipt, or null",
  "original_invoice_ref": "for credit/debit notes — the original invoice number, or null",
  "received_date": "YYYY-MM-DD — date goods were received (for goods receipts), or null",
  "received_by": "name of person who received goods, or null",
  "condition_notes": "quality/condition notes on receipt, or null",
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
- For goods receipts: extract po_reference, received_date, received_by, and line_items with quantities actually received. If the document shows "ordered qty" vs "received qty", use received qty in quantity field.
- Be precise with numbers. If a field is not visible, use null."""


# ============================================================
# FIELD COMPARISON SETS
# ============================================================
_NUMERIC_FIELDS = {"subtotal", "total_amount"}
_STRING_FIELDS = {"vendor_name", "document_number", "document_type", "currency",
    "po_reference", "payment_terms", "issue_date", "due_date"}
_PRIMARY_ONLY = {"notes", "bill_to", "ship_to", "extraction_confidence",
    "pricing_terms", "contract_terms", "parties", "early_payment_discount",
    "received_by", "condition_notes", "original_invoice_ref", "delivery_date", "received_date"}


# ============================================================
# CONTEXT BUILDERS (inject DB knowledge into LLM prompts)
# ============================================================
def build_correction_hints(vendor_name: str, doc_type: str, db: dict) -> str:
    """Build extraction hints from past human corrections for this vendor."""
    patterns = db.get("correction_patterns", [])
    if not patterns:
        return ""
    relevant = []
    for p in patterns:
        if vendor_similarity(vendor_name, p.get("vendor", "")) >= 0.7:
            relevant.append(p)
        elif p.get("vendor") == "_global":
            relevant.append(p)
    if not relevant:
        return ""
    hints = ["\n\nCORRECTION HISTORY (learn from past human corrections for this vendor):"]
    for p in relevant[-10:]:
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


def _build_vendor_context(vendor_hint: str, db: dict) -> str:
    """Build vendor pattern context from historical data."""
    if not vendor_hint or vendor_hint.lower() in ("unknown", "auto"):
        return ""
    history = [i for i in db.get("invoices", [])
        if i.get("vendor") and vendor_similarity(i["vendor"], vendor_hint) >= 0.6]
    if len(history) < 2:
        return ""
    ctx = ["\n\nVENDOR INTELLIGENCE (from our database — use to validate extraction):"]
    currencies = [i.get("currency") for i in history if i.get("currency")]
    if currencies:
        ctx.append(f"- This vendor typically invoices in {max(set(currencies), key=currencies.count)}")
    terms = [i.get("paymentTerms") for i in history if i.get("paymentTerms")]
    if terms:
        ctx.append(f"- Usual payment terms: {max(set(terms), key=terms.count)}")
    amounts = [float(i.get("amount") or 0) for i in history if float(i.get("amount") or 0) > 0]
    if amounts:
        sym = currency_symbol(currencies[0] if currencies else "USD")
        ctx.append(f"- Invoice amount range: {sym}{min(amounts):,.0f} – {sym}{max(amounts):,.0f} (avg: {sym}{sum(amounts)/len(amounts):,.0f})")
    tax_types, tax_rates = set(), set()
    for i in history:
        for t in (i.get("taxDetails") or []):
            if t.get("type"): tax_types.add(t["type"])
            if t.get("rate"): tax_rates.add(float(t["rate"]))
    if tax_types:
        ctx.append(f"- Tax types used: {', '.join(tax_types)} at rates: {', '.join(f'{r}%' for r in sorted(tax_rates))}")
    all_descs = []
    for i in history:
        for li in (i.get("lineItems") or []):
            if li.get("description") and li["description"] != "?":
                all_descs.append(li["description"])
    if all_descs:
        from collections import Counter
        ctx.append(f"- Common line items: {', '.join(d for d, _ in Counter(all_descs).most_common(5))}")
    inv_nums = [i.get("invoiceNumber", "") for i in history if i.get("invoiceNumber")]
    if inv_nums:
        prefix = inv_nums[0]
        for n in inv_nums[1:]:
            while not n.startswith(prefix) and prefix:
                prefix = prefix[:-1]
        if prefix and len(prefix) >= 3:
            ctx.append(f"- Invoice number pattern: starts with '{prefix}...'")
    if len(ctx) == 1:
        return ""
    ctx.append("Use this intelligence to verify your extraction. Flag any deviations.")
    return "\n".join(ctx)


def _build_po_context(vendor_hint: str, db: dict) -> str:
    """Build PO/contract reference context from DB."""
    if not vendor_hint or vendor_hint.lower() in ("unknown", "auto"):
        return ""
    ctx_parts = []
    open_pos = [p for p in db.get("purchase_orders", [])
        if p.get("vendor") and vendor_similarity(p["vendor"], vendor_hint) >= 0.6
        and p.get("status") in ("open", "active", "partial")]
    if open_pos:
        ctx_parts.append("\n\nKNOWN PURCHASE ORDERS FOR THIS VENDOR:")
        for po in open_pos[:5]:
            sym = currency_symbol(po.get("currency", "USD"))
            li_summary = ", ".join(li.get("description", "?") for li in (po.get("lineItems") or [])[:5])
            ctx_parts.append(f"- PO {po.get('poNumber', '?')}: {sym}{float(po.get('amount',0)):,.0f} ({po.get('currency','USD')}) — Items: {li_summary or 'N/A'}")
        ctx_parts.append("If the invoice references one of these POs, extract the PO number accurately.")
    active_contracts = [c for c in db.get("contracts", [])
        if c.get("vendor") and vendor_similarity(c["vendor"], vendor_hint) >= 0.6
        and c.get("status") in ("active", "pending")]
    if active_contracts:
        ctx_parts.append("\nACTIVE CONTRACTS FOR THIS VENDOR:")
        for c in active_contracts[:3]:
            terms = c.get("contractTerms", {})
            pricing = c.get("pricingTerms", [])
            pricing_str = ", ".join(f"{p.get('item','?')} @ {p.get('rate','?')}/{p.get('unit','?')}" for p in pricing[:3]) if pricing else "N/A"
            ctx_parts.append(f"- Contract {c.get('contractNumber', '?')}: Payment terms: {c.get('paymentTerms','N/A')}, Expires: {terms.get('expiry_date','N/A')}, Pricing: {pricing_str}")
        ctx_parts.append("Verify payment terms and pricing against these contracts.")
    return "\n".join(ctx_parts) if ctx_parts else ""


def learn_from_correction(doc: dict, field: str, old_value, new_value, db: dict):
    """Record a correction pattern for future extraction improvement."""
    import uuid
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
        "timestamp": __import__('datetime').datetime.now().isoformat()
    }
    db.setdefault("correction_patterns", []).append(pattern)


# ============================================================
# COMPARISON FUNCTIONS
# ============================================================
def _numeric_close(a, b, tolerance_pct=1.0) -> bool:
    a, b = float(a or 0), float(b or 0)
    if a == 0 and b == 0: return True
    if a == 0 or b == 0: return False
    return abs(a - b) / max(abs(a), abs(b)) * 100 <= tolerance_pct


def _string_match(a, b) -> str:
    """Compare two string values. Returns 'exact', 'close', or 'mismatch'."""
    if not a and not b: return "exact"
    if not a or not b: return "mismatch"
    a_n, b_n = str(a).strip().lower(), str(b).strip().lower()
    if a_n == b_n: return "exact"
    a_stripped, b_stripped = a_n, b_n
    for suffix in [" ltd", " pvt", " pvt ltd", " private limited", " limited", " inc", " llc", " corp", " corporation"]:
        a_stripped = a_stripped.replace(suffix, "")
        b_stripped = b_stripped.replace(suffix, "")
    a_stripped, b_stripped = a_stripped.strip(), b_stripped.strip()
    if a_stripped == b_stripped: return "close"
    if a_stripped in b_stripped or b_stripped in a_stripped: return "close"
    # Acronym matching
    for shorter, longer_candidates in [
        (a_stripped, [b_n, b_stripped]), (b_stripped, [a_n, a_stripped]),
        (a_n, [b_n, b_stripped]), (b_n, [a_n, a_stripped]),
    ]:
        if len(shorter) >= 2 and shorter.replace(" ", "").isalpha() and len(shorter) <= 6:
            for longer in longer_candidates:
                words = longer.split()
                if len(words) >= 2:
                    initials = "".join(w[0] for w in words if w)
                    if shorter == initials: return "close"
    return "mismatch"


def _compare_line_items(li_a: list, li_b: list) -> dict:
    if not li_a and not li_b:
        return {"status": "both_empty", "confidence": "high", "count_a": 0, "count_b": 0}
    if not li_a or not li_b:
        return {"status": "one_empty", "confidence": "low", "count_a": len(li_a or []), "count_b": len(li_b or [])}
    if len(li_a) != len(li_b):
        return {"status": "count_mismatch", "confidence": "low", "count_a": len(li_a), "count_b": len(li_b),
            "detail": f"Model A: {len(li_a)} items, Model B: {len(li_b)} items"}
    agreed, disputed = 0, []
    for i, (a, b) in enumerate(zip(li_a, li_b)):
        qty_ok = _numeric_close(a.get("quantity"), b.get("quantity"), 0.1)
        price_ok = _numeric_close(a.get("unit_price", a.get("unitPrice")), b.get("unit_price", b.get("unitPrice")), 1.0)
        total_ok = _numeric_close(a.get("total"), b.get("total"), 1.0)
        if qty_ok and price_ok and total_ok:
            agreed += 1
        else:
            disputed.append({"line": i + 1, "desc": a.get("description", "?"),
                "model_a": {"qty": a.get("quantity"), "price": a.get("unit_price", a.get("unitPrice")), "total": a.get("total")},
                "model_b": {"qty": b.get("quantity"), "price": b.get("unit_price", b.get("unitPrice")), "total": b.get("total")}})
    return {"status": "all_agreed" if not disputed else "partial",
        "confidence": "high" if not disputed else "medium" if agreed > len(disputed) else "low",
        "agreed": agreed, "disputed": len(disputed), "total": len(li_a), "disputed_items": disputed[:5]}


def _compare_tax(tax_a: list, tax_b: list) -> dict:
    if not tax_a and not tax_b: return {"status": "both_empty", "confidence": "high"}
    if not tax_a or not tax_b: return {"status": "one_empty", "confidence": "low"}
    total_a = sum(t.get("amount", 0) for t in tax_a)
    total_b = sum(t.get("amount", 0) for t in tax_b)
    if _numeric_close(total_a, total_b, 1.0):
        return {"status": "agreed", "confidence": "high", "total": total_a}
    return {"status": "mismatch", "confidence": "low", "model_a_total": total_a, "model_b_total": total_b}


# ============================================================
# MATH VALIDATION (deterministic — no AI)
# ============================================================
def _math_validate(result: dict) -> list:
    """Run 5 deterministic math checks on extracted data."""
    issues = []
    li = result.get("line_items") or []
    subtotal = float(result.get("subtotal") or 0)
    total = float(result.get("total_amount") or 0)
    taxes = result.get("tax_details") or []

    if li and subtotal > 0:
        li_sum = sum(float(l.get("total") or 0) for l in li)
        if li_sum > 0:
            diff_pct = abs(li_sum - subtotal) / max(subtotal, 1) * 100
            if diff_pct > 2:
                issues.append({"check": "line_item_sum", "severity": "high",
                    "detail": f"Line items sum to {li_sum:,.2f} but subtotal is {subtotal:,.2f} (diff: {diff_pct:.1f}%)"})
            elif diff_pct > 0.5:
                issues.append({"check": "line_item_sum", "severity": "low",
                    "detail": f"Minor rounding: line items {li_sum:,.2f} vs subtotal {subtotal:,.2f}"})

    if taxes and subtotal > 0 and total > 0:
        tax_total = sum(float(t.get("amount") or 0) for t in taxes)
        expected = subtotal + tax_total
        diff_pct = abs(expected - total) / max(total, 1) * 100
        if diff_pct > 2:
            issues.append({"check": "total_equals_subtotal_plus_tax", "severity": "high",
                "detail": f"Subtotal ({subtotal:,.2f}) + tax ({tax_total:,.2f}) = {expected:,.2f}, but total is {total:,.2f}"})

    for t in taxes:
        rate = float(t.get("rate") or 0)
        amount = float(t.get("amount") or 0)
        if rate > 0 and subtotal > 0 and amount > 0:
            expected_amt = subtotal * rate / 100
            diff_pct = abs(expected_amt - amount) / max(amount, 1) * 100
            if diff_pct > 5:
                issues.append({"check": "tax_rate_consistency", "severity": "medium",
                    "detail": f"{t.get('type','Tax')} at {rate}% on {subtotal:,.2f} should be {expected_amt:,.2f}, got {amount:,.2f}"})

    for i, l in enumerate(li):
        qty = float(l.get("quantity") or 0)
        price = float(l.get("unit_price") or l.get("unitPrice") or 0)
        lt = float(l.get("total") or 0)
        if qty > 0 and price > 0 and lt > 0:
            expected_lt = qty * price
            diff_pct = abs(expected_lt - lt) / max(lt, 1) * 100
            if diff_pct > 2:
                issues.append({"check": f"line_{i+1}_math", "severity": "medium",
                    "detail": f"Line {i+1}: {qty} × {price:,.2f} = {expected_lt:,.2f}, but total says {lt:,.2f}"})

    issue_d = result.get("issue_date")
    due_d = result.get("due_date")
    if issue_d and due_d:
        try:
            if issue_d > due_d:
                issues.append({"check": "date_order", "severity": "medium",
                    "detail": f"Issue date ({issue_d}) is after due date ({due_d})"})
        except: pass

    return issues


# ============================================================
# ENSEMBLE MERGE
# ============================================================
def _ensemble_merge(primary: dict, secondary: dict) -> tuple:
    """Merge two extraction results field-by-field. Returns (merged, field_confidence, metadata)."""
    merged, field_conf = {}, {}
    agreements, disputes = 0, 0

    for f in _NUMERIC_FIELDS:
        va, vb = primary.get(f), secondary.get(f)
        if va is not None and vb is not None:
            if _numeric_close(va, vb, 1.0):
                merged[f] = va; field_conf[f] = {"status": "agreed", "confidence": "high", "a": va, "b": vb}; agreements += 1
            elif _numeric_close(va, vb, 5.0):
                merged[f] = va; field_conf[f] = {"status": "near_match", "confidence": "medium", "a": va, "b": vb}; agreements += 1
            else:
                merged[f] = va; field_conf[f] = {"status": "disputed", "confidence": "low", "a": va, "b": vb}; disputes += 1
        elif va is not None:
            merged[f] = va; field_conf[f] = {"status": "single_source", "confidence": "medium", "source": "primary"}
        elif vb is not None:
            merged[f] = vb; field_conf[f] = {"status": "single_source", "confidence": "medium", "source": "secondary"}

    for f in _STRING_FIELDS:
        va, vb = primary.get(f), secondary.get(f)
        if va and not vb:
            merged[f] = va; field_conf[f] = {"status": "single_source", "confidence": "medium", "source": "primary"}; continue
        if vb and not va:
            merged[f] = vb; field_conf[f] = {"status": "single_source", "confidence": "medium", "source": "secondary"}; continue
        match = _string_match(va, vb)
        merged[f] = va if va else vb
        if match == "exact": field_conf[f] = {"status": "agreed", "confidence": "high"}; agreements += 1
        elif match == "close": field_conf[f] = {"status": "near_match", "confidence": "high"}; agreements += 1
        else: field_conf[f] = {"status": "disputed", "confidence": "medium", "a": va, "b": vb}; disputes += 1

    li_a, li_b = primary.get("line_items") or [], secondary.get("line_items") or []
    li_comparison = _compare_line_items(li_a, li_b)
    merged["line_items"] = li_a; field_conf["line_items"] = li_comparison
    if li_comparison["status"] == "all_agreed": agreements += 1
    elif li_comparison["status"] in ("count_mismatch", "one_empty"): disputes += 1

    tax_a, tax_b = primary.get("tax_details") or [], secondary.get("tax_details") or []
    tax_comparison = _compare_tax(tax_a, tax_b)
    merged["tax_details"] = tax_a; field_conf["tax_details"] = tax_comparison
    if tax_comparison["status"] in ("agreed", "both_empty"): agreements += 1
    else: disputes += 1

    for f in _PRIMARY_ONLY:
        if primary.get(f) is not None: merged[f] = primary[f]

    total_compared = agreements + disputes
    agreement_rate = round(agreements / max(total_compared, 1) * 100, 1)
    meta = {
        "models_used": [primary.get("_model", "unknown"), secondary.get("_model", "unknown")],
        "primary_latency_ms": primary.get("_latency_ms", 0),
        "secondary_latency_ms": secondary.get("_latency_ms", 0),
        "fields_compared": total_compared, "fields_agreed": agreements,
        "fields_disputed": disputes, "agreement_rate": agreement_rate,
        "ensemble_confidence": "high" if agreement_rate >= 90 else "medium" if agreement_rate >= 70 else "low"
    }
    return merged, field_conf, meta


# ============================================================
# VENDOR CROSS-REFERENCE
# ============================================================
def _vendor_cross_reference(merged: dict, db: dict) -> list:
    """Check extracted data against existing vendor patterns."""
    deviations = []
    vendor = merged.get("vendor_name", "")
    if not vendor or vendor.lower() in ("unknown", "n/a"):
        return deviations
    history = [i for i in db.get("invoices", [])
        if i.get("vendor") and vendor_similarity(i["vendor"], vendor) >= 0.7]
    if len(history) < 3:
        return deviations
    hist_currencies = {i.get("currency") for i in history if i.get("currency")}
    ext_currency = merged.get("currency")
    if ext_currency and hist_currencies and ext_currency not in hist_currencies:
        deviations.append({"field": "currency", "type": "vendor_norm_deviation",
            "detail": f"Currency '{ext_currency}' unusual — this vendor typically uses {', '.join(hist_currencies)}",
            "severity": "medium"})
    hist_terms = {i.get("paymentTerms") for i in history if i.get("paymentTerms")}
    ext_terms = merged.get("payment_terms")
    if ext_terms and hist_terms and ext_terms not in hist_terms:
        deviations.append({"field": "payment_terms", "type": "vendor_norm_deviation",
            "detail": f"Terms '{ext_terms}' unusual — this vendor typically uses {', '.join(str(t) for t in hist_terms)}",
            "severity": "low"})
    hist_amounts = [float(i.get("amount") or 0) for i in history if float(i.get("amount") or 0) > 0]
    ext_amount = float(merged.get("total_amount") or 0)
    if hist_amounts and ext_amount > 0:
        avg = sum(hist_amounts) / len(hist_amounts)
        max_h = max(hist_amounts)
        if ext_amount > max_h * 3:
            deviations.append({"field": "total_amount", "type": "vendor_norm_deviation",
                "detail": f"Amount {ext_amount:,.2f} is {ext_amount/avg:.1f}x the vendor average ({avg:,.2f}). Highest ever: {max_h:,.2f}",
                "severity": "high"})
    return deviations


# ============================================================
# MODEL CALLER
# ============================================================
async def _call_model(client, model: str, content_block: dict, prompt: str, label: str) -> dict:
    """Call a single model for extraction. Uses AsyncAnthropic for true parallel execution."""
    try:
        print(f"[Ensemble:{label}] Calling {model.split('-')[1]}...")
        t0 = _time.time()
        msg = await client.messages.create(model=model, max_tokens=4000,
            messages=[{"role": "user", "content": [content_block, {"type": "text", "text": prompt}]}])
        text = msg.content[0].text.strip()
        elapsed = round((_time.time() - t0) * 1000)
        if text.startswith("```"):
            first_nl = text.index("\n") if "\n" in text else len(text)
            text = text[first_nl + 1:]
            if text.endswith("```"): text = text[:-3]
            text = text.strip()
        result = json.loads(text)
        result["_model"] = model; result["_latency_ms"] = elapsed
        print(f"[Ensemble:{label}] OK in {elapsed}ms — type={result.get('document_type')}, vendor={result.get('vendor_name')}, total={result.get('total_amount')}")
        return result
    except json.JSONDecodeError as e:
        print(f"[Ensemble:{label}] JSON parse error: {e}")
        return {"_error": f"JSON parse: {e}", "_model": model}
    except Exception as e:
        print(f"[Ensemble:{label}] API error: {type(e).__name__}: {e}")
        return {"_error": str(e), "_model": model}


# ============================================================
# DISPUTE RESOLVER (agentic)
# ============================================================
async def _resolve_disputes(client, content_block: dict, merged: dict, field_conf: dict, meta: dict) -> dict:
    """On critical disagreements, send both outputs + DB context back to Sonnet."""
    critical_disputes = []
    for f in ("subtotal", "total_amount"):
        fc = field_conf.get(f, {})
        if fc.get("status") == "disputed":
            critical_disputes.append(f"- {f}: Model A says {fc['a']}, Model B says {fc['b']}")
    li_fc = field_conf.get("line_items", {})
    if li_fc.get("status") in ("count_mismatch", "partial") and li_fc.get("disputed_items"):
        for d in li_fc["disputed_items"][:3]:
            critical_disputes.append(f"- Line {d['line']} ({d['desc']}): Model A={d['model_a']}, Model B={d['model_b']}")
    tax_fc = field_conf.get("tax_details", {})
    if tax_fc.get("status") == "mismatch":
        critical_disputes.append(f"- Tax total: Model A says {tax_fc.get('model_a_total')}, Model B says {tax_fc.get('model_b_total')}")
    if not critical_disputes:
        return merged

    # Full DB context for resolver
    db = get_db()
    vendor_name = merged.get("vendor_name", "")
    vendor_ctx = _build_vendor_context(vendor_name, db) if vendor_name else ""
    po_ctx = _build_po_context(vendor_name, db) if vendor_name else ""
    correction_ctx = build_correction_hints(vendor_name, merged.get("document_type", "invoice"), db) if vendor_name else ""

    resolve_prompt = f"""Two AI models extracted data from the same financial document but DISAGREED on these fields:

{chr(10).join(critical_disputes)}
{vendor_ctx}
{po_ctx}
{correction_ctx}

Please re-examine the document very carefully and provide the CORRECT values for ONLY the disputed fields.
Respond ONLY with a JSON object containing the corrected fields. For example:
{{"subtotal": 1200000, "total_amount": 1416000}}

If line items are disputed, include "line_items" with the full corrected array.
If tax is disputed, include "tax_details" with the corrected array.

Be extremely precise. Count digits carefully. Pay attention to Indian number formatting (lakhs/crores)."""

    try:
        print(f"[Ensemble:Resolve] Re-examining {len(critical_disputes)} disputed fields...")
        t0 = _time.time()
        msg = await client.messages.create(model=ENSEMBLE_PRIMARY_MODEL, max_tokens=2000,
            messages=[{"role": "user", "content": [content_block, {"type": "text", "text": resolve_prompt}]}])
        text = msg.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text
            if text.endswith("```"): text = text[:-3]
            text = text.strip()
        corrections = json.loads(text)
        elapsed = round((_time.time() - t0) * 1000)
        for k, v in corrections.items():
            if k in merged:
                old = merged[k]; merged[k] = v
                if k in field_conf:
                    field_conf[k]["status"] = "resolved"; field_conf[k]["confidence"] = "high"
                    field_conf[k]["resolved_from"] = old; field_conf[k]["resolved_to"] = v
        meta["resolution_applied"] = True; meta["resolution_latency_ms"] = elapsed
        meta["fields_resolved"] = list(corrections.keys())
    except Exception as e:
        print(f"[Ensemble:Resolve] Error: {e}")
        meta["resolution_applied"] = False; meta["resolution_error"] = str(e)
    return merged


# ============================================================
# MAIN EXTRACTION FUNCTION
# ============================================================
async def extract_with_claude(file_path: str, file_name: str, media_type: str,
                              vendor_hint: str = "", doc_type_hint: str = "",
                              rag_get_extraction_context=None) -> dict:
    """
    Ensemble extraction pipeline:
    1. Parallel extraction with Sonnet (primary) + Haiku (secondary)
    2. Field-by-field comparison and merge
    3. Agentic dispute resolution for critical disagreements
    4. Deterministic math validation
    5. Vendor cross-reference against historical patterns
    """
    if not USE_REAL_API:
        return {"_source": "no_api_key", "_extraction_failed": True,
                "document_type": doc_type_hint or "invoice", "vendor_name": "Unknown",
                "total_amount": 0, "extraction_confidence": 0,
                "_error": "ANTHROPIC_API_KEY not configured. Use Manual Entry to index this document."}

    client = anthropic.AsyncAnthropic()
    with open(file_path, "rb") as f:
        b64_data = base64.standard_b64encode(f.read()).decode("utf-8")

    if media_type == "application/pdf":
        content_block = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64_data}}
    else:
        img_type = media_type if media_type in ["image/jpeg", "image/png", "image/gif", "image/webp"] else "image/png"
        content_block = {"type": "image", "source": {"type": "base64", "media_type": img_type, "data": b64_data}}

    db = get_db()
    hints = build_correction_hints(vendor_hint or file_name, doc_type_hint or "auto", db)
    rag_context = ""
    if rag_get_extraction_context:
        rag_context = await rag_get_extraction_context(vendor_hint or file_name, doc_type_hint or "auto")
    vendor_context = _build_vendor_context(vendor_hint or file_name, db)
    po_context = _build_po_context(vendor_hint or file_name, db)
    prompt = EXTRACTION_PROMPT + hints + rag_context + vendor_context + po_context

    print(f"[Ensemble] Starting parallel extraction for '{file_name}'")
    t0_ensemble = _time.time()

    try:
        primary_result, secondary_result = await asyncio.gather(
            _call_model(client, ENSEMBLE_PRIMARY_MODEL, content_block, prompt, "Primary"),
            _call_model(client, ENSEMBLE_SECONDARY_MODEL, content_block, prompt, "Secondary"),
            return_exceptions=True)
    except Exception as e:
        return {"_source": "ensemble_error", "_extraction_failed": True,
                "document_type": doc_type_hint or "invoice", "vendor_name": "Unknown",
                "total_amount": 0, "extraction_confidence": 0, "_error": f"Ensemble extraction failed: {e}"}

    if isinstance(primary_result, Exception):
        primary_result = {"_error": str(primary_result), "_model": ENSEMBLE_PRIMARY_MODEL}
    if isinstance(secondary_result, Exception):
        secondary_result = {"_error": str(secondary_result), "_model": ENSEMBLE_SECONDARY_MODEL}

    primary_ok = "_error" not in primary_result
    secondary_ok = "_error" not in secondary_result

    if not primary_ok and not secondary_ok:
        return {"_source": "ensemble_both_failed", "_extraction_failed": True,
                "document_type": doc_type_hint or "invoice", "vendor_name": "Unknown",
                "total_amount": 0, "extraction_confidence": 0,
                "_error": f"Both models failed. Primary: {primary_result.get('_error')}. Secondary: {secondary_result.get('_error')}"}

    if not secondary_ok:
        primary_result["_source"] = "ensemble_primary_only"
        primary_result["_confidence"] = primary_result.pop("extraction_confidence", 85)
        primary_result["_ensemble"] = {"mode": "single_model", "reason": "secondary_failed", "error": secondary_result.get("_error")}
        math_issues = _math_validate(primary_result)
        if math_issues: primary_result["_ensemble"]["math_issues"] = math_issues
        return primary_result

    if not primary_ok:
        secondary_result["_source"] = "ensemble_secondary_only"
        secondary_result["_confidence"] = secondary_result.pop("extraction_confidence", 80)
        secondary_result["_ensemble"] = {"mode": "single_model", "reason": "primary_failed", "error": primary_result.get("_error")}
        math_issues = _math_validate(secondary_result)
        if math_issues: secondary_result["_ensemble"]["math_issues"] = math_issues
        return secondary_result

    # Both succeeded — merge
    merged, field_conf, meta = _ensemble_merge(primary_result, secondary_result)
    if meta["fields_disputed"] > 0:
        merged = await _resolve_disputes(client, content_block, merged, field_conf, meta)

    math_issues = _math_validate(merged)
    meta["math_validation"] = {"passed": not any(i["severity"] == "high" for i in math_issues),
        "issues": math_issues, "checks_run": 5}

    vendor_deviations = _vendor_cross_reference(merged, db)
    if vendor_deviations: meta["vendor_deviations"] = vendor_deviations

    base_conf = float(primary_result.get("extraction_confidence") or 90)
    ensemble_adj = (meta["agreement_rate"] - 80) * 0.3
    math_penalty = sum(10 if i["severity"] == "high" else 3 for i in math_issues)
    vendor_penalty = sum(5 if d["severity"] == "high" else 2 for d in vendor_deviations)
    final_conf = max(10, min(99, base_conf + ensemble_adj - math_penalty - vendor_penalty))

    elapsed_total = round((_time.time() - t0_ensemble) * 1000)
    meta["total_latency_ms"] = elapsed_total

    merged["_source"] = "ensemble"
    merged["_confidence"] = round(final_conf, 1)
    merged["_ensemble"] = meta
    merged["_field_confidence"] = field_conf
    return merged
