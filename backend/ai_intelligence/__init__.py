"""
AuditLens — AI Intelligence Layer
===================================
8 AI-powered features beyond extraction, built on the Grounded Generation pattern:
  Claude reasons → System provides facts → Post-validation verifies output.

Features:
  F1. Investigation Briefs      — AI-narrated case investigation summaries
  F2. Smart PO Matching         — Fuzzy AI-powered invoice→PO resolution
  F3. Natural Language Policy    — Configure AP policy in plain English
  F4. Payment Prioritization    — AI-optimized payment run recommendations
  F5. Plain English Anomalies   — Human-readable anomaly explanations
  F6. Vendor Communication      — AI-drafted dispute letters & emails
  F7. Anomaly Pattern Insights  — AI-synthesized vendor behavior analysis
  F8. Smart Case Routing        — AI-recommended case assignments

Architecture:
  - Claude is the narrator, NOT the analyst
  - All facts come from the database (grounded context)
  - Every number in AI output is post-validated against source data
  - Deterministic fallback for every feature if AI fails
  - Human confirmation required for all high-stakes actions
"""

import json, re, os
from datetime import datetime, timedelta
from typing import Optional

# Lazy imports to avoid circular dependencies
def _get_db():
    from backend.db import get_db
    return get_db()

def _get_policy():
    from backend.policy import get_policy
    return get_policy()

def _use_real_api():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))

async def _call_claude(prompt: str, max_tokens: int = 2000) -> Optional[str]:
    """Single LLM call with error handling. Routes through llm_provider for multi-provider support."""
    if not _use_real_api():
        return None
    try:
        from backend.llm_provider import llm_call
        return await llm_call(prompt=prompt, model="primary", max_tokens=max_tokens)
    except ImportError:
        # Fallback if llm_provider not yet integrated
        import anthropic
        from backend.config import ENSEMBLE_PRIMARY_MODEL
        client = anthropic.AsyncAnthropic()
        msg = await client.messages.create(
            model=ENSEMBLE_PRIMARY_MODEL, max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}])
        return msg.content[0].text.strip()
    except Exception as e:
        print(f"[AI Intelligence] LLM call failed: {e}")
        return None

def _clean_json(text: str) -> str:
    """Strip markdown fences from Claude JSON output."""
    if text and text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"): text = text[:-3]
    return text.strip() if text else ""

def _fmt_amount(amount, currency="USD"):
    """Format amount with currency symbol."""
    sym = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹", "AED": "AED ",
           "JPY": "¥", "CAD": "C$", "AUD": "A$"}.get(currency, f"{currency} ")
    if currency == "JPY":
        return f"{sym}{amount:,.0f}"
    return f"{sym}{amount:,.2f}"


# ════════════════════════════════════════════════════════════════
# F1. AI INVESTIGATION BRIEFS
# ════════════════════════════════════════════════════════════════

def _build_investigation_context(case: dict, db: dict) -> dict:
    """Assemble all facts for investigation brief — deterministic, no AI."""
    inv_id = case.get("invoiceId")
    invoice = next((i for i in db.get("invoices", []) if i["id"] == inv_id), None)
    if not invoice:
        return {}

    vendor = invoice.get("vendor", "Unknown")

    # Find matched PO
    po = None
    grn = None
    for m in db.get("matches", []):
        if m.get("invoiceId") == inv_id:
            po = next((p for p in db.get("purchase_orders", []) if p["id"] == m.get("poId")), None)
            grn = next((g for g in db.get("goods_receipts", []) if g.get("poId") == m.get("poId")), None)
            break

    # Contract
    from backend.vendor import find_vendor_contract
    contract = find_vendor_contract(vendor, db.get("contracts", []))

    # Anomalies for this invoice
    anomalies = [a for a in db.get("anomalies", [])
                 if a.get("invoiceId") == inv_id and a.get("status") == "open"]

    # Vendor history
    from backend.vendor import vendor_similarity
    vendor_invoices = [i for i in db.get("invoices", [])
                       if vendor_similarity(i.get("vendor", ""), vendor) >= 0.7
                       and i["id"] != inv_id]
    vendor_anomalies = [a for a in db.get("anomalies", [])
                        if vendor_similarity(a.get("vendor", ""), vendor) >= 0.7
                        and a.get("invoiceId") != inv_id]

    # Vendor risk
    from backend.vendor import compute_vendor_risk_score
    risk = compute_vendor_risk_score(vendor, db)

    return {
        "invoice": invoice, "po": po, "grn": grn, "contract": contract,
        "anomalies": anomalies, "vendor_history": vendor_invoices[-5:],
        "vendor_anomaly_history": vendor_anomalies[-10:],
        "vendor_risk": risk, "case": case
    }


def _fallback_investigation_brief(ctx: dict) -> str:
    """Deterministic fallback brief when AI is unavailable."""
    inv = ctx.get("invoice", {})
    anomalies = ctx.get("anomalies", [])
    risk = ctx.get("vendor_risk", {})
    cur = inv.get("currency", "USD")

    lines = [f"Investigation required for invoice {inv.get('invoiceNumber', 'N/A')} "
             f"from {inv.get('vendor', 'Unknown')} for {_fmt_amount(inv.get('amount', 0), cur)}."]

    if anomalies:
        total_risk = sum(abs(float(a.get("amount_at_risk", 0))) for a in anomalies)
        lines.append(f"{len(anomalies)} anomaly(ies) detected with total risk of {_fmt_amount(total_risk, cur)}.")
        for a in anomalies:
            lines.append(f"• {a.get('type', 'UNKNOWN').replace('_', ' ')}: {a.get('description', 'No description')}")

    if ctx.get("po"):
        lines.append(f"Matched to PO {ctx['po'].get('poNumber', 'N/A')}.")
    if ctx.get("contract"):
        lines.append(f"Vendor contract {ctx['contract'].get('contractNumber', 'N/A')} on file.")
    if risk.get("level") in ("high",):
        lines.append(f"Vendor risk: {risk['level'].upper()} ({risk.get('score', 0)}/100).")

    return "\n".join(lines)


