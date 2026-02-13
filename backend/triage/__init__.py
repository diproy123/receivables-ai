"""
AuditLens — Agentic Invoice Triage Engine

Classifies invoices into AUTO_APPROVE / REVIEW / BLOCK with reasoning.
Fully deterministic — no LLM calls. Uses multi-factor analysis:
  - Anomaly severity (high → BLOCK)
  - Extraction confidence
  - Vendor risk score
  - Delegation of authority (role-based amount limits)
  - PO match quality
  - Three-way match status (GRN)

Returns structured decision with reasons, confidence, and required approver.
"""

import uuid
from datetime import datetime

from backend.policy import get_policy, DEFAULT_POLICY
from backend.vendor import compute_vendor_risk_score, currency_symbol
from backend.auth import get_authority_limit, get_required_approver
from backend.config import AUTHORITY_MATRIX, DEFAULT_ROLE, TRIAGE_ENABLED


def triage_invoice(invoice: dict, anomalies: list, db: dict,
                   role: str = None, performed_by: str = "System") -> dict:
    """Classify invoice into AUTO_APPROVE / REVIEW / BLOCK with reasoning."""
    if not TRIAGE_ENABLED:
        return {"lane": "REVIEW", "reasons": ["Triage disabled"], "confidence": 0,
                "vendorRisk": None, "triageAt": datetime.now().isoformat(), "autoAction": None}

    policy = get_policy()
    active_role = role or DEFAULT_ROLE
    TRIAGE_AUTO_APPROVE_CONFIDENCE = policy["auto_approve_min_confidence"]
    TRIAGE_AUTO_APPROVE_MAX_RISK = policy["auto_approve_max_vendor_risk"]
    TRIAGE_BLOCK_MIN_RISK_SCORE = policy["block_min_vendor_risk"]
    AUTO_APPROVE_AMOUNT_LIMITS = policy["auto_approve_limits"]

    inv_id = invoice.get("id", "")
    confidence = float(invoice.get("confidence") or 0)
    vendor = invoice.get("vendor", "")
    inv_amount = float(invoice.get("amount") or 0)

    # Vendor risk
    vendor_risk = compute_vendor_risk_score(vendor, db)
    risk_score = vendor_risk["score"]
    risk_level = vendor_risk["level"]

    # Filter anomalies for THIS invoice
    has_invoice_ids = any(a.get("invoiceId") for a in anomalies)
    if has_invoice_ids:
        inv_anomalies = [a for a in anomalies
                         if a.get("invoiceId") == inv_id
                         and a.get("status", "open") == "open"
                         and a.get("type") != "EARLY_PAYMENT_DISCOUNT"]
        epd_anomalies = [a for a in anomalies
                         if a.get("invoiceId") == inv_id and a.get("type") == "EARLY_PAYMENT_DISCOUNT"]
    else:
        inv_anomalies = [a for a in anomalies
                         if a.get("status", "open") == "open"
                         and a.get("type") != "EARLY_PAYMENT_DISCOUNT"]
        epd_anomalies = [a for a in anomalies if a.get("type") == "EARLY_PAYMENT_DISCOUNT"]

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
    lane = "REVIEW"

    # ═══ BLOCK LOGIC ═══
    block = False

    # B1: Any HIGH severity anomaly
    if high_anomalies:
        block = True
        types = list(set(a.get("type", "?") for a in high_anomalies))
        reasons.append(f"BLOCK: {len(high_anomalies)} high-severity anomal{'y' if len(high_anomalies)==1 else 'ies'} ({', '.join(t.replace('_',' ') for t in types)})")

    # B2: Over-invoiced PO
    if is_over_invoiced:
        block = True
        reasons.append("BLOCK: PO over-invoiced — cumulative invoices exceed PO amount")

    # B3: Duplicate invoice
    dup_anomalies = [a for a in inv_anomalies if a.get("type") == "DUPLICATE_INVOICE"]
    if dup_anomalies:
        block = True
        reasons.append(f"BLOCK: Potential duplicate invoice detected (confidence: {dup_anomalies[0].get('description', '').split('Confidence: ')[-1] if 'Confidence:' in (dup_anomalies[0].get('description', '')) else 'high'})")

    # B4: High-risk vendor WITH anomalies
    if risk_score >= TRIAGE_BLOCK_MIN_RISK_SCORE and inv_anomalies:
        block = True
        reasons.append(f"BLOCK: High-risk vendor (score: {risk_score:.0f}) with {len(inv_anomalies)} open anomal{'y' if len(inv_anomalies)==1 else 'ies'}")

    # B5: Very low extraction confidence
    if confidence < 60:
        block = True
        reasons.append(f"BLOCK: Low extraction confidence ({confidence:.0f}%) — data unreliable")

    # B6: Risk amount exceeds 20% of invoice
    if inv_amount > 0 and total_risk_amount > inv_amount * 0.20:
        block = True
        risk_pct = (total_risk_amount / inv_amount) * 100
        reasons.append(f"BLOCK: At-risk amount is {risk_pct:.0f}% of invoice total")

    if block:
        lane = "BLOCK"
        auto_action = "on_hold"
        triage_confidence = min(99, 70 + len([r for r in reasons if r.startswith("BLOCK")]) * 8)
    else:
        # ═══ AUTO-APPROVE LOGIC ═══
        approve_conditions = []
        approve_fails = []

        # A1: No anomalies
        if not inv_anomalies:
            approve_conditions.append("No anomalies detected")
        else:
            approve_fails.append(f"{len(inv_anomalies)} anomal{'y' if len(inv_anomalies)==1 else 'ies'} found")

        # A2: High confidence
        if confidence >= TRIAGE_AUTO_APPROVE_CONFIDENCE:
            approve_conditions.append(f"High confidence ({confidence:.0f}%)")
        else:
            approve_fails.append(f"Confidence below threshold ({confidence:.0f}% < {TRIAGE_AUTO_APPROVE_CONFIDENCE:.0f}%)")

        # A3: Low vendor risk
        if risk_score <= TRIAGE_AUTO_APPROVE_MAX_RISK:
            approve_conditions.append(f"Trusted vendor (risk: {risk_score:.0f})")
        else:
            approve_fails.append(f"Vendor risk above threshold ({risk_score:.0f} > {TRIAGE_AUTO_APPROVE_MAX_RISK:.0f})")

        # A4: PO matched
        if invoice.get("poReference"):
            if match and match_score >= 60:
                approve_conditions.append(f"PO matched (score: {match_score})")
            else:
                approve_fails.append("PO reference not matched adequately")
        else:
            approve_fails.append("No PO reference — requires manual authorization")

        # A6: Three-way match
        matching_mode = policy["matching_mode"]
        if matching_mode == "three_way":
            if match and match.get("matchType") == "three_way":
                approve_conditions.append("Goods received (3-way match ✓)")
            else:
                approve_fails.append("No goods receipt — 3-way matching required by policy")
        elif matching_mode == "flexible":
            if match and match.get("matchType") == "three_way":
                approve_conditions.append("Goods received (3-way match)")
            elif match and match.get("grnStatus") == "no_grn":
                unreceipted = [a for a in inv_anomalies if a.get("type") == "UNRECEIPTED_INVOICE"]
                if unreceipted:
                    approve_fails.append("No goods receipt on file — cannot confirm delivery")

        # A5: Delegation of Authority
        inv_currency = invoice.get("currency", "USD")
        role_limit = get_authority_limit(active_role, inv_currency)
        required = get_required_approver(inv_amount, inv_currency)
        role_info = AUTHORITY_MATRIX.get(active_role, AUTHORITY_MATRIX[DEFAULT_ROLE])

        if inv_amount <= role_limit:
            approve_conditions.append(f"Within {role_info['title']} authority ({currency_symbol(inv_currency)}{role_limit:,.0f})")
        else:
            approve_fails.append(f"Exceeds {role_info['title']} limit ({currency_symbol(inv_currency)}{inv_amount:,.0f} > {currency_symbol(inv_currency)}{role_limit:,.0f}) — requires {required['title']} approval")

        if not approve_fails:
            lane = "AUTO_APPROVE"
            auto_action = "approved"
            reasons = [f"APPROVED: {c}" for c in approve_conditions]
            if epd_anomalies:
                reasons.append("NOTE: Early payment discount available")
            triage_confidence = min(99, 80 + len(approve_conditions) * 4)
        else:
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
        "activeRole": active_role,
        "activeRoleTitle": AUTHORITY_MATRIX.get(active_role, AUTHORITY_MATRIX[DEFAULT_ROLE])["title"],
        "requiredApprover": get_required_approver(inv_amount, invoice.get("currency", "USD")),
    }


