"""
AuditLens — Matching Engine Module

PO matching (two-way) and GRN matching (three-way).
Deterministic matching using multi-signal scoring.

Matching signals:
  - PO reference exact match (+50)
  - Vendor similarity (+20/+30)
  - Amount proximity (+5/+12/+20)
  - Line item overlap (+10)
  - Budget remaining (+5)
"""

import uuid
from datetime import datetime
from difflib import SequenceMatcher

from backend.vendor import vendor_similarity
from backend.policy import get_policy
from backend.db import _n


def get_po_fulfillment(po_id, matches, invoices):
    """Calculate how much of a PO has already been invoiced."""
    inv_ids = [m["invoiceId"] for m in matches if m.get("poId") == po_id]
    return sum(i.get("subtotal", i["amount"]) for i in invoices if i["id"] in inv_ids), len(inv_ids)


def match_invoice_to_po(invoice, purchase_orders, existing_matches, all_invoices):
    """Match a single invoice to the best PO using multi-signal scoring.

    Scoring signals (max 100):
      +50  PO reference exact match
      +30  Vendor exact / +20 partial
      +20  Amount near-exact (<2%) / +12 close (<10%) / +5 approximate (<25%)
      +10  Line item overlap >50%
      +5   Within PO remaining budget

    Variance penalties (applied AFTER signals):
      -10  Variance > amount_tolerance_pct (default 2%)
      -15  Variance > 10%
      -25  Variance > 25%
      -10  Absolute variance > match_tolerance_abs (default $500)

    Auto-match downgrade to review_needed if:
      - Per-invoice variance exceeds tolerance (pct OR absolute)
      - Cumulative invoicing exceeds PO value
      - Duplicate invoice number already matched to same PO
    """
    policy = get_policy()
    OVER_INVOICE_PCT = policy["over_invoice_pct"]
    AMOUNT_TOL_PCT = policy.get("amount_tolerance_pct", 2)
    AMOUNT_TOL_ABS = policy.get("match_tolerance_abs", 500)
    best, best_score = None, 0
    inv_subtotal = _n(invoice.get("subtotal") or invoice.get("amount"))
    inv_number = invoice.get("invoiceNumber", "")

    for po in purchase_orders:
        score, signals, review_reasons = 0, [], []

        # ── Signal 1: PO reference exact match (+50) ──
        if invoice.get("poReference") and invoice["poReference"] == po.get("poNumber"):
            score += 50; signals.append("po_reference_exact")

        # ── Signal 2: Vendor similarity (+20/+30) ──
        # In AP, exact vendor match is very strong evidence — many invoices lack PO references
        vs = vendor_similarity(invoice.get("vendor"), po.get("vendor"))
        if vs >= 0.95: score += 30; signals.append("vendor_exact")
        elif vs >= 0.7: score += 20; signals.append("vendor_partial")

        # ── Signal 3: Amount proximity (+5/+12/+20) ──
        pa = _n(po.get("amount"))
        already, cnt = get_po_fulfillment(po["id"], existing_matches, all_invoices)
        remaining = pa - already

        variance_abs = 0
        variance_pct = 0
        if inv_subtotal > 0 and pa > 0:
            target = remaining if remaining > 0 else pa
            variance_abs = abs(inv_subtotal - target)
            variance_pct = (variance_abs / max(inv_subtotal, target)) * 100
            dp = variance_pct / 100  # as fraction

            if dp < 0.02: score += 20; signals.append("amount_near_exact")
            elif dp < 0.10: score += 12; signals.append("amount_close")
            elif dp < 0.25: score += 5; signals.append("amount_approximate")
            else: signals.append("amount_mismatch")

            if remaining > 0 and inv_subtotal <= remaining * 1.1:
                score += 5; signals.append("within_po_budget")

        # ── Signal 4: Line item overlap (+10) ──
        inv_set = set(((li.get("description") or "")).lower() for li in invoice.get("lineItems", []))
        po_set = set(((li.get("description") or "")).lower() for li in po.get("lineItems", []))
        if inv_set and po_set:
            if len(inv_set & po_set) / max(len(inv_set), len(po_set)) > 0.5:
                score += 10; signals.append("line_items_overlap")

        # ── Variance penalties (reduce score for large discrepancies) ──
        # Cap total penalties so structural matches still appear as review items
        penalty = 0
        if variance_pct > AMOUNT_TOL_PCT:
            penalty += 10; signals.append("variance_exceeds_pct_tolerance")
            review_reasons.append(f"Variance {variance_pct:.1f}% exceeds {AMOUNT_TOL_PCT}% tolerance")
        if variance_pct > 10:
            penalty += 10; signals.append("variance_over_10pct")
        if variance_pct > 25:
            penalty += 10; signals.append("variance_over_25pct")
        if variance_abs > AMOUNT_TOL_ABS:
            penalty += 5; signals.append("variance_exceeds_abs_tolerance")
            review_reasons.append(f"Variance ${variance_abs:,.2f} exceeds ${AMOUNT_TOL_ABS:,.0f} threshold")
        # Cap penalty at 25 — structural evidence (PO ref, vendor) should not be fully negated
        penalty = min(penalty, 25)

        # ── Pre-penalty score: used for match IDENTIFICATION (is this the right PO?) ──
        # ── Post-penalty score: used for CONFIDENCE display and status determination ──
        pre_penalty_score = max(0, min(100, score))
        ns = max(0, min(100, score - penalty))

        # ── Over-invoicing check (cumulative) ──
        over = (already + inv_subtotal) > pa * (1 + OVER_INVOICE_PCT / 100) if pa > 0 else False
        exceeds_po = (already + inv_subtotal) > pa * 1.005 if pa > 0 else False

        # ── Duplicate detection: same invoice number already matched to this PO ──
        is_dup = any(
            m.get("invoiceNumber") == inv_number and m.get("poId") == po["id"]
            for m in existing_matches
        ) if inv_number else False

        # ── Status determination ──
        match_status = "auto_matched" if ns >= 75 else "review_needed"

        # Downgrade to review_needed if ANY tolerance is breached
        if variance_pct > AMOUNT_TOL_PCT or variance_abs > AMOUNT_TOL_ABS:
            match_status = "review_needed"
            if "tolerance_breach" not in signals:
                signals.append("tolerance_breach")
        if over or exceeds_po:
            match_status = "review_needed"
            review_reasons.append("Cumulative invoicing exceeds PO value")
        if is_dup:
            match_status = "review_needed"
            signals.append("duplicate_invoice_on_po")
            review_reasons.append("Duplicate invoice number already matched to this PO")

        if pre_penalty_score > best_score and pre_penalty_score >= 40:
            best_score = pre_penalty_score
            best = {"poId": po["id"], "poNumber": po["poNumber"], "poAmount": pa,
                "matchScore": ns, "signals": signals,
                "amountDifference": round(variance_abs, 2),
                "variancePct": round(variance_pct, 1),
                "status": match_status,
                "reviewReasons": review_reasons,
                "poAlreadyInvoiced": round(already, 2), "poRemaining": round(remaining, 2),
                "poInvoiceCount": cnt, "overInvoiced": over, "isDuplicate": is_dup}
    return best


