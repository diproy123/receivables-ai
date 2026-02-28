"""
AuditLens — Contract Intelligence, Vendor Risk, Delivery Analytics
Intelligence Engine (v3.0)

Three intelligence modules in a single additive package:
  - Contract clause risk scoring, compliance monitoring, expiry alerting
  - Extended vendor risk (9 factors), compliance tracking, behavioral analysis
  - Delivery performance analytics, fulfillment tracking

DESIGN PRINCIPLES:
  - Pure additive — no modifications to existing modules
  - Zero LLM calls — all deterministic rule-based intelligence
  - Uses only data already in db[] — no new document types needed
  - All functions receive db dict, return new data — side-effect free
"""

import math
from datetime import datetime, timedelta
from backend.vendor import vendor_similarity, normalize_vendor, currency_symbol
from backend.db import _n
from backend.policy import get_policy


# ═══════════════════════════════════════════════════════════════
# CONTRACT INTELLIGENCE
# ═══════════════════════════════════════════════════════════════

CLAUSE_TYPES = [
    "liability_cap", "termination_notice", "auto_renewal", "sla_terms",
    "penalty_clauses", "force_majeure", "confidentiality", "ip_ownership",
    "insurance", "warranty", "indemnification", "data_protection",
    "audit_rights", "subcontracting",
]

