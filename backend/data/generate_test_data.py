#!/usr/bin/env python3
"""
AuditLens — Freight Forwarding Demo Data Generator
===================================================
Generates realistic freight forwarding AP data for Freight Forwarding demo:
- 8 carrier/vendor profiles (ocean carriers, NVOCCs, hauliers, customs brokers, CFS)
- 15+ POs representing CW1 job cost accruals
- 50+ carrier invoices with freight-specific charge codes
- Contracts with carrier rate agreements
- GRNs representing service delivery confirmations
- Pre-built anomaly patterns: overcharges, duplicates, missing charges, rate escalation

Replace backend/data/generate_test_data.py with this file, then
POST /api/reset followed by POST /api/seed-demo to load.
"""
import json, uuid, random, os, sys
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)

def uid(): return str(uuid.uuid4())[:8].upper()
def ts(d): return d.isoformat()
now = datetime(2026, 3, 10, 14, 30, 0)

# ═══════════════════════════════════════
# VENDORS — Freight Forwarding Carrier/Service Providers
# ═══════════════════════════════════════
VENDORS = [
    {"name": "Maersk Line A/S", "risk": "medium", "profile": "rate-escalator", "currency": "USD",
     "category": "Ocean Carrier", "cw1_code": "MAEU"},
    {"name": "MSC Mediterranean Shipping", "risk": "high", "profile": "over-invoicer", "currency": "USD",
     "category": "Ocean Carrier", "cw1_code": "MSCU"},
    {"name": "Hapag-Lloyd AG", "risk": "low", "profile": "clean", "currency": "USD",
     "category": "Ocean Carrier", "cw1_code": "HLCU"},
    {"name": "CMA CGM S.A.", "risk": "medium", "profile": "duplicate-sender", "currency": "USD",
     "category": "Ocean Carrier", "cw1_code": "CMDU"},
    {"name": "DB Schenker Logistics", "risk": "low", "profile": "early-pay-eligible", "currency": "USD",
     "category": "Freight Forwarder / NVOCC", "cw1_code": "DBSC"},
    {"name": "Kuehne+Nagel International", "risk": "medium", "profile": "stale-invoicer", "currency": "USD",
     "category": "Freight Forwarder / NVOCC", "cw1_code": "KNIG"},
    {"name": "Swift Haulage Ltd", "risk": "high", "profile": "weekend-invoicer", "currency": "GBP",
     "category": "Haulier", "cw1_code": "SWHL"},
    {"name": "ClearPort Customs Brokers", "risk": "low", "profile": "clean", "currency": "USD",
     "category": "Customs Broker", "cw1_code": "CPCB"},
]

# ═══════════════════════════════════════
# FREIGHT CHARGE CODES (CW1 standard)
# ═══════════════════════════════════════
CHARGE_CODES = {
    "OFR": {"desc": "Ocean Freight", "typical_range": (1800, 5500)},
    "THO": {"desc": "THC Origin", "typical_range": (200, 600)},
    "THD": {"desc": "THC Destination", "typical_range": (250, 650)},
    "BAF": {"desc": "Bunker Adjustment Factor", "typical_range": (300, 900)},
    "CAF": {"desc": "Currency Adjustment Factor", "typical_range": (50, 200)},
    "ISPS": {"desc": "ISPS Security Surcharge", "typical_range": (15, 75)},
    "DOC": {"desc": "Documentation Fee", "typical_range": (50, 200)},
    "BLF": {"desc": "Bill of Lading Fee", "typical_range": (50, 150)},
    "AMS": {"desc": "AMS Filing Fee", "typical_range": (25, 45)},
    "ENS": {"desc": "ENS Filing Fee", "typical_range": (20, 40)},
    "EBS": {"desc": "Emergency Bunker Surcharge", "typical_range": (100, 400)},
    "PSS": {"desc": "Peak Season Surcharge", "typical_range": (200, 800)},
    "HAU": {"desc": "Haulage / Drayage", "typical_range": (300, 1200)},
    "CFS": {"desc": "CFS Charges", "typical_range": (150, 500)},
    "CUS": {"desc": "Customs Clearance", "typical_range": (80, 300)},
    "DEM": {"desc": "Demurrage", "typical_range": (100, 500)},
    "DET": {"desc": "Detention", "typical_range": (100, 500)},
    "WAR": {"desc": "War Risk Surcharge", "typical_range": (20, 80)},
}

# Trade lanes
TRADE_LANES = [
    {"pol": "Shanghai (CNSHA)", "pod": "Felixstowe (GBFXT)", "route": "Far East - North Europe"},
    {"pol": "Ningbo (CNNBO)", "pod": "Rotterdam (NLRTM)", "route": "Far East - North Europe"},
    {"pol": "Shenzhen (CNSZX)", "pod": "Hamburg (DEHAM)", "route": "Far East - North Europe"},
    {"pol": "Shanghai (CNSHA)", "pod": "Los Angeles (USLAX)", "route": "Transpacific"},
    {"pol": "Mumbai (INBOM)", "pod": "Felixstowe (GBFXT)", "route": "Indian Subcontinent - Europe"},
    {"pol": "Colombo (LKCMB)", "pod": "Rotterdam (NLRTM)", "route": "Indian Subcontinent - Europe"},
    {"pol": "Ho Chi Minh (VNSGN)", "pod": "Southampton (GBSOU)", "route": "Southeast Asia - Europe"},
]

