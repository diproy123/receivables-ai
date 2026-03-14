#!/usr/bin/env python3
"""
AuditLens — Rich Demo Data Generator
Generates 50+ invoices, 15+ POs, contracts, GRNs, matches, anomalies,
cases, triage decisions, correction patterns, and user accounts.
Designed to showcase every product capability in investor demos.
"""
import json, uuid, random, os
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)  # Reproducible demos

def uid(): return str(uuid.uuid4())[:8].upper()
def ts(d): return d.isoformat()
now = datetime(2026, 3, 10, 14, 30, 0)

# ═══════════════════════════════════════
# VENDORS — 8 vendors with distinct profiles
# ═══════════════════════════════════════
VENDORS = [
    {"name": "GoldPak Industries Ltd.", "risk": "high", "profile": "over-invoicer", "currency": "USD"},
    {"name": "Legacy Systems Corp", "risk": "medium", "profile": "contract-violator", "currency": "USD"},
    {"name": "QuickServ Facilities", "risk": "low", "profile": "clean", "currency": "USD"},
    {"name": "NovaTech Solutions Inc", "risk": "high", "profile": "duplicate-sender", "currency": "USD"},
    {"name": "Pacific Rim Logistics", "risk": "medium", "profile": "weekend-invoicer", "currency": "USD"},
    {"name": "Meridian Consulting Group", "risk": "low", "profile": "early-pay-eligible", "currency": "USD"},
    {"name": "Atlas Raw Materials Co", "risk": "high", "profile": "price-escalator", "currency": "USD"},
    {"name": "Horizon Digital Services", "risk": "medium", "profile": "stale-invoicer", "currency": "USD"},
]

# ═══════════════════════════════════════
# USERS
# ═══════════════════════════════════════
users = [
    {"id": uid(), "email": "cfo@auditlens.demo", "name": "Dip CFO", "role": "cfo", "status": "active", "assignedVendors": [], "createdAt": ts(now - timedelta(days=90))},
    {"id": uid(), "email": "vp@auditlens.demo", "name": "Sarah VP", "role": "vp", "status": "active", "assignedVendors": [], "createdAt": ts(now - timedelta(days=90))},
    {"id": uid(), "email": "mgr@auditlens.demo", "name": "Mike Manager", "role": "manager", "status": "active", "assignedVendors": [], "createdAt": ts(now - timedelta(days=60))},
    {"id": uid(), "email": "analyst1@auditlens.demo", "name": "Priya Analyst", "role": "analyst", "status": "active",
     "assignedVendors": ["GoldPak Industries Ltd.", "Legacy Systems Corp", "Atlas Raw Materials Co", "Pacific Rim Logistics"],
     "createdAt": ts(now - timedelta(days=60))},
    {"id": uid(), "email": "analyst2@auditlens.demo", "name": "James Analyst", "role": "analyst", "status": "active",
     "assignedVendors": ["QuickServ Facilities", "NovaTech Solutions Inc", "Meridian Consulting Group", "Horizon Digital Services"],
     "createdAt": ts(now - timedelta(days=45))},
]

