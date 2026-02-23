"""
AuditLens — ERP Integration Layer

Provides the four integration primitives needed for production ERP connectivity:
  1. API Key Authentication — machine-to-machine auth for ERP/middleware systems
  2. Batch Import — bulk document ingest with full pipeline processing
  3. Idempotent Upsert — prevents duplicates on re-sync (lookup by doc_number+vendor+type)
  4. Webhook Notifications — push events to external systems on anomaly/case/triage events

Architecture Notes:
  - API keys are stored in the main DB alongside users (KVMeta "api_keys")
  - Batch import reuses the SAME pipeline as /api/upload (matching, anomaly detection,
    triage, case creation) — it does NOT skip steps like /api/documents/manual
  - Idempotency is opt-in via `upsert: true` in the batch request
  - Webhooks are fire-and-forget with async delivery and configurable retry
"""

import os
import uuid
import hmac
import hashlib
import secrets
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

import aiohttp

from backend.config import AUTHORITY_MATRIX, DEFAULT_ROLE

logger = logging.getLogger("auditlens.integration")


# ============================================================
# 1. API KEY MANAGEMENT
# ============================================================

def generate_api_key() -> tuple[str, str]:
    """Generate an API key pair: (key_id, secret).
    Returns (display_key, hash_for_storage).
    Format: 'alens_<key_id>_<secret>' — shown once to user, never stored raw.
    """
    key_id = secrets.token_hex(4)       # 8 chars
    secret = secrets.token_hex(24)      # 48 chars
    raw_key = f"alens_{key_id}_{secret}"
    # Store only the hash — raw key shown once at creation
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    return raw_key, key_hash


def verify_api_key(raw_key: str, stored_hash: str) -> bool:
    """Constant-time comparison of API key against stored hash."""
    computed = hashlib.sha256(raw_key.encode()).hexdigest()
    return hmac.compare_digest(computed, stored_hash)


def get_api_keys(db: dict) -> list:
    """Get all API keys from DB (without raw secrets)."""
    return db.get("api_keys", [])


def create_api_key_record(db: dict, name: str, role: str = "analyst",
                          created_by: str = "system", scopes: list = None) -> dict:
    """Create a new API key and store it.
    Returns the record WITH the raw key (shown once to caller).
    """
    if role not in AUTHORITY_MATRIX:
        role = DEFAULT_ROLE

    raw_key, key_hash = generate_api_key()
    key_id = raw_key.split("_")[1]  # Extract key_id from alens_<key_id>_<secret>

    record = {
        "id": key_id,
        "name": name,
        "key_hash": key_hash,
        "key_prefix": raw_key[:16] + "...",  # Show first 16 chars for identification
        "role": role,
        "scopes": scopes or ["read", "write", "batch"],
        "created_by": created_by,
        "created_at": datetime.now().isoformat(),
        "last_used_at": None,
        "active": True,
        "request_count": 0,
    }

    db.setdefault("api_keys", []).append(record)
    # Return with raw key — caller MUST show this to user immediately
    return {**record, "raw_key": raw_key}


def revoke_api_key(db: dict, key_id: str) -> bool:
    """Deactivate an API key."""
    for k in db.get("api_keys", []):
        if k["id"] == key_id:
            k["active"] = False
            k["revoked_at"] = datetime.now().isoformat()
            return True
    return False


def authenticate_api_key(raw_key: str, db: dict) -> Optional[dict]:
    """Authenticate an API key and return user-equivalent dict.
    Returns None if invalid/inactive. Updates last_used_at on success.
    """
    if not raw_key or not raw_key.startswith("alens_"):
        return None

    for k in db.get("api_keys", []):
        if not k.get("active", True):
            continue
        if verify_api_key(raw_key, k["key_hash"]):
            # Update usage stats
            k["last_used_at"] = datetime.now().isoformat()
            k["request_count"] = k.get("request_count", 0) + 1
            # Return user-equivalent dict (compatible with _user_from_request)
            return {
                "id": f"apikey_{k['id']}",
                "email": f"apikey+{k['name']}@integration",
                "name": f"[API] {k['name']}",
                "role": k.get("role", DEFAULT_ROLE),
                "authenticated": True,
                "is_api_key": True,
                "api_key_id": k["id"],
                "scopes": k.get("scopes", []),
            }
    return None


# ============================================================
# 2. IDEMPOTENT UPSERT
# ============================================================

