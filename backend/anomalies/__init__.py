"""
AuditLens — Anomaly Detection Module

16 deterministic F&A anomaly detection rules + GRN-specific checks + Claude AI detector.
Rule-based is primary (zero LLM). Claude detector is complementary for edge cases.

Rules:
  1.  LINE_ITEM_TOTAL_MISMATCH — sum of line items ≠ subtotal
  2.  MISSING_PO — no purchase order reference or unmatched PO
  3.  AMOUNT_DISCREPANCY — invoice exceeds PO amount
  4.  QUANTITY_MISMATCH — billed qty > PO authorized qty
  5.  PRICE_OVERCHARGE — unit price exceeds PO rate
  6.  UNAUTHORIZED_ITEM — line item not in PO
  7.  TERMS_VIOLATION — expired contract or terms mismatch
  8.  CONTRACT_PRICE_VIOLATION — exceeds contracted rates
  9.  DUPLICATE_INVOICE — probable duplicate (multi-signal scoring)
  10. EARLY_PAYMENT_DISCOUNT — savings opportunity
  11. TAX_RATE_ANOMALY — unusual effective tax rate or rate mismatch
  12. CURRENCY_MISMATCH — invoice vs PO currency differ
  13. ROUND_NUMBER_INVOICE — suspiciously round amount
  14. WEEKEND_INVOICE — dated on Saturday/Sunday
  15. STALE_INVOICE — older than policy max age

GRN-specific:
  16. UNRECEIPTED_INVOICE — no goods receipt on file
  17. OVERBILLED_VS_RECEIVED — invoice > received value
  18. QUANTITY_RECEIVED_MISMATCH — billed qty > received qty
  19. SHORT_SHIPMENT — GRN < PO (informational)
"""

import json
from datetime import datetime
from difflib import SequenceMatcher

from backend.policy import get_policy
from backend.vendor import currency_symbol, severity_for_amount, fmt_amt, fmt_pct
from backend.db import _n
from backend.config import USE_REAL_API, ENSEMBLE_PRIMARY_MODEL


# ============================================================
# ANOMALY DETECTION PROMPT (for Claude-powered detector)
# ============================================================
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
15. OVERBILLED_VS_RECEIVED — invoice charges for more units than were received (vs GRN)
16. QUANTITY_RECEIVED_MISMATCH — GRN quantity differs significantly from invoice quantity
17. SHORT_SHIPMENT — GRN shows significantly fewer items received than PO authorized
18. STALE_INVOICE — invoice date is very old (beyond acceptable age threshold)
19. WEEKEND_INVOICE — invoice dated on a Saturday or Sunday (unusual for business transactions). ONLY flag if the date actually falls on Saturday (day 6) or Sunday (day 7). Do NOT flag Monday through Friday — those are normal business days.
20. ROUND_NUMBER_INVOICE — invoice total is a suspiciously round number
21. UNRECEIPTED_INVOICE — invoice references a PO but no goods receipt exists

IMPORTANT: When comparing invoice total vs PO total, account for tax. POs are typically pre-tax amounts. Compare invoice SUBTOTAL (pre-tax) against PO total, NOT invoice total (post-tax) vs PO total.

Use the actual currency ({currency}) in descriptions. Do not assume USD.

Severity: high (>10% variance or systematic issue), medium (5-10% or one-off), low (<5% or informational).

Respond ONLY with JSON array:
[{{"type": "PRICE_OVERCHARGE", "severity": "high", "description": "explanation with {currency} amounts", "amount_at_risk": 70.00, "contract_clause": "Section 2", "recommendation": "action"}}]

If no anomalies: []
Be thorough. Check every line item."""


# ============================================================
# CLAUDE-POWERED ANOMALY DETECTION
# ============================================================
async def detect_anomalies_with_claude(invoice, po, contract, history, tolerances=None) -> list:
    """Detect anomalies using Claude AI. Falls back to rule-based on any failure."""
    if not USE_REAL_API:
        return detect_anomalies_rule_based(invoice, po, contract, history, tolerances)

    import anthropic  # kept for type hints only

    ## R1/R2: Route through provider layer, not direct client
    def clean(d):
        if not d: return "Not available"
        skip = {"rawExtraction", "extractionSource", "extractedAt", "billTo", "shipTo"}
        return json.dumps({k: v for k, v in d.items() if k not in skip}, indent=2, default=str)

    cur = invoice.get("currency", "USD")
    policy = get_policy()

    # RAG context injection (imported lazily to avoid circular imports)
    rag_context = ""
    try:
        from backend.rag_engine import get_anomaly_context
        rag_context = await get_anomaly_context(invoice)
    except ImportError:
        pass

    # Vendor risk tolerance injection
    tol_context = ""
    if tolerances and tolerances.get("risk_adjusted"):
        tol_context = f"""