# ═══════════════════════════════════════
# USERS
# ═══════════════════════════════════════
users = [
    {"id": uid(), "email": "cfo@auditlens.demo", "name": "Dip Roy (CFO)", "role": "cfo", "status": "active", "assignedVendors": [], "createdAt": ts(now - timedelta(days=90))},
    {"id": uid(), "email": "vp@auditlens.demo", "name": "Sarah VP Finance", "role": "vp", "status": "active", "assignedVendors": [], "createdAt": ts(now - timedelta(days=90))},
    {"id": uid(), "email": "ap.manager@auditlens.demo", "name": "Mike AP Manager", "role": "manager", "status": "active", "assignedVendors": [], "createdAt": ts(now - timedelta(days=60))},
    {"id": uid(), "email": "ap.analyst1@auditlens.demo", "name": "Priya AP Analyst", "role": "analyst", "status": "active",
     "assignedVendors": ["Maersk Line A/S", "MSC Mediterranean Shipping", "Hapag-Lloyd AG", "CMA CGM S.A."],
     "createdAt": ts(now - timedelta(days=60))},
    {"id": uid(), "email": "ap.analyst2@auditlens.demo", "name": "James AP Analyst", "role": "analyst", "status": "active",
     "assignedVendors": ["DB Schenker Logistics", "Kuehne+Nagel International", "Swift Haulage Ltd", "ClearPort Customs Brokers"],
     "createdAt": ts(now - timedelta(days=45))},
]

# ═══════════════════════════════════════
# CONTRACTS (Carrier Rate Agreements)
# ═══════════════════════════════════════
contracts = [
    {"id": uid(), "type": "contract", "contractNumber": "CRA-MAEU-2025-001", "vendor": "Maersk Line A/S",
     "amount": 850000, "currency": "USD", "startDate": "2025-01-01", "endDate": "2025-12-31",
     "issueDate": "2024-12-15", "status": "active", "extractedAt": ts(now - timedelta(days=90)),
     "autoRenewal": True, "terminationNoticeDays": 90, "paymentTerms": "Net 30",
     "lineItems": [
         {"description": "Ocean Freight - Far East to N.Europe (20GP)", "unitPrice": 1850, "quantity": 200, "total": 370000},
         {"description": "Ocean Freight - Far East to N.Europe (40HC)", "unitPrice": 3200, "quantity": 150, "total": 480000},
     ],
     "clauses": {"liability_cap": True, "termination_notice": "90 days", "auto_renewal": True,
                 "sla_terms": "Transit 28-32 days", "penalty_clauses": True, "force_majeure": True,
                 "confidentiality": True, "ip_ownership": False, "indemnification": False}},
    {"id": uid(), "type": "contract", "contractNumber": "CRA-MSCU-2025-001", "vendor": "MSC Mediterranean Shipping",
     "amount": 720000, "currency": "USD", "startDate": "2025-01-01", "endDate": "2025-12-31",
     "issueDate": "2024-12-20", "status": "active", "extractedAt": ts(now - timedelta(days=85)),
     "autoRenewal": False, "terminationNoticeDays": 60, "paymentTerms": "Net 30",
     "lineItems": [
         {"description": "Ocean Freight - Far East to N.Europe (20GP)", "unitPrice": 1750, "quantity": 180, "total": 315000},
         {"description": "Ocean Freight - Far East to N.Europe (40HC)", "unitPrice": 3050, "quantity": 130, "total": 396500},
     ],
     "clauses": {"liability_cap": True, "termination_notice": "60 days", "auto_renewal": False,
                 "sla_terms": "Transit 30-35 days", "penalty_clauses": True, "force_majeure": True,
                 "confidentiality": True, "ip_ownership": False, "indemnification": True}},
    {"id": uid(), "type": "contract", "contractNumber": "SVC-SWHL-2025-001", "vendor": "Swift Haulage Ltd",
     "amount": 180000, "currency": "GBP", "startDate": "2025-01-01", "endDate": "2025-12-31",
     "issueDate": "2024-12-10", "status": "active", "extractedAt": ts(now - timedelta(days=95)),
     "autoRenewal": True, "terminationNoticeDays": 30, "paymentTerms": "Net 14",
     "lineItems": [
         {"description": "Container haulage - Felixstowe to London (20GP)", "unitPrice": 350, "quantity": 300, "total": 105000},
         {"description": "Container haulage - Felixstowe to London (40HC)", "unitPrice": 500, "quantity": 150, "total": 75000},
     ],
     "clauses": {"liability_cap": True, "termination_notice": "30 days", "auto_renewal": True,
                 "sla_terms": "Delivery within 24 hours", "penalty_clauses": True, "force_majeure": True,
                 "confidentiality": True, "ip_ownership": False, "indemnification": False}},
    {"id": uid(), "type": "contract", "contractNumber": "SVC-CPCB-2025-001", "vendor": "ClearPort Customs Brokers",
     "amount": 96000, "currency": "USD", "startDate": "2025-01-01", "endDate": "2025-12-31",
     "issueDate": "2024-12-05", "status": "active", "extractedAt": ts(now - timedelta(days=100)),
     "autoRenewal": True, "terminationNoticeDays": 30, "paymentTerms": "Net 30",
     "lineItems": [
         {"description": "Import customs clearance (per entry)", "unitPrice": 120, "quantity": 800, "total": 96000},
     ],
     "clauses": {"liability_cap": True, "termination_notice": "30 days", "auto_renewal": True,
                 "sla_terms": "Clearance within 4 hours of document receipt", "penalty_clauses": False, "force_majeure": True,
                 "confidentiality": True, "ip_ownership": False, "indemnification": True}},
]