# ═══════════════════════════════════════
# CONTRACTS
# ═══════════════════════════════════════
contracts = [
    {"id": uid(), "type": "contract", "contractNumber": "SVC-2023-010", "vendor": "Legacy Systems Corp",
     "amount": 120000, "currency": "USD", "startDate": "2023-01-01", "endDate": "2025-06-30",
     "issueDate": "2023-01-01", "status": "active", "extractedAt": ts(now - timedelta(days=400)),
     "autoRenewal": True, "terminationNoticeDays": 90, "paymentTerms": "Net 30",
     "lineItems": [{"description": "Legacy system maintenance", "unitPrice": 10000, "quantity": 12, "total": 120000}],
     "clauses": {"liability_cap": True, "termination_notice": "90 days", "auto_renewal": True,
                 "sla_terms": "99.5% uptime", "penalty_clauses": True, "force_majeure": True,
                 "confidentiality": True, "ip_ownership": False, "indemnification": False}},
    {"id": uid(), "type": "contract", "contractNumber": "MNT-2024-020", "vendor": "QuickServ Facilities",
     "amount": 80000, "currency": "USD", "startDate": "2024-01-01", "endDate": "2025-12-31",
     "issueDate": "2024-01-01", "status": "active", "extractedAt": ts(now - timedelta(days=300)),
     "autoRenewal": False, "terminationNoticeDays": 60, "paymentTerms": "Net 45",
     "lineItems": [{"description": "Facility maintenance", "unitPrice": 6667, "quantity": 12, "total": 80000}],
     "clauses": {"liability_cap": True, "termination_notice": "60 days", "auto_renewal": False,
                 "sla_terms": "Response within 4 hours", "penalty_clauses": True, "force_majeure": True,
                 "confidentiality": True, "ip_ownership": True, "indemnification": True}},
    {"id": uid(), "type": "contract", "contractNumber": "RAW-2024-030", "vendor": "Atlas Raw Materials Co",
     "amount": 500000, "currency": "USD", "startDate": "2024-06-01", "endDate": "2025-05-31",
     "issueDate": "2024-06-01", "status": "active", "extractedAt": ts(now - timedelta(days=200)),
     "autoRenewal": True, "terminationNoticeDays": 120, "paymentTerms": "Net 30",
     "lineItems": [
         {"description": "Steel grade A (per ton)", "unitPrice": 850, "quantity": 300, "total": 255000},
         {"description": "Aluminum alloy (per ton)", "unitPrice": 1225, "quantity": 200, "total": 245000}],
     "clauses": {"liability_cap": False, "termination_notice": "120 days", "auto_renewal": True,
                 "sla_terms": "Delivery within 14 days", "penalty_clauses": True, "force_majeure": True,
                 "confidentiality": True, "ip_ownership": False, "indemnification": False}},
    {"id": uid(), "type": "contract", "contractNumber": "DIG-2024-040", "vendor": "Horizon Digital Services",
     "amount": 96000, "currency": "USD", "startDate": "2024-03-01", "endDate": "2025-02-28",
     "issueDate": "2024-03-01", "status": "active", "extractedAt": ts(now - timedelta(days=250)),
     "autoRenewal": True, "terminationNoticeDays": 30, "paymentTerms": "Net 15",
     "lineItems": [{"description": "Cloud hosting & support", "unitPrice": 8000, "quantity": 12, "total": 96000}],
     "clauses": {"liability_cap": True, "termination_notice": "30 days", "auto_renewal": True,
                 "sla_terms": "99.9% uptime", "penalty_clauses": True, "force_majeure": True,
                 "confidentiality": True, "ip_ownership": True, "indemnification": True}},
]

# ═══════════════════════════════════════
# PURCHASE ORDERS
# ═══════════════════════════════════════
purchase_orders = []
po_data = [
    ("PO-2025-301", "GoldPak Industries Ltd.", 9212, [{"description": "Packaging materials Q1", "unitPrice": 46.06, "quantity": 200, "total": 9212}]),
    ("PO-2025-302", "Legacy Systems Corp", 45000, [{"description": "Legacy system maintenance - Q1", "unitPrice": 15000, "quantity": 3, "total": 45000}]),
    ("PO-2025-303", "GoldPak Industries Ltd.", 15000, [{"description": "Custom packaging design", "unitPrice": 7500, "quantity": 2, "total": 15000}]),
    ("PO-2025-304", "GoldPak Industries Ltd.", 427500, [{"description": "Bulk packaging run", "unitPrice": 4.275, "quantity": 100000, "total": 427500}]),
    ("PO-2025-305", "QuickServ Facilities", 12500, [{"description": "HVAC maintenance Q1", "unitPrice": 2500, "quantity": 5, "total": 12500}]),
    ("PO-2025-306", "NovaTech Solutions Inc", 35000, [{"description": "Software licenses", "unitPrice": 350, "quantity": 100, "total": 35000}]),
    ("PO-2025-307", "Pacific Rim Logistics", 78000, [{"description": "Freight forwarding - Asia route", "unitPrice": 6500, "quantity": 12, "total": 78000}]),
    ("PO-2025-308", "Meridian Consulting Group", 60000, [{"description": "Strategy consulting", "unitPrice": 300, "quantity": 200, "total": 60000}]),
    ("PO-2025-309", "Atlas Raw Materials Co", 127500, [{"description": "Steel grade A (per ton)", "unitPrice": 850, "quantity": 75, "total": 63750}, {"description": "Aluminum alloy (per ton)", "unitPrice": 1275, "quantity": 50, "total": 63750}]),
    ("PO-2025-310", "Horizon Digital Services", 24000, [{"description": "Cloud hosting Q1", "unitPrice": 8000, "quantity": 3, "total": 24000}]),
    ("PO-2025-311", "NovaTech Solutions Inc", 18500, [{"description": "Support contract extension", "unitPrice": 18500, "quantity": 1, "total": 18500}]),
    ("PO-2025-312", "Pacific Rim Logistics", 42000, [{"description": "Warehousing services Q1", "unitPrice": 14000, "quantity": 3, "total": 42000}]),
    ("PO-2025-313", "Legacy Systems Corp", 28000, [{"description": "Database migration Phase 1", "unitPrice": 28000, "quantity": 1, "total": 28000}]),
    ("PO-2025-314", "Atlas Raw Materials Co", 85000, [{"description": "Steel grade B (per ton)", "unitPrice": 950, "quantity": 50, "total": 47500}, {"description": "Copper wire (per spool)", "unitPrice": 750, "quantity": 50, "total": 37500}]),
    ("PO-2025-315", "Meridian Consulting Group", 45000, [{"description": "Change management program", "unitPrice": 225, "quantity": 200, "total": 45000}]),
]
for i, (pn, vendor, amount, items) in enumerate(po_data):
    purchase_orders.append({
        "id": uid(), "type": "purchase_order", "poNumber": pn, "vendor": vendor,
        "amount": amount, "currency": "USD", "issueDate": ts(now - timedelta(days=30 + i*3)),
        "status": "open", "extractedAt": ts(now - timedelta(days=28 + i*3)),
        "lineItems": items, "extractionConfidence": random.randint(90, 100),
    })