def get_grn_for_po(po_id: str, goods_receipts: list, purchase_orders: list = None) -> dict:
    """Find GRN(s) linked to a PO and compute three-way match status."""
    po_identifiers = {po_id}
    if purchase_orders:
        for po in purchase_orders:
            if po["id"] == po_id:
                pn = po.get("poNumber", "")
                if pn:
                    po_identifiers.add(pn)
                break

    linked_grns = []
    for grn in goods_receipts:
        grn_ref = grn.get("poReference", "")
        if grn_ref and grn_ref in po_identifiers:
            linked_grns.append(grn)

    if not linked_grns:
        return {
            "matchType": "two_way", "grnStatus": "no_grn",
            "grnIds": [], "grnNumbers": [],
            "totalReceived": 0, "grnLineItems": [],
        }

    total_received = sum(grn.get("amount", 0) or grn.get("subtotal", 0) or 0 for grn in linked_grns)
    grn_line_items = []
    for grn in linked_grns:
        for li in grn.get("lineItems", []):
            grn_line_items.append({
                "description": li.get("description", ""),
                "quantityReceived": li.get("quantity", 0),
                "grnNumber": grn.get("grnNumber", grn.get("id", "?")),
                "receivedDate": grn.get("receivedDate", grn.get("issueDate")),
            })

    return {
        "matchType": "three_way", "grnStatus": "received",
        "grnIds": [g["id"] for g in linked_grns],
        "grnNumbers": [g.get("grnNumber", g["id"]) for g in linked_grns],
        "totalReceived": round(total_received, 2),
        "grnLineItems": grn_line_items,
        "receivedDate": linked_grns[-1].get("receivedDate") or linked_grns[-1].get("issueDate"),
    }


def run_grn_matching(db):
    """Update existing matches with GRN data for three-way matching."""
    updated = 0
    grns = db.get("goods_receipts", [])
    if not grns:
        return 0

    for match in db["matches"]:
        if match.get("matchType") == "three_way":
            continue
        po_id = match.get("poId")
        if not po_id:
            continue
        grn_info = get_grn_for_po(po_id, grns, db.get("purchase_orders", []))
        if grn_info["matchType"] == "three_way":
            match.update(grn_info)
            updated += 1

    return updated


def run_matching(db):
    """Match all unmatched invoices to POs. Returns list of new matches."""
    matched_ids = {m["invoiceId"] for m in db["matches"]}
    unmatched = [i for i in db["invoices"] if i["id"] not in matched_ids]
    new = []
    for inv in unmatched:
        r = match_invoice_to_po(inv, db["purchase_orders"], db["matches"] + new, db["invoices"])
        if r:
            grn_info = get_grn_for_po(r["poId"], db.get("goods_receipts", []), db["purchase_orders"])
            r.update(grn_info)
            new.append({"id": str(uuid.uuid4())[:8].upper(), "invoiceId": inv["id"],
                "invoiceNumber": inv.get("invoiceNumber", ""), "invoiceAmount": inv["amount"],
                "invoiceSubtotal": inv.get("subtotal", inv["amount"]),
                "vendor": inv["vendor"], "matchedAt": datetime.now().isoformat(), **r})
    return new