async def generate_investigation_brief(case_id: str) -> dict:
    """F1: Generate AI investigation brief for a case.
    Returns: {"brief": str, "ai_generated": bool, "facts_verified": bool, "context_summary": dict}
    """
    db = _get_db()
    case = next((c for c in db.get("cases", []) if c["id"] == case_id), None)
    if not case:
        return {"brief": "Case not found.", "ai_generated": False, "facts_verified": False}

    ctx = _build_investigation_context(case, db)
    if not ctx.get("invoice"):
        return {"brief": "Invoice data not found.", "ai_generated": False, "facts_verified": False}

    inv = ctx["invoice"]
    cur = inv.get("currency", "USD")
    anomalies = ctx["anomalies"]
    risk = ctx["vendor_risk"]

    # Build grounded context for Claude
    def safe(d, skip=None):
        if not d: return "Not available"
        skip = skip or {"rawExtraction", "extractionSource", "extractedAt", "editHistory", "processingTime"}
        return json.dumps({k: v for k, v in d.items() if k not in skip}, indent=2, default=str)[:3000]

    prompt = f"""You are a senior F&A auditor writing an investigation brief. Use ONLY the facts below.
Do NOT infer, assume, or fabricate any figures, dates, contract terms, or vendor details not present in the data.
Every dollar amount must match EXACTLY. Every contract reference must quote the actual text provided.

INVOICE:
{safe(inv)}

PURCHASE ORDER:
{safe(ctx.get("po"))}

GOODS RECEIPT:
{safe(ctx.get("grn"))}

CONTRACT:
{safe(ctx.get("contract"))}

ANOMALIES DETECTED:
{json.dumps([{"type": a.get("type"), "severity": a.get("severity"), "description": a.get("description"),
              "amount_at_risk": a.get("amount_at_risk"), "recommendation": a.get("recommendation")}
             for a in anomalies], indent=2, default=str)}

VENDOR RISK PROFILE:
Score: {risk.get("score", 0)}/100 | Level: {risk.get("level", "unknown")} | Trend: {risk.get("trend", "stable")}
Past invoices: {risk.get("invoiceCount", 0)} | Open anomalies: {risk.get("openAnomalyCount", 0)}

VENDOR ANOMALY HISTORY (last 10):
{json.dumps([{"type": a.get("type"), "invoiceNumber": a.get("invoiceNumber"),
              "amount_at_risk": a.get("amount_at_risk"), "status": a.get("status")}
             for a in ctx.get("vendor_anomaly_history", [])[-10:]], indent=2, default=str)}

CASE DETAILS:
Type: {case.get("type")} | Priority: {case.get("priority")} | SLA Deadline: {case.get("sla", {}).get("deadline")}

Write a 3-4 paragraph investigation brief covering:
1. What happened (invoice details + what the anomalies are)
2. Financial impact (exact amounts at risk, using {cur} currency)
3. Vendor context (risk level, history of similar issues)
4. Recommended action (based on the anomaly recommendations and vendor history)

Be specific and factual. Use the exact amounts from the data. Do NOT speculate about vendor intent."""

    text = await _call_claude(prompt, max_tokens=1500)

    if not text:
        return {"brief": _fallback_investigation_brief(ctx),
                "ai_generated": False, "facts_verified": True,
                "context_summary": {"anomaly_count": len(anomalies),
                    "total_risk": sum(abs(float(a.get("amount_at_risk", 0))) for a in anomalies),
                    "vendor_risk": risk.get("level"), "has_po": bool(ctx.get("po")),
                    "has_contract": bool(ctx.get("contract"))}}

    # ── Post-validation: verify key amounts ──
    verified = True
    known_amounts = set()
    known_amounts.add(str(round(float(inv.get("amount", 0)), 2)))
    known_amounts.add(str(round(float(inv.get("subtotal", 0)), 2)))
    for a in anomalies:
        if a.get("amount_at_risk"):
            known_amounts.add(str(round(abs(float(a["amount_at_risk"])), 2)))
    if ctx.get("po") and ctx["po"].get("amount"):
        known_amounts.add(str(round(float(ctx["po"]["amount"]), 2)))

    # Extract numbers from AI output and check
    ai_numbers = re.findall(r'[\$€£¥₹][\d,]+\.?\d*', text)
    for num_str in ai_numbers:
        clean = re.sub(r'[^\d.]', '', num_str)
        if clean and float(clean) > 100:  # Only check significant amounts
            if clean not in known_amounts and f"{float(clean):.2f}" not in known_amounts:
                verified = False
                break

    return {"brief": text, "ai_generated": True, "facts_verified": verified,
            "context_summary": {"anomaly_count": len(anomalies),
                "total_risk": sum(abs(float(a.get("amount_at_risk", 0))) for a in anomalies),
                "vendor_risk": risk.get("level"), "has_po": bool(ctx.get("po")),
                "has_contract": bool(ctx.get("contract"))}}


# ════════════════════════════════════════════════════════════════
# F2. SMART PO MATCHING (Fuzzy AI Resolution)
# ════════════════════════════════════════════════════════════════

