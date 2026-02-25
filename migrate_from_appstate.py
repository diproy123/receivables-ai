"""
AuditLens — One-Time Data Migration
====================================
Migrates data from the old single-row app_state JSONB blob
into the new relational SQLAlchemy tables.

Run this ONCE after deploying the Phase 1 upgrade:

    python migrate_from_appstate.py

What it does:
  1. Reads the old app_state.data JSONB blob from Postgres
  2. Creates the new relational tables (via SQLAlchemy)
  3. Inserts every record into the proper table
  4. Renames app_state → app_state_backup (preserves original)
  5. Prints a summary

Requirements:
  - DATABASE_URL environment variable must be set
  - The old app_state table must exist with data

Safe to run multiple times — it checks if migration was already done.
"""

import os
import sys
import json
import uuid
from datetime import datetime, timezone

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    print("❌ DATABASE_URL not set. This script migrates from Postgres app_state.")
    print("   Set it: export DATABASE_URL=postgresql://user:pass@host:5432/dbname")
    sys.exit(1)

# Fix Railway URL format
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    os.environ["DATABASE_URL"] = DATABASE_URL

import psycopg2


def read_old_data():
    """Read the JSONB blob from the old app_state table."""
    conn = psycopg2.connect(DATABASE_URL)
    try:
        cur = conn.cursor()

        # Check if app_state exists
        cur.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'app_state'
            )
        """)
        if not cur.fetchone()[0]:
            print("❌ No app_state table found. Nothing to migrate.")
            return None

        # Check if we already migrated (backup exists)
        cur.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'app_state_backup'
            )
        """)
        if cur.fetchone()[0]:
            print("⚠️  app_state_backup already exists — migration was already run.")
            print("   If you want to re-run, drop app_state_backup first:")
            print("   DROP TABLE app_state_backup;")
            return None

        cur.execute("SELECT data FROM app_state WHERE id = 'main'")
        row = cur.fetchone()
        if not row:
            print("❌ app_state table exists but no 'main' row found.")
            return None

        data = row[0]
        if isinstance(data, str):
            data = json.loads(data)

        print(f"✅ Read old data from app_state:")
        for key in sorted(data.keys()):
            val = data[key]
            if isinstance(val, list):
                print(f"   {key}: {len(val)} records")
            elif isinstance(val, dict):
                print(f"   {key}: dict ({len(val)} keys)")
            else:
                print(f"   {key}: {type(val).__name__}")

        return data
    finally:
        conn.close()