def store_triage_decision(invoice_id: str, triage: dict, db: dict):
    """Store triage decision for audit trail."""
    decisions = db.setdefault("triage_decisions", [])
    decisions[:] = [d for d in decisions if d.get("invoiceId") != invoice_id]
    decisions.append({
        "id": str(uuid.uuid4())[:8].upper(),
        "invoiceId": invoice_id,
        **triage,
    })


def apply_triage_action(invoice: dict, triage: dict, db: dict, performed_by: str = "System"):
    """Apply triage result: update invoice status and log to activity trail."""
    action = triage.get("autoAction")
    lane = triage.get("lane")
    old_status = invoice.get("status", "unpaid")

    terminal = {"paid", "disputed", "scheduled"}
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

    invoice["triageLane"] = lane
    invoice["triageReasons"] = triage.get("reasons", [])
    invoice["triageConfidence"] = triage.get("confidence", 0)
    invoice["triageAt"] = triage.get("triageAt")
    invoice["vendorRiskScore"] = (triage.get("vendorRisk") or {}).get("score", 0)
    invoice["vendorRiskLevel"] = (triage.get("vendorRisk") or {}).get("level", "unknown")

    db["activity_log"].append({
        "id": str(uuid.uuid4())[:8],
        "action": f"triage_{lane.lower()}",
        "documentId": invoice["id"],
        "documentNumber": invoice.get("invoiceNumber", ""),
        "vendor": invoice.get("vendor", ""),
        "lane": lane,
        "autoAction": action,
        "triageConfidence": triage.get("confidence", 0),
        "vendorRisk": (triage.get("vendorRisk") or {}).get("score", 0),
        "anomalyCount": (triage.get("anomalySummary") or {}).get("total", 0),
        "reasons": triage.get("reasons", [])[:3],
        "timestamp": datetime.now().isoformat(),
        "performedBy": performed_by,
    })