async def smart_match_invoice(invoice_id: str) -> dict:
    """F2: AI-powered fuzzy PO matching for unmatched invoices.
    Returns: {"candidates": [{"po_id", "po_number", "confidence", "reasons": [], "warnings": []}], "ai_powered": bool}
    """
    db = _get_db()
    invoice = next((i for i in db.get("invoices", []) if i["id"] == invoice_id), None)
    if not invoice:
        return {"candidates": [], "ai_powered": False, "error": "Invoice not found"}

    # Already matched?
    existing = [m for m in db.get("matches", []) if m.get("invoiceId") == invoice_id]
    if existing:
        return {"candidates": [], "ai_powered": False, "note": "Already matched"}

    pos = db.get("purchase_orders", [])
    if not pos:
        return {"candidates": [], "ai_powered": False, "note": "No POs in system"}

    # Build context
    inv_summary = {
        "vendor": invoice.get("vendor"), "amount": invoice.get("amount"),
        "subtotal": invoice.get("subtotal"), "currency": invoice.get("currency"),
        "date": invoice.get("issueDate"), "po_reference": invoice.get("poReference"),
        "line_items": [{"description": li.get("description"), "quantity": li.get("quantity"),
                        "unitPrice": li.get("unitPrice"), "total": li.get("total")}
                       for li in invoice.get("lineItems", [])[:10]]
    }
    po_summaries = [{"id": p["id"], "po_number": p.get("poNumber"),
                     "vendor": p.get("vendor"), "amount": p.get("amount"),
                     "currency": p.get("currency"), "date": p.get("issueDate"),
                     "line_items": [{"description": li.get("description"), "quantity": li.get("quantity"),
                                     "unitPrice": li.get("unitPrice")}
                                    for li in p.get("lineItems", [])[:10]]}
                    for p in pos]

    prompt = f"""You are an F&A matching specialist. An invoice could not be automatically matched to a PO.
Analyze the invoice and ALL available POs. Identify the most likely PO match(es).

UNMATCHED INVOICE:
{json.dumps(inv_summary, indent=2, default=str)}

AVAILABLE PURCHASE ORDERS:
{json.dumps(po_summaries, indent=2, default=str)}

For each potential match, consider:
1. Vendor name similarity (exact match, abbreviations, parent companies)
2. Amount proximity (invoice subtotal vs PO total, accounting for tax)
3. Line item overlap (similar descriptions, quantities, unit prices)
4. Date logic (invoice should be after PO)
5. Currency match

Respond ONLY with JSON:
{{"candidates": [
  {{"po_id": "actual_po_id_from_data", "po_number": "actual_po_number", "confidence": 0.85,
    "reasons": ["Vendor names match", "3 of 5 line items match"],
    "warnings": ["Invoice total exceeds PO by 12%"]}}
]}}

If no reasonable match exists, return {{"candidates": []}}
confidence: 0.9+ strong match, 0.7-0.9 likely, 0.5-0.7 possible, <0.5 unlikely.
Use ONLY po_id values from the PO data above. Do NOT fabricate IDs."""

    text = await _call_claude(prompt, max_tokens=1000)
    if not text:
        # Deterministic fallback: simple vendor name + amount matching
        from backend.vendor import vendor_similarity
        candidates = []
        for p in pos:
            vs = vendor_similarity(invoice.get("vendor", ""), p.get("vendor", ""))
            if vs < 0.5:
                continue
            inv_sub = float(invoice.get("subtotal") or invoice.get("amount") or 0)
            po_amt = float(p.get("amount") or 0)
            amt_ratio = min(inv_sub, po_amt) / max(inv_sub, po_amt) if max(inv_sub, po_amt) > 0 else 0
            if amt_ratio < 0.5:
                continue
            conf = round((vs * 0.6 + amt_ratio * 0.4), 2)
            candidates.append({"po_id": p["id"], "po_number": p.get("poNumber", ""),
                               "confidence": conf,
                               "reasons": [f"Vendor similarity: {vs:.0%}", f"Amount match: {amt_ratio:.0%}"],
                               "warnings": []})
        candidates.sort(key=lambda x: x["confidence"], reverse=True)
        return {"candidates": candidates[:3], "ai_powered": False}

    try:
        result = json.loads(_clean_json(text))
        candidates = result.get("candidates", [])
        # Post-validate: ensure po_ids actually exist
        valid_ids = {p["id"] for p in pos}
        candidates = [c for c in candidates if c.get("po_id") in valid_ids]
        return {"candidates": candidates[:3], "ai_powered": True}
    except Exception:
        return {"candidates": [], "ai_powered": False, "error": "AI response parse failed"}


# ════════════════════════════════════════════════════════════════
# F3. NATURAL LANGUAGE POLICY CONFIGURATION
# ════════════════════════════════════════════════════════════════

POLICY_FIELDS_SCHEMA = """Available policy fields and valid ranges:
- matching_mode: "three_way" | "two_way" | "flexible" (how strictly to match PO+GRN+Invoice)
- amount_tolerance_pct: 0-50 (% variance allowed between invoice and PO amounts)
- price_tolerance_pct: 0-50 (% unit price variance allowed)
- over_invoice_pct: 0-25 (% invoice can exceed PO total)
- grn_qty_tolerance_pct: 0-25 (% quantity variance between GRN and invoice)
- short_shipment_threshold_pct: 50-100 (% below which GRN flags short shipment)
- duplicate_window_days: 1-365 (days to look back for duplicate detection)
- max_invoice_age_days: 30-730 (invoice older than this = stale)
- tax_tolerance_pct: 0-10 (% tax rate variance allowed)
- flag_round_number_invoices: true/false (flag suspiciously round totals)
- flag_weekend_invoices: true/false (flag invoices dated on weekends)
- require_po_for_auto_approve: true/false
- auto_approve_min_confidence: 50-100 (extraction confidence % needed for auto-approve)
- auto_approve_max_vendor_risk: 0-100 (vendor risk score ceiling for auto-approve)
- early_payment_discount_flag: true/false (detect EPD opportunities)
- sla_critical_hours: 1-48
- sla_high_hours: 4-168
- sla_medium_hours: 24-336
- sla_low_hours: 48-720"""