def analyze_contract_clauses(contract: dict) -> dict:
    """Analyze contract terms and produce clause-level risk scores.
    Returns { risk_score, risk_level, clauses[], obligations[], pricing_rules[] }
    """
    ct = contract.get("contractTerms") or {}
    clauses, obligations, pricing_rules = [], [], []
    risk_points, max_points = 0, 0
    sym = currency_symbol(contract.get("currency", "USD"))
    cval = _n(contract.get("amount"))

    # ── Liability Cap ──
    max_points += 20
    cap_desc = ct.get("liability_cap_description") or contract.get("liabilityCapDescription") or ""
    cap_val = _n(ct.get("liability_cap") or contract.get("liabilityCap"))
    if not cap_desc and not cap_val:
        clauses.append({"type": "liability_cap", "risk": "high", "score": 20,
            "summary": "No liability cap defined",
            "benchmark": "Industry standard: 150–200% of annual value",
            "recommendation": "Negotiate liability cap at renewal"})
        risk_points += 20
    elif cap_val and cval and cap_val < cval:
        r = 12
        clauses.append({"type": "liability_cap", "risk": "medium", "score": r,
            "summary": f"Cap at {sym}{cap_val:,.0f} ({cap_val/cval*100:.0f}% of value) — below contract value" if cval > 0 else (cap_desc or f"{sym}{cap_val:,.0f}"),
            "benchmark": "Standard: 150–200% of contract value",
            "recommendation": "Negotiate higher cap — buyer underprotected"})
        risk_points += r
    elif cap_val and cval and cap_val < cval * 1.5:
        r = 7
        clauses.append({"type": "liability_cap", "risk": "medium", "score": r,
            "summary": f"Cap at {sym}{cap_val:,.0f} ({cap_val/cval*100:.0f}% of value)" if cval > 0 else (cap_desc or f"{sym}{cap_val:,.0f}"),
            "benchmark": "Standard: 150–200% of contract value; current cap is adequate but tight",
            "recommendation": "Consider increasing cap at renewal"})
        risk_points += r
    else:
        clauses.append({"type": "liability_cap", "risk": "low", "score": 3,
            "summary": cap_desc or (f"Cap: {sym}{cap_val:,.0f}" if cap_val else "Defined"),
            "benchmark": "Adequate", "recommendation": "Retain at renewal"})
        risk_points += 3

    # ── Termination Notice ──
    max_points += 15
    td = _n(ct.get("termination_notice_days") or contract.get("terminationNoticeDays"))
    if not td:
        clauses.append({"type": "termination_notice", "risk": "high", "score": 15,
            "summary": "No termination notice defined",
            "benchmark": "Standard: 30–90 days", "recommendation": "Add termination clause"})
        risk_points += 15
    elif td > 90:
        clauses.append({"type": "termination_notice", "risk": "medium", "score": 10,
            "summary": f"{int(td)}-day notice required",
            "benchmark": f"Standard: 30–60 days; {int(td)}-day is restrictive",
            "recommendation": "Negotiate shorter notice"})
        risk_points += 10
    else:
        clauses.append({"type": "termination_notice", "risk": "low", "score": 2,
            "summary": f"{int(td)}-day notice", "benchmark": "Within range", "recommendation": "Acceptable"})
        risk_points += 2

    # ── Auto-Renewal ──
    max_points += 15
    ar = ct.get("auto_renewal") or contract.get("autoRenewal")
    rnd = _n(ct.get("renewal_notice_days") or contract.get("renewalNoticeDays"))
    if ar:
        if rnd and rnd > 60:
            clauses.append({"type": "auto_renewal", "risk": "high", "score": 15,
                "summary": f"Auto-renews; {int(rnd)}-day opt-out notice",
                "benchmark": "Standard opt-out: 30–60 days",
                "recommendation": "Set calendar alert for opt-out deadline"})
            risk_points += 15
        elif rnd:
            clauses.append({"type": "auto_renewal", "risk": "medium", "score": 8,
                "summary": f"Auto-renews; {int(rnd)}-day opt-out",
                "benchmark": "Requires tracking", "recommendation": "Set renewal reminder"})
            risk_points += 8
        else:
            clauses.append({"type": "auto_renewal", "risk": "medium", "score": 10,
                "summary": "Auto-renews — no opt-out period specified",
                "benchmark": "Ambiguous terms", "recommendation": "Clarify opt-out terms"})
            risk_points += 10
    else:
        clauses.append({"type": "auto_renewal", "risk": "low", "score": 0,
            "summary": "No auto-renewal", "benchmark": "Full control", "recommendation": "Track expiry proactively"})

    # ── SLA ──
    max_points += 15
    sla = ct.get("sla_summary") or contract.get("slaSummary")
    if sla:
        clauses.append({"type": "sla_terms", "risk": "low", "score": 3,
            "summary": sla[:200], "benchmark": "SLA defined — enables monitoring",
            "recommendation": "Track vendor delivery against SLA"})
        risk_points += 3
        obligations.append({"party": "vendor", "type": "sla_compliance",
            "obligation": f"SLA: {sla[:100]}", "frequency": "ongoing"})
    else:
        clauses.append({"type": "sla_terms", "risk": "medium", "score": 10,
            "summary": "No SLA defined", "benchmark": "SLA protects buyer",
            "recommendation": "Negotiate measurable SLA at renewal"})
        risk_points += 10

    # ── Penalty Clauses ──
    max_points += 10
    pen = ct.get("penalty_clauses") or contract.get("penaltyClauses")
    if pen:
        clauses.append({"type": "penalty_clauses", "risk": "low", "score": 2,
            "summary": pen[:200], "benchmark": "Enforcement leverage exists",
            "recommendation": "Enforce when warranted"})
        risk_points += 2
    else:
        clauses.append({"type": "penalty_clauses", "risk": "medium", "score": 7,
            "summary": "No penalty clauses", "benchmark": "Penalties incentivize compliance",
            "recommendation": "Add liquidated damages at renewal"})
        risk_points += 7

    # ── Force Majeure ──
    max_points += 10
    fm = _n(ct.get("force_majeure_days") or contract.get("forceMajeureDays"))
    if fm:
        r = 2 if fm <= 120 else 6
        clauses.append({"type": "force_majeure", "risk": "low" if fm <= 120 else "medium", "score": r,
            "summary": f"{int(fm)}-day threshold", "benchmark": "Standard: 90–120 days",
            "recommendation": "Acceptable" if fm <= 120 else "Negotiate lower"})
        risk_points += r
    else:
        clauses.append({"type": "force_majeure", "risk": "medium", "score": 5,
            "summary": "No force majeure clause", "benchmark": "Post-COVID: include FM",
            "recommendation": "Add FM protection"})
        risk_points += 5

    # ── Confidentiality ──
    max_points += 8
    cy = _n(ct.get("confidentiality_years") or contract.get("confidentialityYears"))
    if cy:
        clauses.append({"type": "confidentiality", "risk": "low", "score": 1,
            "summary": f"{int(cy)}-year post-termination", "benchmark": "Standard: 2–5 years",
            "recommendation": "Adequate"})
        risk_points += 1
    else:
        clauses.append({"type": "confidentiality", "risk": "medium", "score": 4,
            "summary": "No confidentiality clause", "benchmark": "Standard: 2–5 years post-termination",
            "recommendation": "Add NDA or confidentiality terms"})
        risk_points += 4

    # ── IP Ownership ──
    max_points += 7
    ip = ct.get("ip_ownership") or contract.get("ipOwnership")
    if ip:
        clauses.append({"type": "ip_ownership", "risk": "low", "score": 2,
            "summary": ip[:200], "benchmark": "IP terms defined", "recommendation": "Verify alignment"})
        risk_points += 2
    else:
        clauses.append({"type": "ip_ownership", "risk": "low", "score": 3,
            "summary": "No IP clause — may not be applicable",
            "benchmark": "Define IP ownership for work-product contracts",
            "recommendation": "Add if deliverables involve IP"})
        risk_points += 3

    # ── Insurance Requirements ──
    ins = ct.get("insurance_requirements") or contract.get("insuranceRequirements")
    if ins:
        clauses.append({"type": "insurance", "risk": "low", "score": 1,
            "summary": ins[:200], "benchmark": "Insurance requirements defined",
            "recommendation": "Verify vendor certificates are current"})
        obligations.append({"party": "vendor", "type": "insurance_compliance",
            "obligation": f"Maintain insurance: {ins[:100]}", "frequency": "annual"})

    # ── Warranty ──
    war = _n(ct.get("warranty_months") or contract.get("warrantyMonths"))
    if war:
        clauses.append({"type": "warranty", "risk": "low" if war >= 12 else "medium", "score": 1 if war >= 12 else 4,
            "summary": f"{int(war)}-month warranty",
            "benchmark": "Standard: 12–24 months",
            "recommendation": "Adequate" if war >= 12 else "Negotiate longer warranty period"})

    # ── Indemnification ──
    indem = ct.get("indemnification") or contract.get("indemnification")
    if indem:
        clauses.append({"type": "indemnification", "risk": "low", "score": 1,
            "summary": indem[:200], "benchmark": "Indemnification terms defined",
            "recommendation": "Review scope and carve-outs at renewal"})
    else:
        # Only flag as risk for service/IT contracts where indemnity matters
        if cval and cval >= 50000:
            clauses.append({"type": "indemnification", "risk": "medium", "score": 5,
                "summary": "No indemnification clause",
                "benchmark": "Standard for services/IT: mutual indemnity for third-party claims",
                "recommendation": "Add indemnification for IP infringement and data breaches"})

    # ── Data Protection / GDPR ──
    dp_clause = ct.get("data_protection") or contract.get("dataProtection")
    if dp_clause:
        clauses.append({"type": "data_protection", "risk": "low", "score": 1,
            "summary": dp_clause[:200], "benchmark": "Data protection terms defined",
            "recommendation": "Ensure DPA is signed and up to date"})
        obligations.append({"party": "vendor", "type": "data_protection_compliance",
            "obligation": f"Data protection: {dp_clause[:100]}", "frequency": "ongoing"})
    # No penalty for missing — only relevant for data-handling contracts

    # ── Audit Rights ──
    audit_r = ct.get("audit_rights") or contract.get("auditRights")
    if audit_r:
        clauses.append({"type": "audit_rights", "risk": "low", "score": 0,
            "summary": audit_r[:200], "benchmark": "Buyer audit rights established",
            "recommendation": "Exercise periodically for high-value vendors"})
    else:
        if cval and cval >= 100000:
            clauses.append({"type": "audit_rights", "risk": "medium", "score": 4,
                "summary": "No audit rights clause",
                "benchmark": "Standard for contracts >$100K: buyer right to audit vendor books",
                "recommendation": "Add audit rights — essential for SOX/regulatory compliance"})

    # ── Subcontracting Restrictions ──
    subcon = ct.get("subcontracting") or contract.get("subcontracting")
    if subcon:
        clauses.append({"type": "subcontracting", "risk": "low", "score": 1,
            "summary": subcon[:200], "benchmark": "Subcontracting terms defined",
            "recommendation": "Monitor compliance"})
    # No penalty for missing — not universally required

    # ── Composite ──
    risk_score = round(risk_points / max(max_points, 1) * 100) if max_points > 0 else 50
    risk_score = max(0, min(100, risk_score))
    risk_level = "high" if risk_score >= 60 else "medium" if risk_score >= 30 else "low"

    # ── Expiry obligations ──
    expiry = ct.get("expiry_date") or contract.get("endDate")
    if expiry:
        try:
            exp_dt = datetime.fromisoformat(str(expiry)[:10])
            dl = (exp_dt - datetime.now()).days
            if dl > 0:
                obligations.append({"party": "buyer", "type": "renewal_decision",
                    "obligation": f"Contract expires {expiry}", "deadline": expiry,
                    "days_left": dl, "urgency": "high" if dl <= 30 else "medium" if dl <= 90 else "low"})
                if ar and rnd:
                    nd = (exp_dt - timedelta(days=int(rnd))).strftime("%Y-%m-%d")
                    ndl = (exp_dt - timedelta(days=int(rnd)) - datetime.now()).days
                    if ndl > 0:
                        obligations.append({"party": "buyer", "type": "opt_out_deadline",
                            "obligation": f"Opt-out by {nd} ({int(rnd)}-day notice)",
                            "deadline": nd, "days_left": ndl,
                            "urgency": "high" if ndl <= 14 else "medium" if ndl <= 45 else "low"})
        except (ValueError, TypeError):
            pass

    # ── Pricing rules ──
    pricing = contract.get("pricingTerms")
    if isinstance(pricing, dict):
        for k, v in pricing.items():
            if v and k not in ("discount", "description"):
                pricing_rules.append({"term": k, "value": str(v)})
    elif isinstance(pricing, str) and pricing.strip():
        pricing_rules.append({"term": "pricing", "value": pricing[:300]})

    # ── Payment terms obligation ──
    pt = ct.get("payment_terms") or contract.get("paymentTerms")
    if pt:
        obligations.append({"party": "buyer", "type": "payment_terms",
            "obligation": f"Payment terms: {pt}", "frequency": "per invoice"})
        # Check for early payment discount
        pt_lower = str(pt).lower()
        if "discount" in pt_lower or "2/10" in pt_lower or "early" in pt_lower:
            obligations.append({"party": "buyer", "type": "early_payment_discount",
                "obligation": f"Early payment discount available: {pt}",
                "frequency": "per invoice",
                "urgency": "medium"})

    return {"risk_score": risk_score, "risk_level": risk_level, "clauses": clauses,
            "obligations": obligations, "pricing_rules": pricing_rules,
            "analyzed_at": datetime.now().isoformat()}