def migrate_data(old_db):
    """Insert old data into new relational tables."""
    # Import after setting DATABASE_URL
    from backend.models import Base
    from backend.models.database import engine, SessionLocal, init_db
    from backend.models import (
        User, Document, Anomaly, Match, Case,
        ActivityLog, CorrectionPattern, VendorProfile, KVMeta,
    )

    # Create all new tables
    init_db()
    print("\n✅ New relational tables created")

    session = SessionLocal()
    counts = {}

    try:
        # ── Users ──
        for u in old_db.get("users", []):
            session.add(User(
                id=u["id"], email=u["email"], name=u["name"],
                role=u["role"], password_hash=u["password_hash"],
                active=u.get("active", True),
            ))
        counts["users"] = len(old_db.get("users", []))

        # ── Documents (all types) ──
        doc_count = 0
        for doc_type, collection_key in [
            ("invoice", "invoices"), ("purchase_order", "purchase_orders"),
            ("contract", "contracts"), ("goods_receipt", "goods_receipts"),
        ]:
            for d in old_db.get(collection_key, []):
                d.setdefault("type", doc_type)
                doc_number = (d.get("invoiceNumber") or d.get("poNumber") or
                              d.get("contractNumber") or d.get("documentNumber") or
                              d.get("grnNumber"))
                session.add(Document(
                    id=d["id"], type=d.get("type", doc_type),
                    document_name=d.get("documentName"),
                    document_number=doc_number,
                    vendor=d.get("vendor"),
                    vendor_normalized=d.get("vendorNormalized"),
                    vendor_english=d.get("vendorEnglish"),
                    amount=d.get("amount", 0), subtotal=d.get("subtotal", 0),
                    total_tax=d.get("totalTax", 0),
                    currency=d.get("currency", "USD"),
                    status=d.get("status", "pending"),
                    issue_date=d.get("issueDate"), due_date=d.get("dueDate"),
                    delivery_date=d.get("deliveryDate"),
                    received_date=d.get("receivedDate"),
                    po_reference=d.get("poReference"),
                    original_invoice_ref=d.get("originalInvoiceRef"),
                    confidence=d.get("confidence", 0),
                    extraction_source=d.get("extractionSource"),
                    line_items=d.get("lineItems", []),
                    tax_details=d.get("taxDetails", []),
                    confidence_factors=d.get("confidenceFactors", {}),
                    ensemble_data=d.get("ensembleData"),
                    field_confidence=d.get("fieldConfidence"),
                    pricing_terms=d.get("pricingTerms"),
                    contract_terms=d.get("contractTerms"),
                    parties=d.get("parties"),
                    received_by=d.get("receivedBy"),
                    condition_notes=d.get("conditionNotes"),
                    payment_terms=d.get("paymentTerms"),
                    notes=d.get("notes"),
                    early_payment_discount=d.get("earlyPaymentDiscount"),
                    locale=d.get("locale", "en_US"),
                    document_language=d.get("documentLanguage", "en"),
                    uploaded_file=d.get("uploadedFile"),
                    uploaded_by=d.get("uploadedBy"),
                    uploaded_by_email=d.get("uploadedByEmail"),
                    triage_lane=d.get("triageLane"),
                    triage_confidence=d.get("triageConfidence"),
                    triage_reasons=d.get("triageReasons"),
                ))
                doc_count += 1
        counts["documents"] = doc_count

        # ── Anomalies ──
        for a in old_db.get("anomalies", []):
            session.add(Anomaly(
                id=a["id"], invoice_id=a.get("invoiceId"),
                invoice_number=a.get("invoiceNumber"),
                vendor=a.get("vendor"),
                currency=a.get("currency", "USD"),
                type=a["type"], severity=a["severity"],
                description=a.get("description"),
                amount_at_risk=a.get("amount_at_risk", 0),
                contract_clause=a.get("contract_clause"),
                recommendation=a.get("recommendation"),
                status=a.get("status", "open"),
                ai_explanation=a.get("aiExplanation"),
                ai_confidence=a.get("aiConfidence"),
            ))
        counts["anomalies"] = len(old_db.get("anomalies", []))

        # ── Matches ──
        for m in old_db.get("matches", []):
            session.add(Match(
                id=m["id"], invoice_id=m.get("invoiceId"),
                invoice_number=m.get("invoiceNumber"),
                invoice_amount=m.get("invoiceAmount", 0),
                invoice_subtotal=m.get("invoiceSubtotal", 0),
                vendor=m.get("vendor"),
                po_id=m.get("poId"), po_number=m.get("poNumber"),
                po_amount=m.get("poAmount", 0),
                match_score=m.get("matchScore", 0),
                signals=m.get("signals", []),
                amount_difference=m.get("amountDifference", 0),
                status=m.get("status"),
                po_already_invoiced=m.get("poAlreadyInvoiced", 0),
                po_remaining=m.get("poRemaining", 0),
                po_invoice_count=m.get("poInvoiceCount", 0),
                over_invoiced=m.get("overInvoiced", False),
                match_type=m.get("matchType", "two_way"),
                grn_status=m.get("grnStatus"),
                grn_ids=m.get("grnIds", []),
                grn_numbers=m.get("grnNumbers", []),
                total_received=m.get("totalReceived", 0),
                grn_line_items=m.get("grnLineItems", []),
                received_date=m.get("receivedDate"),
            ))
        counts["matches"] = len(old_db.get("matches", []))

        # ── Cases ──
        for c in old_db.get("cases", []):
            session.add(Case(
                id=c["id"], type=c.get("type", "anomaly_review"),
                title=c.get("title"), description=c.get("description"),
                status=c.get("status", "open"),
                priority=c.get("priority", "medium"),
                invoice_id=c.get("invoiceId"),
                anomaly_ids=c.get("anomalyIds", []),
                vendor=c.get("vendor"),
                amount_at_risk=c.get("amountAtRisk", 0),
                currency=c.get("currency", "USD"),
                created_by=c.get("createdBy"),
                assigned_to=c.get("assignedTo"),
                sla=c.get("sla", {}),
                case_notes=c.get("notes", []),
                status_history=c.get("statusHistory", []),
                resolution=c.get("resolution"),
                resolution_notes=c.get("resolutionNotes"),
                escalated_to=c.get("escalatedTo"),
                escalation_reason=c.get("escalationReason"),
                investigation_brief=c.get("investigationBrief"),
            ))
        counts["cases"] = len(old_db.get("cases", []))

        # ── Activity Log ──
        for a in old_db.get("activity_log", []):
            session.add(ActivityLog(
                id=a["id"], action=a["action"],
                document_id=a.get("documentId"),
                document_type=a.get("documentType"),
                document_number=a.get("documentNumber"),
                vendor=a.get("vendor"),
                amount=a.get("amount"), currency=a.get("currency"),
                confidence=a.get("confidence"),
                count=a.get("count"), total_risk=a.get("totalRisk"),
                performed_by=a.get("performedBy"),
                performed_by_email=a.get("performedByEmail"),
            ))
        counts["activity_log"] = len(old_db.get("activity_log", []))

        # ── Correction Patterns ──
        for cp in old_db.get("correction_patterns", []):
            session.add(CorrectionPattern(
                id=cp["id"], vendor=cp.get("vendor"),
                field=cp.get("field"),
                original_value=cp.get("extracted_value"),
                corrected_value=cp.get("corrected_value"),
                document_type=cp.get("documentType"),
                details={"vendorNormalized": cp.get("vendorNormalized", "")},
            ))
        counts["correction_patterns"] = len(old_db.get("correction_patterns", []))

        # ── Vendor Profiles ──
        for vp in old_db.get("vendor_profiles", []):
            session.add(VendorProfile(
                id=str(uuid.uuid4())[:12],
                vendor=vp["vendor"],
                vendor_normalized=vp.get("vendorNormalized"),
                risk_score=vp.get("riskScore", 50),
                risk_level=vp.get("riskLevel", "medium"),
                risk_trend=vp.get("riskTrend", "stable"),
                factors=vp.get("factors", {}),
                invoice_count=vp.get("invoiceCount", 0),
                total_spend=vp.get("totalSpend", 0),
                open_anomalies=vp.get("openAnomalies", 0),
                total_anomalies=vp.get("totalAnomalies", 0),
            ))
        counts["vendor_profiles"] = len(old_db.get("vendor_profiles", []))

        # ── KV Metadata ──
        kv_count = 0
        for key in ("_policy_state", "custom_model_config", "policy_history",
                     "triage_decisions", "finetune_history", "active_finetune_job",
                     "together_files"):
            if key in old_db and old_db[key]:
                session.add(KVMeta(key=key, value=old_db[key]))
                kv_count += 1
        counts["kv_metadata"] = kv_count

        session.commit()
        print("\n✅ All data migrated to relational tables:")
        for table, count in counts.items():
            print(f"   {table}: {count} records")

    except Exception as e:
        session.rollback()
        print(f"\n❌ Migration failed: {e}")
        raise
    finally:
        session.close()


def backup_old_table():
    """Rename app_state → app_state_backup."""
    conn = psycopg2.connect(DATABASE_URL)
    try:
        cur = conn.cursor()
        cur.execute("ALTER TABLE app_state RENAME TO app_state_backup")
        conn.commit()
        print("\n✅ Old app_state table renamed to app_state_backup")
        print("   (You can drop it later: DROP TABLE app_state_backup;)")
    finally:
        conn.close()


def main():
    print("=" * 55)
    print("  AuditLens — Database Migration")
    print("  app_state JSONB blob → relational tables")
    print("=" * 55)
    print()

    # Step 1: Read old data
    old_db = read_old_data()
    if old_db is None:
        return

    # Step 2: Migrate
    migrate_data(old_db)

    # Step 3: Backup old table
    backup_old_table()

    print()
    print("=" * 55)
    print("  ✅ Migration complete!")
    print()
    print("  Next steps:")
    print("  1. Deploy the upgraded code (git push)")
    print("  2. The app will use the new relational tables")
    print("  3. Verify everything works")
    print("  4. Later, drop the backup:")
    print("     DROP TABLE app_state_backup;")
    print("=" * 55)


if __name__ == "__main__":
    main()