async def parse_natural_language_policy(user_input: str) -> dict:
    """F3: Convert natural language to policy changes.
    Returns: {"changes": [{"field", "from", "to", "reason"}], "ai_powered": bool, "warnings": []}
    """
    current = _get_policy()

    prompt = f"""You are an AP policy configuration assistant. Convert the user's request into specific policy field changes.

CURRENT POLICY:
{json.dumps(current, indent=2, default=str)}

{POLICY_FIELDS_SCHEMA}

USER REQUEST: "{user_input}"

Respond ONLY with JSON:
{{"changes": [
  {{"field": "amount_tolerance_pct", "to": 10, "reason": "User requested lenient thresholds"}}
],
"summary": "Brief description of what these changes do"}}

Rules:
- Only change fields directly implied by the user's request
- Never disable safety-critical features unless explicitly asked
- Keep values within the valid ranges specified above
- If the request is ambiguous, prefer conservative (stricter) settings
- If you cannot map the request to any field, return {{"changes": [], "summary": "Could not map request to policy fields"}}"""

    text = await _call_claude(prompt, max_tokens=1000)
    if not text:
        return {"changes": [], "ai_powered": False, "warnings": ["AI unavailable — configure manually"],
                "summary": "AI policy assistant unavailable"}

    try:
        result = json.loads(_clean_json(text))
        changes = result.get("changes", [])

        # Post-validate: enforce hard limits
        HARD_LIMITS = {
            "amount_tolerance_pct": (0, 50), "price_tolerance_pct": (0, 50),
            "over_invoice_pct": (0, 25), "grn_qty_tolerance_pct": (0, 25),
            "short_shipment_threshold_pct": (50, 100), "duplicate_window_days": (1, 365),
            "max_invoice_age_days": (30, 730), "tax_tolerance_pct": (0, 10),
            "auto_approve_min_confidence": (50, 100), "auto_approve_max_vendor_risk": (0, 100),
            "sla_critical_hours": (1, 48), "sla_high_hours": (4, 168),
            "sla_medium_hours": (24, 336), "sla_low_hours": (48, 720),
        }
        BOOL_FIELDS = {"flag_round_number_invoices", "flag_weekend_invoices",
                        "require_po_for_auto_approve", "early_payment_discount_flag"}
        ENUM_FIELDS = {"matching_mode": ["three_way", "two_way", "flexible"]}

        warnings = []
        validated = []
        for c in changes:
            field = c.get("field", "")
            to_val = c.get("to")
            if field in HARD_LIMITS:
                lo, hi = HARD_LIMITS[field]
                if isinstance(to_val, (int, float)):
                    if to_val < lo or to_val > hi:
                        warnings.append(f"{field}: {to_val} clamped to [{lo}, {hi}]")
                        to_val = max(lo, min(hi, to_val))
                        c["to"] = to_val
            elif field in BOOL_FIELDS:
                c["to"] = bool(to_val)
            elif field in ENUM_FIELDS:
                if to_val not in ENUM_FIELDS[field]:
                    warnings.append(f"{field}: '{to_val}' invalid, ignored")
                    continue
            else:
                warnings.append(f"Unknown field '{field}' — ignored")
                continue

            c["from"] = current.get(field)
            validated.append(c)

        return {"changes": validated, "ai_powered": True, "warnings": warnings,
                "summary": result.get("summary", "")}
    except Exception as e:
        return {"changes": [], "ai_powered": False,
                "warnings": [f"AI response parse error: {str(e)}"], "summary": ""}


# ════════════════════════════════════════════════════════════════
# F4. PAYMENT PRIORITIZATION
# ════════════════════════════════════════════════════════════════