def detect_contract_compliance_anomalies(invoice: dict, contract: dict, db: dict) -> list:
    """Contract compliance anomaly rules:
    - CONTRACT_PRICE_DRIFT: invoice unit price above contracted rate
    - CONTRACT_UNDERBILLING: invoice unit price significantly below contracted rate
    - CONTRACT_CURRENCY_MISMATCH: invoice/contract in different currencies, manual review needed
    - CONTRACT_EXPIRY_WARNING: invoice against expired or near-expiry contract
    - CONTRACT_OVER_UTILIZATION: cumulative invoicing exceeds contract value
    - VOLUME_COMMITMENT_GAP: below minimum purchase commitment pace
    """
    anomalies = []
    if not contract:
        return anomalies
    sym = currency_symbol(invoice.get("currency", "USD"))
    ct = contract.get("contractTerms") or {}

    # ── CONTRACT_PRICE_DRIFT ──
    cp = contract.get("pricingTerms")
    inv_currency = (invoice.get("currency") or "USD").upper()
    ctr_currency = (contract.get("currency") or "USD").upper()
    if cp and isinstance(cp, dict) and inv_currency == ctr_currency:
        # Only compare when currencies match — cross-currency comparison needs FX rates
        for li in invoice.get("lineItems", []):
            desc = (li.get("description") or "").lower().strip()
            up = _n(li.get("unitPrice"))
            if not up or not desc:
                continue
            for tk, tv in cp.items():
                tp = _n(tv)
                if not tp:
                    continue
                if tk.lower() in desc or desc in tk.lower():
                    drift = ((up - tp) / tp * 100) if tp > 0 else 0
                    # Use contract-specific tolerance (broader than line-item matching)
                    tol = get_policy().get("contract_price_drift_pct",
                          max(get_policy().get("price_tolerance_pct", 10), 5))
                    qty = _n(li.get("quantity") or 1)
                    if drift > tol:
                        # Overbilling — vendor charging more than contracted
                        risk = (up - tp) * qty
                        anomalies.append({"type": "CONTRACT_PRICE_DRIFT",
                            "severity": "high" if drift > 20 else "medium",
                            "description": f"'{li.get('description')}': {sym}{up:,.2f}/unit vs contracted {sym}{tp:,.2f} (+{drift:.1f}%)",
                            "amount_at_risk": round(risk, 2),
                            "contract_clause": f"Contracted rate: {sym}{tp:,.2f}",
                            "recommendation": f"Challenge vendor — contract specifies {sym}{tp:,.2f}"})
                    elif drift < -tol and abs(drift) > 10:
                        # Underbilling — vendor charging less than contracted (>10% below)
                        # May indicate partial delivery, unapproved discounts, scope reduction
                        shortfall = (tp - up) * qty
                        anomalies.append({"type": "CONTRACT_UNDERBILLING",
                            "severity": "low",
                            "description": f"'{li.get('description')}': {sym}{up:,.2f}/unit vs contracted {sym}{tp:,.2f} ({drift:.1f}%) — below contracted rate",
                            "amount_at_risk": 0,
                            "contract_clause": f"Contracted rate: {sym}{tp:,.2f}; invoiced {sym}{shortfall:,.2f} below expected",
                            "recommendation": "Verify: partial delivery? Unapproved discount? Scope change requiring amendment?"})
    elif cp and isinstance(cp, dict) and inv_currency != ctr_currency:
        # Currency mismatch — cannot validate prices, flag for manual review
        anomalies.append({"type": "CONTRACT_CURRENCY_MISMATCH",
            "severity": "low",
            "description": f"Invoice in {inv_currency} but contract priced in {ctr_currency} — price compliance cannot be verified automatically",
            "amount_at_risk": 0,
            "contract_clause": f"Contract currency: {ctr_currency}",
            "recommendation": f"Manually verify pricing with FX conversion ({inv_currency} → {ctr_currency})"})

    # ── CONTRACT_EXPIRY_WARNING ──
    expiry = ct.get("expiry_date") or contract.get("endDate")
    if expiry:
        try:
            exp_dt = datetime.fromisoformat(str(expiry)[:10])
            dl = (exp_dt - datetime.now()).days
            if dl < 0:
                anomalies.append({"type": "CONTRACT_EXPIRY_WARNING", "severity": "high",
                    "description": f"Invoice against expired contract (expired {abs(dl)} days ago, {expiry})",
                    "amount_at_risk": _n(invoice.get("subtotal") or invoice.get("amount")),
                    "contract_clause": f"Expired: {expiry}",
                    "recommendation": "Renew contract before approving further invoices"})
            elif dl <= 30:
                anomalies.append({"type": "CONTRACT_EXPIRY_WARNING", "severity": "medium",
                    "description": f"Contract expires in {dl} days ({expiry})",
                    "amount_at_risk": 0, "contract_clause": f"End: {expiry}",
                    "recommendation": f"Initiate renewal — {dl} days remaining"})
        except (ValueError, TypeError):
            pass

    # ── CONTRACT_OVER_UTILIZATION ──
    cv = _n(contract.get("amount"))
    if cv > 0:
        vn = contract.get("vendor", "")
        inv_id = invoice.get("id")
        invoices = db.get("invoices", []) if db else []
        # Exclude current invoice from DB sum to prevent double-counting during re-processing
        total_invoiced = sum(_n(i.get("subtotal") or i.get("amount")) for i in invoices
                            if i.get("vendor") and vn and
                            vendor_similarity(i.get("vendor", ""), vn) >= 0.7
                            and (not inv_id or i.get("id") != inv_id))
        inv_amt = _n(invoice.get("subtotal") or invoice.get("amount"))
        projected = total_invoiced + inv_amt
        util_pct = projected / cv * 100
        if util_pct > 100:
            if util_pct > 150:
                sev = "high"
            elif util_pct > 110:
                sev = "medium"
            else:
                sev = "low"
            anomalies.append({"type": "CONTRACT_OVER_UTILIZATION", "severity": sev,
                "description": f"Cumulative invoicing ({sym}{projected:,.0f}) exceeds contract value ({sym}{cv:,.0f}) by {util_pct - 100:.0f}%",
                "amount_at_risk": round(projected - cv, 2),
                "contract_clause": f"Contract value: {sym}{cv:,.0f}",
                "recommendation": "Review scope — contract amendment or new PO may be required" if util_pct > 110
                    else "Approaching contract ceiling — monitor remaining budget"})

    # ── VOLUME_COMMITMENT_GAP ──
    # Check if contract has a minimum volume commitment and whether the buyer is on track
    min_vol = _n(ct.get("minimum_volume") or ct.get("minimum_commitment") or contract.get("minimumVolume"))
    if min_vol and min_vol > 0 and cv > 0:
        vn_vol = contract.get("vendor", "")
        invoices_vol = db.get("invoices", []) if db else []
        inv_id_vol = invoice.get("id")
        total_invoiced_vol = sum(_n(i.get("subtotal") or i.get("amount")) for i in invoices_vol
                            if i.get("vendor") and vn_vol and
                            vendor_similarity(i.get("vendor", ""), vn_vol) >= 0.7
                            and (not inv_id_vol or i.get("id") != inv_id_vol))
        # Check time-based progress: if contract is >50% through its term but invoicing is <30% of commitment
        expiry = ct.get("expiry_date") or contract.get("endDate")
        effective = ct.get("effective_date") or contract.get("effectiveDate") or contract.get("signingDate")
        if expiry and effective:
            try:
                exp_dt = datetime.fromisoformat(str(expiry)[:10])
                eff_dt = datetime.fromisoformat(str(effective)[:10])
                total_days = max((exp_dt - eff_dt).days, 1)
                elapsed_days = max((datetime.now() - eff_dt).days, 0)
                time_pct = elapsed_days / total_days * 100
                vol_pct = total_invoiced_vol / min_vol * 100 if min_vol > 0 else 100
                # Flag if we're >50% through term but <30% of commitment
                if time_pct > 50 and vol_pct < 30:
                    shortfall = min_vol - total_invoiced_vol
                    anomalies.append({"type": "VOLUME_COMMITMENT_GAP", "severity": "medium",
                        "description": f"Minimum commitment: {sym}{min_vol:,.0f}; invoiced {sym}{total_invoiced_vol:,.0f} ({vol_pct:.0f}%) with {100-time_pct:.0f}% of contract term remaining",
                        "amount_at_risk": round(shortfall, 2),
                        "contract_clause": f"Minimum volume: {sym}{min_vol:,.0f}",
                        "recommendation": f"Shortfall risk: {sym}{shortfall:,.0f} — may trigger take-or-pay penalty"})
                elif time_pct > 80 and vol_pct < 70:
                    shortfall = min_vol - total_invoiced_vol
                    anomalies.append({"type": "VOLUME_COMMITMENT_GAP", "severity": "high",
                        "description": f"Critical: {sym}{total_invoiced_vol:,.0f} invoiced vs {sym}{min_vol:,.0f} commitment ({vol_pct:.0f}%) — contract {time_pct:.0f}% elapsed",
                        "amount_at_risk": round(shortfall, 2),
                        "contract_clause": f"Minimum volume: {sym}{min_vol:,.0f}",
                        "recommendation": f"Imminent shortfall penalty risk — {sym}{shortfall:,.0f} below commitment"})
            except (ValueError, TypeError):
                pass

    return anomalies


