"""
AuditLens — Database Layer (v2 — SQLAlchemy)

Backward-compatible wrapper: existing code calls get_db()/save_db() with
dict-of-lists, while under the hood we use SQLAlchemy ORM.

Migration strategy:
  1. (NOW) This shim lets server.py work unchanged by converting between
     dict-of-lists ↔ SQLAlchemy objects on each call.
  2. (NEXT) Gradually migrate endpoints to use sessions directly.
"""

import os
import json
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone

# Register psycopg2 Json adapter so Python dicts/lists serialize to JSONB
try:
    from psycopg2.extras import Json
    from psycopg2.extensions import register_adapter
    register_adapter(dict, Json)
    register_adapter(list, Json)
except ImportError:
    pass  # SQLite mode — psycopg2 not installed

from backend.config import DB_PATH, DATA_DIR, UPLOAD_DIR, PERSIST_DATA
from backend.models import (
    Base, User, Document, Anomaly, Match, Case,
    ActivityLog, CorrectionPattern, VendorProfile, KVMeta,
)
from backend.models.database import engine, SessionLocal, init_db, _get_session_factory

logger = logging.getLogger("auditlens.db")

DATABASE_URL = os.environ.get("DATABASE_URL", "")

EMPTY_DB = {
    "invoices": [], "purchase_orders": [], "contracts": [],
    "goods_receipts": [], "matches": [], "anomalies": [],
    "activity_log": [], "correction_patterns": [], "vendor_profiles": [],
    "users": [], "cases": [], "triage_decisions": [],
    "policy_history": [], "custom_model_config": {},
    "_policy_state": {}, "finetune_history": [],
    "active_finetune_job": None, "together_files": [],
    "api_keys": [], "webhooks": [],
    "lifecycle_alerts": [], "_lifecycle_meta": {},
}


def _fresh_db():
    return json.loads(json.dumps(EMPTY_DB))


# Initialize tables lazily on first access, not at import time
_tables_initialized = False


def _ensure_tables():
    """Create tables if not yet done. Safe to call multiple times."""
    global _tables_initialized
    if _tables_initialized:
        return
    try:
        init_db()
        # Migrate existing columns if needed (safe to run multiple times)
        _run_migrations()
        _tables_initialized = True
    except Exception as e:
        logger.warning("DB table init deferred (will retry): %s", e)


def _run_migrations():
    """Apply schema migrations for existing Postgres databases."""
    session = _get_session_factory()()
    try:
        bind = session.get_bind()
        if "postgresql" in str(bind.url):
            from sqlalchemy import text
            # Migration: early_payment_discount varchar → jsonb
            try:
                session.execute(text(
                    "ALTER TABLE documents ALTER COLUMN early_payment_discount "
                    "TYPE JSONB USING early_payment_discount::jsonb"
                ))
                session.commit()
                logger.info("Migration: early_payment_discount → JSONB")
            except Exception:
                session.rollback()  # Already JSONB or table doesn't exist yet
    except Exception as e:
        logger.debug("Migration check skipped: %s", e)
    finally:
        session.close()


def _doc_type_to_collection(doc_type):
    return {"invoice": "invoices", "purchase_order": "purchase_orders",
            "contract": "contracts", "credit_note": "invoices",
            "debit_note": "invoices", "goods_receipt": "goods_receipts"
            }.get(doc_type, "invoices")


def _db_to_dict(session) -> dict:
    db = _fresh_db()
    for doc in session.query(Document).all():
        db[_doc_type_to_collection(doc.type)].append(doc.to_dict())
    db["matches"] = [m.to_dict() for m in session.query(Match).all()]
    db["anomalies"] = [a.to_dict() for a in session.query(Anomaly).all()]
    db["activity_log"] = [a.to_dict() for a in session.query(ActivityLog).order_by(ActivityLog.timestamp.desc()).all()]
    db["correction_patterns"] = [c.to_dict() for c in session.query(CorrectionPattern).all()]
    db["vendor_profiles"] = [v.to_dict() for v in session.query(VendorProfile).all()]
    db["users"] = [u.to_dict() for u in session.query(User).all()]
    db["cases"] = [c.to_dict() for c in session.query(Case).all()]

    # Non-ORM collections stored as KV metadata
    for row in session.query(KVMeta).all():
        db[row.key] = row.value

    # Synthesize flat "documents" list (used by custom_model + together_finetune)
    db["documents"] = db["invoices"] + db["purchase_orders"] + db["contracts"] + db["goods_receipts"]

    return db