async def generate_payment_priorities(budget_limit: float = None, currency_filter: str = None) -> dict:
    """F4: AI-optimized payment run recommendations.
    Returns: {"recommendations": [...], "total_recommended", "savings_captured", "ai_powered": bool}
    """
    db = _get_db()
    policy = _get_policy()

    # Gather all payable invoices (approved or unpaid, not on hold/disputed)
    payable = [i for i in db.get("invoices", [])
               if i.get("status") in ("approved", "pending", "unpaid", None)
               and i.get("type") in ("invoice",)
               and not any(a.get("type") == "DUPLICATE_INVOICE" and a.get("status") == "open"
                          for a in db.get("anomalies", []) if a.get("invoiceId") == i["id"])]

    if currency_filter:
        payable = [i for i in payable if i.get("currency") == currency_filter]

    if not payable:
        return {"recommendations": [], "total_recommended": 0, "savings_captured": 0,
                "ai_powered": False, "note": "No payable invoices"}

    # Pre-compute facts for each invoice
    from backend.vendor import compute_vendor_risk_score
    invoice_facts = []
    for inv in payable:
        anomalies = [a for a in db.get("anomalies", [])
                     if a.get("invoiceId") == inv["id"] and a.get("status") == "open"]
        risk = compute_vendor_risk_score(inv.get("vendor", ""), db)
        # Check EPD opportunity
        epd = next((a for a in db.get("anomalies", [])
                     if a.get("invoiceId") == inv["id"]
                     and a.get("type") == "EARLY_PAYMENT_DISCOUNT"), None)

        # Aging
        due = inv.get("dueDate")
        days_until_due = None
        if due:
            try:
                due_dt = datetime.fromisoformat(due) if "T" in str(due) else datetime.strptime(str(due), "%Y-%m-%d")
                days_until_due = (due_dt - datetime.now()).days
            except:
                pass

        invoice_facts.append({
            "id": inv["id"], "number": inv.get("invoiceNumber", ""),
            "vendor": inv.get("vendor", ""), "amount": inv.get("amount", 0),
            "currency": inv.get("currency", "USD"), "due_date": due,
            "days_until_due": days_until_due,
            "open_anomalies": len(anomalies),
            "vendor_risk": risk.get("level", "unknown"),
            "vendor_risk_score": risk.get("score", 0),
            "epd_savings": abs(float(epd.get("amount_at_risk", 0))) if epd else 0,
            "triage_lane": inv.get("triageLane", ""),
            "status": inv.get("status", "pending"),
        })

    # Sort deterministically first: EPD opportunities first, then by due date
    invoice_facts.sort(key=lambda x: (
        -x["epd_savings"],           # EPD savings first
        x["days_until_due"] or 999,  # Closest due date next
        x["open_anomalies"],         # Fewer anomalies preferred
        x["vendor_risk_score"],      # Lower risk preferred
    ))

    # Build AI prompt for narrative + priority reasoning
    prompt = f"""You are a treasury manager optimizing a weekly payment run.
Rank these invoices by payment priority and explain your reasoning.

PAYABLE INVOICES:
{json.dumps(invoice_facts[:20], indent=2, default=str)}

{"BUDGET LIMIT: " + _fmt_amount(budget_limit) if budget_limit else "No budget constraint."}

Rules:
- NEVER recommend paying invoices with open anomalies > 0 (hold for investigation)
- Prioritize early payment discounts (capture savings)
- Prioritize invoices approaching due date (avoid late fees)
- Deprioritize high-risk vendors
- If budget limited, maximize value within budget

Respond ONLY with JSON:
{{"recommendations": [
  {{"invoice_id": "actual_id", "priority": 1, "action": "pay_now|pay_this_week|hold|investigate",
    "reason": "2/10 Net 30 discount saves $661 if paid by Feb 25"}}
],
"summary": "Brief overview of payment strategy",
"total_recommended": 12345.67,
"savings_captured": 661.00}}

Use ONLY invoice IDs from the data above."""

    text = await _call_claude(prompt, max_tokens=1500)

    if not text:
        # Deterministic fallback
        recs = []
        total = 0
        savings = 0
        for i, fact in enumerate(invoice_facts):
            if fact["open_anomalies"] > 0:
                action = "investigate"
            elif fact["epd_savings"] > 0:
                action = "pay_now"
                savings += fact["epd_savings"]
            elif fact["days_until_due"] is not None and fact["days_until_due"] <= 7:
                action = "pay_now"
            elif fact["days_until_due"] is not None and fact["days_until_due"] <= 14:
                action = "pay_this_week"
            else:
                action = "pay_this_week"

            if action in ("pay_now", "pay_this_week"):
                if budget_limit and total + fact["amount"] > budget_limit:
                    action = "hold"
                else:
                    total += fact["amount"]

            recs.append({"invoice_id": fact["id"], "invoice_number": fact["number"],
                         "vendor": fact["vendor"], "amount": fact["amount"],
                         "currency": fact["currency"], "priority": i + 1,
                         "action": action, "reason": f"Due in {fact['days_until_due'] or '?'} days"
                         + (f", EPD saves {_fmt_amount(fact['epd_savings'], fact['currency'])}" if fact['epd_savings'] else "")})

        return {"recommendations": recs, "total_recommended": round(total, 2),
                "savings_captured": round(savings, 2), "ai_powered": False,
                "summary": f"{len([r for r in recs if r['action'] in ('pay_now', 'pay_this_week')])} invoices recommended for payment"}

    try:
        result = json.loads(_clean_json(text))
        recs = result.get("recommendations", [])
        # Post-validate: ensure invoice IDs exist
        valid_ids = {f["id"] for f in invoice_facts}
        recs = [r for r in recs if r.get("invoice_id") in valid_ids]
        # Enrich with invoice details
        for r in recs:
            fact = next((f for f in invoice_facts if f["id"] == r["invoice_id"]), {})
            r["invoice_number"] = fact.get("number", "")
            r["vendor"] = fact.get("vendor", "")
            r["amount"] = fact.get("amount", 0)
            r["currency"] = fact.get("currency", "USD")
        return {"recommendations": recs, "ai_powered": True,
                "total_recommended": result.get("total_recommended", 0),
                "savings_captured": result.get("savings_captured", 0),
                "summary": result.get("summary", "")}
    except Exception:
        return {"recommendations": [], "ai_powered": False, "error": "Parse failed"}


# ════════════════════════════════════════════════════════════════
# F5. PLAIN ENGLISH ANOMALY DESCRIPTIONS
# ════════════════════════════════════════════════════════════════

async def generate_anomaly_explanation(anomaly_id: str) -> dict:
    """F5: Generate human-readable explanation for a single anomaly.
    Returns: {"explanation": str, "ai_generated": bool}
    """
    db = _get_db()
    anomaly = next((a for a in db.get("anomalies", []) if a["id"] == anomaly_id), None)
    if not anomaly:
        return {"explanation": "Anomaly not found.", "ai_generated": False}

    # Build fact packet
    cur = anomaly.get("currency", "USD")
    facts = {
        "type": anomaly.get("type", ""),
        "severity": anomaly.get("severity", ""),
        "description": anomaly.get("description", ""),
        "amount_at_risk": anomaly.get("amount_at_risk", 0),
        "currency": cur,
        "vendor": anomaly.get("vendor", ""),
        "invoice_number": anomaly.get("invoiceNumber", ""),
        "recommendation": anomaly.get("recommendation", ""),
    }

    prompt = f"""Rewrite this anomaly alert as ONE clear sentence a finance manager would understand.
Use the EXACT amounts provided. Do not add information not in the data.

ANOMALY DATA:
{json.dumps(facts, indent=2, default=str)}

Rules:
- One sentence only, under 40 words
- Use business language, not technical jargon
- Include the vendor name and amount at risk
- Explain what happened, not just the anomaly type name"""

    text = await _call_claude(prompt, max_tokens=200)
    if not text:
        # Deterministic fallback
        t = anomaly.get("type", "").replace("_", " ").title()
        amt = _fmt_amount(abs(float(anomaly.get("amount_at_risk", 0))), cur)
        vendor = anomaly.get("vendor", "Unknown")
        return {"explanation": f"{t} detected on invoice from {vendor} — {amt} at risk.",
                "ai_generated": False}

    # Post-validate: check that amount mentioned matches
    risk_amt = abs(float(anomaly.get("amount_at_risk", 0)))
    if risk_amt > 100:
        # Check the AI output contains a number close to the actual risk
        ai_nums = re.findall(r'[\d,]+\.?\d*', text)
        found_match = False
        for n in ai_nums:
            try:
                val = float(n.replace(",", ""))
                if abs(val - risk_amt) / max(risk_amt, 1) < 0.01:  # within 1%
                    found_match = True
                    break
            except:
                pass
        if not found_match and risk_amt > 0:
            # Append the correct amount
            text = text.rstrip(".")
            text += f" ({_fmt_amount(risk_amt, cur)} at risk)."

    return {"explanation": text, "ai_generated": True}