# ═══════════════════════════════════════
# GOODS RECEIPTS
# ═══════════════════════════════════════
goods_receipts = []
grn_data = [
    ("GRN-2025-001", "PO-2025-305", "QuickServ Facilities", 12500, "2025-02-20"),
    ("GRN-2025-002", "PO-2025-307", "Pacific Rim Logistics", 6500, "2025-02-15"),
    ("GRN-2025-003", "PO-2025-309", "Atlas Raw Materials Co", 63750, "2025-02-25"),
    ("GRN-2025-004", "PO-2025-312", "Pacific Rim Logistics", 14000, "2025-03-01"),
    ("GRN-2025-005", "PO-2025-310", "Horizon Digital Services", 8000, "2025-03-05"),
    ("GRN-2025-006", "PO-2025-308", "Meridian Consulting Group", 60000, "2025-03-02"),
    ("GRN-2025-007", "PO-2025-302", "Legacy Systems Corp", 15000, "2025-02-28"),
    ("GRN-2025-008", "PO-2025-306", "NovaTech Solutions Inc", 35000, "2025-03-03"),
    ("GRN-2025-009", "PO-2025-301", "GoldPak Industries Ltd.", 9212, "2025-02-18"),
    ("GRN-2025-010", "PO-2025-303", "GoldPak Industries Ltd.", 15000, "2025-02-22"),
    ("GRN-2025-011", "PO-2025-314", "Atlas Raw Materials Co", 47500, "2025-03-06"),
    ("GRN-2025-012", "PO-2025-315", "Meridian Consulting Group", 22500, "2025-03-08"),
]
for gn, po_ref, vendor, amount, rd in grn_data:
    goods_receipts.append({
        "id": uid(), "type": "goods_receipt", "grnNumber": gn, "poReference": po_ref,
        "vendor": vendor, "amount": amount, "currency": "USD",
        "receivedDate": rd, "issueDate": rd, "status": "received",
        "extractedAt": ts(now - timedelta(days=random.randint(1, 15))),
        "lineItems": [{"description": "Received goods/services", "quantity": 1, "unitPrice": amount, "total": amount}],
    })

# ═══════════════════════════════════════
# INVOICES — 55 invoices with diverse patterns
# ═══════════════════════════════════════
invoices = []
inv_counter = {"GP": 4000, "LS": 1000, "QS": 2000, "NT": 3000, "PR": 5000, "MC": 6000, "AR": 7000, "HD": 8000}
prefixes = {"GoldPak Industries Ltd.": "GP", "Legacy Systems Corp": "LS", "QuickServ Facilities": "QS",
            "NovaTech Solutions Inc": "NT", "Pacific Rim Logistics": "PR", "Meridian Consulting Group": "MC",
            "Atlas Raw Materials Co": "AR", "Horizon Digital Services": "HD"}