def _sync_to_orm(db: dict, session):
    """Sync dict-of-lists → SQLAlchemy. Upsert semantics."""
    # Documents
    all_docs = []
    for doc_type, key in [("invoice", "invoices"), ("purchase_order", "purchase_orders"),
                           ("contract", "contracts"), ("goods_receipt", "goods_receipts")]:
        for d in db.get(key, []):
            if d.get("type") in ("credit_note", "debit_note"):
                pass  # handled below
            else:
                d.setdefault("type", doc_type)
            all_docs.append(d)
    # credit/debit notes in invoices
    for d in db.get("invoices", []):
        if d.get("type") in ("credit_note", "debit_note") and d not in all_docs:
            all_docs.append(d)

    existing_ids = {r[0] for r in session.query(Document.id).all()}
    for d in all_docs:
        if d["id"] in existing_ids:
            doc = session.get(Document, d["id"])
            if doc:
                for attr in ("status", "amount", "subtotal", "line_items", "tax_details",
                              "uploaded_by", "uploaded_by_email"):
                    legacy_key = {"line_items": "lineItems", "tax_details": "taxDetails",
                                  "uploaded_by": "uploadedBy", "uploaded_by_email": "uploadedByEmail"
                                  }.get(attr, attr)
                    if legacy_key in d:
                        setattr(doc, attr, d[legacy_key])
                if "triageLane" in d:
                    doc.triage_lane = d["triageLane"]
                    doc.triage_confidence = d.get("triageConfidence")
                    doc.triage_reasons = d.get("triageReasons")
        else:
            session.add(Document.from_dict(d))

    # Flush documents first — anomalies have FK to documents.id
    session.flush()

    # Anomalies
    existing = {r[0] for r in session.query(Anomaly.id).all()}
    for a in db.get("anomalies", []):
        if a["id"] in existing:
            obj = session.get(Anomaly, a["id"])
            if obj:
                obj.status = a.get("status", obj.status)
                if a.get("resolvedAt"):
                    try: obj.resolved_at = datetime.fromisoformat(a["resolvedAt"])
                    except: pass
                obj.resolved_by = a.get("resolvedBy", obj.resolved_by)
                obj.ai_explanation = a.get("aiExplanation", obj.ai_explanation)
        else:
            session.add(Anomaly(
                id=a["id"], invoice_id=a.get("invoiceId"), invoice_number=a.get("invoiceNumber"),
                vendor=a.get("vendor"), currency=a.get("currency", "USD"), type=a["type"],
                severity=a["severity"], description=a.get("description"),
                amount_at_risk=a.get("amount_at_risk", 0), contract_clause=a.get("contract_clause"),
                recommendation=a.get("recommendation"), status=a.get("status", "open"),
                ai_explanation=a.get("aiExplanation"), ai_confidence=a.get("aiConfidence"),
            ))

    # Matches
    existing = {r[0] for r in session.query(Match.id).all()}
    for m in db.get("matches", []):
        if m["id"] not in existing:
            session.add(Match(
                id=m["id"], invoice_id=m.get("invoiceId"), invoice_number=m.get("invoiceNumber"),
                invoice_amount=m.get("invoiceAmount", 0), invoice_subtotal=m.get("invoiceSubtotal", 0),
                vendor=m.get("vendor"), po_id=m.get("poId"), po_number=m.get("poNumber"),
                po_amount=m.get("poAmount", 0), match_score=m.get("matchScore", 0),
                signals=m.get("signals", []), amount_difference=m.get("amountDifference", 0),
                status=m.get("status"), po_already_invoiced=m.get("poAlreadyInvoiced", 0),
                po_remaining=m.get("poRemaining", 0), po_invoice_count=m.get("poInvoiceCount", 0),
                over_invoiced=m.get("overInvoiced", False), match_type=m.get("matchType", "two_way"),
                grn_status=m.get("grnStatus"), grn_ids=m.get("grnIds", []),
                grn_numbers=m.get("grnNumbers", []), total_received=m.get("totalReceived", 0),
                grn_line_items=m.get("grnLineItems", []), received_date=m.get("receivedDate"),
            ))
        else:
            obj = session.get(Match, m["id"])
            if obj:
                for attr in ("match_type", "grn_status", "grn_ids", "grn_numbers", "total_received", "grn_line_items"):
                    key = {"match_type": "matchType", "grn_status": "grnStatus", "grn_ids": "grnIds",
                           "grn_numbers": "grnNumbers", "total_received": "totalReceived",
                           "grn_line_items": "grnLineItems"}.get(attr, attr)
                    if key in m:
                        setattr(obj, attr, m[key])

    # Activity log (append only)
    existing = {r[0] for r in session.query(ActivityLog.id).all()}
    for a in db.get("activity_log", []):
        if a["id"] not in existing:
            session.add(ActivityLog(
                id=a["id"], action=a["action"], document_id=a.get("documentId"),
                document_type=a.get("documentType"), document_number=a.get("documentNumber"),
                vendor=a.get("vendor"), amount=a.get("amount"), currency=a.get("currency"),
                confidence=a.get("confidence"), count=a.get("count"), total_risk=a.get("totalRisk"),
                performed_by=a.get("performedBy"), performed_by_email=a.get("performedByEmail"),
            ))

    # Users
    existing = {r[0] for r in session.query(User.id).all()}
    for u in db.get("users", []):
        if u["id"] not in existing:
            session.add(User(id=u["id"], email=u["email"], name=u["name"],
                            role=u["role"], password_hash=u["password_hash"],
                            active=u.get("active", True)))
        else:
            obj = session.get(User, u["id"])
            if obj:
                obj.role = u.get("role", obj.role)
                obj.active = u.get("active", obj.active)
                obj.name = u.get("name", obj.name)

    # Correction patterns
    existing = {r[0] for r in session.query(CorrectionPattern.id).all()}
    for cp in db.get("correction_patterns", []):
        if cp["id"] not in existing:
            session.add(CorrectionPattern(
                id=cp["id"], vendor=cp.get("vendor"),
                field=cp.get("field"),
                original_value=cp.get("extracted_value"),
                corrected_value=cp.get("corrected_value"),
                document_type=cp.get("documentType"),
                details={"vendorNormalized": cp.get("vendorNormalized", "")},
            ))

    # Vendor profiles
    existing_vp = {(v.vendor_normalized or v.vendor): v for v in session.query(VendorProfile).all()}
    for vp in db.get("vendor_profiles", []):
        key = vp.get("vendorNormalized") or vp.get("vendor")
        if key in existing_vp:
            obj = existing_vp[key]
            for attr in ("risk_score", "risk_level", "risk_trend", "factors",
                         "invoice_count", "total_spend", "open_anomalies", "total_anomalies"):
                legacy = {"risk_score": "riskScore", "risk_level": "riskLevel", "risk_trend": "riskTrend",
                          "invoice_count": "invoiceCount", "total_spend": "totalSpend",
                          "open_anomalies": "openAnomalies", "total_anomalies": "totalAnomalies"
                          }.get(attr, attr)
                if legacy in vp:
                    setattr(obj, attr, vp[legacy])
        else:
            session.add(VendorProfile(
                id=str(uuid.uuid4())[:12], vendor=vp["vendor"],
                vendor_normalized=vp.get("vendorNormalized"),
                risk_score=vp.get("riskScore", 50), risk_level=vp.get("riskLevel", "medium"),
                risk_trend=vp.get("riskTrend", "stable"), factors=vp.get("factors", {}),
                invoice_count=vp.get("invoiceCount", 0), total_spend=vp.get("totalSpend", 0),
                open_anomalies=vp.get("openAnomalies", 0), total_anomalies=vp.get("totalAnomalies", 0),
            ))

    # Cases
    existing = {r[0] for r in session.query(Case.id).all()}
    for c in db.get("cases", []):
        if c["id"] not in existing:
            session.add(Case(
                id=c["id"], type=c.get("type", "anomaly_review"),
                title=c.get("title"), description=c.get("description"),
                status=c.get("status", "open"), priority=c.get("priority", "medium"),
                invoice_id=c.get("invoiceId"), anomaly_ids=c.get("anomalyIds", []),
                vendor=c.get("vendor"), amount_at_risk=c.get("amountAtRisk", 0),
                currency=c.get("currency", "USD"), created_by=c.get("createdBy"),
                assigned_to=c.get("assignedTo"),
                sla=c.get("sla", {}), case_notes=c.get("notes", []),
                status_history=c.get("statusHistory", []),
                resolution=c.get("resolution"),
                resolution_notes=c.get("resolutionNotes"),
                escalated_to=c.get("escalatedTo"),
                escalation_reason=c.get("escalationReason"),
                investigation_brief=c.get("investigationBrief"),
            ))
        else:
            obj = session.get(Case, c["id"])
            if obj:
                obj.status = c.get("status", obj.status)
                obj.priority = c.get("priority", obj.priority)
                obj.assigned_to = c.get("assignedTo", obj.assigned_to)
                obj.sla = c.get("sla", obj.sla)
                obj.case_notes = c.get("notes", obj.case_notes)
                obj.status_history = c.get("statusHistory", obj.status_history)
                obj.investigation_brief = c.get("investigationBrief", obj.investigation_brief)
                obj.resolution = c.get("resolution", obj.resolution)
                obj.resolution_notes = c.get("resolutionNotes", obj.resolution_notes)
                obj.escalated_to = c.get("escalatedTo", obj.escalated_to)
                obj.escalation_reason = c.get("escalationReason", obj.escalation_reason)

    # KV Metadata — all non-relational collections
    kv_keys = ("_policy_state", "custom_model_config", "policy_history",
               "triage_decisions", "finetune_history", "active_finetune_job",
               "together_files", "api_keys", "webhooks",
               "lifecycle_alerts", "_lifecycle_meta")
    for kv_key in kv_keys:
        if kv_key in db:
            existing_kv = session.get(KVMeta, kv_key)
            if existing_kv:
                existing_kv.value = db[kv_key]
            else:
                session.add(KVMeta(key=kv_key, value=db[kv_key]))

    session.commit()