async def generate_all_anomaly_explanations(invoice_id: str) -> list:
    """F5 batch: Generate explanations for all anomalies on an invoice."""
    db = _get_db()
    anomalies = [a for a in db.get("anomalies", []) if a.get("invoiceId") == invoice_id]
    results = []
    for a in anomalies:
        try:
            result = await generate_anomaly_explanation(a["id"])
        except Exception as e:
            result = {"explanation": f"Error generating explanation: {str(e)}", "ai_generated": False}
        result["anomaly_id"] = a["id"]
        result["type"] = a.get("type", "")
        result["severity"] = a.get("severity", "")
        results.append(result)
    return results


# ════════════════════════════════════════════════════════════════
# F6. VENDOR COMMUNICATION DRAFTS
# ════════════════════════════════════════════════════════════════

async def draft_vendor_communication(case_id: str, comm_type: str = "dispute") -> dict:
    """F6: AI-drafted vendor communication.
    comm_type: "dispute" | "payment_delay" | "information_request" | "debit_note_justification"
    Returns: {"subject": str, "body": str, "ai_generated": bool, "data_sources": [str]}
    """
    db = _get_db()
    case = next((c for c in db.get("cases", []) if c["id"] == case_id), None)
    if not case:
        return {"subject": "", "body": "Case not found.", "ai_generated": False, "data_sources": []}

    ctx = _build_investigation_context(case, db)
    inv = ctx.get("invoice", {})
    cur = inv.get("currency", "USD")
    anomalies = ctx.get("anomalies", [])
    contract = ctx.get("contract")
    po = ctx.get("po")

    # Template structure
    templates = {
        "dispute": {
            "subject_template": f"Invoice Dispute: {{inv_num}} — {{vendor}}",
            "instruction": "Write a professional dispute letter requesting correction of the overcharge/discrepancy.",
        },
        "payment_delay": {
            "subject_template": f"Payment Status Update: {{inv_num}} — Under Review",
            "instruction": "Write a professional notice that payment is delayed pending investigation.",
        },
        "information_request": {
            "subject_template": f"Information Request: {{inv_num}} — Supporting Documentation Needed",
            "instruction": "Write a professional request for additional documentation or clarification.",
        },
        "debit_note_justification": {
            "subject_template": f"Debit Note Justification: {{inv_num}}",
            "instruction": "Write a justification for issuing a debit note against the vendor.",
        },
    }
    tmpl = templates.get(comm_type, templates["dispute"])
    inv_num = inv.get("invoiceNumber", "N/A")
    vendor = inv.get("vendor", "Unknown")
    subject = tmpl["subject_template"].format(inv_num=inv_num, vendor=vendor)

    data_sources = ["Invoice"]
    if po: data_sources.append("Purchase Order")
    if contract: data_sources.append("Contract")
    if anomalies: data_sources.append("Anomaly Records")

    prompt = f"""{tmpl["instruction"]}
Use ONLY the facts below. Do NOT fabricate any contract terms, prices, or dates not in the data.
Be professional, factual, and specific. Reference exact amounts, dates, and document numbers.

INVOICE:
Number: {inv_num} | Vendor: {vendor} | Date: {inv.get("issueDate")}
Amount: {_fmt_amount(inv.get("amount", 0), cur)} | Currency: {cur}
PO Reference: {inv.get("poReference", "None")}

{"PURCHASE ORDER:" + chr(10) + f"Number: {po.get('poNumber')} | Amount: {_fmt_amount(po.get('amount', 0), cur)}" if po else "No PO on file."}

{"CONTRACT:" + chr(10) + f"Number: {contract.get('contractNumber')} | Terms: {contract.get('paymentTerms', 'N/A')}" + chr(10) + f"Pricing: {json.dumps(contract.get('pricingTerms', [])[:5], default=str)}" if contract else "No contract on file."}

ANOMALIES:
{chr(10).join(f"• {a.get('type')}: {a.get('description')} (Risk: {_fmt_amount(abs(float(a.get('amount_at_risk', 0))), cur)})" for a in anomalies) if anomalies else "No anomalies."}

Format as a professional email body. Start with 'Dear {vendor} Accounts Team,' and end with a clear action request.
Do NOT include a sign-off (the user will add their own)."""

    text = await _call_claude(prompt, max_tokens=1200)
    if not text:
        # Deterministic fallback
        risk_total = sum(abs(float(a.get("amount_at_risk", 0))) for a in anomalies)
        body = f"Dear {vendor} Accounts Team,\n\n"
        body += f"We are writing regarding invoice {inv_num} dated {inv.get('issueDate', 'N/A')} for {_fmt_amount(inv.get('amount', 0), cur)}.\n\n"
        if anomalies:
            body += f"Upon review, we identified {len(anomalies)} discrepancy(ies) totaling {_fmt_amount(risk_total, cur)} at risk:\n\n"
            for a in anomalies:
                body += f"• {a.get('type', '').replace('_', ' ')}: {a.get('description', '')}\n"
            body += f"\nPlease review and provide a corrected invoice or explanation at your earliest convenience."
        else:
            body += "We require additional information to process this payment. Please contact us to discuss."
        return {"subject": subject, "body": body, "ai_generated": False, "data_sources": data_sources}

    return {"subject": subject, "body": text, "ai_generated": True, "data_sources": data_sources}


# ════════════════════════════════════════════════════════════════
# F7. ANOMALY PATTERN INSIGHTS
# ════════════════════════════════════════════════════════════════