# ═══════════════════════════════════════
# PURCHASE ORDERS (CW1 Job Cost Accruals)
# ═══════════════════════════════════════
purchase_orders = []
po_data = [
    # (PO ref = CW1 shipment ref, vendor, line items representing accrued charges)
    ("SH-2026-0101", "Maersk Line A/S", [
        {"description": "Ocean Freight 2x40HC CNSHA-GBFXT", "unitPrice": 3200, "quantity": 2, "total": 6400, "chargeCode": "OFR"},
        {"description": "THC Origin Shanghai", "unitPrice": 425, "quantity": 2, "total": 850, "chargeCode": "THO"},
        {"description": "THC Destination Felixstowe", "unitPrice": 380, "quantity": 2, "total": 760, "chargeCode": "THD"},
        {"description": "BAF Surcharge", "unitPrice": 650, "quantity": 2, "total": 1300, "chargeCode": "BAF"},
        {"description": "Documentation Fee", "unitPrice": 150, "quantity": 1, "total": 150, "chargeCode": "DOC"},
        {"description": "BL Fee", "unitPrice": 100, "quantity": 1, "total": 100, "chargeCode": "BLF"},
        {"description": "ISPS Surcharge", "unitPrice": 50, "quantity": 2, "total": 100, "chargeCode": "ISPS"},
    ], 9660),
    ("SH-2026-0102", "MSC Mediterranean Shipping", [
        {"description": "Ocean Freight 3x20GP CNNBO-NLRTM", "unitPrice": 1750, "quantity": 3, "total": 5250, "chargeCode": "OFR"},
        {"description": "THC Origin Ningbo", "unitPrice": 380, "quantity": 3, "total": 1140, "chargeCode": "THO"},
        {"description": "THC Destination Rotterdam", "unitPrice": 350, "quantity": 3, "total": 1050, "chargeCode": "THD"},
        {"description": "BAF Surcharge", "unitPrice": 580, "quantity": 3, "total": 1740, "chargeCode": "BAF"},
        {"description": "ENS Filing", "unitPrice": 30, "quantity": 1, "total": 30, "chargeCode": "ENS"},
        {"description": "Documentation Fee", "unitPrice": 175, "quantity": 1, "total": 175, "chargeCode": "DOC"},
        {"description": "ISPS", "unitPrice": 45, "quantity": 3, "total": 135, "chargeCode": "ISPS"},
    ], 9520),
    ("SH-2026-0103", "Hapag-Lloyd AG", [
        {"description": "Ocean Freight 1x40HC CNSZX-DEHAM", "unitPrice": 3100, "quantity": 1, "total": 3100, "chargeCode": "OFR"},
        {"description": "THC Origin Shenzhen", "unitPrice": 400, "quantity": 1, "total": 400, "chargeCode": "THO"},
        {"description": "THC Destination Hamburg", "unitPrice": 420, "quantity": 1, "total": 420, "chargeCode": "THD"},
        {"description": "BAF", "unitPrice": 620, "quantity": 1, "total": 620, "chargeCode": "BAF"},
        {"description": "Documentation Fee", "unitPrice": 125, "quantity": 1, "total": 125, "chargeCode": "DOC"},
        {"description": "BL Fee", "unitPrice": 75, "quantity": 1, "total": 75, "chargeCode": "BLF"},
    ], 4740),
    ("SH-2026-0104", "CMA CGM S.A.", [
        {"description": "Ocean Freight 2x20GP CNSHA-USLAX", "unitPrice": 2200, "quantity": 2, "total": 4400, "chargeCode": "OFR"},
        {"description": "THC Origin Shanghai", "unitPrice": 425, "quantity": 2, "total": 850, "chargeCode": "THO"},
        {"description": "THC Destination Los Angeles", "unitPrice": 520, "quantity": 2, "total": 1040, "chargeCode": "THD"},
        {"description": "AMS Filing", "unitPrice": 35, "quantity": 1, "total": 35, "chargeCode": "AMS"},
        {"description": "ISPS", "unitPrice": 50, "quantity": 2, "total": 100, "chargeCode": "ISPS"},
        {"description": "Documentation Fee", "unitPrice": 150, "quantity": 1, "total": 150, "chargeCode": "DOC"},
    ], 6575),
    ("SH-2026-0105", "Maersk Line A/S", [
        {"description": "Ocean Freight 1x40HC INBOM-GBFXT", "unitPrice": 2800, "quantity": 1, "total": 2800, "chargeCode": "OFR"},
        {"description": "THC Origin Mumbai", "unitPrice": 280, "quantity": 1, "total": 280, "chargeCode": "THO"},
        {"description": "THC Dest Felixstowe", "unitPrice": 380, "quantity": 1, "total": 380, "chargeCode": "THD"},
        {"description": "BAF", "unitPrice": 480, "quantity": 1, "total": 480, "chargeCode": "BAF"},
        {"description": "War Risk Surcharge", "unitPrice": 45, "quantity": 1, "total": 45, "chargeCode": "WAR"},
        {"description": "Documentation Fee", "unitPrice": 150, "quantity": 1, "total": 150, "chargeCode": "DOC"},
        {"description": "BL Fee", "unitPrice": 100, "quantity": 1, "total": 100, "chargeCode": "BLF"},
    ], 4235),
    ("SH-2026-0106", "Swift Haulage Ltd", [
        {"description": "Container Haulage 2x40HC Felixstowe-London", "unitPrice": 500, "quantity": 2, "total": 1000, "chargeCode": "HAU"},
        {"description": "Waiting Time (per hour)", "unitPrice": 45, "quantity": 2, "total": 90, "chargeCode": "HAU"},
    ], 1090),
    ("SH-2026-0107", "ClearPort Customs Brokers", [
        {"description": "Import Customs Clearance", "unitPrice": 120, "quantity": 1, "total": 120, "chargeCode": "CUS"},
        {"description": "Customs Examination Fee", "unitPrice": 250, "quantity": 1, "total": 250, "chargeCode": "CUS"},
    ], 370),
    ("SH-2026-0108", "MSC Mediterranean Shipping", [
        {"description": "Ocean Freight 2x40HC VNSGN-GBSOU", "unitPrice": 3400, "quantity": 2, "total": 6800, "chargeCode": "OFR"},
        {"description": "THC Origin Ho Chi Minh", "unitPrice": 350, "quantity": 2, "total": 700, "chargeCode": "THO"},
        {"description": "THC Destination Southampton", "unitPrice": 400, "quantity": 2, "total": 800, "chargeCode": "THD"},
        {"description": "BAF", "unitPrice": 700, "quantity": 2, "total": 1400, "chargeCode": "BAF"},
        {"description": "Peak Season Surcharge", "unitPrice": 500, "quantity": 2, "total": 1000, "chargeCode": "PSS"},
        {"description": "Documentation Fee", "unitPrice": 175, "quantity": 1, "total": 175, "chargeCode": "DOC"},
        {"description": "ISPS", "unitPrice": 45, "quantity": 2, "total": 90, "chargeCode": "ISPS"},
    ], 10965),
    # Additional accruals
    ("SH-2026-0109", "DB Schenker Logistics", [
        {"description": "Consolidated LCL Freight CNSHA-GBFXT", "unitPrice": 65, "quantity": 28, "total": 1820, "chargeCode": "OFR"},
        {"description": "CFS Origin Charges", "unitPrice": 45, "quantity": 28, "total": 1260, "chargeCode": "CFS"},
        {"description": "CFS Destination Charges", "unitPrice": 55, "quantity": 28, "total": 1540, "chargeCode": "CFS"},
        {"description": "Documentation Fee", "unitPrice": 100, "quantity": 1, "total": 100, "chargeCode": "DOC"},
    ], 4720),
    ("SH-2026-0110", "Kuehne+Nagel International", [
        {"description": "LCL Freight LKCMB-NLRTM", "unitPrice": 58, "quantity": 15, "total": 870, "chargeCode": "OFR"},
        {"description": "CFS Charges", "unitPrice": 40, "quantity": 15, "total": 600, "chargeCode": "CFS"},
        {"description": "Documentation", "unitPrice": 120, "quantity": 1, "total": 120, "chargeCode": "DOC"},
    ], 1590),
]