def compute_contract_health(contract: dict, db: dict) -> dict:
    """Quick health score for contract list display."""
    analysis = analyze_contract_clauses(contract)
    cr = analysis["risk_score"]

    # Expiry risk
    ct = contract.get("contractTerms") or {}
    expiry = ct.get("expiry_date") or contract.get("endDate")
    er, dl = 0, None
    if expiry:
        try:
            exp_dt = datetime.fromisoformat(str(expiry)[:10])
            dl = (exp_dt - datetime.now()).days
            er = 100 if dl < 0 else 80 if dl <= 30 else 40 if dl <= 90 else 0
        except (ValueError, TypeError):
            pass

    # Utilization
    vn = contract.get("vendor", "")
    cv = _n(contract.get("amount"))
    ti = sum(_n(i.get("subtotal") or i.get("amount")) for i in db.get("invoices", [])
             if vendor_similarity(i.get("vendor", ""), vn) >= 0.7)
    util = (ti / cv * 100) if cv > 0 else 0
    ur = min(100, (util - 100) * 5) if util > 100 else (30 if util > 90 else 0)

    comp = round(cr * 0.5 + er * 0.3 + ur * 0.2)
    health = max(0, min(100, 100 - comp))

    return {"health_score": health,
            "health_level": "good" if health >= 70 else "warning" if health >= 40 else "critical",
            "clause_risk": cr, "expiry_risk": er, "utilization_pct": round(util, 1),
            "days_to_expiry": dl, "total_invoiced": round(ti, 2),
            "obligations_count": len(analysis.get("obligations", [])),
            "high_risk_clauses": sum(1 for c in analysis.get("clauses", []) if c.get("risk") == "high"),
            "analysis": analysis}


def get_expiring_contracts(db: dict, days: int = 90) -> list:
    """Contracts expiring within N days, sorted by urgency."""
    results = []
    now = datetime.now()
    for c in db.get("contracts", []):
        ct = c.get("contractTerms") or {}
        expiry = ct.get("expiry_date") or c.get("endDate")
        if not expiry:
            continue
        try:
            exp_dt = datetime.fromisoformat(str(expiry)[:10])
            dl = (exp_dt - now).days
            if 0 < dl <= days:
                ar = ct.get("auto_renewal") or c.get("autoRenewal")
                rnd = _n(ct.get("renewal_notice_days") or c.get("renewalNoticeDays"))
                nd, no = None, False
                if ar and rnd:
                    ndt = exp_dt - timedelta(days=int(rnd))
                    nd = ndt.strftime("%Y-%m-%d")
                    no = ndt < now
                results.append({"id": c.get("id"), "number": c.get("contractNumber") or c.get("id"),
                    "vendor": c.get("vendor", "Unknown"), "expiry": expiry, "days_left": dl,
                    "amount": _n(c.get("amount")), "auto_renewal": bool(ar),
                    "notice_deadline": nd, "notice_overdue": no,
                    "urgency": "critical" if dl <= 30 or no else "warning" if dl <= 60 else "info"})
        except (ValueError, TypeError):
            continue
    return sorted(results, key=lambda x: x["days_left"])


# ═══════════════════════════════════════════════════════════════
# VENDOR COMPLIANCE & EXTENDED RISK
# ═══════════════════════════════════════════════════════════════

def compute_extended_vendor_risk(vendor_name: str, db: dict) -> dict:
    """Enhanced 9-factor vendor risk (extends existing 5-factor).
    New factors: kyc_status, payment_behavior, concentration_risk, delivery_performance.
    Returns the original 5-factor result PLUS 4 new factors merged in.
    """
    from backend.vendor import compute_vendor_risk_score
    base = compute_vendor_risk_score(vendor_name, db)
    factors = dict(base.get("factors", {}))
    vn = normalize_vendor(vendor_name)

    # ── Factor 6: KYC/Compliance ──
    # Check if vendor has active contract (proxy for onboarded/verified)
    vendor_contracts = [c for c in db.get("contracts", [])
                        if vendor_similarity(c.get("vendor", ""), vendor_name) >= 0.7]
    kyc_score = 0
    kyc_detail = ""
    if not vendor_contracts:
        kyc_score = 55
        kyc_detail = "No contract on file — vendor not formally onboarded"
    else:
        best = vendor_contracts[0]
        ct = best.get("contractTerms") or {}
        expiry = ct.get("expiry_date") or best.get("endDate")
        if expiry:
            try:
                dl = (datetime.fromisoformat(str(expiry)[:10]) - datetime.now()).days
                if dl < 0:
                    kyc_score = 70
                    kyc_detail = f"Contract expired {abs(dl)} days ago"
                elif dl <= 30:
                    kyc_score = 40
                    kyc_detail = f"Contract expiring in {dl} days"
                else:
                    kyc_score = 10
                    kyc_detail = f"Active contract, {dl} days remaining"
            except Exception:
                kyc_score = 30
                kyc_detail = "Contract date unclear"
        else:
            kyc_score = 20
            kyc_detail = "Contract active, no expiry date"
    factors["kyc_compliance"] = {"score": round(kyc_score, 1), "weight": 0.12, "detail": kyc_detail}

    # ── Factor 7: Payment Behavior ──
    vendor_invoices = [i for i in db.get("invoices", [])
                       if vendor_similarity(i.get("vendor", ""), vendor_name) >= 0.7]
    pb_score = 0
    pb_detail = "Normal patterns"
    if len(vendor_invoices) >= 3:
        # Check for round-number pattern (indicator of estimated/fabricated invoices)
        amounts = [_n(i.get("amount")) for i in vendor_invoices if _n(i.get("amount")) > 0]
        round_count = sum(1 for a in amounts if a == round(a, -2) and a >= 1000)
        if amounts and round_count / len(amounts) > 0.5:
            pb_score += 25
            pb_detail = f"{round_count}/{len(amounts)} invoices are round numbers"

        # Check invoice velocity (sudden spike)
        sorted_inv = sorted(vendor_invoices, key=lambda x: x.get("extractedAt", ""))
        if len(sorted_inv) >= 4:
            recent_3 = sorted_inv[-3:]
            older = sorted_inv[:-3]
            if older:
                recent_dates = [i.get("extractedAt", "") for i in recent_3 if i.get("extractedAt")]
                if len(recent_dates) >= 2:
                    try:
                        rd = [datetime.fromisoformat(d[:19]) for d in recent_dates]
                        avg_gap = sum((rd[i+1] - rd[i]).days for i in range(len(rd)-1)) / max(len(rd)-1, 1)
                        if avg_gap < 3:  # invoices coming faster than every 3 days
                            pb_score += 20
                            pb_detail += "; high-frequency submissions"
                    except Exception:
                        pass
        pb_score = min(100, pb_score)
    factors["payment_behavior"] = {"score": round(pb_score, 1), "weight": 0.08, "detail": pb_detail}

    # ── Factor 8: Concentration Risk ──
    total_spend = sum(_n(i.get("amount")) for i in db.get("invoices", []))
    vendor_spend = base.get("totalSpend", 0)
    conc_pct = (vendor_spend / total_spend * 100) if total_spend > 0 else 0
    conc_score = min(100, max(0, (conc_pct - 15) * 3))  # Risk starts above 15% share
    conc_detail = f"{conc_pct:.1f}% of total spend" if total_spend > 0 else "Insufficient data"
    if conc_pct > 30:
        conc_detail += " — high concentration risk"
    factors["concentration_risk"] = {"score": round(conc_score, 1), "weight": 0.08, "detail": conc_detail}

    # ── Factor 9: Delivery Performance (from GRN data) ──
    dp = compute_delivery_performance(vendor_name, db)
    dp_score = 0
    dp_detail = "No delivery data"
    if dp.get("total_grns", 0) > 0:
        ot = dp.get("on_time_rate", 1.0)
        ss = dp.get("short_shipment_rate", 0)
        dp_score = round((1 - ot) * 60 + ss * 40)
        dp_score = max(0, min(100, dp_score))
        dp_detail = f"{round(ot*100)}% on-time, {round(ss*100)}% short shipments ({dp['total_grns']} GRNs)"
    factors["delivery_performance"] = {"score": round(dp_score, 1), "weight": 0.07, "detail": dp_detail}

    # ── Recompute weighted score with all 9 factors ──
    # Rebalance original weights to accommodate new factors (total must = 1.0)
    # Original: anomaly=0.30, correction=0.15, contract=0.20, duplicate=0.15, volume=0.20
    # New allocation: anomaly=0.22, correction=0.10, contract=0.15, duplicate=0.11, volume=0.07
    #   + kyc=0.12, payment=0.08, concentration=0.08, delivery=0.07 = 1.00
    weight_map = {
        "anomaly_rate": 0.22, "correction_freq": 0.10, "contract_compliance": 0.15,
        "duplicate_history": 0.11, "volume_consistency": 0.07,
        "kyc_compliance": 0.12, "payment_behavior": 0.08,
        "concentration_risk": 0.08, "delivery_performance": 0.07,
    }
    raw = sum(factors.get(k, {}).get("score", 0) * w for k, w in weight_map.items())
    final = max(0, min(100, round(raw, 1)))
    level = "high" if final >= 60 else "medium" if final >= 30 else "low"

    # Update weights in factors for UI display
    for k, w in weight_map.items():
        if k in factors:
            factors[k]["weight"] = w

    return {**base, "score": final, "level": level, "factors": factors,
            "factor_count": 9, "extended": True,
            "concentration_pct": round(conc_pct, 1),
            "delivery": dp if dp.get("total_grns", 0) > 0 else None}