def find_existing_document(db: dict, doc_number: str, vendor: str,
                           doc_type: str) -> Optional[dict]:
    """Find an existing document by (document_number, vendor, type).
    Used for idempotent upsert — prevents duplicates on ERP re-sync.
    Uses normalized vendor name for fuzzy matching.
    """
    from backend.vendor import normalize_vendor, vendor_similarity

    if not doc_number or not vendor:
        return None

    doc_number_clean = doc_number.strip().upper()
    vendor_norm = normalize_vendor(vendor)

    # Map doc_type to collection
    collections = {
        "invoice": "invoices",
        "purchase_order": "purchase_orders",
        "contract": "contracts",
        "goods_receipt": "goods_receipts",
        "credit_note": "invoices",
        "debit_note": "invoices",
    }
    collection = collections.get(doc_type, "invoices")

    # Number field varies by type
    number_fields = {
        "invoice": "invoiceNumber",
        "purchase_order": "poNumber",
        "contract": "contractNumber",
        "goods_receipt": "grnNumber",
        "credit_note": "documentNumber",
        "debit_note": "documentNumber",
    }
    number_field = number_fields.get(doc_type, "invoiceNumber")

    for doc in db.get(collection, []):
        existing_number = (doc.get(number_field) or "").strip().upper()
        existing_vendor_norm = doc.get("vendorNormalized") or ""

        if existing_number == doc_number_clean:
            # Check vendor match (fuzzy — handles "GoldPak Ltd" vs "GoldPak Industries Ltd")
            if vendor_norm and existing_vendor_norm:
                if vendor_similarity(vendor, doc.get("vendor", "")) >= 0.7:
                    return doc
            elif not vendor_norm or not existing_vendor_norm:
                # If either vendor is blank, match on number alone
                return doc

    return None


def upsert_document_fields(existing: dict, updates: dict) -> dict:
    """Merge new field values into an existing document record.
    Only updates non-None fields from the updates dict.
    Returns the updated document.
    """
    # Fields that can be updated via upsert
    updatable = {
        "amount", "subtotal", "currency", "issueDate", "dueDate",
        "lineItems", "paymentTerms", "status", "taxDetails", "totalTax",
        "notes", "deliveryDate", "endDate", "effectiveDate",
        "contractTerms", "pricingTerms", "parties",
    }

    for key, value in updates.items():
        if key in updatable and value is not None:
            existing[key] = value

    existing["lastSyncedAt"] = datetime.now().isoformat()
    return existing


# ============================================================
# 3. BATCH IMPORT PROCESSING
# ============================================================

class BatchResult:
    """Collects results from a batch import operation."""
    def __init__(self):
        self.created = []
        self.updated = []
        self.skipped = []
        self.errors = []
        self.anomalies_detected = []
        self.cases_created = []
        self.matches_created = []

    def to_dict(self) -> dict:
        return {
            "summary": {
                "total_processed": len(self.created) + len(self.updated) + len(self.skipped),
                "created": len(self.created),
                "updated": len(self.updated),
                "skipped": len(self.skipped),
                "errors": len(self.errors),
                "anomalies_detected": len(self.anomalies_detected),
                "cases_created": len(self.cases_created),
                "matches_created": len(self.matches_created),
            },
            "created": self.created,
            "updated": self.updated,
            "skipped": self.skipped,
            "errors": self.errors,
            "anomalies_detected": [
                {"id": a["id"], "type": a["type"], "severity": a["severity"],
                 "invoiceNumber": a.get("invoiceNumber"), "vendor": a.get("vendor")}
                for a in self.anomalies_detected
            ],
            "cases_created": [
                {"id": c["id"], "type": c.get("type"), "title": c.get("title"),
                 "priority": c.get("priority")}
                for c in self.cases_created
            ],
        }


def validate_batch_item(item: dict, index: int) -> Optional[str]:
    """Validate a single item in a batch request. Returns error message or None."""
    doc_type = item.get("type")
    valid_types = ("invoice", "purchase_order", "contract", "goods_receipt",
                   "credit_note", "debit_note")
    if doc_type not in valid_types:
        return f"Item {index}: invalid type '{doc_type}'. Must be one of {valid_types}"

    if not item.get("vendor"):
        return f"Item {index}: 'vendor' is required"

    if not item.get("documentNumber"):
        return f"Item {index}: 'documentNumber' is required"

    return None