for po_ref, vendor, items, total in po_data:
    purchase_orders.append({
        "id": uid(), "poNumber": po_ref, "vendor": vendor, "amount": total, "currency": "USD",
        "issueDate": ts(now - timedelta(days=random.randint(10, 40))),
        "status": "open", "type": "purchase_order",
        "lineItems": items, "extractionConfidence": random.randint(92, 100),
    })

# Additional POs for volume
for i in range(5):
    v = random.choice(VENDORS[:4])  # Ocean carriers only
    lane = random.choice(TRADE_LANES)
    ofr = random.randint(2500, 4500)
    thc = random.randint(300, 500)
    total = ofr + thc * 2 + random.randint(200, 800)
    purchase_orders.append({
        "id": uid(), "poNumber": f"SH-2026-{111+i:04d}", "vendor": v["name"], "amount": total, "currency": "USD",
        "issueDate": ts(now - timedelta(days=random.randint(5, 25))),
        "status": "open", "type": "purchase_order",
        "lineItems": [
            {"description": f"Ocean Freight {lane['pol']}-{lane['pod']}", "unitPrice": ofr, "quantity": 1, "total": ofr, "chargeCode": "OFR"},
            {"description": "THC Origin", "unitPrice": thc, "quantity": 1, "total": thc, "chargeCode": "THO"},
            {"description": "THC Destination", "unitPrice": thc, "quantity": 1, "total": thc, "chargeCode": "THD"},
            {"description": "Documentation Fee", "unitPrice": 150, "quantity": 1, "total": 150, "chargeCode": "DOC"},
        ],
        "extractionConfidence": random.randint(90, 99),
    })

print(f"Generated {len(purchase_orders)} purchase orders (CW1 accruals)")