def get_vendor_kyc_status(vendor_name: str, db: dict) -> dict:
    """KYC/compliance summary for a vendor."""
    contracts = [c for c in db.get("contracts", [])
                 if vendor_similarity(c.get("vendor", ""), vendor_name) >= 0.7]

    has_contract = len(contracts) > 0
    active_contract = None
    expired = False
    days_left = None

    if contracts:
        for c in contracts:
            ct = c.get("contractTerms") or {}
            expiry = ct.get("expiry_date") or c.get("endDate")
            if expiry:
                try:
                    dl = (datetime.fromisoformat(str(expiry)[:10]) - datetime.now()).days
                    if dl > 0:
                        active_contract = c
                        days_left = dl
                        break
                    else:
                        expired = True
                except Exception:
                    pass
            else:
                active_contract = c

    status = "compliant" if active_contract else "expired" if expired else "unverified"

    # Check for bank detail anomalies (proxy for BEC risk)
    anomalies = [a for a in db.get("anomalies", [])
                 if vendor_similarity(a.get("vendor", ""), vendor_name) >= 0.7]
    bank_flags = [a for a in anomalies if a.get("type") in ("DUPLICATE_INVOICE", "ROUND_NUMBER_INVOICE")
                  and a.get("status") == "open"]

    return {
        "status": status,
        "has_contract": has_contract,
        "active_contract_id": active_contract.get("id") if active_contract else None,
        "contract_expiry": days_left,
        "risk_flags": len(bank_flags),
        "risk_flag_types": list(set(a.get("type") for a in bank_flags)),
        "documents": [
            {"type": "contract", "status": "valid" if active_contract else ("expired" if expired else "missing")},
            {"type": "pricing_terms", "status": "valid" if (active_contract and active_contract.get("pricingTerms")) else "missing"},
        ]
    }


# ═══════════════════════════════════════════════════════════════
# DELIVERY ANALYTICS
# ═══════════════════════════════════════════════════════════════

def compute_delivery_performance(vendor_name: str, db: dict) -> dict:
    """Aggregate GRN data per vendor: on-time rate, short shipments, fulfillment."""
    grns = db.get("goods_receipts", [])
    pos = db.get("purchase_orders", [])
    matches = db.get("matches", [])
    anomalies = db.get("anomalies", [])

    # Find GRNs linked to this vendor's POs
    vendor_pos = [p for p in pos if vendor_similarity(p.get("vendor", ""), vendor_name) >= 0.7]
    vendor_po_ids = {p["id"] for p in vendor_pos}

    # GRNs linked via matches
    vendor_grn_ids = set()
    for m in matches:
        if m.get("poId") in vendor_po_ids and m.get("grnIds"):
            for gid in m["grnIds"]:
                vendor_grn_ids.add(gid)

    # Also direct vendor match on GRNs
    vendor_grns = [g for g in grns if g.get("id") in vendor_grn_ids or
                   vendor_similarity(g.get("vendor", ""), vendor_name) >= 0.7]
    total_grns = len(vendor_grns)

    if total_grns == 0:
        return {"total_grns": 0, "on_time_rate": 0, "short_shipment_rate": 0,
                "avg_fulfillment_pct": 0, "trend": "no_data", "monthly_stats": []}

    # Short shipment analysis from anomalies
    vendor_anomalies = [a for a in anomalies
                        if vendor_similarity(a.get("vendor", ""), vendor_name) >= 0.7]
    short_count = sum(1 for a in vendor_anomalies if a.get("type") == "SHORT_SHIPMENT")
    overbill_count = sum(1 for a in vendor_anomalies if a.get("type") in ("OVERBILLED_VS_RECEIVED", "QUANTITY_RECEIVED_MISMATCH"))

    # On-time: approximate from GRN received dates vs PO dates
    on_time = 0
    late = 0
    unmeasurable = 0
    for g in vendor_grns:
        rd = g.get("receivedDate") or g.get("issueDate")
        po_ref = g.get("poReference")
        if rd and po_ref:
            po = next((p for p in vendor_pos if p.get("poNumber") == po_ref or p.get("id") == po_ref), None)
            if po:
                pd = po.get("dueDate") or po.get("deliveryDate")
                if pd and rd:
                    try:
                        rd_dt = datetime.fromisoformat(str(rd)[:10])
                        pd_dt = datetime.fromisoformat(str(pd)[:10])
                        if rd_dt <= pd_dt + timedelta(days=3):
                            on_time += 1
                        else:
                            late += 1
                    except Exception:
                        unmeasurable += 1  # Date parsing failed — cannot determine
                else:
                    unmeasurable += 1  # Missing due date — cannot measure
            else:
                unmeasurable += 1  # No matching PO found
        else:
            unmeasurable += 1  # Missing receive date or PO ref

    measurable = on_time + late
    otr = on_time / measurable if measurable > 0 else 0
    ssr = short_count / max(total_grns, 1)

    # PO Fulfillment tracking
    open_pos = []
    for po in vendor_pos:
        po_id = po["id"]
        po_amt = _n(po.get("amount"))
        if po_amt <= 0:
            continue
        # Sum all invoices matched to this PO
        inv_ids = [m["invoiceId"] for m in matches if m.get("poId") == po_id]
        invoiced = sum(_n(i.get("subtotal") or i.get("amount"))
                       for i in db.get("invoices", []) if i["id"] in inv_ids)
        fulfilled_pct = (invoiced / po_amt * 100) if po_amt > 0 else 0
        if fulfilled_pct < 90:
            # Check age
            po_date = po.get("issueDate") or po.get("extractedAt")
            days_open = 0
            if po_date:
                try:
                    days_open = (datetime.now() - datetime.fromisoformat(str(po_date)[:10])).days
                except Exception:
                    pass
            open_pos.append({"po_number": po.get("poNumber") or po["id"],
                "days_open": days_open, "fulfilled_pct": round(fulfilled_pct, 1),
                "outstanding": round(po_amt - invoiced, 2)})

    # Trend (simple: compare short shipment rate of recent vs older)
    trend = "stable"
    if total_grns >= 4 and short_count >= 2:
        trend = "deteriorating"
    elif total_grns >= 4 and short_count == 0:
        trend = "good"

    return {
        "total_grns": total_grns,
        "on_time_rate": round(otr, 3),
        "on_time_count": on_time,
        "late_count": late,
        "unmeasurable_count": unmeasurable,
        "measurable_count": measurable,
        "short_shipment_rate": round(ssr, 3),
        "overbill_count": overbill_count,
        "short_count": short_count,
        "trend": trend,
        "open_pos": sorted(open_pos, key=lambda x: x["days_open"], reverse=True)[:5],
        "avg_fulfillment_pct": round(sum(p["fulfilled_pct"] for p in open_pos) / max(len(open_pos), 1), 1) if open_pos else 100,
    }