def build_record_from_batch_item(item: dict) -> dict:
    """Convert a batch import item into a document record compatible with the pipeline.
    Handles field mapping from ERP-style names to AuditLens internal format.
    """
    from backend.vendor import normalize_vendor

    fid = str(uuid.uuid4())[:8].upper()
    doc_type = item["type"]

    record = {
        "id": fid,
        "type": doc_type,
        "documentName": item.get("documentName", f"{doc_type}_{item['documentNumber']}"),
        "vendor": item["vendor"],
        "vendorNormalized": normalize_vendor(item["vendor"]),
        "vendorEnglish": item.get("vendorEnglish") or item["vendor"],
        "amount": float(item.get("amount") or 0),
        "subtotal": float(item.get("subtotal") or item.get("amount") or 0),
        "totalTax": float(item.get("totalTax") or 0),
        "taxDetails": item.get("taxDetails", []),
        "currency": item.get("currency", "USD"),
        "issueDate": item.get("issueDate"),
        "lineItems": item.get("lineItems", []),
        "status": "pending",
        "confidence": 100,  # ERP-sourced = structured data = 100% confidence
        "confidenceFactors": {"erp_integration": {"score": 100, "weight": 1.0,
                              "detail": "Structured data from ERP integration"}},
        "extractionSource": item.get("source", "erp_integration"),
        "extractedAt": datetime.now().isoformat(),
        "paymentTerms": item.get("paymentTerms"),
        "notes": item.get("notes"),
        "earlyPaymentDiscount": item.get("earlyPaymentDiscount"),
        "uploadedFile": None,
        # Integration metadata
        "erpSource": item.get("source", "erp"),
        "erpExternalId": item.get("externalId"),
        "lastSyncedAt": datetime.now().isoformat(),
    }

    # Type-specific fields
    if doc_type == "invoice":
        record.update({
            "invoiceNumber": item["documentNumber"],
            "poReference": item.get("poReference"),
            "dueDate": item.get("dueDate"),
            "status": "unpaid",
        })
    elif doc_type == "purchase_order":
        record.update({
            "poNumber": item["documentNumber"],
            "deliveryDate": item.get("deliveryDate"),
            "status": "open",
        })
    elif doc_type == "contract":
        record.update({
            "contractNumber": item["documentNumber"],
            "contractTerms": item.get("contractTerms", {}),
            "pricingTerms": item.get("pricingTerms", []),
            "parties": item.get("parties", []),
            "effectiveDate": item.get("effectiveDate"),
            "endDate": item.get("endDate"),
            "status": "active",
        })
    elif doc_type == "goods_receipt":
        record.update({
            "grnNumber": item["documentNumber"],
            "poReference": item.get("poReference"),
            "receivedDate": item.get("receivedDate"),
            "receivedBy": item.get("receivedBy"),
            "status": "received",
        })
    elif doc_type in ("credit_note", "debit_note"):
        record.update({
            "documentNumber": item["documentNumber"],
            "originalInvoiceRef": item.get("originalInvoiceRef"),
            "status": "pending",
        })

    return record


# ============================================================
# 4. WEBHOOK NOTIFICATIONS
# ============================================================

# Event types that can trigger webhooks
WEBHOOK_EVENTS = {
    "document.created",
    "document.updated",
    "anomaly.detected",
    "anomaly.resolved",
    "case.created",
    "case.escalated",
    "case.resolved",
    "triage.blocked",
    "triage.review",
    "batch.completed",
    "contract.expiring",
}


def get_webhook_config(db: dict) -> list:
    """Get all configured webhooks."""
    return db.get("webhooks", [])


def create_webhook(db: dict, url: str, events: list, name: str = "",
                   secret: str = "", created_by: str = "system") -> dict:
    """Register a new webhook endpoint."""
    # Generate signing secret if not provided
    if not secret:
        secret = secrets.token_hex(32)

    webhook = {
        "id": str(uuid.uuid4())[:8],
        "name": name or f"Webhook {len(db.get('webhooks', [])) + 1}",
        "url": url,
        "events": [e for e in events if e in WEBHOOK_EVENTS],
        "secret": secret,
        "active": True,
        "created_by": created_by,
        "created_at": datetime.now().isoformat(),
        "last_triggered_at": None,
        "success_count": 0,
        "failure_count": 0,
    }

    db.setdefault("webhooks", []).append(webhook)
    return webhook