# ═══════════════════════════════════════
# GRNs (Service Delivery Confirmations)
# ═══════════════════════════════════════
grn_data = [
    ("GRN-2026-001", "SH-2026-0101", "Maersk Line A/S", 9660, "2026-02-20"),
    ("GRN-2026-002", "SH-2026-0102", "MSC Mediterranean Shipping", 9520, "2026-02-22"),
    ("GRN-2026-003", "SH-2026-0103", "Hapag-Lloyd AG", 4740, "2026-02-25"),
    ("GRN-2026-004", "SH-2026-0104", "CMA CGM S.A.", 6575, "2026-02-28"),
    ("GRN-2026-005", "SH-2026-0105", "Maersk Line A/S", 4235, "2026-03-01"),
    ("GRN-2026-006", "SH-2026-0106", "Swift Haulage Ltd", 1090, "2026-03-02"),
    ("GRN-2026-007", "SH-2026-0107", "ClearPort Customs Brokers", 370, "2026-03-03"),
    ("GRN-2026-008", "SH-2026-0108", "MSC Mediterranean Shipping", 10965, "2026-03-04"),
    ("GRN-2026-009", "SH-2026-0109", "DB Schenker Logistics", 4720, "2026-03-05"),
    ("GRN-2026-010", "SH-2026-0110", "Kuehne+Nagel International", 1590, "2026-03-06"),
]

grns = []
for gn, po_ref, vendor, amount, rd in grn_data:
    grns.append({
        "id": uid(), "type": "goods_receipt", "grnNumber": gn, "poReference": po_ref,
        "vendor": vendor, "amount": amount, "currency": "USD",
        "receivedDate": rd, "status": "verified",
        "lineItems": [{"description": "Freight services delivered as per shipment", "quantity": 1, "unitPrice": amount, "total": amount}],
    })

print(f"Generated {len(grns)} GRNs")

# ═══════════════════════════════════════
# INVOICES — Carrier Invoices with Freight Charge Codes
# ═══════════════════════════════════════
invoices = []
inv_counter = {"MAE": 100, "MSC": 200, "HLC": 300, "CMA": 400, "DBS": 500, "KNI": 600, "SHL": 700, "CPC": 800}
prefixes = {
    "Maersk Line A/S": "MAE", "MSC Mediterranean Shipping": "MSC", "Hapag-Lloyd AG": "HLC",
    "CMA CGM S.A.": "CMA", "DB Schenker Logistics": "DBS", "Kuehne+Nagel International": "KNI",
    "Swift Haulage Ltd": "SHL", "ClearPort Customs Brokers": "CPC",
}

def make_invoice(vendor, amount, po_ref=None, days_ago=None, confidence=None, status="on hold",
                 line_items=None, tax_rate=None, payment_terms=None, issue_day=None, subtotal=None):
    prefix = prefixes[vendor]
    inv_counter[prefix] += 1
    inv_num = f"INV-{prefix}-2026-{inv_counter[prefix]}"
    d = days_ago if days_ago is not None else random.randint(1, 45)
    inv_date = now - timedelta(days=d)
    tax = round(amount * (tax_rate or 0), 2)  # Freight invoices often have zero tax
    sub = subtotal or round(amount - tax, 2)
    conf = confidence or random.randint(82, 99)
    inv = {
        "id": uid(), "invoiceNumber": inv_num, "vendor": vendor,
        "amount": amount, "subtotal": sub, "tax": tax, "currency": "USD",
        "issueDate": ts(issue_day or inv_date), "extractedAt": ts(inv_date + timedelta(hours=1)),
        "extractionConfidence": conf, "confidence": conf,
        "status": status, "paymentTerms": payment_terms or "Net 30",
        "poReference": po_ref, "type": "invoice",
        "lineItems": line_items or [{"description": "Freight services", "unitPrice": sub, "quantity": 1, "total": sub}],
        "processingTime": {"extraction_ms": random.randint(2800, 6500), "matching_ms": random.randint(40, 180),
                           "anomaly_ms": random.randint(80, 350), "triage_ms": random.randint(15, 60),
                           "total_seconds": round(random.uniform(3.2, 7.8), 1)},
    }
    invoices.append(inv)
    return inv

# ── Maersk: Rate escalation pattern (SH-0101 accrual = $9,660) ──
make_invoice("Maersk Line A/S", 9660, "SH-2026-0101", 15, 96,  # Exact match
    line_items=[
        {"description": "Ocean Freight 2x40HC CNSHA-GBFXT", "unitPrice": 3200, "quantity": 2, "total": 6400, "chargeCode": "OFR"},
        {"description": "THC Origin Shanghai", "unitPrice": 425, "quantity": 2, "total": 850, "chargeCode": "THO"},
        {"description": "THC Destination Felixstowe", "unitPrice": 380, "quantity": 2, "total": 760, "chargeCode": "THD"},
        {"description": "BAF Surcharge", "unitPrice": 650, "quantity": 2, "total": 1300, "chargeCode": "BAF"},
        {"description": "Documentation Fee", "unitPrice": 150, "quantity": 1, "total": 150, "chargeCode": "DOC"},
        {"description": "BL Fee", "unitPrice": 100, "quantity": 1, "total": 100, "chargeCode": "BLF"},
        {"description": "ISPS Surcharge", "unitPrice": 50, "quantity": 2, "total": 100, "chargeCode": "ISPS"},
    ])
make_invoice("Maersk Line A/S", 4535, "SH-2026-0105", 12, 94,  # +$300 over accrual ($4,235)
    line_items=[
        {"description": "Ocean Freight 1x40HC INBOM-GBFXT", "unitPrice": 2800, "quantity": 1, "total": 2800, "chargeCode": "OFR"},
        {"description": "THC Origin Mumbai", "unitPrice": 280, "quantity": 1, "total": 280, "chargeCode": "THO"},
        {"description": "THC Dest Felixstowe", "unitPrice": 450, "quantity": 1, "total": 450, "chargeCode": "THD"},  # THD inflated: 380->450
        {"description": "BAF", "unitPrice": 480, "quantity": 1, "total": 480, "chargeCode": "BAF"},
        {"description": "War Risk", "unitPrice": 45, "quantity": 1, "total": 45, "chargeCode": "WAR"},
        {"description": "Documentation Fee", "unitPrice": 150, "quantity": 1, "total": 150, "chargeCode": "DOC"},
        {"description": "BL Fee", "unitPrice": 130, "quantity": 1, "total": 130, "chargeCode": "BLF"},  # BLF inflated: 100->130
        {"description": "Congestion Surcharge", "unitPrice": 200, "quantity": 1, "total": 200, "chargeCode": "PSS"},  # Not accrued!
    ])