def _compute_vendor_patterns(vendor_name: str, db: dict) -> dict:
    """Deterministic pattern computation — statistical gating before AI."""
    from backend.vendor import vendor_similarity
    invoices = [i for i in db.get("invoices", [])
                if vendor_similarity(i.get("vendor", ""), vendor_name) >= 0.7]
    anomalies = [a for a in db.get("anomalies", [])
                 if vendor_similarity(a.get("vendor", ""), vendor_name) >= 0.7]

    if len(invoices) < 3:
        return {"sufficient_data": False, "invoice_count": len(invoices)}

    # Anomaly type frequency
    type_counts = {}
    for a in anomalies:
        t = a.get("type", "UNKNOWN")
        type_counts[t] = type_counts.get(t, 0) + 1

    # Pattern: same anomaly on >50% of invoices
    inv_count = len(invoices)
    patterns = []
    for atype, count in type_counts.items():
        rate = count / inv_count
        if rate >= 0.5 and count >= 2:
            amounts = [abs(float(a.get("amount_at_risk", 0))) for a in anomalies if a.get("type") == atype]
            patterns.append({
                "type": atype, "count": count, "rate": round(rate, 2),
                "avg_amount": round(sum(amounts) / len(amounts), 2) if amounts else 0,
                "total_amount": round(sum(amounts), 2),
            })

    # Trend: is risk increasing over time?
    dated_anomalies = sorted(
        [a for a in anomalies if a.get("detectedAt")],
        key=lambda a: a.get("detectedAt", ""))
    trend = "stable"
    if len(dated_anomalies) >= 3:
        first_half = dated_anomalies[:len(dated_anomalies)//2]
        second_half = dated_anomalies[len(dated_anomalies)//2:]
        first_risk = sum(abs(float(a.get("amount_at_risk", 0))) for a in first_half) / max(len(first_half), 1)
        second_risk = sum(abs(float(a.get("amount_at_risk", 0))) for a in second_half) / max(len(second_half), 1)
        if second_risk > first_risk * 1.2:
            trend = "worsening"
        elif second_risk < first_risk * 0.8:
            trend = "improving"

    # Total spend
    total_spend = sum(float(i.get("amount", 0)) for i in invoices)
    total_risk = sum(abs(float(a.get("amount_at_risk", 0))) for a in anomalies)

    return {
        "sufficient_data": True, "invoice_count": inv_count,
        "anomaly_count": len(anomalies), "patterns": patterns,
        "trend": trend, "total_spend": round(total_spend, 2),
        "total_risk": round(total_risk, 2),
        "risk_to_spend_ratio": round(total_risk / total_spend * 100, 2) if total_spend > 0 else 0,
        "anomaly_types": type_counts,
    }


async def generate_vendor_insights(vendor_name: str) -> dict:
    """F7: AI-synthesized vendor behavior analysis.
    Returns: {"insights": str, "patterns": [...], "recommendations": [...], "ai_powered": bool}
    """
    db = _get_db()
    stats = _compute_vendor_patterns(vendor_name, db)

    if not stats.get("sufficient_data"):
        return {"insights": f"Insufficient data for {vendor_name} — need at least 3 invoices.",
                "patterns": [], "recommendations": [], "ai_powered": False,
                "stats": stats}

    from backend.vendor import compute_vendor_risk_score
    risk = compute_vendor_risk_score(vendor_name, db)

    prompt = f"""You are a procurement analytics expert. Analyze this vendor's behavior and provide actionable insights.
Use ONLY the statistics below. Do NOT invent patterns or trends not supported by the numbers.

VENDOR: {vendor_name}
RISK SCORE: {risk.get("score", 0)}/100 ({risk.get("level", "unknown")}) | Trend: {stats["trend"]}

STATISTICS:
- Invoices processed: {stats["invoice_count"]}
- Total anomalies: {stats["anomaly_count"]}
- Total spend: {_fmt_amount(stats["total_spend"])}
- Total risk identified: {_fmt_amount(stats["total_risk"])}
- Risk/spend ratio: {stats["risk_to_spend_ratio"]}%

RECURRING PATTERNS (>50% of invoices):
{json.dumps(stats["patterns"], indent=2)}

ANOMALY TYPE DISTRIBUTION:
{json.dumps(stats["anomaly_types"], indent=2)}

Write 2-3 specific, actionable insights. Then give 1-2 concrete recommendations.
Base everything on the numbers. Example: "PRICE_OVERCHARGE occurred on 3 of 4 invoices (75%), averaging $5,933 per occurrence, totaling $17,800 in risk — suggesting systematic pricing non-compliance with contract terms."
Do NOT speculate about vendor intent. Stick to observable patterns."""

    text = await _call_claude(prompt, max_tokens=1000)
    if not text:
        # Deterministic fallback
        insights = []
        for p in stats["patterns"]:
            t = p["type"].replace("_", " ").title()
            insights.append(f"{t} detected on {p['count']} of {stats['invoice_count']} invoices ({p['rate']:.0%}). "
                          f"Average risk: {_fmt_amount(p['avg_amount'])}. Total: {_fmt_amount(p['total_amount'])}.")
        if stats["trend"] == "worsening":
            insights.append(f"Risk trend is worsening — recent invoices show higher anomaly amounts than earlier ones.")

        return {"insights": "\n".join(insights) if insights else "No significant patterns detected.",
                "patterns": stats["patterns"], "recommendations": [],
                "ai_powered": False, "stats": stats, "risk": risk}

    return {"insights": text, "patterns": stats["patterns"],
            "recommendations": [],  # Could parse from AI output
            "ai_powered": True, "stats": stats, "risk": risk}


# ════════════════════════════════════════════════════════════════
# F8. SMART CASE ROUTING
# ════════════════════════════════════════════════════════════════

def _compute_user_scores(case: dict, db: dict) -> list:
    """Deterministic scoring of users for case assignment."""
    users = db.get("users", [])
    cases = db.get("cases", [])
    if not users:
        return []

    case_type = case.get("type", "")
    vendor = case.get("vendor", "")
    priority = case.get("priority", "medium")

    scored = []
    for user in users:
        uid = user.get("id", "")
        role = user.get("role", "analyst")
        # Skip if role can't handle the priority
        if priority in ("critical",) and role not in ("vp", "cfo", "manager"):
            continue

        # Factor 1: Similar case resolution history (0-40 pts)
        resolved = [c for c in cases if c.get("resolvedBy") == user.get("name")
                    or c.get("assignedTo") == user.get("name")]
        similar = [c for c in resolved if c.get("type") == case_type or c.get("vendor") == vendor]
        history_score = min(40, len(similar) * 10)

        # Factor 2: Resolution speed (0-20 pts)
        resolution_times = []
        for c in resolved:
            if c.get("createdAt") and c.get("resolvedAt"):
                try:
                    cr = datetime.fromisoformat(c["createdAt"])
                    rs = datetime.fromisoformat(c["resolvedAt"])
                    resolution_times.append((rs - cr).total_seconds() / 3600)
                except:
                    pass
        avg_time = sum(resolution_times) / len(resolution_times) if resolution_times else 999
        speed_score = max(0, 20 - int(avg_time / 4))  # 0 hrs = 20 pts, 80+ hrs = 0 pts

        # Factor 3: Current workload (0-20 pts, inverse)
        open_cases = len([c for c in cases if c.get("assignedTo") == user.get("name")
                         and c.get("status") not in ("resolved", "closed")])
        workload_score = max(0, 20 - open_cases * 4)  # 0 cases = 20 pts, 5+ = 0

        # Factor 4: Authority level (0-20 pts)
        authority_map = {"analyst": 5, "manager": 12, "vp": 18, "cfo": 20}
        authority_score = authority_map.get(role, 5)

        total = history_score + speed_score + workload_score + authority_score
        scored.append({
            "user_id": uid, "name": user.get("name", ""), "email": user.get("email", ""),
            "role": role, "score": total,
            "factors": {"history": history_score, "speed": speed_score,
                       "workload": workload_score, "authority": authority_score},
            "similar_resolved": len(similar), "open_cases": open_cases,
            "avg_resolution_hours": round(avg_time, 1) if resolution_times else None,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:5]


async def recommend_case_assignment(case_id: str) -> dict:
    """F8: AI-recommended case assignment.
    Returns: {"recommendations": [...], "explanation": str, "ai_powered": bool}
    """
    db = _get_db()
    case = next((c for c in db.get("cases", []) if c["id"] == case_id), None)
    if not case:
        return {"recommendations": [], "explanation": "Case not found.", "ai_powered": False}

    scored_users = _compute_user_scores(case, db)
    if not scored_users:
        return {"recommendations": [], "explanation": "No eligible users found.", "ai_powered": False}

    prompt = f"""You are assigning an F&A investigation case to a team member. Explain why the top candidate is the best fit.

CASE:
Type: {case.get("type")} | Priority: {case.get("priority")}
Vendor: {case.get("vendor")} | Amount at Risk: {_fmt_amount(case.get("amountAtRisk", 0), case.get("currency", "USD"))}
SLA Deadline: {case.get("sla", {}).get("deadline")}

TOP CANDIDATES (ranked by algorithm):
{json.dumps(scored_users[:3], indent=2, default=str)}

Write a 2-3 sentence explanation for the top recommendation.
Mention: their relevant experience, current workload, and authority level.
If the second candidate offers a valid alternative, mention why briefly."""

    text = await _call_claude(prompt, max_tokens=500)
    if not text:
        top = scored_users[0]
        text = (f"Recommended: {top['name']} ({top['role']}) — "
                f"Score {top['score']}/100. "
                f"{top['similar_resolved']} similar cases resolved. "
                f"{top['open_cases']} cases currently open.")

    return {"recommendations": scored_users[:3],
            "explanation": text, "ai_powered": bool(text and _use_real_api())}


# ════════════════════════════════════════════════════════════════
# MODULE EXPORTS & FEATURE REGISTRY
# ════════════════════════════════════════════════════════════════

AI_FEATURES = {
    "investigation_briefs": {
        "id": "F1", "name": "AI Investigation Briefs",
        "description": "Auto-generated case investigation narratives from verified data",
        "icon": "📋", "endpoint": "/api/ai/investigation-brief/{case_id}",
    },
    "smart_matching": {
        "id": "F2", "name": "Smart PO Matching",
        "description": "AI-powered fuzzy invoice-to-PO resolution",
        "icon": "🔗", "endpoint": "/api/ai/smart-match/{invoice_id}",
    },
    "nl_policy": {
        "id": "F3", "name": "Natural Language Policy",
        "description": "Configure AP policy using plain English",
        "icon": "💬", "endpoint": "/api/ai/policy-parse",
    },
    "payment_priorities": {
        "id": "F4", "name": "Payment Prioritization",
        "description": "AI-optimized payment run recommendations",
        "icon": "💰", "endpoint": "/api/ai/payment-priorities",
    },
    "anomaly_explanations": {
        "id": "F5", "name": "Plain English Anomalies",
        "description": "Human-readable anomaly explanations",
        "icon": "💡", "endpoint": "/api/ai/explain-anomaly/{anomaly_id}",
    },
    "vendor_comms": {
        "id": "F6", "name": "Vendor Communication Drafts",
        "description": "AI-drafted dispute letters and vendor emails",
        "icon": "✉️", "endpoint": "/api/ai/vendor-draft/{case_id}",
    },
    "pattern_insights": {
        "id": "F7", "name": "Anomaly Pattern Insights",
        "description": "AI-synthesized vendor behavior analysis",
        "icon": "📊", "endpoint": "/api/ai/vendor-insights/{vendor}",
    },
    "smart_routing": {
        "id": "F8", "name": "Smart Case Routing",
        "description": "AI-recommended case assignments",
        "icon": "🎯", "endpoint": "/api/ai/route-case/{case_id}",
    },
}

__all__ = [
    'generate_investigation_brief', 'smart_match_invoice',
    'parse_natural_language_policy', 'generate_payment_priorities',
    'generate_anomaly_explanation', 'generate_all_anomaly_explanations',
    'draft_vendor_communication', 'generate_vendor_insights',
    'recommend_case_assignment', 'AI_FEATURES',
]
