"""
AuditLens — Documents Module

Record transformation (raw extraction → structured DB record) and
multi-factor extraction confidence scoring.

Confidence factors (7 signals, weighted):
  1. Field completeness (25%) — required fields present
  2. Line item integrity (20%) — valid descriptions, quantities, prices
  3. Mathematical consistency (20%) — totals add up
  4. Date validity (10%) — parseable, reasonable dates
  5. Amount plausibility (10%) — not negative, not absurdly large
  6. Vendor identification (10%) — meaningful vendor name
  7. AI self-assessment (5%) — model's own confidence
"""

from datetime import datetime
from backend.vendor import normalize_vendor


def transform_extracted_to_record(extracted, file_name, file_id):
    """Transform raw Claude extraction output into a structured database record."""
    dt = extracted.get("document_type", "invoice")
    li = [{"description": l.get("description") or "?",
           "quantity": float(l.get("quantity") or 0),
           "unitPrice": float(l.get("unit_price") or l.get("unitPrice") or 0),
           "total": float(l.get("total") or 0)
          } for l in (extracted.get("line_items") or [])]

    subtotal = extracted.get("subtotal") or extracted.get("total_amount") or 0
    subtotal = float(subtotal) if subtotal is not None else 0
    total = extracted.get("total_amount") or subtotal or 0
    total = float(total) if total is not None else 0

    tax_details = []
    for t in extracted.get("tax_details", []) or []:
        tax_details.append({"type": t.get("type", "Tax"),
                           "rate": float(t.get("rate") or 0),
                           "amount": float(t.get("amount") or 0)})

    confidence, confidence_factors = compute_extraction_confidence(
        extracted, li, subtotal, total, tax_details, dt)

    base = {
        "id": file_id, "type": dt, "documentName": file_name,
        "vendor": extracted.get("vendor_name") or "Unknown",
        "vendorNormalized": normalize_vendor(extracted.get("vendor_name") or ""),
        "amount": total, "subtotal": subtotal,
        "taxDetails": tax_details,
        "totalTax": sum(t["amount"] for t in tax_details),
        "issueDate": extracted.get("issue_date"),
        "status": "pending", "lineItems": li,
        "confidence": confidence, "confidenceFactors": confidence_factors,
        "extractionSource": extracted.get("_source", "unknown"),
        "extractedAt": datetime.now().isoformat(),
        "currency": extracted.get("currency") or "USD",
        "paymentTerms": extracted.get("payment_terms"),
        "notes": extracted.get("notes"),
        "earlyPaymentDiscount": extracted.get("early_payment_discount"),
        "uploadedFile": f"{file_id}_{file_name}",
        "uploadedBy": None, "uploadedByEmail": None,
    }

    # Store ensemble metadata if available
    if extracted.get("_ensemble"):
        base["ensembleData"] = extracted["_ensemble"]
    if extracted.get("_field_confidence"):
        base["fieldConfidence"] = extracted["_field_confidence"]

    if dt == "invoice":
        base.update({"status": "unpaid",
            "invoiceNumber": extracted.get("document_number", f"INV-{file_id}"),
            "poReference": extracted.get("po_reference"),
            "dueDate": extracted.get("due_date")})
    elif dt == "purchase_order":
        base.update({"status": "open",
            "poNumber": extracted.get("document_number", f"PO-{file_id}"),
            "deliveryDate": extracted.get("delivery_date")})
    elif dt == "contract":
        base.update({"status": "active",
            "contractNumber": extracted.get("document_number", f"AGR-{file_id}"),
            "pricingTerms": extracted.get("pricing_terms") or [],
            "contractTerms": extracted.get("contract_terms") or {},
            "parties": extracted.get("parties", [])})
    elif dt in ("credit_note", "debit_note"):
        base.update({"status": "pending",
            "documentNumber": extracted.get("document_number",
                f"{'CN' if dt == 'credit_note' else 'DN'}-{file_id}"),
            "originalInvoiceRef": extracted.get("original_invoice_ref")})
    elif dt == "goods_receipt":
        base.update({"status": "received",
            "grnNumber": extracted.get("document_number", f"GRN-{file_id}"),
            "poReference": extracted.get("po_reference"),
            "receivedDate": extracted.get("received_date") or extracted.get("issue_date"),
            "receivedBy": extracted.get("received_by"),
            "conditionNotes": extracted.get("condition_notes")})
    return base


