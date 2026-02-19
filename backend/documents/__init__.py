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
           "englishDescription": l.get("english_description") or l.get("description") or "?",
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

    # Load policy for ensemble agreement config
    from backend.db import get_db as _get_db
    from backend.config import DEFAULT_POLICY
    _policy_db = _get_db()
    policy = _policy_db.get("policy", {})

    base = {
        "id": file_id, "type": dt, "documentName": file_name,
        "vendor": extracted.get("vendor_name") or "Unknown",
        "vendorNormalized": normalize_vendor(extracted.get("vendor_name") or ""),
        "vendorEnglish": extracted.get("vendor_name_english") or extracted.get("vendor_name") or "Unknown",
        "amount": total, "subtotal": subtotal,
        "taxDetails": tax_details,
        "totalTax": sum(t["amount"] for t in tax_details),
        "issueDate": extracted.get("issue_date"),
        "status": "pending", "lineItems": li,
        "confidence": confidence, "confidenceFactors": confidence_factors,
        "extractionSource": extracted.get("_source", "unknown"),
        "extractedAt": datetime.now().isoformat(),
        "currency": extracted.get("currency") or "USD",
        "locale": extracted.get("_detected_locale") or extracted.get("locale") or "en_US",
        "documentLanguage": extracted.get("document_language") or "en",
        "paymentTerms": extracted.get("payment_terms"),
        "notes": extracted.get("notes"),
        "earlyPaymentDiscount": extracted.get("early_payment_discount"),
        "uploadedFile": f"{file_id}_{file_name}",
        "uploadedBy": None, "uploadedByEmail": None,
    }

    # Store ensemble metadata if available
    if extracted.get("_ensemble"):
        base["ensembleData"] = extracted["_ensemble"]
        # Factor 8: Ensemble Agreement — penalize confidence when models disagree
        ens = extracted["_ensemble"]
        agreement_rate = ens.get("agreement_rate", 100)
        disputes = ens.get("fields_disputed", 0)
        if ens.get("mode") != "single_model" and agreement_rate < 100:
            # Read configurable weight and caps from policy
            from backend.config import DEFAULT_POLICY
            ens_weight = policy.get("ensemble_agreement_weight",
                DEFAULT_POLICY.get("ensemble_agreement_weight", 0.15))
            cap_80 = policy.get("ensemble_cap_80", DEFAULT_POLICY.get("ensemble_cap_80", 85))
            cap_60 = policy.get("ensemble_cap_60", DEFAULT_POLICY.get("ensemble_cap_60", 70))

            ens_score = round(agreement_rate)
            ens_detail = f"{ens.get('fields_agreed', 0)} agreed, {disputes} disputed ({agreement_rate}%)"
            confidence_factors["ensemble_agreement"] = {
                "score": ens_score, "weight": ens_weight, "detail": ens_detail
            }
            # Rebalance weights: reduce others proportionally to add ensemble weight
            non_ensemble = {k: v for k, v in confidence_factors.items() if k != "ensemble_agreement"}
            original_total = sum(v["weight"] for v in non_ensemble.values())
            for k in non_ensemble:
                confidence_factors[k]["weight"] = round(
                    confidence_factors[k]["weight"] * (1.0 - ens_weight) / original_total, 3)
            # Recompute weighted score
            weighted_sum = sum(f["score"] * f["weight"] for f in confidence_factors.values())
            confidence = round(max(0, min(100, weighted_sum)), 1)
            # Hard caps from policy
            if agreement_rate < 80:
                confidence = min(confidence, cap_80)
            if agreement_rate < 60:
                confidence = min(confidence, cap_60)
            base["confidence"] = confidence
            base["confidenceFactors"] = confidence_factors
    if extracted.get("_field_confidence"):
        base["fieldConfidence"] = extracted["_field_confidence"]

    if dt == "invoice":
        base.update({"status": "unpaid",
            "invoiceNumber": extracted.get("document_number", f"INV-{file_id}"),
            "poReference": extracted.get("po_reference"),
            "dueDate": extracted.get("due_date"),
            "billTo": extracted.get("bill_to"),
            "shipTo": extracted.get("ship_to"),
        })
    elif dt == "purchase_order":
        base.update({"status": "open",
            "poNumber": extracted.get("document_number", f"PO-{file_id}"),
            "deliveryDate": extracted.get("delivery_date"),
            "shipTo": extracted.get("ship_to"),
            "billTo": extracted.get("bill_to"),
            "buyerName": extracted.get("buyer_name"),
            "buyerContact": extracted.get("buyer_contact"),
            "incoterms": extracted.get("incoterms"),
            "shippingMethod": extracted.get("shipping_method"),
        })
    elif dt == "contract":
        ct = extracted.get("contract_terms") or {}
        base.update({"status": "active",
            "contractNumber": extracted.get("document_number", f"AGR-{file_id}"),
            "pricingTerms": extracted.get("pricing_terms") or [],
            "contractTerms": ct,
            "parties": extracted.get("parties", []),
            # Flatten contract dates to top-level for UI access
            "effectiveDate": ct.get("effective_date") or extracted.get("issue_date"),
            "endDate": ct.get("expiry_date"),
            "signingDate": ct.get("signing_date") or extracted.get("issue_date"),
            "termMonths": ct.get("term_months"),
            # Key contract metadata
            "governingLaw": ct.get("governing_law"),
            "autoRenewal": ct.get("auto_renewal", False),
            "renewalNoticeDays": ct.get("renewal_notice_days"),
            "terminationNoticeDays": ct.get("termination_notice_days"),
            "liabilityCap": ct.get("liability_cap"),
            "liabilityCapDescription": ct.get("liability_cap_description"),
            "warrantyMonths": ct.get("warranty_months"),
            "confidentialityYears": ct.get("confidentiality_years"),
            # Clause summaries
            "slaSummary": ct.get("sla_summary"),
            "penaltyClauses": ct.get("penalty_clauses"),
            "ipOwnership": ct.get("ip_ownership"),
            "insuranceRequirements": ct.get("insurance_requirements"),
            "forceMajeureDays": ct.get("force_majeure_days"),
            "terminationForConvenience": ct.get("termination_for_convenience"),
        })
    elif dt in ("credit_note", "debit_note"):
        base.update({"status": "pending",
            "documentNumber": extracted.get("document_number",
                f"{'CN' if dt == 'credit_note' else 'DN'}-{file_id}"),
            "originalInvoiceRef": extracted.get("original_invoice_ref"),
            "creditDebitReason": extracted.get("credit_debit_reason"),
            "adjustmentType": extracted.get("adjustment_type"),
        })
    elif dt == "goods_receipt":
        base.update({"status": "received",
            "grnNumber": extracted.get("document_number", f"GRN-{file_id}"),
            "poReference": extracted.get("po_reference"),
            "receivedDate": extracted.get("received_date") or extracted.get("issue_date"),
            "receivedBy": extracted.get("received_by"),
            "conditionNotes": extracted.get("condition_notes"),
            "shipFrom": extracted.get("ship_from"),
            "warehouseLocation": extracted.get("warehouse_location"),
        })
    return base


