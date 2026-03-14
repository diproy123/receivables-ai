#!/usr/bin/env python3
"""
AuditLens — Freight AP Intelligence Demo Data Generator
========================================================
Loads pre-computed freight forwarding AP demo data.
All matching, anomaly detection, and vendor profiling is pre-baked.

Data includes:
- 8 vendors: Maersk, MSC, Hapag-Lloyd, CMA CGM, DB Schenker, Kuehne+Nagel, Swift Haulage, ClearPort
- 15 POs (shipment accruals with freight charge codes)
- 37 carrier invoices with anomaly patterns
- 29 matches, 48 anomalies, 4 contracts, 10 GRNs
- No client-specific names anywhere
"""
import json, os
from pathlib import Path

def main():
    script_dir = Path(__file__).parent
    db_path = script_dir / "db.json"

    if db_path.exists():
        print(f"[Seed] Loading pre-computed freight demo data from {db_path}")
        with open(db_path) as f:
            db = json.load(f)
        total = sum(len(v) for v in db.values() if isinstance(v, list))
        print(f"[Seed] Loaded {total} records")
        for k, v in db.items():
            if isinstance(v, list) and len(v) > 0:
                print(f"  {k}: {len(v)}")
    else:
        print(f"[Seed] db.json not found at {db_path}, generating fresh data...")
        db = generate_fresh()
        with open(db_path, "w") as f:
            json.dump(db, f, indent=2, default=str)

    # Also write to DB_OUTPUT_DIR if set (Railway deployment)
    out_dir = os.environ.get("DB_OUTPUT_DIR")
    if out_dir:
        out_path = Path(out_dir) / "db.json"
        with open(out_path, "w") as f:
            json.dump(db, f, indent=2, default=str)
        print(f"[Seed] Also wrote to {out_path}")

    return db


def generate_fresh():
    """Generate freight demo data from scratch — no backend imports needed."""
    import uuid, random
    from datetime import datetime, timedelta

    random.seed(42)
    def uid(): return str(uuid.uuid4())[:8].upper()
    def ts(d): return d.isoformat()
    now = datetime(2026, 3, 10, 14, 30, 0)

    VENDORS = [
        {"name": "Maersk Line A/S", "risk": "medium", "profile": "rate-escalator", "currency": "USD", "category": "Ocean Carrier"},
        {"name": "MSC Mediterranean Shipping", "risk": "high", "profile": "over-invoicer", "currency": "USD", "category": "Ocean Carrier"},
        {"name": "Hapag-Lloyd AG", "risk": "low", "profile": "clean", "currency": "USD", "category": "Ocean Carrier"},
        {"name": "CMA CGM S.A.", "risk": "medium", "profile": "duplicate-sender", "currency": "USD", "category": "Ocean Carrier"},
        {"name": "DB Schenker Logistics", "risk": "low", "profile": "early-pay-eligible", "currency": "USD", "category": "NVOCC"},
        {"name": "Kuehne+Nagel International", "risk": "medium", "profile": "stale-invoicer", "currency": "USD", "category": "NVOCC"},
        {"name": "Swift Haulage Ltd", "risk": "high", "profile": "weekend-invoicer", "currency": "GBP", "category": "Haulier"},
        {"name": "ClearPort Customs Brokers", "risk": "low", "profile": "clean", "currency": "USD", "category": "Customs Broker"},
    ]

    users = [
        {"id": uid(), "email": "cfo@auditlens.demo", "name": "Dip CFO", "role": "cfo", "status": "active", "assignedVendors": [], "createdAt": ts(now - timedelta(days=90))},
        {"id": uid(), "email": "vp@auditlens.demo", "name": "Sarah VP Finance", "role": "vp", "status": "active", "assignedVendors": [], "createdAt": ts(now - timedelta(days=90))},
        {"id": uid(), "email": "mgr@auditlens.demo", "name": "Mike AP Manager", "role": "manager", "status": "active", "assignedVendors": [], "createdAt": ts(now - timedelta(days=60))},
        {"id": uid(), "email": "analyst1@auditlens.demo", "name": "Priya AP Analyst", "role": "analyst", "status": "active",
         "assignedVendors": ["Maersk Line A/S", "MSC Mediterranean Shipping", "Hapag-Lloyd AG", "CMA CGM S.A."], "createdAt": ts(now - timedelta(days=60))},
        {"id": uid(), "email": "analyst2@auditlens.demo", "name": "James AP Analyst", "role": "analyst", "status": "active",
         "assignedVendors": ["DB Schenker Logistics", "Kuehne+Nagel International", "Swift Haulage Ltd", "ClearPort Customs Brokers"], "createdAt": ts(now - timedelta(days=45))},
    ]

    # Return minimal structure — the pre-computed db.json should be the primary source
    return {
        "invoices": [], "purchase_orders": [], "matches": [], "anomalies": [],
        "corrections": [], "contracts": [], "goods_receipts": [],
        "vendor_profiles": [], "vendor_master": [], "audit_log": [],
        "triage_decisions": [], "cases": [], "users": users,
    }


if __name__ == "__main__":
    main()