def detect_delivery_anomalies(vendor_name: str, db: dict) -> list:
    """Delivery anomaly rules: CHRONIC_SHORT_SHIPMENT, DELIVERY_DETERIORATION, PO_STALE"""
    anomalies = []
    dp = compute_delivery_performance(vendor_name, db)

    if dp["total_grns"] < 3:
        return anomalies

    sym = currency_symbol("USD")  # Use default; vendor-level metric

    # ── CHRONIC_SHORT_SHIPMENT ──
    if dp["short_shipment_rate"] > 0.20:
        anomalies.append({"type": "CHRONIC_SHORT_SHIPMENT", "severity": "medium",
            "description": f"Vendor has {round(dp['short_shipment_rate']*100)}% short shipment rate across {dp['total_grns']} deliveries",
            "amount_at_risk": 0,
            "contract_clause": "Delivery compliance — pattern detected",
            "recommendation": "Review vendor delivery performance and consider SLA enforcement"})

    # ── PO_FULFILLMENT_STALE ──
    for po in dp.get("open_pos", []):
        if po["days_open"] > 60 and po["fulfilled_pct"] < 50:
            anomalies.append({"type": "PO_FULFILLMENT_STALE", "severity": "low",
                "description": f"PO {po['po_number']}: {po['fulfilled_pct']}% fulfilled after {po['days_open']} days ({sym}{po['outstanding']:,.0f} outstanding)",
                "amount_at_risk": 0,
                "contract_clause": "PO fulfillment tracking",
                "recommendation": f"Follow up on outstanding delivery — PO open {po['days_open']} days"})

    return anomalies


# ═══════════════════════════════════════════════════════════════
# DASHBOARD INTELLIGENCE (feeds into /api/dashboard)
# ═══════════════════════════════════════════════════════════════

def get_intelligence_summary(db: dict) -> dict:
    """Compute intelligence metrics for the dashboard."""
    contracts = db.get("contracts", [])
    expiring = get_expiring_contracts(db, 90)

    # Contract health
    contract_health = []
    for c in contracts:
        h = compute_contract_health(c, db)
        # Strip full analysis from summary to keep payload lean
        h_summary = {k: v for k, v in h.items() if k != "analysis"}
        contract_health.append({
            "id": c.get("id"), "vendor": c.get("vendor"),
            "number": c.get("contractNumber") or c.get("id"),
            **h_summary
        })

    critical_contracts = [h for h in contract_health if h["health_level"] == "critical"]
    high_risk_clauses = sum(h["high_risk_clauses"] for h in contract_health)
    pending_obligations = sum(h["obligations_count"] for h in contract_health)

    # Vendor concentration
    total_spend = sum(_n(i.get("amount")) for i in db.get("invoices", []))
    profiles = db.get("vendor_profiles", [])
    top_concentration = 0
    if profiles and total_spend > 0:
        top_concentration = max(
            (_n(p.get("totalSpend")) / total_spend * 100) for p in profiles
        ) if profiles else 0

    # GRN stats
    grns = db.get("goods_receipts", [])
    grn_anomalies = [a for a in db.get("anomalies", [])
                     if a.get("type") in ("SHORT_SHIPMENT", "OVERBILLED_VS_RECEIVED", "QUANTITY_RECEIVED_MISMATCH",
                                          "UNRECEIPTED_INVOICE")
                     and a.get("status") == "open"]

    return {
        "expiring_contracts": expiring[:5],
        "expiring_count": len(expiring),
        "critical_contracts": len(critical_contracts),
        "high_risk_clauses": high_risk_clauses,
        "pending_obligations": pending_obligations,
        "contract_health": contract_health,
        "top_vendor_concentration": round(top_concentration, 1),
        "grn_count": len(grns),
        "grn_open_anomalies": len(grn_anomalies),
    }


# ═══════════════════════════════════════════════════════════════
# CONTRACT LIFECYCLE SCHEDULER
# ═══════════════════════════════════════════════════════════════
# Runs daily (or on-demand via API). Evaluates ALL active contracts
# against clause obligations and time-based triggers.
# Auto-creates cases with escalation chains and SLA timers.
# Time-triggered (daily cron), not event-triggered.