VENDOR RISK ADJUSTMENT: This vendor has a risk score of {tolerances.get('risk_score', 0):.0f}/100 ({tolerances.get('risk_level', 'unknown')} risk).
Apply TIGHTER thresholds: amount tolerance {tolerances['amount_tolerance_pct']:.1f}% (normal: {policy['amount_tolerance_pct']}%), price tolerance {tolerances['price_tolerance_pct']:.1f}% (normal: {policy['price_tolerance_pct']}%).
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
        from backend.llm_provider import llm_call, audit_log_llm_call
        import time as _t
        t0 = _t.time()
        text = await llm_call(prompt=prompt, model="primary", max_tokens=4000)
        elapsed = round((_t.time() - t0) * 1000)
        if text is None:
            return detect_anomalies_rule_based(invoice, po, contract, history, tolerances)
        try:
            audit_log_llm_call(module="anomaly_detection_ai", model="primary",
                               data_type="text", latency_ms=elapsed,
                               vendor=invoice.get("vendor", ""))
        except Exception:
            pass
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"): text = text[:-3]
            text = text.strip()
        result = json.loads(text)
        anomalies = result if isinstance(result, list) else []

        # Post-processing: validate AI anomalies against deterministic facts
        # AI can hallucinate — verify checkable claims before accepting
        validated = []
        seen_types = set()  # prevent duplicate anomaly types
        inv_total_val = float(invoice.get("amount") or 0)
        for a in anomalies:
            atype = a.get("type")

            # WEEKEND_INVOICE: verify date is actually Sat/Sun
            if atype == "WEEKEND_INVOICE":
                issue_date = invoice.get("issueDate") or invoice.get("issue_date")
                if issue_date:
                    try:
                        dt = datetime.strptime(str(issue_date)[:10], "%Y-%m-%d")
                        if dt.weekday() < 5:  # Mon-Fri = 0-4
                            continue  # discard — not a weekend
                    except (ValueError, TypeError):
                        pass

            # ROUND_NUMBER: verify amount is actually round and above threshold
            if atype == "ROUND_NUMBER_INVOICE":
                policy = get_policy()
                rn_threshold = policy.get("round_number_threshold", 1000)
                if inv_total_val < rn_threshold or inv_total_val != round(inv_total_val, -3):
                    continue  # discard — not actually a round number or below threshold

            # CURRENCY_MISMATCH: verify currencies actually differ
            if atype == "CURRENCY_MISMATCH":
                inv_cur = (invoice.get("currency") or "USD").upper()
                po_cur = (po.get("currency") or "USD").upper() if po else inv_cur
                if inv_cur == po_cur:
                    continue  # discard — AI hallucinated mismatch

            # STALE_INVOICE: verify age calculation
            if atype == "STALE_INVOICE":
                issue_date = invoice.get("issueDate") or invoice.get("issue_date")
                if issue_date:
                    try:
                        dt = datetime.strptime(str(issue_date)[:10], "%Y-%m-%d")
                        age = (datetime.now() - dt).days
                        policy = get_policy()
                        max_age = policy.get("max_invoice_age_days", 365)
                        if 0 <= age <= max_age:
                            continue  # discard — invoice is within acceptable age
                    except (ValueError, TypeError):
                        pass

            # DUPLICATE_INVOICE: verify the claimed duplicate actually exists in history
            if atype == "DUPLICATE_INVOICE":
                if history:
                    claimed_inv = a.get("description", "")
                    # Check if any history invoice number appears in the AI's description
                    history_inv_nums = {h.get("invoiceNumber", "").lower() for h in history if h.get("invoiceNumber")}
                    found_in_history = any(hn in claimed_inv.lower() for hn in history_inv_nums if hn)
                    if not found_in_history:
                        # AI claimed a duplicate that doesn't exist in vendor history
                        continue  # discard hallucinated duplicate
                else:
                    continue  # no history at all — can't be a duplicate

            # Deduplicate: prevent AI from flagging same type multiple times
            if atype in seen_types and atype not in ("PRICE_OVERCHARGE", "QUANTITY_MISMATCH", "UNAUTHORIZED_ITEM"):
                continue  # allow multiple per-line-item types, deduplicate others
            seen_types.add(atype)

            validated.append(a)
        return validated
    except Exception as e:
        print(f"Anomaly detection error: {e}")
        return detect_anomalies_rule_based(invoice, po, contract, history, tolerances)