def make_invoice(vendor, amount, po_ref=None, days_ago=None, confidence=None, status="on hold",
                 line_items=None, tax_rate=None, payment_terms=None, issue_day=None, subtotal=None):
    prefix = prefixes[vendor]
    inv_counter[prefix] += 1
    inv_num = f"INV-{prefix}-{inv_counter[prefix]}"
    d = days_ago if days_ago is not None else random.randint(1, 45)
    inv_date = now - timedelta(days=d)
    tax = round(amount * (tax_rate or 0.08), 2)
    sub = subtotal or round(amount - tax, 2)
    conf = confidence or random.randint(82, 99)
    inv = {
        "id": uid(), "invoiceNumber": inv_num, "vendor": vendor,
        "amount": amount, "subtotal": sub, "tax": tax, "currency": "USD",
        "issueDate": ts(issue_day or inv_date), "extractedAt": ts(inv_date + timedelta(hours=1)),
        "extractionConfidence": conf,
        "confidence": conf,
        "status": status, "paymentTerms": payment_terms or "Net 30",
        "poReference": po_ref, "type": "invoice",
        "lineItems": line_items or [{"description": "Services/goods", "unitPrice": sub, "quantity": 1, "total": sub}],
        "processingTime": {"extraction_ms": random.randint(2800, 6500), "matching_ms": random.randint(40, 180),
                           "anomaly_ms": random.randint(80, 350), "triage_ms": random.randint(15, 60),
                           "total_seconds": round(random.uniform(3.2, 7.8), 1)},
    }
    invoices.append(inv)
    return inv

# ── GoldPak: Over-invoicing pattern (3 invoices against $9,212 PO) ──
make_invoice("GoldPak Industries Ltd.", 9212, "PO-2025-301", 15, 85)
make_invoice("GoldPak Industries Ltd.", 9753, "PO-2025-301", 12, 100)
make_invoice("GoldPak Industries Ltd.", 9212, "PO-2025-301", 10, 100)  # Duplicate
make_invoice("GoldPak Industries Ltd.", 14800, "PO-2025-303", 8, 95)
make_invoice("GoldPak Industries Ltd.", 42750, "PO-2025-304", 5, 92)

# ── Legacy Systems: Contract violations ──
make_invoice("Legacy Systems Corp", 16500, "PO-2025-302", 20, 94, payment_terms="Net 30")  # Exceeds monthly rate
make_invoice("Legacy Systems Corp", 15000, "PO-2025-302", 15, 97)
make_invoice("Legacy Systems Corp", 15200, "PO-2025-302", 10, 96)  # Slight overcharge
make_invoice("Legacy Systems Corp", 29500, "PO-2025-313", 7, 91)  # Over PO amount

# ── QuickServ: Clean vendor (3-way matchable) ──
make_invoice("QuickServ Facilities", 2500, "PO-2025-305", 18, 98)
make_invoice("QuickServ Facilities", 2500, "PO-2025-305", 14, 99)
make_invoice("QuickServ Facilities", 2500, "PO-2025-305", 10, 98)
make_invoice("QuickServ Facilities", 2500, "PO-2025-305", 6, 97)
make_invoice("QuickServ Facilities", 2500, "PO-2025-305", 2, 99)

# ── NovaTech: Duplicate sender pattern ──
make_invoice("NovaTech Solutions Inc", 35000, "PO-2025-306", 22, 95)
make_invoice("NovaTech Solutions Inc", 35000, "PO-2025-306", 20, 95)  # Exact duplicate
make_invoice("NovaTech Solutions Inc", 34998, "PO-2025-306", 18, 94)  # Near-duplicate
make_invoice("NovaTech Solutions Inc", 18500, "PO-2025-311", 12, 93)
make_invoice("NovaTech Solutions Inc", 18500, "PO-2025-311", 10, 96)  # Duplicate

# ── Pacific Rim: Weekend invoicer ──
make_invoice("Pacific Rim Logistics", 6500, "PO-2025-307", 21, 90,
             issue_day=datetime(2025, 3, 1))  # Saturday
make_invoice("Pacific Rim Logistics", 6500, "PO-2025-307", 18, 91,
             issue_day=datetime(2025, 3, 2))  # Sunday
make_invoice("Pacific Rim Logistics", 6500, "PO-2025-307", 14, 93)
make_invoice("Pacific Rim Logistics", 14000, "PO-2025-312", 10, 92)
make_invoice("Pacific Rim Logistics", 14500, "PO-2025-312", 7, 88)  # Over PO line item
make_invoice("Pacific Rim Logistics", 15000, "PO-2025-312", 3, 87)  # Exceeds PO