def run_lifecycle_checks(db: dict) -> dict:
    """Run contract lifecycle checks across all contracts.

    Architecture decision: Only over-utilization creates AP cases because
    that's the only lifecycle event where the next action lands on AP's desk
    (process an invoice that exceeds the contract ceiling, or hold it).

    Everything else (expiry, renewal, SLA, commitments, penalties) generates
    intelligence alerts — data packaged for CFO/Procurement, not investigation
    tickets for AP analysts who can't act on them.

    Returns { cases_created: [], alerts: [], summary: {} }
    """
    from backend.cases import create_case

    contracts = db.get("contracts", [])
    cases = db.get("cases", [])
    now = datetime.now()
    results = {"cases_created": [], "alerts": [], "checks_run": 0}

    # De-dup for AP cases
    existing_case_keys = set()
    for case in cases:
        if case.get("status") not in ("resolved", "closed"):
            ckey = (case.get("type", ""), case.get("vendor", ""), case.get("lifecycleKey", ""))
            existing_case_keys.add(ckey)

    def _case_exists(case_type, vendor, lifecycle_key):
        return (case_type, vendor, lifecycle_key) in existing_case_keys

    # De-dup for alerts (stored in db["lifecycle_alerts"])
    existing_alert_keys = set()
    for alert in db.get("lifecycle_alerts", []):
        if not alert.get("dismissed"):
            existing_alert_keys.add(alert.get("key", ""))

    for contract in contracts:
        results["checks_run"] += 1
        cid = contract.get("id", "")
        vendor = contract.get("vendor", "Unknown")
        ct = contract.get("contractTerms") or {}
        currency = contract.get("currency", "USD")
        sym = currency_symbol(currency)
        cval = _n(contract.get("amount"))
        cnum = contract.get("contractNumber") or cid
        expiry_str = ct.get("expiry_date") or contract.get("endDate")

        # ────────────────────────────────────────────────
        # AP CASE: Over-Utilization (the ONE that belongs in AP)
        # When invoices push past the contract ceiling, the next invoice
        # lands on AP's desk. They need a case to decide: process or hold.
        # ────────────────────────────────────────────────
        if cval > 0:
            vn = contract.get("vendor", "")
            total_invoiced = sum(
                _n(i.get("subtotal") or i.get("amount"))
                for i in db.get("invoices", [])
                if vendor_similarity(i.get("vendor", ""), vn) >= 0.7
            )
            util_pct = total_invoiced / cval * 100
            if util_pct >= 85:
                threshold_key = "over100" if util_pct >= 100 else "over85"
                priority = "critical" if util_pct >= 100 else "high"
                lk = f"utilization-{threshold_key}-{cid}"
                if not _case_exists("over_utilization", vendor, lk):
                    case = create_case(
                        case_type="over_utilization",
                        title=f"{'Contract exceeded' if util_pct >= 100 else 'Near ceiling'}: {cnum} ({vendor})",
                        description=f"Contract {cnum} utilization at {util_pct:.0f}% "
                            f"({sym}{total_invoiced:,.0f} of {sym}{cval:,.0f}). "
                            f"{'Next invoice from this vendor exceeds contract value — hold for amendment or approve with override.' if util_pct >= 100 else 'Next few invoices will breach ceiling — flag for amendment before processing.'}",
                        priority=priority,
                        vendor=vendor,
                        amount_at_risk=round(max(0, total_invoiced - cval), 2) if util_pct >= 100 else 0,
                        currency=currency,
                        created_by="lifecycle_scheduler",
                    )
                    case["lifecycleKey"] = lk
                    case["contractId"] = cid
                    results["cases_created"].append(case)
                    existing_case_keys.add(("over_utilization", vendor, lk))

        # ────────────────────────────────────────────────
        # INTELLIGENCE ALERTS (for CFO/Procurement report, not AP cases)
        # These surface data to the right audience without pretending
        # to be investigation tickets AP analysts will work.
        # ────────────────────────────────────────────────

        # Alert: Auto-Renewal Deadline → Procurement
        auto_renewal = ct.get("auto_renewal") or contract.get("autoRenewal")
        notice_days = _n(ct.get("renewal_notice_days") or contract.get("renewalNoticeDays"))
        if auto_renewal and notice_days and expiry_str:
            try:
                exp_dt = datetime.fromisoformat(str(expiry_str)[:10])
                opt_out_dt = exp_dt - timedelta(days=int(notice_days))
                days_to_optout = (opt_out_dt - now).days
                if 0 < days_to_optout <= 120:
                    ak = f"renewal-{cid}"
                    if ak not in existing_alert_keys:
                        urgency = "critical" if days_to_optout <= 30 else "high" if days_to_optout <= 60 else "medium"
                        results["alerts"].append({
                            "key": ak, "category": "renewal_deadline",
                            "audience": "procurement",
                            "urgency": urgency,
                            "contractId": cid, "contractNumber": cnum,
                            "vendor": vendor, "currency": currency,
                            "headline": f"Auto-renewal opt-out in {days_to_optout} days",
                            "detail": f"Contract {cnum} ({vendor}) auto-renews {exp_dt.strftime('%Y-%m-%d')}. "
                                f"Written notice required by {opt_out_dt.strftime('%Y-%m-%d')}.",
                            "amount": cval,
                            "days_remaining": days_to_optout,
                            "deadline": opt_out_dt.strftime("%Y-%m-%d"),
                            "detectedAt": now.isoformat(),
                        })
                        existing_alert_keys.add(ak)
            except (ValueError, TypeError):
                pass

        # Alert: Contract Expiry → Procurement
        if expiry_str:
            try:
                exp_dt = datetime.fromisoformat(str(expiry_str)[:10])
                days_left = (exp_dt - now).days
                if 0 < days_left <= 90:
                    ak = f"expiry-{cid}"
                    if ak not in existing_alert_keys:
                        urgency = "critical" if days_left <= 30 else "high" if days_left <= 60 else "medium"
                        results["alerts"].append({
                            "key": ak, "category": "contract_expiry",
                            "audience": "procurement",
                            "urgency": urgency,
                            "contractId": cid, "contractNumber": cnum,
                            "vendor": vendor, "currency": currency,
                            "headline": f"Contract expires in {days_left} days",
                            "detail": f"Contract {cnum} ({vendor}) expires {exp_dt.strftime('%Y-%m-%d')}. "
                                f"Value: {sym}{cval:,.0f}." if cval else
                                f"Contract {cnum} ({vendor}) expires in {days_left} days.",
                            "amount": cval,
                            "days_remaining": days_left,
                            "deadline": exp_dt.strftime("%Y-%m-%d"),
                            "detectedAt": now.isoformat(),
                        })
                        existing_alert_keys.add(ak)
            except (ValueError, TypeError):
                pass

        # Alert: Spend Commitment Gap → Finance/Procurement
        min_volume = _n(ct.get("minimum_volume") or ct.get("min_commitment"))
        if min_volume and min_volume > 0 and cval > 0:
            vn = contract.get("vendor", "")
            total_invoiced = sum(
                _n(i.get("subtotal") or i.get("amount"))
                for i in db.get("invoices", [])
                if vendor_similarity(i.get("vendor", ""), vn) >= 0.7
            )
            start_str = ct.get("effective_date") or contract.get("effectiveDate") or contract.get("issueDate")
            if start_str and expiry_str:
                try:
                    start_dt = datetime.fromisoformat(str(start_str)[:10])
                    exp_dt = datetime.fromisoformat(str(expiry_str)[:10])
                    total_days = max((exp_dt - start_dt).days, 1)
                    elapsed_days = max((now - start_dt).days, 0)
                    elapsed_pct = elapsed_days / total_days
                    expected_spend = min_volume * elapsed_pct
                    if elapsed_pct > 0.5 and total_invoiced < expected_spend * 0.7:
                        ak = f"commitment-{cid}"
                        if ak not in existing_alert_keys:
                            shortfall = expected_spend - total_invoiced
                            results["alerts"].append({
                                "key": ak, "category": "commitment_shortfall",
                                "audience": "finance",
                                "urgency": "high" if elapsed_pct > 0.75 else "medium",
                                "contractId": cid, "contractNumber": cnum,
                                "vendor": vendor, "currency": currency,
                                "headline": f"Volume commitment gap: {sym}{shortfall:,.0f} behind",
                                "detail": f"Contract {cnum} ({vendor}) minimum: {sym}{min_volume:,.0f}. "
                                    f"Spent {sym}{total_invoiced:,.0f} ({total_invoiced/min_volume*100:.0f}%) "
                                    f"with {elapsed_pct*100:.0f}% of term elapsed.",
                                "amount": round(shortfall, 2),
                                "detectedAt": now.isoformat(),
                            })
                            existing_alert_keys.add(ak)
                except (ValueError, TypeError):
                    pass

        # Alert: SLA Breach → Procurement/Vendor Management
        sla_pct = _n(ct.get("sla_on_time_pct"))
        if sla_pct and sla_pct > 0:
            vn = contract.get("vendor", "")
            grns = [g for g in db.get("goods_receipts", [])
                    if vendor_similarity(g.get("vendor", ""), vn) >= 0.7]
            if len(grns) >= 3:
                on_time = sum(1 for g in grns if not g.get("receivedLate", False))
                actual_pct = (on_time / len(grns)) * 100
                if actual_pct < sla_pct:
                    ak = f"sla-{cid}"
                    if ak not in existing_alert_keys:
                        results["alerts"].append({
                            "key": ak, "category": "sla_breach",
                            "audience": "procurement",
                            "urgency": "high" if (sla_pct - actual_pct) > 15 else "medium",
                            "contractId": cid, "contractNumber": cnum,
                            "vendor": vendor, "currency": currency,
                            "headline": f"SLA breach: {actual_pct:.0f}% vs {sla_pct:.0f}% required",
                            "detail": f"Contract {cnum} ({vendor}) SLA requires {sla_pct:.0f}% on-time. "
                                f"Actual: {actual_pct:.0f}% ({on_time}/{len(grns)} on time).",
                            "detectedAt": now.isoformat(),
                        })
                        existing_alert_keys.add(ak)

        # Alert: Penalty Recovery → Legal/Procurement
        penalty_str = ct.get("penalty_clauses") or contract.get("penaltyClauses") or ""
        if penalty_str:
            vn = contract.get("vendor", "")
            late_grns = [g for g in db.get("goods_receipts", [])
                        if vendor_similarity(g.get("vendor", ""), vn) >= 0.7
                        and g.get("receivedLate", False)]
            short_anomalies = [a for a in db.get("anomalies", [])
                              if a.get("type") in ("SHORT_SHIPMENT", "QUANTITY_RECEIVED_MISMATCH")
                              and a.get("status") == "open"
                              and vendor_similarity(a.get("vendor", ""), vn) >= 0.6]
            if late_grns or short_anomalies:
                ak = f"penalty-{cid}"
                if ak not in existing_alert_keys:
                    issues = []
                    if late_grns: issues.append(f"{len(late_grns)} late deliveries")
                    if short_anomalies: issues.append(f"{len(short_anomalies)} short shipments")
                    results["alerts"].append({
                        "key": ak, "category": "penalty_recovery",
                        "audience": "legal",
                        "urgency": "medium",
                        "contractId": cid, "contractNumber": cnum,
                        "vendor": vendor, "currency": currency,
                        "headline": f"Penalty recovery: {', '.join(issues)}",
                        "detail": f"Contract {cnum} ({vendor}) has penalty clauses. "
                            f"Detected: {', '.join(issues)}. Review for recoverable penalties.",
                        "detectedAt": now.isoformat(),
                    })
                    existing_alert_keys.add(ak)

    # Persist AP cases
    if results["cases_created"]:
        db.setdefault("cases", []).extend(results["cases_created"])

    # Persist intelligence alerts (append new, keep existing)
    if results["alerts"]:
        existing = db.get("lifecycle_alerts", [])
        existing.extend(results["alerts"])
        db["lifecycle_alerts"] = existing

    results["summary"] = {
        "contracts_checked": results["checks_run"],
        "cases_created": len(results["cases_created"]),
        "alerts_generated": len(results["alerts"]),
    }

    return results