def detect_anomalies_rule_based(invoice, po, contract, history, tolerances=None) -> list:
    """Detect anomalies using 16 deterministic rules. No LLM calls."""
    anomalies = []
    policy = get_policy()
    cur = invoice.get("currency") or "USD"
    sym = currency_symbol(cur)
    inv_total = float(invoice.get("amount") or 0)
    _subtotal_raw = invoice.get("subtotal")
    _subtotal_is_fallback = _subtotal_raw in (None, 0, "", "0")
    inv_subtotal = float(_subtotal_raw or inv_total or 0)

    if po:
        if po.get("amount") is None:
            po["amount"] = 0

    # Tolerances: use vendor-specific if provided, else policy defaults
    amt_tol_pct = (tolerances or {}).get("amount_tolerance_pct", policy["amount_tolerance_pct"])
    prc_tol_pct = (tolerances or {}).get("price_tolerance_pct", policy["price_tolerance_pct"])
    risk_adjusted = (tolerances or {}).get("risk_adjusted", False)
    risk_note = (f" [Tightened: vendor risk {tolerances.get('risk_level', '?')} "
                 f"({tolerances.get('risk_score', 0):.0f})]" if risk_adjusted else "")

    # ── 1. LINE ITEM TOTAL VERIFICATION ──
    li_sum = sum(float(li.get("total") or 0) for li in (invoice.get("lineItems") or []))
    if li_sum > 0 and inv_subtotal > 0:
        diff = abs(li_sum - inv_subtotal)
        if diff > 0.50:
            anomalies.append({"type": "LINE_ITEM_TOTAL_MISMATCH",
                "severity": severity_for_amount(diff, inv_subtotal),
                "description": f"Sum of line items ({fmt_amt(li_sum, sym)}) does not match subtotal ({fmt_amt(inv_subtotal, sym)}). Difference: {fmt_amt(diff, sym)}",
                "amount_at_risk": round(diff, 2), "contract_clause": None,
                "recommendation": "Verify line item totals. Possible hidden charges or calculation error."})

    # ── 2. MISSING PO CHECK ──
    # Note: amount_at_risk = 0 because a missing PO means the invoice is unapproved,
    # NOT that the full amount is fraudulent. The risk is procedural, not financial.
    if not po and not invoice.get("poReference"):
        anomalies.append({"type": "MISSING_PO", "severity": "high",
            "description": f"Invoice {invoice.get('invoiceNumber', '?')} has no purchase order reference. Cannot verify authorization.",
            "amount_at_risk": 0, "contract_clause": None,
            "recommendation": "Verify this purchase was authorized before payment."})
    elif not po and invoice.get("poReference"):
        anomalies.append({"type": "MISSING_PO", "severity": "high",
            "description": f"Invoice references {invoice['poReference']} but no matching PO found in the system.",
            "amount_at_risk": 0, "contract_clause": None,
            "recommendation": f"Upload or locate PO {invoice['poReference']} before approving payment."})

    # ── 3. PO COMPARISON (tax-aware) ──
    po_level_diff = 0
    if po:
        po_amt = float(po.get("amount") or 0)
        compare_amt = inv_subtotal
        tolerance = po_amt * (amt_tol_pct / 100)

        if po_amt > 0 and compare_amt > po_amt + tolerance:
            po_level_diff = compare_amt - po_amt

        inv_items = {((li.get("description") or "")).lower().strip(): li for li in invoice.get("lineItems", [])}
        po_items = {((li.get("description") or "")).lower().strip(): li for li in po.get("lineItems", [])}
        line_item_risk_total = 0

        def _match_score(desc_a, desc_b, li_a, li_b):
            """Multi-signal item matching: part number > word overlap > character similarity."""
            # 1. Part number match (strongest signal)
            pn_a = (li_a.get("partNumber") or li_a.get("itemCode") or li_a.get("sku") or "").strip()
            pn_b = (li_b.get("partNumber") or li_b.get("itemCode") or li_b.get("sku") or "").strip()
            if pn_a and pn_b and pn_a.lower() == pn_b.lower():
                return 1.0  # exact part number match

            # 2. Substring containment
            if desc_a in desc_b or desc_b in desc_a:
                # But verify they aren't trivially short (e.g. "a" in "apple")
                if min(len(desc_a), len(desc_b)) > 5:
                    return 1.0

            # 3. Word overlap (handles reordering: "IT Consulting" ↔ "Consulting Services")
            all_words_a = set(desc_a.split())
            all_words_b = set(desc_b.split())
            sig_a = set(w for w in all_words_a if len(w) > 2)
            sig_b = set(w for w in all_words_b if len(w) > 2)
            if sig_a and sig_b:
                sig_overlap = len(sig_a & sig_b)
                sig_union = len(sig_a | sig_b)
                if sig_overlap >= 2:
                    # Strong match: 2+ significant words in common
                    word_sim = sig_overlap / sig_union if sig_union > 0 else 0
                    boosted = min(1.0, word_sim + 0.4)
                    return max(boosted, SequenceMatcher(None, desc_a, desc_b).ratio())
                elif sig_overlap == 1:
                    # Weak match: 1 significant word in common
                    # Only boost if the shared word is the longest (dominant term)
                    # AND the other words are pure qualifiers that don't conflict
                    shared_word = list(sig_a & sig_b)[0]
                    longest_a = max(sig_a, key=len)
                    longest_b = max(sig_b, key=len)
                    diffs_a = all_words_a - all_words_b
                    diffs_b = all_words_b - all_words_a
                    # If BOTH sides have differing words, they could be different items
                    # "Widget A" vs "Widget B" → diffs_a={a}, diffs_b={b} → skip
                    # "Consulting Services" vs "IT Consulting" → diffs_a={services}, diffs_b={it} → conflicting nouns
                    # Actually: allow ONLY when one side has no diffs (pure subset)
                    # OR the shared word is dominant and diffs are very minor (len <= 2)
                    if shared_word == longest_a or shared_word == longest_b:
                        minor_diffs_only = all(len(w) <= 2 for w in diffs_a) or all(len(w) <= 2 for w in diffs_b)
                        if minor_diffs_only and (len(diffs_a) <= 1 or len(diffs_b) <= 1):
                            return max(0.75, SequenceMatcher(None, desc_a, desc_b).ratio())

            # 4. Character-level similarity (original)
            return SequenceMatcher(None, desc_a, desc_b).ratio()

        for desc, inv_li in inv_items.items():
            matched = None
            best_sim = 0
            for pd, pli in po_items.items():
                sim = _match_score(desc, pd, inv_li, pli)
                if sim > 0.7 and sim > best_sim:
                    matched = pli; best_sim = sim

            if matched:
                iq, pq = _n(inv_li.get("quantity")), _n(matched.get("quantity"))
                if iq > pq > 0:
                    extra = iq - pq
                    price = _n(inv_li.get("unitPrice"))
                    risk = extra * price
                    line_item_risk_total += risk
                    anomalies.append({"type": "QUANTITY_MISMATCH",
                        "severity": severity_for_amount(risk, po_amt),
                        "description": f"'{inv_li['description']}': Billed {iq} units, PO authorized {pq}. {extra} unauthorized.",
                        "amount_at_risk": round(risk, 2), "contract_clause": None,
                        "recommendation": f"Dispute {extra} extra units ({fmt_amt(risk, sym)})"})

                ip, pp = _n(inv_li.get("unitPrice")), _n(matched.get("unitPrice"))
                price_tol = pp * (prc_tol_pct / 100)
                if ip > pp + price_tol and pp > 0:
                    d = ip - pp; q = _n(inv_li.get("quantity"), 1); risk = d * q
                    line_item_risk_total += risk
                    anomalies.append({"type": "PRICE_OVERCHARGE",
                        "severity": severity_for_amount(risk, po_amt),
                        "description": f"'{inv_li['description']}': {fmt_amt(ip, sym)}/unit vs PO {fmt_amt(pp, sym)}/unit{risk_note}",
                        "amount_at_risk": round(risk, 2), "contract_clause": None,
                        "recommendation": f"Request credit: {fmt_amt(risk, sym)}"})
            else:
                if _n(inv_li.get("total")) > 0:
                    line_item_risk_total += _n(inv_li.get("total"))
                    anomalies.append({"type": "UNAUTHORIZED_ITEM",
                        "severity": severity_for_amount(inv_li["total"], po_amt) if po_amt > 0 else "medium",
                        "description": f"'{inv_li['description']}' ({fmt_amt(inv_li['total'], sym)}) not found in purchase order.",
                        "amount_at_risk": inv_li["total"], "contract_clause": None,
                        "recommendation": "Verify authorization before payment."})

        if po_level_diff > 0 and line_item_risk_total < po_level_diff * 0.9:
            unexplained = po_level_diff - line_item_risk_total
            _tax_note = " Note: subtotal unavailable — using total which may include tax, inflating the variance." if _subtotal_is_fallback else ""
            anomalies.append({"type": "AMOUNT_DISCREPANCY",
                "severity": severity_for_amount(unexplained, po_amt) if not _subtotal_is_fallback else "medium",
                "description": f"Invoice subtotal ({fmt_amt(compare_amt, sym)}) exceeds PO total ({fmt_amt(po_amt, sym)}) by {fmt_amt(po_level_diff, sym)}"
                    + (f". {fmt_amt(line_item_risk_total, sym)} explained by line-item overcharges, {fmt_amt(unexplained, sym)} unexplained." if line_item_risk_total > 0 else f", representing a {fmt_pct(po_level_diff/po_amt*100)} variance which exceeds the {amt_tol_pct}% tolerance threshold{risk_note}.")
                    + _tax_note,
                "amount_at_risk": round(unexplained, 2), "contract_clause": "Purchase order authorization limits",
                "recommendation": f"Reject invoice pending price correction to match contracted rates. Total should be {fmt_amt(po_amt, sym)} based on contract pricing."})

    # ── 4. CONTRACT PRICING CHECK ──
    if contract:
        ct = contract.get("contractTerms") or {}
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
            except (ValueError, TypeError):
                pass

        pricing_terms = contract.get("pricingTerms") or []
        for pt in pricing_terms:
            contract_item = (pt.get("item") or "").lower().strip()
            contracted_rate = _n(pt.get("rate"))
            if not contract_item or not contracted_rate:
                continue
            for inv_li in invoice.get("lineItems", []):
                inv_desc = (inv_li.get("description") or "").lower().strip()
                sim = SequenceMatcher(None, contract_item, inv_desc).ratio()
                if sim > 0.6 or contract_item in inv_desc or inv_desc in contract_item:
                    inv_rate = _n(inv_li.get("unitPrice"))
                    if inv_rate > contracted_rate * (1 + prc_tol_pct / 100):
                        diff = inv_rate - contracted_rate
                        qty = _n(inv_li.get("quantity"), 1)
                        risk = diff * qty
                        anomalies.append({"type": "PRICE_OVERCHARGE",
                            "severity": severity_for_amount(risk, inv_total) if inv_total > 0 else "medium",
                            "description": f"'{inv_li['description']}': {fmt_amt(inv_rate, sym)}/{pt.get('unit', 'unit')} vs contract rate {fmt_amt(contracted_rate, sym)}/{pt.get('unit', 'unit')}",
                            "amount_at_risk": round(risk, 2),
                            "contract_clause": f"Contract pricing: {pt.get('item')} at {fmt_amt(contracted_rate, sym)}/{pt.get('unit', 'unit')}",
                            "recommendation": f"Vendor overcharging vs contract. Dispute {fmt_amt(risk, sym)}"})
                    break

    # Contract payment terms mismatch
    if contract:
        it = (invoice.get("paymentTerms") or "").lower().strip()
        ct_terms = (contract.get("paymentTerms") or "").lower().strip()
        if it and ct_terms and it != ct_terms:
            anomalies.append({"type": "TERMS_VIOLATION", "severity": "medium",
                "description": f"Invoice terms '{invoice.get('paymentTerms')}' differ from contract '{contract.get('paymentTerms')}'",
                "amount_at_risk": 0, "contract_clause": f"Contract: {contract.get('paymentTerms')}",
                "recommendation": "Enforce contract payment terms."})

    # ── 5. DUPLICATE DETECTION ──
    DUPLICATE_DAYS_WINDOW = policy["duplicate_window_days"]
    if history:
        for h in history:
            if h.get("id") == invoice.get("id"):
                continue
            dup_score, dup_reasons = 0, []

            h_inv = h.get("invoiceNumber", "")
            inv_inv = invoice.get("invoiceNumber", "")
            if h_inv and inv_inv and h_inv == inv_inv:
                dup_score += 60  # same invoice# is very strong signal
                dup_reasons.append("identical invoice number")

            h_amt = float(h.get("amount") or 0)
            if h_amt > 0 and inv_total > 0 and abs(h_amt - inv_total) / max(h_amt, inv_total) < 0.02:
                dup_score += 40
                dup_reasons.append("same amount")

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
                except:
                    pass

            h_items = set(((li.get("description") or "").lower(), _n(li.get("quantity")), _n(li.get("unitPrice")))
                         for li in h.get("lineItems", []))
            i_items = set(((li.get("description") or "").lower(), _n(li.get("quantity")), _n(li.get("unitPrice")))
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
                    "description": f"Likely duplicate of {h.get('invoiceNumber', '?')} ({fmt_amt(h.get('amount', 0), sym)}). Signals: {', '.join(dup_reasons)}. Confidence: {dup_score}%",
                    "amount_at_risk": inv_total, "contract_clause": None,
                    "recommendation": "Verify this is not a duplicate payment. Do not process until confirmed."})

    # ── 6. EARLY PAYMENT DISCOUNT ──
    epd = invoice.get("earlyPaymentDiscount")
    if epd and epd.get("discount_percent") and epd.get("days"):
        savings = inv_subtotal * (epd["discount_percent"] / 100)
        anomalies.append({"type": "EARLY_PAYMENT_DISCOUNT", "severity": "low",
            "description": f"Eligible for {epd['discount_percent']}% discount ({fmt_amt(savings, sym)}) on subtotal if paid within {epd['days']} days",
            "amount_at_risk": round(-savings, 2),
            "contract_clause": f"Terms: {invoice.get('paymentTerms', '')}",
            "recommendation": f"Pay within {epd['days']} days to save {fmt_amt(savings, sym)}"})

    # ── 7. TAX RATE SANITY CHECK (locale-aware) ──
    tax_details = invoice.get("taxDetails", [])
    if tax_details and inv_subtotal > 0:
        total_tax = sum(_n(t.get("amount")) for t in tax_details)
        effective_rate = (total_tax / inv_subtotal) * 100 if inv_subtotal > 0 else 0

        # Determine locale-specific tax ceilings
        from backend.config import LOCALE_PROFILES, CURRENCY_LOCALE_MAP, DEFAULT_LOCALE
        inv_currency = invoice.get("currency", "USD")
        inv_locale = invoice.get("locale") or invoice.get("_detected_locale") or CURRENCY_LOCALE_MAP.get(inv_currency, DEFAULT_LOCALE)
        locale_profile = LOCALE_PROFILES.get(inv_locale, LOCALE_PROFILES[DEFAULT_LOCALE])
        tax_ceiling = locale_profile.get("tax_rate_ceiling", 30)

        if effective_rate > tax_ceiling:
            anomalies.append({"type": "TAX_RATE_ANOMALY", "severity": "medium",
                "description": f"Effective tax rate is {effective_rate:.1f}% ({fmt_amt(total_tax, sym)} on {fmt_amt(inv_subtotal, sym)}). Exceeds {inv_locale} ceiling of {tax_ceiling}%.",
                "amount_at_risk": round(total_tax, 2), "contract_clause": None,
                "recommendation": f"Verify tax calculation. Rate exceeds the expected maximum of {tax_ceiling}% for {locale_profile.get('name', inv_locale)}."})
        elif effective_rate > 0 and effective_rate < 1:
            # Don't flag if any tax line has explicit 0% rate (reverse charge / zero-rated)
            has_explicit_zero = any(_n(t.get("rate")) == 0 for t in tax_details)
            # Don't flag if total tax is very small (rounding artifact)
            if not has_explicit_zero and total_tax > 1.0:
                anomalies.append({"type": "TAX_RATE_ANOMALY", "severity": "low",
                    "description": f"Effective tax rate is only {effective_rate:.1f}%. Unusually low — verify tax is applied correctly. If this is a reverse-charge or zero-rated transaction, this is expected.",
                    "amount_at_risk": 0, "contract_clause": None,
                    "recommendation": "Confirm tax exemption, reverse charge, or verify rate."})

        for td in tax_details:
            stated_rate = _n(td.get("rate"))
            tax_amount = _n(td.get("amount"))
            if stated_rate > 0 and tax_amount > 0 and inv_subtotal > 0:
                # Calculate expected tax — use line item subtotals if only some items
                # are taxable, otherwise fall back to full subtotal
                n_tax_lines = len(tax_details)
                n_items = len(invoice.get("lineItems", []))
                # If there's 1 tax line for many items, it likely applies to full subtotal
                # If multiple tax lines, each may apply to specific items
                expected_tax = inv_subtotal * (stated_rate / 100)
                tax_diff = abs(tax_amount - expected_tax)
                # Use wider tolerance (10%) when tax may apply to partial subtotal
                tolerance_pct = 0.10 if n_tax_lines > 1 or n_items > 3 else 0.05
                if tax_diff > max(1.0, expected_tax * tolerance_pct):
                    tax_type_name = td.get('type', 'tax')
                    partial_note = " (tax may apply to only some line items)" if n_items > 1 else ""
                    anomalies.append({"type": "TAX_RATE_ANOMALY", "severity": "medium",
                        "description": f"Tax amount {fmt_amt(tax_amount, sym)} doesn't match stated {tax_type_name} rate of {stated_rate}%. Expected {fmt_amt(expected_tax, sym)}, difference: {fmt_amt(tax_diff, sym)}.{partial_note}",
                        "amount_at_risk": round(tax_diff, 2), "contract_clause": None,
                        "recommendation": f"Verify {tax_type_name} calculation. Stated rate {stated_rate}% on {fmt_amt(inv_subtotal, sym)} should be {fmt_amt(expected_tax, sym)}. Check if tax applies to all items."})

    # ── 8. CURRENCY MISMATCH ──
    if po:
        po_cur = po.get("currency", "USD")
        inv_cur = invoice.get("currency", "USD")
        if po_cur != inv_cur:
            anomalies.append({"type": "CURRENCY_MISMATCH", "severity": "medium",
                "description": f"Currency mismatch: Invoice in {inv_cur}, PO in {po_cur}. Cannot compare amounts directly.",
                "amount_at_risk": 0, "contract_clause": None,
                "recommendation": f"Verify exchange rate and ensure amounts align. Invoice: {inv_cur}, PO: {po_cur}"})

    # ── 9. POLICY-DRIVEN CHECKS ──
    if policy.get("flag_round_number_invoices"):
        rn_threshold = policy.get("round_number_threshold", 1000)
        if inv_total >= rn_threshold and inv_total == round(inv_total, -3):
            anomalies.append({"type": "ROUND_NUMBER_INVOICE", "severity": "low",
                "description": f"Suspiciously round invoice amount: {fmt_amt(inv_total, sym)}. Legitimate invoices rarely land on exact thousands.",
                "amount_at_risk": 0, "contract_clause": None,
                "recommendation": "Verify invoice is for actual goods/services delivered."})

    if policy.get("flag_weekend_invoices"):
        issue_date = invoice.get("issueDate") or invoice.get("issue_date")
        if issue_date:
            try:
                dt = datetime.strptime(str(issue_date)[:10], "%Y-%m-%d")
                if dt.weekday() >= 5:
                    anomalies.append({"type": "WEEKEND_INVOICE", "severity": "low",
                        "description": f"Invoice dated on {'Saturday' if dt.weekday()==5 else 'Sunday'} ({issue_date}).",
                        "amount_at_risk": 0, "contract_clause": None,
                        "recommendation": "Verify vendor legitimacy. Weekend invoicing is a minor fraud indicator."})
            except:
                pass

    max_age = policy.get("max_invoice_age_days", 365)
    issue_date_str = invoice.get("issueDate") or invoice.get("issue_date")
    if issue_date_str and max_age > 0:
        try:
            dt = datetime.strptime(str(issue_date_str)[:10], "%Y-%m-%d")
            age = (datetime.now() - dt).days
            if age < -1:
                # Future-dated invoice — suspicious
                anomalies.append({"type": "STALE_INVOICE", "severity": "high",
                    "description": f"Invoice is dated {abs(age)} days in the FUTURE ({issue_date_str}). Possible data entry error or fraudulent backdating.",
                    "amount_at_risk": inv_total, "contract_clause": None,
                    "recommendation": "Verify invoice date with vendor. Future-dated invoices require investigation."})
            elif age > max_age:
                anomalies.append({"type": "STALE_INVOICE", "severity": "medium",
                    "description": f"Invoice is {age} days old (issued {issue_date_str}). Policy max: {max_age} days.",
                    "amount_at_risk": inv_total, "contract_clause": None,
                    "recommendation": f"Investigate why this invoice is {age} days old."})
        except:
            pass

    return anomalies