def compute_extraction_confidence(extracted: dict, line_items: list, subtotal: float,
                                   total: float, tax_details: list, doc_type: str) -> tuple:
    """Multi-factor extraction confidence scoring (0-100).
    Returns (score, factors_dict) for auditability."""
    factors = {}

    # Factor 1: Field Completeness (25%)
    required_common = ["vendor_name", "document_number", "document_type", "total_amount", "currency"]
    required_invoice = ["issue_date", "due_date", "po_reference"]
    required_contract = ["contract_terms", "pricing_terms"]
    required_po = ["issue_date"]

    fields_to_check = list(required_common)
    if doc_type == "invoice":
        fields_to_check += required_invoice
    elif doc_type == "contract":
        fields_to_check += required_contract
    elif doc_type == "purchase_order":
        fields_to_check += required_po

    present = sum(1 for f in fields_to_check if extracted.get(f) not in (None, "", [], {}, 0))
    completeness_score = round((present / len(fields_to_check)) * 100) if fields_to_check else 50
    factors["field_completeness"] = {
        "score": completeness_score, "weight": 0.25,
        "detail": f"{present}/{len(fields_to_check)} required fields present"
    }

    # Factor 2: Line Item Integrity (20%)
    if line_items:
        valid_items = 0
        for li in line_items:
            desc_ok = bool(li.get("description") and li["description"] != "?")
            qty_ok = isinstance(li.get("quantity"), (int, float)) and li["quantity"] > 0
            price_ok = isinstance(li.get("unitPrice"), (int, float)) and li["unitPrice"] > 0
            total_ok = isinstance(li.get("total"), (int, float)) and li["total"] > 0
            if desc_ok and qty_ok and price_ok and total_ok:
                valid_items += 1
            elif desc_ok and total_ok:
                valid_items += 0.5
        li_score = round((valid_items / len(line_items)) * 100)
        li_detail = f"{valid_items}/{len(line_items)} line items fully valid"
    else:
        li_score = 30 if doc_type == "contract" else 40
        li_detail = "No line items extracted"
    factors["line_item_integrity"] = {"score": li_score, "weight": 0.20, "detail": li_detail}

    # Factor 3: Mathematical Consistency (20%)
    math_score = 100
    math_issues = []

    if line_items:
        li_sum = sum(li.get("total", 0) for li in line_items)
        if li_sum > 0 and subtotal > 0:
            li_diff_pct = abs(li_sum - subtotal) / max(subtotal, 1) * 100
            if li_diff_pct > 5:
                math_score -= 40
                math_issues.append(f"Line items sum ({li_sum:,.2f}) differs from subtotal ({subtotal:,.2f}) by {li_diff_pct:.1f}%")
            elif li_diff_pct > 1:
                math_score -= 15
                math_issues.append(f"Minor rounding diff: {li_diff_pct:.1f}%")

    if tax_details and subtotal > 0 and total > 0:
        expected_total = subtotal + sum(t["amount"] for t in tax_details)
        total_diff_pct = abs(expected_total - total) / max(total, 1) * 100
        if total_diff_pct > 5:
            math_score -= 40
            math_issues.append(f"subtotal + tax ({expected_total:,.2f}) differs from total ({total:,.2f})")
        elif total_diff_pct > 1:
            math_score -= 10

    math_score = max(0, math_score)
    factors["math_consistency"] = {
        "score": math_score, "weight": 0.20,
        "detail": "; ".join(math_issues) if math_issues else "All totals consistent"
    }

    # Factor 4: Date Validity (10%)
    date_score = 100
    date_issues = []
    if doc_type == "contract":
        ct = extracted.get("contract_terms") or {}
        date_fields_vals = [ct.get("effective_date"), ct.get("expiry_date")]
    else:
        date_fields_vals = [extracted.get("issue_date"), extracted.get("due_date")]

    for dval in date_fields_vals:
        if dval:
            try:
                d = datetime.fromisoformat(str(dval).replace("Z", "+00:00"))
                if d.year < 2020 or d.year > 2030:
                    date_score -= 20
                    date_issues.append(f"Suspicious date: {dval}")
            except (ValueError, TypeError):
                date_score -= 30
                date_issues.append(f"Unparseable date: {dval}")

    date_score = max(0, date_score)
    factors["date_validity"] = {
        "score": date_score, "weight": 0.10,
        "detail": "; ".join(date_issues) if date_issues else "Dates valid"
    }

    # Factor 5: Amount Plausibility (10%)
    amt_score = 100
    amt_issues = []
    if total <= 0 and doc_type in ("invoice", "purchase_order"):
        amt_score = 20
        amt_issues.append(f"Total amount is {total} — expected positive")
    elif total > 100_000_000:
        amt_score = 50
        amt_issues.append(f"Unusually large amount: {total:,.2f}")

    neg_prices = [li for li in line_items if (li.get("unitPrice") or 0) < 0]
    if neg_prices:
        amt_score -= 25
        amt_issues.append(f"{len(neg_prices)} line items with negative unit prices")

    amt_score = max(0, amt_score)
    factors["amount_plausibility"] = {
        "score": amt_score, "weight": 0.10,
        "detail": "; ".join(amt_issues) if amt_issues else "Amounts plausible"
    }

    # Factor 6: Vendor Identification (10%)
    vendor = extracted.get("vendor_name", "")
    if not vendor or vendor.lower() in ("unknown", "n/a", "none", ""):
        vendor_score = 10
        vendor_detail = "Vendor name missing or unknown"
    elif len(vendor) < 3 or vendor.replace(" ", "").isdigit():
        vendor_score = 40
        vendor_detail = f"Vendor name appears invalid: '{vendor}'"
    else:
        vendor_score = 100
        vendor_detail = f"Vendor identified: {vendor}"
    factors["vendor_identification"] = {"score": vendor_score, "weight": 0.10, "detail": vendor_detail}

    # Factor 7: AI Self-Assessment (5%)
    ai_conf = extracted.get("_confidence") or extracted.get("extraction_confidence") or 85
    ai_conf = float(ai_conf) if ai_conf is not None else 85
    factors["ai_self_assessment"] = {
        "score": round(float(ai_conf)), "weight": 0.05,
        "detail": f"AI model self-reported: {ai_conf}%"
    }

    # Weighted composite
    weighted_sum = sum(f["score"] * f["weight"] for f in factors.values())
    final_score = round(max(0, min(100, weighted_sum)), 1)

    # Critical field penalty
    if not vendor or vendor.lower() in ("unknown", "n/a"):
        final_score = min(final_score, 55)
    if total <= 0 and doc_type in ("invoice", "purchase_order"):
        final_score = min(final_score, 50)

    return final_score, factors