# ── Meridian: Early payment eligible ──
make_invoice("Meridian Consulting Group", 30000, "PO-2025-308", 25, 97, payment_terms="2/10 Net 30")
make_invoice("Meridian Consulting Group", 15000, "PO-2025-308", 18, 98, payment_terms="2/10 Net 30")
make_invoice("Meridian Consulting Group", 15000, "PO-2025-308", 12, 96, payment_terms="2/10 Net 30")
make_invoice("Meridian Consulting Group", 22500, "PO-2025-315", 8, 95, payment_terms="2/10 Net 30")
make_invoice("Meridian Consulting Group", 22500, "PO-2025-315", 4, 97, payment_terms="2/10 Net 30")

# ── Atlas: Price escalation pattern ──
make_invoice("Atlas Raw Materials Co", 63750, "PO-2025-309", 28, 93)  # Matches PO
make_invoice("Atlas Raw Materials Co", 67000, "PO-2025-309", 22, 91)  # 5% over PO price
make_invoice("Atlas Raw Materials Co", 71000, "PO-2025-309", 16, 89)  # 11% over
make_invoice("Atlas Raw Materials Co", 48500, "PO-2025-314", 10, 90)  # Over PO line
make_invoice("Atlas Raw Materials Co", 50000, "PO-2025-314", 5, 88,
             line_items=[{"description": "Steel grade B (per ton)", "unitPrice": 1000, "quantity": 50, "total": 50000}])  # Price escalation

# ── Horizon: Stale invoicer ──
make_invoice("Horizon Digital Services", 8000, "PO-2025-310", 60, 96)  # 60 days old
make_invoice("Horizon Digital Services", 8200, "PO-2025-310", 45, 94)  # Slight overcharge
make_invoice("Horizon Digital Services", 8000, "PO-2025-310", 30, 97)
make_invoice("Horizon Digital Services", 10000, None, 120, 85)  # No PO, very stale

# ── Round-number suspicious invoices ──
make_invoice("GoldPak Industries Ltd.", 50000, "PO-2025-304", 3, 91)  # Suspiciously round
make_invoice("NovaTech Solutions Inc", 10000, None, 5, 88)  # Round, no PO

# ── Additional volume ──
for i in range(12):
    v = random.choice(VENDORS)
    amt = round(random.uniform(2000, 25000), 2)
    po_ref = random.choice([None, None, f"PO-2025-{random.randint(301, 315)}"])
    make_invoice(v["name"], amt, po_ref, random.randint(2, 30), random.randint(80, 98))

# ── Mark some clean invoices as paid (lifecycle demo) ──
paid_candidates = [inv for inv in invoices if inv["vendor"] in ("QuickServ Facilities", "Meridian Consulting Group") and inv.get("poReference")]
for inv in paid_candidates[:5]:
    inv["status"] = "paid"
    inv["paidAt"] = ts(now - timedelta(days=random.randint(1, 10)))
    inv["paidAmount"] = inv["amount"]

# ── Mark some as approved ──
approved_candidates = [inv for inv in invoices if inv["status"] != "paid" and inv.get("poReference") and inv.get("extractionConfidence", 0) >= 95]
for inv in approved_candidates[:4]:
    inv["status"] = "approved"
    inv["approvedAt"] = ts(now - timedelta(days=random.randint(1, 5)))
    inv["approvedBy"] = "Mike Manager"

print(f"Generated {len(invoices)} invoices")

# ═══════════════════════════════════════
# RUN MATCHING
# ═══════════════════════════════════════
from backend.matching import match_invoice_to_po, get_grn_for_po
matches = []
for inv in invoices:
    existing = matches[:]
    result = match_invoice_to_po(inv, purchase_orders, existing, invoices)
    if result:
        grn_info = get_grn_for_po(result["poId"], goods_receipts, purchase_orders)
        result.update(grn_info)
        m = {"id": uid(), "invoiceId": inv["id"], "invoiceNumber": inv.get("invoiceNumber", ""),
             "invoiceAmount": inv["amount"], "invoiceSubtotal": inv.get("subtotal", inv["amount"]),
             "vendor": inv["vendor"], "matchedAt": ts(now - timedelta(hours=random.randint(1, 100))),
             **result}
        matches.append(m)
print(f"Generated {len(matches)} matches")

# ═══════════════════════════════════════
# RUN ANOMALY DETECTION
# ═══════════════════════════════════════
from backend.anomalies import detect_anomalies_rule_based
anomalies = []
for inv in invoices:
    po = None
    match = next((m for m in matches if m["invoiceId"] == inv["id"]), None)
    if match:
        po = next((p for p in purchase_orders if p["id"] == match.get("poId")), None)
    contract = next((c for c in contracts if c["vendor"] == inv["vendor"]), None)
    detected = detect_anomalies_rule_based(inv, po, contract, invoices)
    for a in detected:
        a["id"] = uid()
        a["status"] = "open"
        a["detectedAt"] = ts(now - timedelta(hours=random.randint(1, 72)))
    anomalies.extend(detected)