# ── MSC: Over-invoicing pattern (SH-0102 accrual = $9,520) ──
make_invoice("MSC Mediterranean Shipping", 10280, "SH-2026-0102", 18, 91,  # $760 over accrual
    line_items=[
        {"description": "Ocean Freight 3x20GP CNNBO-NLRTM", "unitPrice": 1950, "quantity": 3, "total": 5850, "chargeCode": "OFR"},  # OFR inflated: 1750->1950
        {"description": "THC Origin Ningbo", "unitPrice": 380, "quantity": 3, "total": 1140, "chargeCode": "THO"},
        {"description": "THC Destination Rotterdam", "unitPrice": 350, "quantity": 3, "total": 1050, "chargeCode": "THD"},
        {"description": "BAF Surcharge", "unitPrice": 580, "quantity": 3, "total": 1740, "chargeCode": "BAF"},
        {"description": "ENS Filing", "unitPrice": 30, "quantity": 1, "total": 30, "chargeCode": "ENS"},
        {"description": "Documentation Fee", "unitPrice": 175, "quantity": 1, "total": 175, "chargeCode": "DOC"},
        {"description": "ISPS", "unitPrice": 45, "quantity": 3, "total": 135, "chargeCode": "ISPS"},
        {"description": "Late Documentation Surcharge", "unitPrice": 160, "quantity": 1, "total": 160, "chargeCode": "DOC"},  # Fabricated charge
    ])
make_invoice("MSC Mediterranean Shipping", 10965, "SH-2026-0108", 10, 93,  # Exact match
    line_items=[
        {"description": "Ocean Freight 2x40HC VNSGN-GBSOU", "unitPrice": 3400, "quantity": 2, "total": 6800, "chargeCode": "OFR"},
        {"description": "THC Origin Ho Chi Minh", "unitPrice": 350, "quantity": 2, "total": 700, "chargeCode": "THO"},
        {"description": "THC Destination Southampton", "unitPrice": 400, "quantity": 2, "total": 800, "chargeCode": "THD"},
        {"description": "BAF", "unitPrice": 700, "quantity": 2, "total": 1400, "chargeCode": "BAF"},
        {"description": "Peak Season Surcharge", "unitPrice": 500, "quantity": 2, "total": 1000, "chargeCode": "PSS"},
        {"description": "Documentation Fee", "unitPrice": 175, "quantity": 1, "total": 175, "chargeCode": "DOC"},
        {"description": "ISPS", "unitPrice": 45, "quantity": 2, "total": 90, "chargeCode": "ISPS"},
    ])
make_invoice("MSC Mediterranean Shipping", 10965, "SH-2026-0108", 8, 93)  # DUPLICATE of above

# ── Hapag-Lloyd: Clean vendor ──
make_invoice("Hapag-Lloyd AG", 4740, "SH-2026-0103", 14, 98,  # Exact match
    line_items=[
        {"description": "Ocean Freight 1x40HC CNSZX-DEHAM", "unitPrice": 3100, "quantity": 1, "total": 3100, "chargeCode": "OFR"},
        {"description": "THC Origin Shenzhen", "unitPrice": 400, "quantity": 1, "total": 400, "chargeCode": "THO"},
        {"description": "THC Destination Hamburg", "unitPrice": 420, "quantity": 1, "total": 420, "chargeCode": "THD"},
        {"description": "BAF", "unitPrice": 620, "quantity": 1, "total": 620, "chargeCode": "BAF"},
        {"description": "Documentation Fee", "unitPrice": 125, "quantity": 1, "total": 125, "chargeCode": "DOC"},
        {"description": "BL Fee", "unitPrice": 75, "quantity": 1, "total": 75, "chargeCode": "BLF"},
    ])

# ── CMA CGM: Duplicate sender pattern ──
make_invoice("CMA CGM S.A.", 6575, "SH-2026-0104", 16, 95,
    line_items=[
        {"description": "Ocean Freight 2x20GP CNSHA-USLAX", "unitPrice": 2200, "quantity": 2, "total": 4400, "chargeCode": "OFR"},
        {"description": "THC Origin Shanghai", "unitPrice": 425, "quantity": 2, "total": 850, "chargeCode": "THO"},
        {"description": "THC Destination Los Angeles", "unitPrice": 520, "quantity": 2, "total": 1040, "chargeCode": "THD"},
        {"description": "AMS Filing", "unitPrice": 35, "quantity": 1, "total": 35, "chargeCode": "AMS"},
        {"description": "ISPS", "unitPrice": 50, "quantity": 2, "total": 100, "chargeCode": "ISPS"},
        {"description": "Documentation Fee", "unitPrice": 150, "quantity": 1, "total": 150, "chargeCode": "DOC"},
    ])