# ============================================================
# GRN-SPECIFIC ANOMALY DETECTION
# ============================================================
def detect_grn_anomalies(invoice: dict, po: dict, grn_info: dict, db: dict) -> list:
    """Detect anomalies specific to three-way matching (PO ↔ GRN ↔ Invoice)."""
    anomalies = []
    policy = get_policy()
    cur = invoice.get("currency", "USD")
    sym = currency_symbol(cur)
    inv_subtotal = float(invoice.get("subtotal") or invoice.get("amount") or 0)

    matching_mode = policy["matching_mode"]
    if grn_info.get("grnStatus") == "no_grn" and po:
        if matching_mode in ("three_way", "flexible"):
            anomalies.append({
                "type": "UNRECEIPTED_INVOICE",
                "severity": "high" if matching_mode == "three_way" else "medium",
                "description": f"Invoice {invoice.get('invoiceNumber', '?')} has no goods receipt (GRN) on file. Cannot confirm goods/services were received.",
                "amount_at_risk": inv_subtotal,
                "contract_clause": "Three-way match policy: No payment without receipt confirmation",
                "recommendation": "Upload GRN/delivery note to confirm receipt before approving payment."
            })
        return anomalies

    if grn_info.get("grnStatus") != "received":
        return anomalies

    total_received = grn_info.get("totalReceived", 0)
    grn_amt_tol = policy.get("grn_amount_tolerance_pct", 2) / 100
    if total_received > 0 and inv_subtotal > total_received * (1 + grn_amt_tol):
        diff = inv_subtotal - total_received
        anomalies.append({
            "type": "OVERBILLED_VS_RECEIVED",
            "severity": "high" if diff > inv_subtotal * 0.1 else "medium",
            "description": f"Invoice subtotal ({fmt_amt(inv_subtotal, sym)}) exceeds total received value ({fmt_amt(total_received, sym)}) by {fmt_amt(diff, sym)}.",
            "amount_at_risk": round(diff, 2),
            "contract_clause": "Three-way match: pay only for goods/services actually received",
            "recommendation": f"Reduce invoice to match received value ({fmt_amt(total_received, sym)}) or obtain additional GRN."
        })

    inv_items = {(li.get("description") or "").lower().strip(): li for li in invoice.get("lineItems", [])}
    grn_items_agg = {}
    for gli in grn_info.get("grnLineItems", []):
        desc = (gli.get("description") or "").lower().strip()
        grn_items_agg[desc] = grn_items_agg.get(desc, 0) + float(gli.get("quantityReceived") or 0)

    for desc, inv_li in inv_items.items():
        inv_qty = float(inv_li.get("quantity") or 0)
        if inv_qty <= 0:
            continue
        best_grn_qty = 0
        best_match_desc = None
        for grn_desc, grn_qty in grn_items_agg.items():
            sim = SequenceMatcher(None, desc, grn_desc).ratio()
            if sim > 0.6 or desc in grn_desc or grn_desc in desc:
                best_grn_qty = grn_qty
                best_match_desc = grn_desc
                break

        grn_qty_tol = policy.get("grn_qty_tolerance_pct", 2) / 100
        if best_match_desc is not None and inv_qty > best_grn_qty * (1 + grn_qty_tol):
            excess = inv_qty - best_grn_qty
            unit_price = float(inv_li.get("unitPrice") or 0)
            risk = excess * unit_price
            anomalies.append({
                "type": "QUANTITY_RECEIVED_MISMATCH",
                "severity": "high" if risk > inv_subtotal * 0.05 else "medium",
                "description": f"'{inv_li.get('description')}': billed {inv_qty:.0f} units but only {best_grn_qty:.0f} received (excess: {excess:.0f}).",
                "amount_at_risk": round(risk, 2),
                "contract_clause": "Three-way match: bill only for quantities actually received",
                "recommendation": f"Reduce billed quantity to {best_grn_qty:.0f} or provide proof of additional delivery."
            })

    if po:
        po_amt = float(po.get("amount") or 0)
        short_threshold = policy.get("short_shipment_threshold_pct", 90) / 100
        if total_received > 0 and po_amt > 0 and total_received < po_amt * short_threshold:
            short_pct = round((1 - total_received / po_amt) * 100, 1)
            anomalies.append({
                "type": "SHORT_SHIPMENT",
                "severity": "low",
                "description": f"Only {fmt_amt(total_received, sym)} of {fmt_amt(po_amt, sym)} PO value received ({short_pct}% short). Partial delivery.",
                "amount_at_risk": 0,
                "contract_clause": "PO fulfillment tracking",
                "recommendation": f"Track remaining delivery. {short_pct}% of PO value outstanding."
            })

    return anomalies