print(f"Generated {len(anomalies)} anomalies")

# ═══════════════════════════════════════
# RUN TRIAGE
# ═══════════════════════════════════════
from backend.triage import triage_invoice
triage_decisions = []
for inv in invoices:
    inv_anoms = [a for a in anomalies if a.get("invoiceId") == inv["id"] or a.get("invoiceNumber") == inv.get("invoiceNumber")]
    match = next((m for m in matches if m["invoiceId"] == inv["id"]), None)
    decision = triage_invoice(inv, inv_anoms, {"invoices": invoices, "purchase_orders": purchase_orders,
                                                       "contracts": contracts, "matches": matches,
                                                       "goods_receipts": goods_receipts, "anomalies": anomalies})
    inv["triageLane"] = decision.get("lane", "REVIEW")
    inv["triageDecision"] = decision.get("decision", "review")
    inv["triageConfidence"] = decision.get("confidence", 50)
    inv["triageReasons"] = decision.get("reasons", [])
    inv["triageAt"] = ts(now - timedelta(hours=random.randint(0, 48)))
    triage_decisions.append(decision)
print(f"Generated {len(triage_decisions)} triage decisions")

# ═══════════════════════════════════════
# CASES — some pre-created for demo
# ═══════════════════════════════════════
cases = []
blocked = [inv for inv in invoices if inv.get("triageLane") == "BLOCK"]
for i, inv in enumerate(blocked[:8]):
    case = {
        "id": uid(), "title": f"Review: {inv['invoiceNumber']} from {inv['vendor']}",
        "description": f"Invoice {inv['invoiceNumber']} ({inv['vendor']}) for ${inv['amount']:,.2f} was blocked during triage. Reasons: {'; '.join(inv.get('triageReasons', [])[:2])}",
        "type": random.choice(["triage_escalation", "duplicate_investigation", "vendor_query", "grn_request"]),
        "priority": random.choice(["high", "critical"]) if i < 3 else random.choice(["medium", "high"]),
        "status": random.choice(["open", "in_progress", "open"]),
        "invoiceId": inv["id"], "vendor": inv["vendor"],
        "amountAtRisk": inv["amount"], "currency": "USD",
        "createdAt": ts(now - timedelta(hours=random.randint(2, 96))),
        "updatedAt": ts(now - timedelta(hours=random.randint(0, 24))),
        "assignedTo": random.choice(["Priya Analyst", "James Analyst", None]),
        "notes": [{"id": uid(), "text": "Investigating — checking vendor records.",
                   "author": "Priya Analyst", "createdAt": ts(now - timedelta(hours=random.randint(1, 48)))}] if i < 5 else [],
    }
    cases.append(case)

# Add some resolved cases for history
for i in range(5):
    inv = random.choice(invoices)
    cases.append({
        "id": uid(), "title": f"Resolved: {inv['invoiceNumber']}",
        "description": f"Historical investigation for {inv['invoiceNumber']}.",
        "type": "triage_escalation", "priority": "medium",
        "status": "resolved", "resolution": random.choice(["Approved after vendor confirmation", "Duplicate voided", "PO matched after correction", "Vendor credit received"]),
        "invoiceId": inv["id"], "vendor": inv["vendor"],
        "amountAtRisk": inv["amount"], "currency": "USD",
        "createdAt": ts(now - timedelta(days=random.randint(10, 30))),
        "updatedAt": ts(now - timedelta(days=random.randint(1, 9))),
        "resolvedAt": ts(now - timedelta(days=random.randint(1, 9))),
        "assignedTo": random.choice(["Priya Analyst", "James Analyst"]),
        "notes": [
            {"id": uid(), "text": "Initial review complete.", "author": "Priya Analyst", "createdAt": ts(now - timedelta(days=20))},
            {"id": uid(), "text": "Vendor confirmed pricing. Approved.", "author": "Mike Manager", "createdAt": ts(now - timedelta(days=15))},
        ],
    })
print(f"Generated {len(cases)} cases")

# ═══════════════════════════════════════
# CORRECTION PATTERNS (for learning loop)
# ═══════════════════════════════════════
correction_patterns = []
correction_vendors = ["GoldPak Industries Ltd.", "Legacy Systems Corp", "Atlas Raw Materials Co",
                       "NovaTech Solutions Inc", "Pacific Rim Logistics"]