# ============================================================
# PUBLIC API (backward compatible)
# ============================================================
_db_cache = None


def load_db():
    global _db_cache
    _ensure_tables()
    session = _get_session_factory()()
    try:
        _db_cache = _db_to_dict(session)
        return _db_cache
    finally:
        session.close()


def get_db():
    global _db_cache
    if _db_cache is None:
        return load_db()
    return _db_cache


def save_db(db):
    global _db_cache
    _db_cache = db
    _ensure_tables()
    session = _get_session_factory()()
    try:
        # Detect full reset: if all list collections are empty, truncate tables
        is_reset = (
            len(db.get("invoices", [])) == 0 and
            len(db.get("anomalies", [])) == 0 and
            len(db.get("users", [])) == 0 and
            len(db.get("cases", [])) == 0 and
            len(db.get("matches", [])) == 0 and
            len(db.get("activity_log", [])) == 0
        )
        if is_reset:
            # Full database reset — clear all tables
            for model in (ActivityLog, CorrectionPattern, VendorProfile,
                          Anomaly, Match, Case, Document, User, KVMeta):
                session.query(model).delete()
            session.commit()
            logger.info("Database reset — all tables truncated")
        else:
            _sync_to_orm(db, session)
    except Exception as e:
        session.rollback()
        logger.error("DB save failed: %s", e, exc_info=True)
        raise
    finally:
        session.close()