make_invoice("CMA CGM S.A.", 6575, "SH-2026-0104", 14, 94)  # DUPLICATE
make_invoice("CMA CGM S.A.", 6573, "SH-2026-0104", 12, 93)  # Near-duplicate ($2 diff)

# ── DB Schenker: Early payment eligible ──
make_invoice("DB Schenker Logistics", 4720, "SH-2026-0109", 20, 97, payment_terms="2/10 Net 30",
    line_items=[
        {"description": "LCL Freight CNSHA-GBFXT (28 CBM)", "unitPrice": 65, "quantity": 28, "total": 1820, "chargeCode": "OFR"},
        {"description": "CFS Origin Charges", "unitPrice": 45, "quantity": 28, "total": 1260, "chargeCode": "CFS"},
        {"description": "CFS Destination Charges", "unitPrice": 55, "quantity": 28, "total": 1540, "chargeCode": "CFS"},
        {"description": "Documentation Fee", "unitPrice": 100, "quantity": 1, "total": 100, "chargeCode": "DOC"},
    ])

# ── Kuehne+Nagel: Stale invoicer ──
make_invoice("Kuehne+Nagel International", 1590, "SH-2026-0110", 55, 95,  # 55 days old!
    line_items=[
        {"description": "LCL Freight LKCMB-NLRTM (15 CBM)", "unitPrice": 58, "quantity": 15, "total": 870, "chargeCode": "OFR"},
        {"description": "CFS Charges", "unitPrice": 40, "quantity": 15, "total": 600, "chargeCode": "CFS"},
        {"description": "Documentation", "unitPrice": 120, "quantity": 1, "total": 120, "chargeCode": "DOC"},
    ])
make_invoice("Kuehne+Nagel International", 1850, "SH-2026-0110", 45, 90)  # Over accrual + stale

# ── Swift Haulage: Weekend invoicer ──
make_invoice("Swift Haulage Ltd", 1090, "SH-2026-0106", 8, 92,
    issue_day=datetime(2026, 3, 7),  # Saturday
    line_items=[
        {"description": "Container Haulage 2x40HC Felixstowe-London", "unitPrice": 500, "quantity": 2, "total": 1000, "chargeCode": "HAU"},
        {"description": "Waiting Time", "unitPrice": 45, "quantity": 2, "total": 90, "chargeCode": "HAU"},
    ])
make_invoice("Swift Haulage Ltd", 1350, "SH-2026-0106", 5, 88,  # Over accrual ($1,090)
    issue_day=datetime(2026, 3, 8),  # Sunday
    line_items=[
        {"description": "Container Haulage 2x40HC Felixstowe-London", "unitPrice": 550, "quantity": 2, "total": 1100, "chargeCode": "HAU"},  # Rate inflated
        {"description": "Waiting Time", "unitPrice": 45, "quantity": 2, "total": 90, "chargeCode": "HAU"},
        {"description": "Congestion Surcharge", "unitPrice": 80, "quantity": 2, "total": 160, "chargeCode": "HAU"},  # Not accrued
    ])

# ── ClearPort: Clean customs broker ──
make_invoice("ClearPort Customs Brokers", 370, "SH-2026-0107", 12, 99,
    line_items=[
        {"description": "Import Customs Clearance", "unitPrice": 120, "quantity": 1, "total": 120, "chargeCode": "CUS"},
        {"description": "Customs Examination Fee", "unitPrice": 250, "quantity": 1, "total": 250, "chargeCode": "CUS"},
    ])

# ── Round-number suspicious ──
make_invoice("MSC Mediterranean Shipping", 10000, None, 3, 87)  # Round, no PO
make_invoice("Maersk Line A/S", 5000, None, 4, 85)  # Round, no PO

# ── Additional volume for realistic dashboard ──
for i in range(20):
    v = random.choice(VENDORS)
    lane = random.choice(TRADE_LANES)
    ofr = random.randint(1800, 5000)
    charges = random.randint(800, 2500)
    total = ofr + charges
    po_ref = random.choice([None, f"SH-2026-{random.randint(101, 115):04d}"])
    items = [
        {"description": f"Ocean/LCL Freight {lane['pol'][:lane['pol'].index('(')].strip()}-{lane['pod'][:lane['pod'].index('(')].strip()}", "unitPrice": ofr, "quantity": 1, "total": ofr, "chargeCode": "OFR"},
        {"description": "Local Charges", "unitPrice": charges, "quantity": 1, "total": charges, "chargeCode": "THO"},
    ]
    make_invoice(v["name"], total, po_ref, random.randint(2, 35), random.randint(80, 98), line_items=items)

# Mark some as paid/approved for lifecycle demo
paid = [inv for inv in invoices if inv["vendor"] in ("Hapag-Lloyd AG", "ClearPort Customs Brokers", "DB Schenker Logistics") and inv.get("poReference")]
for inv in paid[:4]:
    inv["status"] = "paid"
    inv["paidAt"] = ts(now - timedelta(days=random.randint(1, 10)))
    inv["paidAmount"] = inv["amount"]

approved = [inv for inv in invoices if inv["status"] != "paid" and inv.get("poReference") and inv.get("extractionConfidence", 0) >= 96]
for inv in approved[:3]:
    inv["status"] = "approved"
    inv["approvedAt"] = ts(now - timedelta(days=random.randint(1, 5)))
    inv["approvedBy"] = "Mike AP Manager"

print(f"Generated {len(invoices)} invoices")