def compute_extraction_confidence(extracted: dict, line_items: list, subtotal: float,
                                   total: float, tax_details: list, doc_type: str) -> tuple:
    """Multi-factor extraction confidence scoring (0-100).
    Weights are document-type-specific and admin-configurable via AP Policy.
    Each doc type has different F&A risk profiles:
      Invoice:     Math accuracy paramount — wrong amount = overpayment
      PO:          Field completeness paramount — missing ship-to/terms = procurement failure
      Contract:    Date accuracy paramount — wrong effective date = multi-year legal exposure
      Credit/Debit: Reference integrity paramount — wrong original invoice = fraud risk
      GRN:         Line item integrity paramount — wrong qty received = 3-way match failure
    Returns (score, factors_dict) for auditability."""

    # ── Load weight profile from policy (admin-configurable) ──
    from backend.db import get_db
    from backend.config import DEFAULT_POLICY
    db = get_db()
    policy = db.get("policy", {})
    configured_weights = policy.get("confidence_weights", DEFAULT_POLICY.get("confidence_weights", {}))

    FALLBACK = [0.15, 0.20, 0.25, 0.10, 0.15, 0.10, 0.05]  # invoice default
    weight_list = configured_weights.get(doc_type, configured_weights.get("invoice", FALLBACK))

    # Validate: must be 7 values summing to ~1.0
    if len(weight_list) != 7 or abs(sum(weight_list) - 1.0) > 0.05:
        weight_list = FALLBACK  # fallback to safe defaults
    w = tuple(weight_list)
    factors = {}

    # ── Factor 1: Field Completeness ──
    required_common = ["vendor_name", "document_number", "document_type", "total_amount", "currency"]
    required_by_type = {
        "invoice": ["issue_date", "due_date", "po_reference", "payment_terms"],
        "purchase_order": ["issue_date", "delivery_date", "ship_to", "payment_terms"],
        "contract": ["contract_terms", "parties"],
        "credit_note": ["original_invoice_ref", "credit_debit_reason"],
        "debit_note": ["original_invoice_ref", "credit_debit_reason"],
        "goods_receipt": ["po_reference", "received_date", "received_by"],
    }
    fields_to_check = required_common + required_by_type.get(doc_type, [])
    present = sum(1 for f in fields_to_check if extracted.get(f) not in (None, "", [], {}, 0))
    completeness_score = round((present / len(fields_to_check)) * 100) if fields_to_check else 50
    factors["field_completeness"] = {
        "score": completeness_score, "weight": w[0],
        "detail": f"{present}/{len(fields_to_check)} required fields present"
    }

    # ── Factor 2: Line Item Integrity ──
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
        # No line items: less penalty for contracts (often lack itemized tables)
        li_score = 50 if doc_type == "contract" else 40
        li_detail = "No line items extracted"
    factors["line_item_integrity"] = {"score": li_score, "weight": w[1], "detail": li_detail}

    # ── Factor 3: Mathematical Consistency ──
    math_score = 100
    math_issues = []
    # Contracts and GRNs often lack strict math — be lenient
    if doc_type in ("contract", "goods_receipt"):
        math_score = 100
        math_detail = "N/A for this document type"
    else:
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
        math_detail = "; ".join(math_issues) if math_issues else "All totals consistent"
    factors["math_consistency"] = {"score": math_score, "weight": w[2], "detail": math_detail}

    # ── Factor 4: Date Validity ──
    date_score = 100
    date_issues = []
    if doc_type == "contract":
        # Contracts: check effective, expiry, and signing dates
        ct = extracted.get("contract_terms") or {}
        date_fields_vals = [ct.get("effective_date"), ct.get("expiry_date"), ct.get("signing_date")]
        # Extra check: effective_date should be before expiry_date
        eff = ct.get("effective_date")
        exp = ct.get("expiry_date")
        if eff and exp:
            try:
                eff_d = datetime.fromisoformat(str(eff))
                exp_d = datetime.fromisoformat(str(exp))
                if eff_d >= exp_d:
                    date_score -= 30
                    date_issues.append(f"Effective date ({eff}) is after expiry ({exp})")
            except (ValueError, TypeError):
                pass
    elif doc_type == "goods_receipt":
        date_fields_vals = [extracted.get("received_date"), extracted.get("issue_date")]
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
        "score": date_score, "weight": w[3],
        "detail": "; ".join(date_issues) if date_issues else "Dates valid"
    }

    # ── Factor 5: Amount Plausibility ──
    amt_score = 100
    amt_issues = []
    if total <= 0 and doc_type in ("invoice", "purchase_order"):
        amt_score = 20
        amt_issues.append(f"Total amount is {total} — expected positive")
    elif total <= 0 and doc_type in ("credit_note", "debit_note"):
        # Credit/debit notes CAN be zero (full void) but flag it
        amt_score = 60
        amt_issues.append(f"Zero adjustment amount")
    elif total > 100_000_000:
        amt_score = 50
        amt_issues.append(f"Unusually large amount: {total:,.2f}")

    neg_prices = [li for li in line_items if (li.get("unitPrice") or 0) < 0]
    if neg_prices and doc_type not in ("credit_note", "debit_note"):
        amt_score -= 25
        amt_issues.append(f"{len(neg_prices)} line items with negative unit prices")

    amt_score = max(0, amt_score)
    factors["amount_plausibility"] = {
        "score": amt_score, "weight": w[4],
        "detail": "; ".join(amt_issues) if amt_issues else "Amounts plausible"
    }

    # ── Factor 6: Vendor Identification ──
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
    factors["vendor_identification"] = {"score": vendor_score, "weight": w[5], "detail": vendor_detail}

    # ── Factor 7: AI Self-Assessment ──
    ai_conf = extracted.get("_confidence") or extracted.get("extraction_confidence") or 85
    ai_conf = float(ai_conf) if ai_conf is not None else 85
    factors["ai_self_assessment"] = {
        "score": round(float(ai_conf)), "weight": w[6],
        "detail": f"AI model self-reported: {ai_conf}%"
    }

    # ── Weighted composite ──
    weighted_sum = sum(f["score"] * f["weight"] for f in factors.values())
    final_score = round(max(0, min(100, weighted_sum)), 1)

    # ── Critical field penalties ──
    if not vendor or vendor.lower() in ("unknown", "n/a"):
        final_score = min(final_score, 55)
    if total <= 0 and doc_type in ("invoice", "purchase_order"):
        final_score = min(final_score, 50)
    # Credit/debit without original invoice ref is high-risk
    if doc_type in ("credit_note", "debit_note"):
        if not extracted.get("original_invoice_ref"):
            final_score = min(final_score, 65)

    return final_score, factors