field_corrections = {
    "vendor_name": [("Gold Pak Industries", "GoldPak Industries Ltd."), ("GoldPak Ind.", "GoldPak Industries Ltd."),
                     ("Legacy Sys Corp", "Legacy Systems Corp"), ("Nova Tech Sol", "NovaTech Solutions Inc")],
    "invoice_number": [("INV-4001", "INV-GP-4001"), ("4002", "INV-GP-4002"), ("LS-001", "INV-LS-1001")],
    "subtotal": [("9200.00", "9212.00"), ("14500", "14800"), ("34998.00", "35000.00")],
    "tax": [("0", "736.96"), ("", "1184.00"), ("2799.84", "2800.00")],
    "total_amount": [("9200", "9948.96"), ("14500", "15984.00"), ("35000", "37800.00")],
    "payment_terms": [("Net 30", "2/10 Net 30"), ("", "Net 45"), ("N30", "Net 30")],
    "po_reference": [("", "PO-2025-301"), ("2025-302", "PO-2025-302"), ("", "PO-2025-307")],
}
for vendor in correction_vendors:
    for _ in range(random.randint(8, 18)):
        field = random.choice(list(field_corrections.keys()))
        original, corrected = random.choice(field_corrections[field])
        correction_patterns.append({
            "id": uid(), "vendor": vendor, "field": field,
            "original": original,
            "corrected": corrected,
            "documentId": random.choice(invoices)["id"],
            "documentType": "invoice",
            "correctedAt": ts(now - timedelta(days=random.randint(1, 60))),
            "correctedBy": random.choice(["Priya Analyst", "James Analyst"]),
        })
print(f"Generated {len(correction_patterns)} correction patterns")

# ═══════════════════════════════════════
# VENDOR PROFILES
# ═══════════════════════════════════════
vendor_profiles = []
for v in VENDORS:
    v_invs = [i for i in invoices if i["vendor"] == v["name"]]
    v_anoms = [a for a in anomalies if a.get("vendor") == v["name"]]
    v_corrections = [c for c in correction_patterns if c["vendor"] == v["name"]]
    vendor_profiles.append({
        "id": uid(), "vendor": v["name"], "normalizedName": v["name"].lower(),
        "invoiceCount": len(v_invs), "totalSpend": round(sum(i["amount"] for i in v_invs), 2),
        "anomalyCount": len(v_anoms), "correctionCount": len(v_corrections),
        "riskLevel": v["risk"], "currency": v["currency"],
        "avgConfidence": round(sum(i.get("extractionConfidence", 90) for i in v_invs) / max(len(v_invs), 1), 1),
        "lastInvoiceDate": ts(now - timedelta(days=2)),
        "updatedAt": ts(now),
    })

# ═══════════════════════════════════════
# ACTIVITY LOG
# ═══════════════════════════════════════
activity_log = []
for inv in invoices[:20]:
    activity_log.append({
        "id": uid(), "action": "document_uploaded", "documentId": inv["id"],
        "invoiceNumber": inv.get("invoiceNumber", ""), "vendor": inv["vendor"],
        "timestamp": inv.get("extractedAt", ts(now)), "performedBy": "system",
    })
for a in anomalies[:15]:
    activity_log.append({
        "id": uid(), "action": "anomaly_detected", "anomalyId": a["id"],
        "invoiceNumber": a.get("invoiceNumber", ""), "vendor": a.get("vendor", ""),
        "type": a.get("type", ""), "severity": a.get("severity", ""),
        "timestamp": a.get("detectedAt", ts(now)), "performedBy": "system",
    })