def generate_contract_intelligence_report(db: dict) -> dict:
    """Monthly Contract Intelligence Report for CFO/Procurement.

    Packages lifecycle data for the right audience:
    - Expiring contracts with renewal recommendations
    - SLA performance across vendor portfolio
    - Spend commitment tracking vs minimums
    - Early payment discount capture rate
    - Penalty recovery opportunities
    - Portfolio risk summary from clause analysis

    This is NOT an AP report. It's executive intelligence that happens
    to be computed from AP data — contract terms, invoice volumes,
    delivery records — because AP is where that data lives.
    """
    contracts = db.get("contracts", [])
    invoices = db.get("invoices", [])
    anomalies = db.get("anomalies", [])
    grns = db.get("goods_receipts", [])
    now = datetime.now()
    sym_default = "$"

    report = {
        "generated_at": now.isoformat(),
        "period": now.strftime("%B %Y"),
        "sections": {},
    }

    # ── 1. Expiring Contracts ──
    expiring = get_expiring_contracts(db, 90)
    report["sections"]["expiring_contracts"] = {
        "title": "Contracts Expiring Within 90 Days",
        "audience": "Procurement",
        "count": len(expiring),
        "total_value": sum(_n(e.get("amount")) for e in expiring),
        "items": expiring[:10],
        "action": "Begin renewal negotiation or source alternatives",
    }

    # ── 2. Early Payment Discount Capture ──
    epd_anomalies = [a for a in anomalies if a.get("type") == "EARLY_PAYMENT_DISCOUNT"]
    epd_available = sum(_n(a.get("amount_at_risk")) for a in epd_anomalies)
    # Estimate captured: invoices paid within discount window
    epd_captured = 0
    for a in epd_anomalies:
        inv = next((i for i in invoices if i.get("id") == a.get("invoiceId")), None)
        if inv and inv.get("status") in ("paid", "approved"):
            epd_captured += _n(a.get("amount_at_risk"))
    capture_rate = (epd_captured / epd_available * 100) if epd_available > 0 else 0

    report["sections"]["early_payment_discounts"] = {
        "title": "Early Payment Discount Performance",
        "audience": "Finance / AP",
        "available": round(epd_available, 2),
        "captured": round(epd_captured, 2),
        "missed": round(epd_available - epd_captured, 2),
        "capture_rate_pct": round(capture_rate, 1),
        "action": f"{'Improve discount capture — ' + str(round(epd_available - epd_captured, 2)) + ' in available discounts not yet captured' if capture_rate < 80 else 'Healthy capture rate'}",
    }

    # ── 3. Utilization Summary ──
    utilization_items = []
    for c in contracts:
        cval = _n(c.get("amount"))
        if cval <= 0:
            continue
        vn = c.get("vendor", "")
        ti = sum(_n(i.get("subtotal") or i.get("amount")) for i in invoices
                 if vendor_similarity(i.get("vendor", ""), vn) >= 0.7)
        util_pct = ti / cval * 100
        if util_pct >= 75:  # Only report notable utilization
            ccy = c.get("currency", "USD")
            utilization_items.append({
                "contract": c.get("contractNumber") or c.get("id"),
                "vendor": vn,
                "value": cval,
                "invoiced": round(ti, 2),
                "utilization_pct": round(util_pct, 1),
                "status": "exceeded" if util_pct >= 100 else "critical" if util_pct >= 90 else "warning",
                "currency": ccy,
            })
    utilization_items.sort(key=lambda x: x["utilization_pct"], reverse=True)

    report["sections"]["utilization"] = {
        "title": "Contract Utilization",
        "audience": "Finance / Procurement",
        "exceeded_count": sum(1 for u in utilization_items if u["status"] == "exceeded"),
        "critical_count": sum(1 for u in utilization_items if u["status"] == "critical"),
        "items": utilization_items[:10],
        "action": "Amend exceeded contracts; plan renewals for critical utilization",
    }

    # ── 4. Portfolio Risk Summary ──
    health_data = []
    high_risk_clause_details = []
    for c in contracts:
        h = compute_contract_health(c, db)
        cnum = c.get("contractNumber") or c.get("id")
        vendor = c.get("vendor")
        health_data.append({
            "contract": cnum,
            "vendor": vendor,
            "health_score": h["health_score"],
            "health_level": h["health_level"],
            "high_risk_clauses": h["high_risk_clauses"],
        })
        # Collect individual high-risk clause details for CFO drill-down
        for cl in h.get("analysis", {}).get("clauses", []):
            if cl.get("risk") == "high":
                high_risk_clause_details.append({
                    "contract": cnum,
                    "vendor": vendor,
                    "clause_type": (cl.get("type") or "").replace("_", " ").title(),
                    "summary": cl.get("summary", ""),
                })

    total_contracts = len(contracts)
    critical_count = sum(1 for h in health_data if h["health_level"] == "critical")
    warning_count = sum(1 for h in health_data if h["health_level"] == "warning")
    high_risk_clause_total = sum(h["high_risk_clauses"] for h in health_data)

    report["sections"]["portfolio_risk"] = {
        "title": "Contract Portfolio Risk",
        "audience": "CFO / Legal",
        "total_contracts": total_contracts,
        "healthy": total_contracts - critical_count - warning_count,
        "warning": warning_count,
        "critical": critical_count,
        "high_risk_clauses_total": high_risk_clause_total,
        "worst_contracts": sorted(health_data, key=lambda x: x["health_score"])[:5],
        "high_risk_clause_details": high_risk_clause_details[:20],
        "action": f"{critical_count} contracts need immediate review; {high_risk_clause_total} high-risk clauses across portfolio" if critical_count > 0 else "Portfolio health acceptable",
    }

    # ── 5. Lifecycle Alerts Summary ──
    alerts = db.get("lifecycle_alerts", [])
    active_alerts = [a for a in alerts if not a.get("dismissed")]
    by_category = {}
    for a in active_alerts:
        cat = a.get("category", "unknown")
        by_category.setdefault(cat, []).append(a)

    report["sections"]["lifecycle_alerts"] = {
        "title": "Active Contract Lifecycle Alerts",
        "audience": "Procurement / Legal",
        "total_active": len(active_alerts),
        "by_category": {k: len(v) for k, v in by_category.items()},
        "critical_alerts": [a for a in active_alerts if a.get("urgency") == "critical"],
        "items": active_alerts[:15],
    }

    # ── 6. Summary Line (the one-paragraph CFO briefing) ──
    summary_parts = []
    if expiring:
        summary_parts.append(f"{len(expiring)} contract{'s' if len(expiring) != 1 else ''} expiring within 90 days")
    exceeded = [u for u in utilization_items if u["status"] == "exceeded"]
    if exceeded:
        summary_parts.append(f"{len(exceeded)} contract{'s' if len(exceeded) != 1 else ''} exceeded ceiling")
    if epd_available > 0:
        summary_parts.append(f"EPD capture rate {capture_rate:.0f}% ({sym_default}{epd_captured:,.0f} of {sym_default}{epd_available:,.0f})")
    critical_alerts = [a for a in active_alerts if a.get("urgency") == "critical"]
    if critical_alerts:
        summary_parts.append(f"{len(critical_alerts)} critical alert{'s' if len(critical_alerts) != 1 else ''} requiring attention")
    if high_risk_clause_total:
        contracts_with_high_risk = sum(1 for h in health_data if h["high_risk_clauses"] > 0)
        summary_parts.append(f"{high_risk_clause_total} high-risk clauses across {contracts_with_high_risk} contract{'s' if contracts_with_high_risk != 1 else ''}")

    report["summary_line"] = ". ".join(summary_parts) + "." if summary_parts else "All contracts healthy, no action required."

    return report