def update_webhook(db: dict, webhook_id: str, updates: dict) -> Optional[dict]:
    """Update webhook configuration."""
    for wh in db.get("webhooks", []):
        if wh["id"] == webhook_id:
            if "url" in updates:
                wh["url"] = updates["url"]
            if "events" in updates:
                wh["events"] = [e for e in updates["events"] if e in WEBHOOK_EVENTS]
            if "active" in updates:
                wh["active"] = updates["active"]
            if "name" in updates:
                wh["name"] = updates["name"]
            return wh
    return None


def delete_webhook(db: dict, webhook_id: str) -> bool:
    """Remove a webhook."""
    webhooks = db.get("webhooks", [])
    before = len(webhooks)
    db["webhooks"] = [w for w in webhooks if w["id"] != webhook_id]
    return len(db["webhooks"]) < before


def _sign_payload(payload_bytes: bytes, secret: str) -> str:
    """HMAC-SHA256 signature for webhook payload verification."""
    return hmac.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()


async def _deliver_webhook(webhook: dict, event: str, payload: dict,
                           max_retries: int = 2):
    """Deliver a webhook event with retry. Fire-and-forget."""
    import json

    body = json.dumps({
        "event": event,
        "timestamp": datetime.now().isoformat(),
        "data": payload,
    }, default=str)

    headers = {
        "Content-Type": "application/json",
        "X-AuditLens-Event": event,
        "X-AuditLens-Signature": _sign_payload(body.encode(), webhook.get("secret", "")),
        "X-AuditLens-Delivery": str(uuid.uuid4()),
        "User-Agent": "AuditLens-Webhook/1.0",
    }

    for attempt in range(max_retries + 1):
        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(webhook["url"], data=body, headers=headers) as resp:
                    if resp.status < 300:
                        webhook["last_triggered_at"] = datetime.now().isoformat()
                        webhook["success_count"] = webhook.get("success_count", 0) + 1
                        logger.info("Webhook delivered: %s → %s (%d)", event, webhook["url"], resp.status)
                        return True
                    else:
                        logger.warning("Webhook %s returned %d (attempt %d/%d)",
                                       webhook["url"], resp.status, attempt + 1, max_retries + 1)
        except Exception as e:
            logger.warning("Webhook delivery failed: %s (attempt %d/%d): %s",
                           webhook["url"], attempt + 1, max_retries + 1, e)

        if attempt < max_retries:
            await asyncio.sleep(2 ** attempt)  # Exponential backoff: 1s, 2s

    webhook["failure_count"] = webhook.get("failure_count", 0) + 1
    return False


async def dispatch_webhook_event(db: dict, event: str, payload: dict):
    """Dispatch an event to all subscribed webhooks. Non-blocking fire-and-forget."""
    webhooks = db.get("webhooks", [])
    tasks = []

    for wh in webhooks:
        if not wh.get("active", True):
            continue
        if event not in wh.get("events", []):
            continue
        tasks.append(_deliver_webhook(wh, event, payload))

    if tasks:
        # Fire-and-forget: schedule as background tasks, don't block caller
        try:
            loop = asyncio.get_event_loop()
            for t in tasks:
                loop.create_task(t)
        except RuntimeError:
            # No running event loop (e.g. tests) — run synchronously as fallback
            await asyncio.gather(*tasks, return_exceptions=True)


# ============================================================
# 5. INTEGRATION STATUS
# ============================================================

def get_integration_status(db: dict) -> dict:
    """Dashboard view of integration health."""
    api_keys = db.get("api_keys", [])
    webhooks = db.get("webhooks", [])

    active_keys = [k for k in api_keys if k.get("active", True)]
    active_webhooks = [w for w in webhooks if w.get("active", True)]

    # Recent integration activity
    recent_syncs = [
        log for log in db.get("activity_log", [])
        if log.get("performedBy", "").startswith("[API]")
    ]

    return {
        "api_keys": {
            "total": len(api_keys),
            "active": len(active_keys),
            "total_requests": sum(k.get("request_count", 0) for k in api_keys),
        },
        "webhooks": {
            "total": len(webhooks),
            "active": len(active_webhooks),
            "total_deliveries": sum(w.get("success_count", 0) for w in webhooks),
            "total_failures": sum(w.get("failure_count", 0) for w in webhooks),
            "events_subscribed": list(set(
                e for w in active_webhooks for e in w.get("events", [])
            )),
        },
        "recent_sync_count": len(recent_syncs[-100:]),
        "available_events": sorted(WEBHOOK_EVENTS),
    }