# ============================================================
# FILE STORAGE — S3/R2 with local fallback
# ============================================================
_s3_client = None

def _get_s3():
    """Lazy-init S3 client. Returns None if S3 not configured."""
    global _s3_client
    from backend.config import USE_S3, S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY
    if not USE_S3:
        return None
    if _s3_client is None:
        try:
            import boto3
            kwargs = {
                "service_name": "s3",
                "region_name": S3_REGION,
                "aws_access_key_id": S3_ACCESS_KEY,
                "aws_secret_access_key": S3_SECRET_KEY,
            }
            if S3_ENDPOINT:
                kwargs["endpoint_url"] = S3_ENDPOINT
            _s3_client = boto3.client(**kwargs)
        except ImportError:
            print("[Storage] boto3 not installed — falling back to local filesystem")
            return None
        except Exception as e:
            print(f"[Storage] S3 init failed: {e} — falling back to local filesystem")
            return None
    return _s3_client


def save_uploaded_file(filename, content, content_type="application/octet-stream"):
    """Save file to S3 if configured, otherwise local filesystem."""
    from backend.config import USE_S3, S3_BUCKET, S3_PREFIX
    s3 = _get_s3()
    if s3:
        try:
            key = f"{S3_PREFIX}{filename}"
            s3.put_object(Bucket=S3_BUCKET, Key=key, Body=content, ContentType=content_type)
            print(f"[Storage] Saved to S3: {key}")
            return
        except Exception as e:
            print(f"[Storage] S3 upload failed: {e} — saving locally")
    # Local fallback
    (UPLOAD_DIR / filename).write_bytes(content)


def load_uploaded_file(filename):
    """Load file from S3 if configured, otherwise local filesystem.
    Returns (path_or_bytes, exists). For S3, returns (bytes, True).
    For local, returns (Path, bool)."""
    from backend.config import USE_S3, S3_BUCKET, S3_PREFIX
    s3 = _get_s3()
    if s3:
        try:
            key = f"{S3_PREFIX}{filename}"
            resp = s3.get_object(Bucket=S3_BUCKET, Key=key)
            return resp["Body"].read(), True
        except Exception:
            pass  # Fall through to local check
    # Local fallback
    path = UPLOAD_DIR / filename
    return path, path.exists()


def _n(val, default=0):
    if val is None or val == "":
        return float(default)
    try:
        return float(val)
    except (ValueError, TypeError):
        return float(default)