# Add some resolved anomaly actions
resolved_sample = random.sample(anomalies[:len(anomalies)//2], min(25, len(anomalies)//2))
for a in resolved_sample:
    a["status"] = "resolved"
    a["resolvedAt"] = ts(now - timedelta(days=random.randint(1, 10)))
    a["resolvedBy"] = random.choice(["Priya Analyst", "James Analyst", "Mike Manager"])
    a["resolution"] = random.choice(["Confirmed with vendor — invoice correct", "False positive — approved exception",
                                      "Credit memo received from vendor", "PO amended to match invoice",
                                      "Vendor agreed to credit next invoice", "Duplicate voided — payment blocked",
                                      "Contract rate updated by procurement"])
    activity_log.append({
        "id": uid(), "action": "anomaly_resolved", "anomalyId": a["id"],
        "invoiceNumber": a.get("invoiceNumber", ""), "vendor": a.get("vendor", ""),
        "resolution": a["resolution"],
        "timestamp": a["resolvedAt"], "performedBy": a["resolvedBy"],
    })
# Add some dismissed anomalies
dismissed_sample = random.sample([a for a in anomalies if a["status"] == "open"][:20], min(8, 20))
for a in dismissed_sample:
    a["status"] = "dismissed"
    a["dismissedAt"] = ts(now - timedelta(days=random.randint(1, 8)))
    a["dismissedBy"] = random.choice(["Priya Analyst", "James Analyst"])
    a["dismissReason"] = random.choice(["Approved exception — within policy", "False positive — seasonal pricing",
                                         "Duplicate detection — already addressed", "Within acceptable tolerance"])

# ═══════════════════════════════════════
# ASSEMBLE AND SAVE
# ═══════════════════════════════════════
db = {
    "invoices": invoices,
    "purchase_orders": purchase_orders,
    "contracts": contracts,
    "goods_receipts": goods_receipts,
    "matches": matches,
    "anomalies": anomalies,
    "triage_decisions": triage_decisions,
    "cases": cases,
    "users": users,
    "correction_patterns": correction_patterns,
    "vendor_profiles": vendor_profiles,
    "activity_log": sorted(activity_log, key=lambda x: x.get("timestamp", ""), reverse=True),
    "policy_history": [],
    "custom_model_config": {
        "enabled": False,
        "corrections_count": len(correction_patterns),
        "last_export": ts(now - timedelta(days=5)),
        "readiness": "ready" if len(correction_patterns) >= 50 else "accumulating",
        "accuracy_before": 86.2,
        "accuracy_after": 94.5,
        "vendors_covered": list(set(c["vendor"] for c in correction_patterns)),
    },
    "_policy_state": {},
    "finetune_history": [
        {"id": uid(), "status": "completed", "model": "Qwen2.5-7B-Instruct-LoRA",
         "corrections_used": min(47, len(correction_patterns)), "started_at": ts(now - timedelta(days=15)),
         "completed_at": ts(now - timedelta(days=14)), "accuracy_improvement": 8.3,
         "base_accuracy": 86.2, "tuned_accuracy": 94.5},
        {"id": uid(), "status": "completed", "model": "Qwen2.5-7B-Instruct-LoRA",
         "corrections_used": 23, "started_at": ts(now - timedelta(days=45)),
         "completed_at": ts(now - timedelta(days=44)), "accuracy_improvement": 4.7,
         "base_accuracy": 81.5, "tuned_accuracy": 86.2},
    ],
    "active_finetune_job": None,
    "together_files": [],
    "api_keys": [],
    "webhooks": [],
    "lifecycle_alerts": [],
    "_lifecycle_meta": {},
    "vendor_master": [],
}

# Count stats
auto = sum(1 for i in invoices if i.get("triageDecision") == "auto_approve")
review = sum(1 for i in invoices if i.get("triageLane") in ("REVIEW", "MANAGER_REVIEW", "VP_REVIEW", "CFO_REVIEW"))
blocked_count = sum(1 for i in invoices if i.get("triageLane") == "BLOCK")
paid_count = sum(1 for i in invoices if i.get("status") == "paid")
anom_open = sum(1 for a in anomalies if a["status"] == "open")
anom_resolved = sum(1 for a in anomalies if a["status"] == "resolved")
anom_dismissed = sum(1 for a in anomalies if a.get("status") == "dismissed")
print(f"\n{'='*50}")
print(f"Demo Data Summary:")
print(f"  Invoices:    {len(invoices)} ({paid_count} paid)")
print(f"  POs:         {len(purchase_orders)}")
print(f"  Contracts:   {len(contracts)}")
print(f"  GRNs:        {len(goods_receipts)}")
print(f"  Matches:     {len(matches)}")
print(f"  Anomalies:   {len(anomalies)} ({anom_open} open, {anom_resolved} resolved, {anom_dismissed} dismissed)")
print(f"  Cases:       {len(cases)}")
print(f"  Users:       {len(users)}")
print(f"  Corrections: {len(correction_patterns)}")
print(f"  Triage: Auto={auto} Review={review} Blocked={blocked_count}")
print(f"{'='*50}")

# Write to file
out_dir = os.environ.get("DB_OUTPUT_DIR", str(Path(__file__).parent))
out_path = Path(out_dir) / "db.json"
with open(out_path, "w") as f:
    json.dump(db, f, indent=2)
print(f"Written to {out_path} ({os.path.getsize(out_path) / 1024:.0f} KB)")