# ═══════════════════════════════════════
# RUN MATCHING & ANOMALY DETECTION
# ═══════════════════════════════════════
# Add project root to path for imports
_root = str(Path(__file__).resolve().parent.parent.parent)
if _root not in sys.path:
    sys.path.insert(0, _root)

from backend.matching import match_invoice_to_po, get_grn_for_po
from backend.anomalies import detect_anomalies_rule_based, detect_grn_anomalies

matches = []
anomalies = []
existing = []

for inv in invoices:
    result = match_invoice_to_po(inv, purchase_orders, existing, invoices)
    if result:
        result["invoiceId"] = inv["id"]
        result["invoiceNumber"] = inv.get("invoiceNumber", "")
        result["vendor"] = inv.get("vendor", "")
        matches.append(result)
        existing.append(result)

        # GRN matching for 3-way
        grn_result = get_grn_for_po(result.get("poNumber", result.get("poId", "")), grns, purchase_orders)
        if grn_result and grn_result.get("matchType") == "three_way":
            result["grnNumbers"] = grn_result.get("grnNumbers", [])
            result["grnAmount"] = grn_result.get("totalReceived", 0)
            result["matchType"] = "three_way"

    # Find matched PO and contract for this invoice
    matched_po = None
    matched_contract = None
    if inv.get("poReference"):
        matched_po = next((po for po in purchase_orders if po.get("poNumber") == inv["poReference"]), None)
    if inv.get("vendor"):
        matched_contract = next((c for c in contracts if c.get("vendor") == inv["vendor"]), None)

    anoms = detect_anomalies_rule_based(inv, matched_po, matched_contract, invoices)
    anomalies.extend(anoms)

print(f"Generated {len(matches)} matches, {len(anomalies)} anomalies")

# ═══════════════════════════════════════
# VENDOR PROFILES
# ═══════════════════════════════════════
vendor_profiles = []
for v in VENDORS:
    v_invoices = [inv for inv in invoices if inv["vendor"] == v["name"]]
    total_spend = sum(inv["amount"] for inv in v_invoices)
    avg_conf = sum(inv.get("extractionConfidence", 90) for inv in v_invoices) / max(len(v_invoices), 1)
    v_anomalies = [a for a in anomalies if a.get("vendor") == v["name"] or any(inv["vendor"] == v["name"] and inv["id"] == a.get("invoiceId") for inv in invoices)]

    vendor_profiles.append({
        "id": uid(), "vendor": v["name"], "vendorNormalized": v["name"].upper().replace(" ", "_"),
        "category": v.get("category", "Carrier"), "cw1Code": v.get("cw1_code", ""),
        "totalInvoices": len(v_invoices), "totalSpend": round(total_spend, 2),
        "avgConfidence": round(avg_conf, 1),
        "riskLevel": v["risk"], "riskScore": {"high": 78, "medium": 52, "low": 22}[v["risk"]],
        "anomalyCount": len(v_anomalies),
        "profile": v["profile"],
        "firstSeen": ts(now - timedelta(days=random.randint(180, 365))),
        "lastInvoice": ts(now - timedelta(days=random.randint(1, 15))),
        "paymentTerms": "Net 30",
        "currency": v["currency"],
    })

print(f"Generated {len(vendor_profiles)} vendor profiles")

# ═══════════════════════════════════════
# ASSEMBLE & SAVE
# ═══════════════════════════════════════
db = {
    "invoices": invoices,
    "purchase_orders": purchase_orders,
    "matches": matches,
    "anomalies": anomalies,
    "corrections": [],
    "contracts": contracts,
    "goods_receipts": grns,
    "vendor_profiles": vendor_profiles,
    "vendor_master": [],
    "audit_log": [],
    "triage_decisions": [],
    "cases": [],
    "users": users,
}

out_dir = os.environ.get("DB_OUTPUT_DIR", str(Path(__file__).parent))
out_path = Path(out_dir) / "db.json"
with open(out_path, "w") as f:
    json.dump(db, f, indent=2, default=str)

total = sum(len(v) for v in db.values() if isinstance(v, list))
print(f"\n{'='*50}")
print(f"Freight AP Intelligence Demo Data")
print(f"{'='*50}")
print(f"Vendors:          {len(VENDORS)} (carriers, NVOCCs, hauliers, brokers)")
print(f"Contracts:        {len(contracts)} (carrier rate agreements)")
print(f"POs (CW1 Accruals): {len(purchase_orders)}")
print(f"GRNs:             {len(grns)}")
print(f"Invoices:         {len(invoices)}")
print(f"Matches:          {len(matches)}")
print(f"Anomalies:        {len(anomalies)}")
print(f"Vendor Profiles:  {len(vendor_profiles)}")
print(f"Total Records:    {total}")
print(f"Output:           {out_path}")
print(f"{'='*50}")
print(f"\nAnomaly patterns included:")
print(f"  - Maersk: THC/BLF rate escalation + unapproved surcharges")
print(f"  - MSC: Ocean freight over-invoicing + fabricated charges + duplicates")
print(f"  - CMA CGM: Duplicate + near-duplicate invoices")
print(f"  - Swift Haulage: Weekend invoicing + rate inflation + unapproved charges")
print(f"  - Kuehne+Nagel: Stale invoices (55+ days)")
print(f"  - Maersk/MSC: Suspicious round-number invoices without PO reference")
print(f"  - Hapag-Lloyd/ClearPort/DB Schenker: Clean vendors for contrast")
