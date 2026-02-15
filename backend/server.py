"""
AuditLens — AI-Powered Spend Compliance Auditor
v2.7.0 — Fully Modular Architecture

FastAPI routing layer. All business logic lives in backend/* modules:
  config/     — Constants, feature flags, authority matrix
  db/         — Database abstraction (file JSON / PostgreSQL)
  auth/       — JWT, RBAC, user management
  extraction/ — Ensemble extraction pipeline (Sonnet + Haiku + math validation)
  vendor/     — Vendor normalization, similarity, risk scoring
  policy/     — AP policy state, presets, accessors
  anomalies/  — 16 rule-based anomaly detectors + GRN checks
  matching/   — PO matching (two-way) + GRN matching (three-way)
  documents/  — Record transformation, confidence scoring
  triage/     — Agentic invoice triage engine (BLOCK/REVIEW/AUTO_APPROVE)
  rag_engine  — RAG retrieval engine
"""

import sys
from pathlib import Path as _Path
# Ensure project root (parent of backend/) is on sys.path so 'from backend.x import' works
# regardless of whether we're launched from /app or /app/backend
_project_root = str(_Path(__file__).resolve().parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import os, json, base64, uuid, asyncio, re, math, copy as _copy
from datetime import datetime, timedelta
from pathlib import Path
from difflib import SequenceMatcher
from collections import defaultdict

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import anthropic
import time as _time

# ============================================================
# MODULE IMPORTS
# ============================================================
from backend.config import (
    VERSION, ENSEMBLE_PRIMARY_MODEL, ENSEMBLE_SECONDARY_MODEL,
    BASE_DIR, DATA_DIR, UPLOAD_DIR, FRONTEND_DIR, DB_PATH,
    USE_REAL_API, PERSIST_DATA, SEED_DEMO, RESET_ON_START,
    AUTHORITY_MATRIX, DEFAULT_ROLE, AUTH_ENABLED, TRIAGE_ENABLED,
)
from backend.db import (
    get_db, save_db, load_db, _fresh_db, _n,
    save_uploaded_file, load_uploaded_file, EMPTY_DB, DATABASE_URL,
)
from backend.auth import (
    hash_password, verify_password, create_jwt, decode_jwt,
    _get_users, _save_users, get_current_user, get_optional_user,
    get_role_from_request, get_user_display, require_role,
    get_authority_limit, get_required_approver, security,
    _user_from_request,
)
from backend.extraction import (
    extract_with_claude as _module_extract_with_claude,
    _math_validate, _ensemble_merge,
    _numeric_close, _string_match, _compare_line_items, _compare_tax,
    _vendor_cross_reference, _build_vendor_context, _build_po_context,
    build_correction_hints, learn_from_correction, EXTRACTION_PROMPT,
)
from backend.vendor import (
    normalize_vendor, vendor_similarity, currency_symbol, severity_for_amount,
    compute_vendor_risk_score, get_dynamic_tolerances, update_vendor_profile,
    find_vendor_contract,
)
from backend.policy import (
    DEFAULT_POLICY, get_policy, update_policy, reset_policy,
    POLICY_PRESETS, _active_policy,
    get_amount_tolerance, get_price_tolerance, get_over_invoice_pct,
    get_duplicate_window, get_matching_mode,
)
from backend.anomalies import (
    detect_anomalies_rule_based, detect_grn_anomalies,
    detect_anomalies_with_claude, ANOMALY_PROMPT,
)
from backend.matching import (
    match_invoice_to_po, run_matching, run_grn_matching,
    get_grn_for_po, get_po_fulfillment,
)
from backend.documents import (
    transform_extracted_to_record, compute_extraction_confidence,
)
from backend.triage import (
    triage_invoice, store_triage_decision, apply_triage_action,
)

# RAG Engine
try:
    from backend.rag_engine import (on_document_uploaded, on_anomaly_detected, on_document_edited,
        get_extraction_context, get_anomaly_context, get_rag_stats, reset_rag, on_anomalies_detected_batch)
    RAG_ENABLED = True
except ImportError:
    try:
        from rag_engine import (on_document_uploaded, on_anomaly_detected, on_document_edited,
            get_extraction_context, get_anomaly_context, get_rag_stats, reset_rag, on_anomalies_detected_batch)
        RAG_ENABLED = True
    except ImportError:
        RAG_ENABLED = False
        async def on_document_uploaded(doc): pass
        async def on_anomaly_detected(anom): pass
        async def on_anomalies_detected_batch(anoms): pass
        async def on_document_edited(doc): pass
        async def get_extraction_context(v, d): return ""
        async def get_anomaly_context(inv): return ""
        def get_rag_stats(): return {"enabled": False}
        async def reset_rag(): pass

# Wrapper: extraction with RAG context injection
async def extract_with_claude(file_path, file_name, media_type, vendor_hint="", doc_type_hint=""):
    return await _module_extract_with_claude(
        file_path, file_name, media_type, vendor_hint, doc_type_hint,
        rag_get_extraction_context=get_extraction_context if RAG_ENABLED else None
    )

# ============================================================
# FASTAPI APP
# ============================================================
app = FastAPI(title="AuditLens", version=VERSION)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ============================================================
# AUTH ROUTES
# ============================================================
@app.post("/api/auth/register")
async def register(request: Request):
    try:
        body = await request.json()
    except:
        raise HTTPException(400, "Invalid JSON")
    email = (body.get("email") or "").strip().lower()
    password = body.get("password", "")
    name = (body.get("name") or "").strip()
    role = (body.get("role") or "analyst").lower().strip()
    if not email or "@" not in email: raise HTTPException(400, "Valid email required")
    if len(password) < 6: raise HTTPException(400, "Password must be at least 6 characters")
    if not name: raise HTTPException(400, "Name required")
    if role not in AUTHORITY_MATRIX: raise HTTPException(400, f"Invalid role. Must be one of: {list(AUTHORITY_MATRIX.keys())}")
    users = _get_users()
    if any(u["email"] == email for u in users): raise HTTPException(409, "Email already registered")
    user = {"id": str(uuid.uuid4())[:12], "email": email, "name": name, "role": role,
            "password_hash": hash_password(password), "active": True, "createdAt": datetime.now().isoformat()}
    users.append(user); _save_users(users)
    token = create_jwt(user)
    return {"success": True, "token": token,
            "user": {"id": user["id"], "email": user["email"], "name": user["name"],
                     "role": user["role"], "roleTitle": AUTHORITY_MATRIX[user["role"]]["title"]}}

@app.post("/api/auth/login")
async def login(request: Request):
    try:
        body = await request.json()
    except:
        raise HTTPException(400, "Invalid JSON")
    email = (body.get("email") or "").strip().lower()
    password = body.get("password", "")
    users = _get_users()
    user = next((u for u in users if u["email"] == email and u.get("active", True)), None)
    if not user or not verify_password(password, user["password_hash"]): raise HTTPException(401, "Invalid email or password")
    token = create_jwt(user)
    return {"success": True, "token": token,
            "user": {"id": user["id"], "email": user["email"], "name": user["name"],
                     "role": user["role"], "roleTitle": AUTHORITY_MATRIX[user["role"]]["title"]}}

@app.get("/api/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {"user": user, "roleTitle": AUTHORITY_MATRIX.get(user["role"], AUTHORITY_MATRIX[DEFAULT_ROLE])["title"],
            "limits": AUTHORITY_MATRIX.get(user["role"], AUTHORITY_MATRIX[DEFAULT_ROLE])["limits"]}

@app.get("/api/auth/users")
async def list_users(user: dict = Depends(get_current_user)):
    if user["role"] not in ("cfo", "vp"): raise HTTPException(403, "Insufficient permissions to view users")
    users = _get_users()
    return {"users": [{"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"],
        "roleTitle": AUTHORITY_MATRIX.get(u["role"], AUTHORITY_MATRIX[DEFAULT_ROLE])["title"],
        "active": u.get("active", True), "createdAt": u.get("createdAt")} for u in users]}

@app.post("/api/auth/users/{user_id}/role")
async def update_user_role(user_id: str, request: Request, admin: dict = Depends(get_current_user)):
    if admin["role"] != "cfo": raise HTTPException(403, "Only CFO can change roles")
    try: body = await request.json()
    except: raise HTTPException(400, "Invalid JSON")
    new_role = body.get("role", "").lower().strip()
    if new_role not in AUTHORITY_MATRIX: raise HTTPException(400, f"Invalid role: {new_role}")
    users = _get_users()
    user = next((u for u in users if u["id"] == user_id), None)
    if not user: raise HTTPException(404, "User not found")
    user["role"] = new_role; _save_users(users)
    return {"success": True, "user": {"id": user["id"], "name": user["name"], "role": new_role}}

@app.post("/api/auth/users/{user_id}/deactivate")
async def deactivate_user(user_id: str, admin: dict = Depends(get_current_user)):
    if admin["role"] != "cfo": raise HTTPException(403, "Only CFO can deactivate users")
    users = _get_users()
    user = next((u for u in users if u["id"] == user_id), None)
    if not user: raise HTTPException(404, "User not found")
    if user["id"] == admin["id"]: raise HTTPException(400, "Cannot deactivate yourself")
    user["active"] = False; _save_users(users)
    return {"success": True}

@app.get("/api/auth/status")
async def auth_status():
    users = _get_users()
    return {"auth_enabled": AUTH_ENABLED, "has_users": len(users) > 0, "user_count": len(users)}


# ── Backward-compatible module-level constants (read from policy/) ──
AMOUNT_TOLERANCE_PCT = DEFAULT_POLICY["amount_tolerance_pct"]
PRICE_TOLERANCE_PCT = DEFAULT_POLICY["price_tolerance_pct"]
OVER_INVOICE_PCT = DEFAULT_POLICY["over_invoice_pct"]
DUPLICATE_DAYS_WINDOW = DEFAULT_POLICY["duplicate_window_days"]



# ── Triage, anomaly detection, matching, and document transformation
# ── now live in backend/triage/, backend/anomalies/, backend/matching/, backend/documents/
# ── Imported at top of file


# ============================================================
# ROUTES
# ============================================================
@app.get("/api/health")
async def health():
    from backend.config import LOCALE_PROFILES, SUPPORTED_LANGUAGES
    return {"status": "ok", "product": "AuditLens",
        "claude_api": "connected" if USE_REAL_API else "no_api_key", "version": VERSION,
        "features": {"agentic_triage": TRIAGE_ENABLED, "vendor_risk_scoring": True,
            "delegation_of_authority": True, "three_way_matching": True,
            "policy_engine": True, "authentication": AUTH_ENABLED,
            "rag_feedback_loop": RAG_ENABLED,
            "ensemble_extraction": USE_REAL_API,
            "multilingual_extraction": True,
            "supported_locales": list(LOCALE_PROFILES.keys()),
            "supported_languages": SUPPORTED_LANGUAGES}}

@app.get("/api/locales")
async def get_locales():
    """Return all supported locales with their tax system definitions."""
    from backend.config import LOCALE_PROFILES, CURRENCY_LOCALE_MAP, SUPPORTED_LANGUAGES
    return {
        "locales": {k: {"name": v["name"], "languages": v["languages"],
            "tax_systems": list(v["tax_systems"].keys()),
            "tax_rate_ceiling": v["tax_rate_ceiling"],
            "currencies": v["common_currencies"]}
            for k, v in LOCALE_PROFILES.items()},
        "currency_locale_map": CURRENCY_LOCALE_MAP,
        "supported_languages": SUPPORTED_LANGUAGES,
    }

@app.get("/api/authority-matrix")
async def authority_matrix():
    """F4: Return the delegation of authority matrix for display."""
    return {"roles": {k: {"title": v["title"], "level": v["level"], "limits": v["limits"]}
        for k, v in AUTHORITY_MATRIX.items()}}

@app.get("/api/role-info")
async def role_info(request: Request):
    """F4: Return current role info based on X-User-Role header."""
    role = get_role_from_request(request)
    info = AUTHORITY_MATRIX.get(role, AUTHORITY_MATRIX[DEFAULT_ROLE])
    return {"role": role, "title": info["title"], "level": info["level"], "limits": info["limits"]}

# ============================================================
# AP POLICY CONFIGURATION API
# ============================================================
# POLICY_PRESETS imported from backend.policy (single source of truth)

@app.get("/api/policy")
async def get_policy_endpoint():
    """Return the active AP policy configuration."""
    return {"policy": get_policy(), "presets": list(POLICY_PRESETS.keys())}

@app.post("/api/policy")
async def update_policy_endpoint(request: Request):
    """Update policy fields. Requires manager+ role."""
    # RBAC: analysts cannot change policy
    try:
        user = _user_from_request(request)
        if user.get("role") == "analyst":
            raise HTTPException(403, "Policy changes require Manager, VP, or CFO role")
    except HTTPException as e:
        if e.status_code == 403: raise
        pass  # Allow unauthenticated if auth not enabled
    try:
        body = await request.json()
    except:
        raise HTTPException(400, "Invalid JSON")
    updated = update_policy(body)
    db = get_db()
    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "policy_updated",
        "fieldsChanged": list(body.keys()), "timestamp": datetime.now().isoformat(),
        "performedBy": user.get("name","System")})
    save_db(db)
    return {"success": True, "policy": updated}

@app.post("/api/policy/preset/{preset_name}")
async def apply_policy_preset(preset_name: str, request: Request):
    """Apply a named policy preset. Requires manager+ role."""
    try:
        user = _user_from_request(request)
        if user.get("role") == "analyst":
            raise HTTPException(403, "Policy presets require Manager, VP, or CFO role")
    except HTTPException as e:
        if e.status_code == 403: raise
        pass
    if preset_name not in POLICY_PRESETS:
        raise HTTPException(404, f"Unknown preset. Available: {list(POLICY_PRESETS.keys())}")
    preset = POLICY_PRESETS[preset_name]
    # Don't overwrite name/description into the active policy
    fields = {k: v for k, v in preset.items() if k not in ("name", "description")}
    updated = update_policy(fields)
    db = get_db()
    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "policy_preset_applied",
        "preset": preset_name, "timestamp": datetime.now().isoformat(),
        "performedBy": user.get("name","System")})
    save_db(db)
    return {"success": True, "preset": preset_name, "applied": fields, "policy": updated}

@app.get("/api/policy/presets")
async def list_policy_presets():
    """List all available policy presets with descriptions."""
    return {"presets": {k: {"name": v["name"], "description": v["description"]}
        for k, v in POLICY_PRESETS.items()}}

@app.post("/api/upload")
async def upload_document(request: Request, file: UploadFile = File(...), document_type: str = Form("auto")):
  try:
    import time as _time
    _t0 = _time.time()
    _timings = {}
    _upload_user = _user_from_request(request)
    _upload_by = _upload_user.get("name","System") if _upload_user else "System"
    _upload_email = _upload_user.get("email","") if _upload_user else ""

    ct = file.content_type or "application/octet-stream"
    ext = Path(file.filename or "doc").suffix.lower()
    em = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    if ct == "application/octet-stream" and ext in em: ct = em[ext]

    fid = str(uuid.uuid4())[:8].upper()
    stored_name = f"{fid}_{file.filename}"
    file_content = await file.read()

    # Store file in persistent storage (Postgres or filesystem)
    save_uploaded_file(stored_name, file_content, ct)

    # Also write to local filesystem for extraction processing
    fp = UPLOAD_DIR / stored_name
    fp.write_bytes(file_content)
    _timings["file_storage_ms"] = round((_time.time() - _t0) * 1000)

    _t1 = _time.time()
    print(f"[Upload] Processing '{file.filename}' (type={ct}, doc_type={document_type})")
    extracted = await extract_with_claude(str(fp), file.filename, ct)
    _timings["ai_extraction_ms"] = round((_time.time() - _t1) * 1000)
    print(f"[Upload] Extraction done: doc_type={extracted.get('document_type')}, vendor={extracted.get('vendor_name')}, source={extracted.get('_source')}")

    # If extraction failed, return error with file reference so user can manually index
    if extracted.get("_extraction_failed"):
        error_msg = extracted.get("_error", "Extraction failed")
        print(f"[Upload] EXTRACTION FAILED: {error_msg}")
        db = get_db()
        db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "extraction_failed",
            "documentId": fid, "fileName": file.filename, "error": error_msg,
            "timestamp": datetime.now().isoformat(), "performedBy": _upload_by})
        save_db(db)
        return JSONResponse(status_code=200, content={
            "success": False, "error": error_msg, "fileId": fid, "fileName": file.filename,
            "storedFile": stored_name, "processing_time": _timings})

    if document_type in ("invoice", "purchase_order", "contract", "credit_note", "debit_note", "goods_receipt"):
        extracted["document_type"] = document_type

    _t2 = _time.time()
    record = transform_extracted_to_record(extracted, file.filename, fid)
    _timings["confidence_scoring_ms"] = round((_time.time() - _t2) * 1000)
    print(f"[Upload] Record created: type={record['type']}, vendor={record['vendor']}, amount={record['amount']}")

    db = get_db()
    store = {"invoice": "invoices", "purchase_order": "purchase_orders", "contract": "contracts",
             "credit_note": "invoices", "debit_note": "invoices", "goods_receipt": "goods_receipts"}
    record["uploadedBy"] = _upload_by
    record["uploadedByEmail"] = _upload_email
    db[store.get(record["type"], "invoices")].append(record)

    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "document_uploaded",
        "documentId": fid, "documentType": record["type"],
        "documentNumber": record.get("invoiceNumber") or record.get("poNumber") or record.get("contractNumber") or record.get("documentNumber"),
        "vendor": record["vendor"], "amount": record["amount"], "currency": record.get("currency"),
        "confidence": record["confidence"], "timestamp": datetime.now().isoformat(),
        "performedBy": _upload_by, "performedByEmail": _upload_email})

    new_matches, new_anomalies = [], []

    _t3 = _time.time()
    if record["type"] in ("invoice", "purchase_order"):
        new_matches = run_matching(db)
        db["matches"].extend(new_matches)
    _timings["matching_ms"] = round((_time.time() - _t3) * 1000)

    _t4 = _time.time()
    if record["type"] == "invoice":
        mpo = None
        for m in db["matches"]:
            if m.get("invoiceId") == record["id"]:
                mpo = next((p for p in db["purchase_orders"] if p["id"] == m.get("poId")), None)
                break
        vc = find_vendor_contract(record["vendor"], db.get("contracts", []))
        vh = [i for i in db["invoices"] if i.get("vendor") and record.get("vendor") and
              vendor_similarity(i["vendor"], record["vendor"]) >= 0.7 and i["id"] != record["id"]]
        # F3: Dynamic tolerances based on vendor risk
        vendor_tols = get_dynamic_tolerances(record["vendor"], db)
        detected = await detect_anomalies_with_claude(record, mpo, vc, vh, tolerances=vendor_tols)
        for a in detected:
            anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                "invoiceNumber": record.get("invoiceNumber", ""), "vendor": record["vendor"],
                "currency": record.get("currency", "USD"),
                "detectedAt": datetime.now().isoformat(), "status": "open", **a}
            new_anomalies.append(anom)
            db["anomalies"].append(anom)

        # F5: Three-way match anomalies (GRN checks)
        matched_entry = next((m for m in db["matches"] if m.get("invoiceId") == record["id"]), None)
        if matched_entry and mpo:
            grn_info = {k: matched_entry.get(k) for k in
                ("matchType", "grnStatus", "grnIds", "grnNumbers", "totalReceived", "grnLineItems")}
            grn_anomalies = detect_grn_anomalies(record, mpo, grn_info, db)
            for a in grn_anomalies:
                anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                    "invoiceNumber": record.get("invoiceNumber", ""), "vendor": record["vendor"],
                    "currency": record.get("currency", "USD"),
                    "detectedAt": datetime.now().isoformat(), "status": "open", **a}
                new_anomalies.append(anom)
                db["anomalies"].append(anom)

    # Activity log for invoice anomalies
    _timings["anomaly_detection_ms"] = round((_time.time() - _t4) * 1000)
    if record["type"] == "invoice" and new_anomalies:
        db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "anomalies_detected",
            "documentId": record["id"], "documentNumber": record.get("invoiceNumber"),
            "vendor": record["vendor"], "count": len(new_anomalies),
            "totalRisk": sum(a.get("amount_at_risk", 0) for a in new_anomalies if a.get("amount_at_risk", 0) > 0),
            "timestamp": datetime.now().isoformat(), "performedBy": _upload_by})

    # F5: When GRN uploaded — update existing matches to three-way and re-check anomalies
    if record["type"] == "goods_receipt":
        grn_updated = run_grn_matching(db)
        if grn_updated:
            # Re-run GRN anomaly checks for affected invoices
            for match in db["matches"]:
                if match.get("matchType") == "three_way":
                    inv = next((i for i in db["invoices"] if i["id"] == match.get("invoiceId")), None)
                    po = next((p for p in db["purchase_orders"] if p["id"] == match.get("poId")), None)
                    if inv and po:
                        # Remove old GRN-related anomalies for this invoice
                        grn_types = {"UNRECEIPTED_INVOICE", "OVERBILLED_VS_RECEIVED", "QUANTITY_RECEIVED_MISMATCH", "SHORT_SHIPMENT"}
                        db["anomalies"] = [a for a in db["anomalies"]
                            if not (a.get("invoiceId") == inv["id"] and a.get("type") in grn_types)]
                        grn_info = {k: match.get(k) for k in
                            ("matchType", "grnStatus", "grnIds", "grnNumbers", "totalReceived", "grnLineItems")}
                        grn_anoms = detect_grn_anomalies(inv, po, grn_info, db)
                        for a in grn_anoms:
                            anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": inv["id"],
                                "invoiceNumber": inv.get("invoiceNumber", ""), "vendor": inv["vendor"],
                                "currency": inv.get("currency", "USD"),
                                "detectedAt": datetime.now().isoformat(), "status": "open", **a}
                            new_anomalies.append(anom)
                            db["anomalies"].append(anom)
            db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "grn_matched",
                "documentId": record["id"], "documentNumber": record.get("grnNumber"),
                "vendor": record["vendor"], "matchesUpdated": grn_updated,
                "timestamp": datetime.now().isoformat(), "performedBy": _upload_by})

    # Fix #20: PO-level anomaly checks against contract
    if record["type"] == "purchase_order":
        vc = find_vendor_contract(record["vendor"], db.get("contracts", []))
        if vc:
            sym = currency_symbol(record.get("currency", "USD"))
            po_amt = record.get("amount", 0)
            po_num = record.get("poNumber", record["id"])

            # Check: PO exceeds contract liability cap
            ct = vc.get("contractTerms") or {}
            cap = ct.get("liability_cap")
            if cap and po_amt > cap:
                diff = po_amt - cap
                anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                    "invoiceNumber": po_num, "vendor": record["vendor"],
                    "currency": record.get("currency", "USD"), "detectedAt": datetime.now().isoformat(),
                    "status": "open", "type": "AMOUNT_DISCREPANCY", "severity": "high",
                    "description": f"PO amount {sym}{po_amt:,.2f} exceeds contract liability cap {sym}{cap:,.2f} by {sym}{diff:,.2f}.",
                    "amount_at_risk": round(diff, 2), "contract_clause": f"Liability cap: {sym}{cap:,.2f}",
                    "recommendation": "PO exceeds contractual limits. Renegotiate or split into multiple POs."}
                new_anomalies.append(anom); db["anomalies"].append(anom)

            # Check: PO issued against expired contract
            expiry = ct.get("expiry_date")
            if expiry:
                try:
                    exp_date = datetime.fromisoformat(expiry)
                    po_date = datetime.fromisoformat(record.get("issueDate", "")) if record.get("issueDate") else datetime.now()
                    if po_date > exp_date:
                        days_expired = (po_date - exp_date).days
                        anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                            "invoiceNumber": po_num, "vendor": record["vendor"],
                            "currency": record.get("currency", "USD"), "detectedAt": datetime.now().isoformat(),
                            "status": "open", "type": "TERMS_VIOLATION", "severity": "high",
                            "description": f"PO issued {days_expired} days after contract expired on {expiry}.",
                            "amount_at_risk": po_amt, "contract_clause": f"Contract expired: {expiry}",
                            "recommendation": "Renew contract before issuing new purchase orders."}
                        new_anomalies.append(anom); db["anomalies"].append(anom)
                except: pass

            # Check: PO terms differ from contract
            po_terms = (record.get("paymentTerms") or "").lower().strip()
            c_terms = (vc.get("paymentTerms") or "").lower().strip()
            if po_terms and c_terms and po_terms != c_terms:
                anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                    "invoiceNumber": po_num, "vendor": record["vendor"],
                    "currency": record.get("currency", "USD"), "detectedAt": datetime.now().isoformat(),
                    "status": "open", "type": "TERMS_VIOLATION", "severity": "medium",
                    "description": f"PO terms '{record.get('paymentTerms')}' differ from contract '{vc.get('paymentTerms')}'.",
                    "amount_at_risk": 0, "contract_clause": f"Contract: {vc.get('paymentTerms')}",
                    "recommendation": "Align PO terms with contract before sending to vendor."}
                new_anomalies.append(anom); db["anomalies"].append(anom)

    # Activity log for PO anomalies
    if record["type"] == "purchase_order" and new_anomalies:
        db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "anomalies_detected",
            "documentId": record["id"], "documentNumber": record.get("poNumber"),
            "vendor": record["vendor"], "count": len(new_anomalies),
            "totalRisk": sum(a.get("amount_at_risk", 0) for a in new_anomalies if a.get("amount_at_risk", 0) > 0),
            "timestamp": datetime.now().isoformat(), "performedBy": _upload_by})

    # Fix #7: Validate credit/debit notes against original invoice
    if record["type"] in ("credit_note", "debit_note"):
        orig_ref = record.get("originalInvoiceRef")
        cn_amount = record.get("amount", 0)
        sym = currency_symbol(record.get("currency", "USD"))
        dt_label = "Credit note" if record["type"] == "credit_note" else "Debit note"
        doc_num = record.get("documentNumber", record["id"])

        if not orig_ref:
            new_anomalies.append({"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                "invoiceNumber": doc_num, "vendor": record["vendor"],
                "currency": record.get("currency", "USD"), "detectedAt": datetime.now().isoformat(),
                "status": "open", "type": "MISSING_PO", "severity": "medium",
                "description": f"{dt_label} {doc_num} has no original invoice reference.",
                "amount_at_risk": cn_amount, "contract_clause": None,
                "recommendation": "Verify which invoice this note applies to."})
            db["anomalies"].append(new_anomalies[-1])
        else:
            # Find original invoice and cross-check
            orig = next((i for i in db["invoices"]
                if i.get("invoiceNumber", "").strip().lower() == orig_ref.strip().lower()), None)
            if orig and cn_amount > orig.get("amount", 0):
                diff = cn_amount - orig["amount"]
                new_anomalies.append({"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                    "invoiceNumber": doc_num, "vendor": record["vendor"],
                    "currency": record.get("currency", "USD"), "detectedAt": datetime.now().isoformat(),
                    "status": "open", "type": "AMOUNT_DISCREPANCY", "severity": "high",
                    "description": f"{dt_label} amount {sym}{cn_amount:,.2f} exceeds original invoice {orig_ref} amount {sym}{orig['amount']:,.2f} by {sym}{diff:,.2f}.",
                    "amount_at_risk": round(diff, 2), "contract_clause": None,
                    "recommendation": f"Do not process. {dt_label} cannot exceed original invoice."})
                db["anomalies"].append(new_anomalies[-1])
        if new_anomalies:
            db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "anomalies_detected",
                "documentId": record["id"], "documentNumber": record.get("invoiceNumber"),
                "vendor": record["vendor"], "count": len(new_anomalies),
                "totalRisk": sum(a.get("amount_at_risk", 0) for a in new_anomalies if a.get("amount_at_risk", 0) > 0),
                "timestamp": datetime.now().isoformat(), "performedBy": _upload_by})

    save_db(db)

    # Index into RAG for future retrieval
    try:
        await on_document_uploaded(record)
        if new_anomalies:
            await on_anomalies_detected_batch(new_anomalies)
    except Exception as e:
        print(f"RAG indexing error (non-fatal): {e}")

    # ── F3: Update vendor risk profile ──
    db = get_db()  # Reload after save
    update_vendor_profile(record["vendor"], db)

    # ── F1: Triage invoice / credit note / debit note (NS3 FIX) ──
    _t5 = _time.time()
    triage_result = None
    if record["type"] in ("invoice", "credit_note", "debit_note"):
        # Use the DB copy (post-save), not the stale pre-save record
        db_invoice = next((i for i in db["invoices"] if i["id"] == record["id"]), None)
        if db_invoice:
            triage_result = triage_invoice(db_invoice, db.get("anomalies", []), db, performed_by=_upload_by)
            store_triage_decision(db_invoice["id"], triage_result, db)
            apply_triage_action(db_invoice, triage_result, db, performed_by=_upload_by)
            record = db_invoice  # Update return value with triage fields

    save_db(db)

    # ── Timing summary (must persist to DB for dashboard speed metrics) ──
    _timings["triage_ms"] = round((_time.time() - _t5) * 1000)
    _timings["total_ms"] = round((_time.time() - _t0) * 1000)
    record["processingTime"] = _timings
    print(f"[Upload] Pipeline timing: {_timings}")

    # Persist timing into the stored record
    db = get_db()
    stores = {"invoice": "invoices", "purchase_order": "purchase_orders", "contract": "contracts",
              "credit_note": "invoices", "debit_note": "invoices", "goods_receipt": "goods_receipts"}
    coll = db.get(stores.get(record["type"], "invoices"), [])
    for d in coll:
        if d["id"] == record["id"]:
            d["processingTime"] = _timings
            break
    save_db(db)

    return {"success": True, "document": record, "new_matches": new_matches,
        "new_anomalies": new_anomalies, "extraction_source": extracted.get("_source", "unknown"),
        "triage": triage_result, "processing_time": _timings}
  except Exception as e:
    import traceback
    tb = traceback.format_exc()
    print(f"[Upload] FATAL ERROR: {type(e).__name__}: {e}")
    print(tb)
    return JSONResponse(status_code=200, content={
        "success": False, "error": f"{type(e).__name__}: {str(e)}",
        "traceback": tb.split("\n")[-4:]
    })

@app.post("/api/documents/manual")
async def manual_document_entry(request: Request):
    """Manually index a document when AI extraction fails or for offline documents."""
    _user = _user_from_request(request)
    _by = _user.get("name", "System") if _user else "System"
    _email = _user.get("email", "") if _user else ""
    try:
        body = await request.json()
    except:
        raise HTTPException(400, "Invalid JSON")

    doc_type = body.get("type", "invoice")
    if doc_type not in ("invoice", "purchase_order", "contract", "goods_receipt", "credit_note", "debit_note"):
        raise HTTPException(400, f"Invalid type: {doc_type}")

    fid = str(uuid.uuid4())[:8].upper()
    record = {
        "id": fid,
        "type": doc_type,
        "documentName": body.get("documentName", "Manual Entry"),
        "vendor": body.get("vendor", "Unknown"),
        "vendorNormalized": normalize_vendor(body.get("vendor", "")),
        "amount": float(body.get("amount") or 0),
        "subtotal": float(body.get("subtotal") or body.get("amount") or 0),
        "totalTax": float(body.get("totalTax") or 0),
        "taxDetails": body.get("taxDetails", []),
        "currency": body.get("currency", "USD"),
        "issueDate": body.get("issueDate"),
        "lineItems": body.get("lineItems", []),
        "status": "pending",
        "confidence": 100,  # Human-entered = 100% confidence
        "confidenceFactors": {"manual_entry": {"score": 100, "weight": 1.0, "detail": "Manually indexed by user"}},
        "extractionSource": "manual",
        "extractedAt": datetime.now().isoformat(),
        "uploadedBy": _by,
        "uploadedByEmail": _email,
        "paymentTerms": body.get("paymentTerms"),
        "notes": body.get("notes"),
        "earlyPaymentDiscount": None,
        "uploadedFile": None,
    }

    if doc_type == "invoice":
        record.update({"status": "unpaid", "invoiceNumber": body.get("documentNumber", f"INV-{fid}"),
            "poReference": body.get("poReference"), "dueDate": body.get("dueDate")})
    elif doc_type == "purchase_order":
        record.update({"status": "open", "poNumber": body.get("documentNumber", f"PO-{fid}")})
    elif doc_type == "contract":
        record.update({"status": "active", "contractNumber": body.get("documentNumber", f"AGR-{fid}")})
    elif doc_type == "goods_receipt":
        record.update({"status": "received", "grnNumber": body.get("documentNumber", f"GRN-{fid}"),
            "poReference": body.get("poReference")})
    elif doc_type in ("credit_note", "debit_note"):
        pfx = "CN" if doc_type == "credit_note" else "DN"
        record.update({"status": "pending", "documentNumber": body.get("documentNumber", f"{pfx}-{fid}")})

    db = get_db()
    store = {"invoice": "invoices", "purchase_order": "purchase_orders", "contract": "contracts",
             "credit_note": "invoices", "debit_note": "invoices", "goods_receipt": "goods_receipts"}
    db[store.get(doc_type, "invoices")].append(record)

    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "manual_entry",
        "documentId": fid, "documentType": doc_type,
        "documentNumber": record.get("invoiceNumber") or record.get("poNumber") or record.get("contractNumber") or record.get("grnNumber") or record.get("documentNumber"),
        "vendor": record["vendor"], "amount": record["amount"], "currency": record.get("currency"),
        "timestamp": datetime.now().isoformat(), "performedBy": _by})

    # Run matching if applicable
    new_matches = []
    if doc_type in ("invoice", "purchase_order"):
        new_matches = run_matching(db)
    save_db(db)

    return {"success": True, "document": record, "new_matches": new_matches}

@app.get("/api/documents")
async def get_documents():
    db = get_db()
    docs = db["invoices"] + db["purchase_orders"] + db.get("contracts", []) + db.get("goods_receipts", [])
    return {"documents": sorted(docs, key=lambda x: x.get("extractedAt", ""), reverse=True), "total": len(docs)}

@app.get("/api/invoices")
async def get_invoices():
    return {"invoices": get_db()["invoices"]}

@app.get("/api/purchase-orders")
async def get_pos():
    return {"purchase_orders": get_db()["purchase_orders"]}

@app.get("/api/goods-receipts")
async def get_grns():
    """F5: Goods receipt notes API."""
    return {"goods_receipts": get_db().get("goods_receipts", [])}

@app.get("/api/contracts")
async def get_contracts():
    return {"contracts": get_db().get("contracts", [])}

@app.get("/api/matches")
async def get_matches():
    db = get_db()
    matches = db["matches"]
    three_way = sum(1 for m in matches if m.get("matchType") == "three_way")
    two_way = sum(1 for m in matches if m.get("matchType") == "two_way" or not m.get("matchType"))
    return {"matches": matches, "summary": {"total": len(matches),
        "auto_matched": sum(1 for m in matches if m["status"] == "auto_matched"),
        "review_needed": sum(1 for m in matches if m["status"] == "review_needed"),
        "three_way": three_way, "two_way": two_way}}

@app.get("/api/anomalies")
async def get_anomalies():
    db = get_db()
    an = db.get("anomalies", [])
    op = [a for a in an if a.get("status") == "open"]
    return {"anomalies": sorted(an, key=lambda x: x.get("detectedAt", ""), reverse=True),
        "summary": {"total": len(an), "open": len(op),
            "resolved": sum(1 for a in an if a.get("status") == "resolved"),
            "dismissed": sum(1 for a in an if a.get("status") == "dismissed"),
            "total_risk": round(sum(a.get("amount_at_risk", 0) for a in op if a.get("amount_at_risk", 0) > 0), 2),
            "savings_opportunities": round(abs(sum(a.get("amount_at_risk", 0) for a in op if a.get("type") == "EARLY_PAYMENT_DISCOUNT")), 2),
            "by_type": {t: sum(1 for a in an if a.get("type") == t) for t in set(a.get("type") for a in an)},
            "by_severity": {"high": sum(1 for a in op if a.get("severity") == "high"),
                "medium": sum(1 for a in op if a.get("severity") == "medium"),
                "low": sum(1 for a in op if a.get("severity") == "low")}}}

@app.post("/api/anomalies/{aid}/resolve")
async def resolve_anomaly(aid: str, request: Request):
    role = get_role_from_request(request)
    user_display = get_user_display(request)
    db = get_db()
    for a in db.get("anomalies", []):
        if a["id"] == aid:
            a["status"] = "resolved"
            a["resolvedAt"] = datetime.now().isoformat()
            a["resolvedBy"] = user_display
            # C3 FIX: Cascade — update vendor risk + re-triage affected invoice
            if a.get("vendor"):
                update_vendor_profile(a["vendor"], db)
            inv_id = a.get("invoiceId")
            if inv_id:
                inv = next((i for i in db["invoices"] if i["id"] == inv_id), None)
                if inv:
                    triage = triage_invoice(inv, db.get("anomalies", []), db, role=role)
                    store_triage_decision(inv_id, triage, db)
                    apply_triage_action(inv, triage, db, performed_by=user_display)
            save_db(db)
            return {"success": True, "anomaly": a}
    raise HTTPException(404)

@app.post("/api/anomalies/{aid}/dismiss")
async def dismiss_anomaly(aid: str, request: Request):
    role = get_role_from_request(request)
    user_display = get_user_display(request)
    db = get_db()
    for a in db.get("anomalies", []):
        if a["id"] == aid:
            a["status"] = "dismissed"
            a["dismissedAt"] = datetime.now().isoformat()
            a["dismissedBy"] = user_display
            # C3 FIX: Cascade — update vendor risk + re-triage affected invoice
            if a.get("vendor"):
                update_vendor_profile(a["vendor"], db)
            inv_id = a.get("invoiceId")
            if inv_id:
                inv = next((i for i in db["invoices"] if i["id"] == inv_id), None)
                if inv:
                    triage = triage_invoice(inv, db.get("anomalies", []), db, role=role)
                    store_triage_decision(inv_id, triage, db)
                    apply_triage_action(inv, triage, db, performed_by=user_display)
            save_db(db)
            return {"success": True, "anomaly": a}
    raise HTTPException(404)

@app.post("/api/invoices/{iid}/status")
async def update_invoice_status(iid: str, request: Request, status: str = Form(...)):
    valid = {"unpaid", "under_review", "approved", "disputed", "scheduled", "paid", "on_hold"}
    if status not in valid: raise HTTPException(400, f"Invalid status. Must be one of: {valid}")
    role = get_role_from_request(request)
    user_display = get_user_display(request)
    db = get_db()
    for i in db["invoices"]:
        if i["id"] == iid:
            # F4: Authority check — only approve/pay if within role's limit
            if status in ("approved", "paid"):
                inv_amount = float(i.get("amount") or 0)
                inv_currency = i.get("currency", "USD")
                role_limit = get_authority_limit(role, inv_currency)
                if inv_amount > role_limit:
                    required = get_required_approver(inv_amount, inv_currency)
                    raise HTTPException(403, f"Insufficient authority. {currency_symbol(inv_currency)}{inv_amount:,.2f} requires {required['title']} approval (your limit: {currency_symbol(inv_currency)}{role_limit:,.0f})")
            old = i["status"]; i["status"] = status
            if status == "paid": i["paidAt"] = datetime.now().isoformat()
            if status == "disputed": i["disputedAt"] = datetime.now().isoformat()
            db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "status_changed",
                "documentId": iid, "documentNumber": i.get("invoiceNumber"),
                "vendor": i["vendor"], "from": old, "to": status,
                "actionedBy": user_display, "timestamp": datetime.now().isoformat()})
            save_db(db); return {"success": True, "invoice": i}
    raise HTTPException(404)

@app.post("/api/invoices/{iid}/mark-paid")
async def mark_paid(iid: str, request: Request):
    role = get_role_from_request(request)
    user_display = get_user_display(request)
    db = get_db()
    for i in db["invoices"]:
        if i["id"] == iid:
            # F4: Authority check
            inv_amount = float(i.get("amount") or 0)
            inv_currency = i.get("currency", "USD")
            role_limit = get_authority_limit(role, inv_currency)
            if inv_amount > role_limit:
                required = get_required_approver(inv_amount, inv_currency)
                raise HTTPException(403, f"Insufficient authority. {currency_symbol(inv_currency)}{inv_amount:,.2f} requires {required['title']} approval")
            old = i["status"]; i["status"] = "paid"; i["paidAt"] = datetime.now().isoformat()
            db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "status_changed",
                "documentId": iid, "documentNumber": i.get("invoiceNumber"),
                "vendor": i["vendor"], "from": old, "to": "paid",
                "actionedBy": user_display, "timestamp": datetime.now().isoformat()})
            save_db(db); return {"success": True}
    raise HTTPException(404)

@app.post("/api/matches/{mid}/approve")
async def approve_match(mid: str):
    db = get_db()
    for m in db["matches"]:
        if m["id"] == mid: m["status"] = "auto_matched"; save_db(db); return {"success": True}
    raise HTTPException(404)

@app.post("/api/matches/{mid}/reject")
async def reject_match(mid: str):
    db = get_db(); db["matches"] = [m for m in db["matches"] if m["id"] != mid]; save_db(db); return {"success": True}

# ============================================================
# F3: VENDOR RISK API
# ============================================================
@app.get("/api/vendors")
async def get_vendors():
    """List all vendors with risk scores, spend, anomaly data."""
    db = get_db()
    profiles = db.get("vendor_profiles", [])

    # Rebuild any missing profiles
    all_vendors = set()
    for inv in db["invoices"]:
        vn = normalize_vendor(inv.get("vendor", ""))
        if vn:
            all_vendors.add((vn, inv.get("vendor", "")))
    for po in db["purchase_orders"]:
        vn = normalize_vendor(po.get("vendor", ""))
        if vn:
            all_vendors.add((vn, po.get("vendor", "")))

    existing_normalized = {p["vendorNormalized"] for p in profiles}
    for vn, display in all_vendors:
        if vn not in existing_normalized:
            update_vendor_profile(display, db)

    save_db(db)
    profiles = db.get("vendor_profiles", [])

    return {"vendors": sorted(profiles, key=lambda x: x.get("riskScore", 0), reverse=True),
            "total": len(profiles),
            "summary": {
                "high_risk": sum(1 for p in profiles if p.get("riskLevel") == "high"),
                "medium_risk": sum(1 for p in profiles if p.get("riskLevel") == "medium"),
                "low_risk": sum(1 for p in profiles if p.get("riskLevel") == "low"),
                "total_spend": round(sum(p.get("totalSpend", 0) for p in profiles), 2),
            }}

@app.get("/api/vendors/{vendor_name}/risk")
async def get_vendor_risk(vendor_name: str):
    """Get detailed risk profile for a specific vendor."""
    db = get_db()
    risk = compute_vendor_risk_score(vendor_name, db)
    tolerances = get_dynamic_tolerances(vendor_name, db)
    return {"vendor": vendor_name, "risk": risk, "dynamicTolerances": tolerances}

@app.post("/api/vendors/refresh-all")
async def refresh_vendor_profiles():
    """Refresh all vendor risk profiles. Useful after bulk operations."""
    db = get_db()
    vendors_refreshed = set()
    for inv in db["invoices"]:
        vn = normalize_vendor(inv.get("vendor", ""))
        if vn and vn not in vendors_refreshed:
            update_vendor_profile(inv["vendor"], db)
            vendors_refreshed.add(vn)
    save_db(db)
    return {"success": True, "vendorsRefreshed": len(vendors_refreshed)}

# ============================================================
# F1: TRIAGE API
# ============================================================
@app.get("/api/triage")
async def get_triage_overview():
    """Get triage overview: lane counts, auto-approve rate, blocked invoices."""
    db = get_db()
    decisions = db.get("triage_decisions", [])
    invoices = db.get("invoices", [])

    # Build lane counts from invoice records (source of truth after edits)
    auto_approved = [i for i in invoices if i.get("triageLane") == "AUTO_APPROVE"]
    review = [i for i in invoices if i.get("triageLane") == "REVIEW"]
    blocked = [i for i in invoices if i.get("triageLane") == "BLOCK"]
    untriaged = [i for i in invoices if not i.get("triageLane")]
    total_triaged = len(auto_approved) + len(review) + len(blocked)

    return {
        "summary": {
            "totalInvoices": len(invoices),
            "totalTriaged": total_triaged,
            "autoApproved": len(auto_approved),
            "review": len(review),
            "blocked": len(blocked),
            "untriaged": len(untriaged),
            "autoApproveRate": round(len(auto_approved) / max(total_triaged, 1) * 100, 1),
            "blockRate": round(len(blocked) / max(total_triaged, 1) * 100, 1),
            "autoApprovedAmount": round(sum(i.get("amount", 0) for i in auto_approved), 2),
            "blockedAmount": round(sum(i.get("amount", 0) for i in blocked), 2),
            "reviewAmount": round(sum(i.get("amount", 0) for i in review), 2),
        },
        "blocked": [{
            "invoiceId": i["id"],
            "invoiceNumber": i.get("invoiceNumber", ""),
            "vendor": i.get("vendor", ""),
            "amount": i.get("amount", 0),
            "currency": i.get("currency", "USD"),
            "reasons": i.get("triageReasons", []),
            "vendorRisk": i.get("vendorRiskScore", 0),
            "triageAt": i.get("triageAt", ""),
        } for i in blocked],
        "decisions": sorted(decisions, key=lambda x: x.get("triageAt", ""), reverse=True)[:20],
    }

@app.post("/api/invoices/{iid}/retriage")
async def retriage_invoice(iid: str, request: Request):
    """Manually trigger re-triage for an invoice."""
    db = get_db()
    invoice = None
    for i in db["invoices"]:
        if i["id"] == iid:
            invoice = i
            break
    if not invoice:
        raise HTTPException(404, "Invoice not found")

    _user = _user_from_request(request)
    _by = _user.get("name","System") if _user else "System"
    triage = triage_invoice(invoice, db.get("anomalies", []), db, performed_by=_by)
    store_triage_decision(iid, triage, db)
    apply_triage_action(invoice, triage, db, performed_by=_by)
    save_db(db)
    return {"success": True, "invoice": invoice, "triage": triage}

@app.post("/api/invoices/{iid}/override-triage")
async def override_triage(iid: str, request: Request, lane: str = Form(...), reason: str = Form("")):
    """Manual override of triage decision by auditor."""
    _user = _user_from_request(request)
    _by = _user.get("name","System") if _user else "System"
    valid_lanes = {"AUTO_APPROVE", "REVIEW", "BLOCK"}
    if lane not in valid_lanes:
        raise HTTPException(400, f"Lane must be one of: {valid_lanes}")

    db = get_db()
    for i in db["invoices"]:
        if i["id"] == iid:
            old_lane = i.get("triageLane", "NONE")
            # NC3 FIX: Only preserve original AI triage on first override
            if not i.get("triageOriginalLane"):
                i["triageOriginalLane"] = old_lane
                i["triageOriginalReasons"] = i.get("triageReasons", [])
            i["triageLane"] = lane
            i["triageOverride"] = True
            i["triageOverrideAt"] = datetime.now().isoformat()
            i["triageOverrideReason"] = reason
            i["triageReasons"] = [f"MANUAL OVERRIDE: {reason}" if reason else f"MANUAL OVERRIDE to {lane}"]

            # Apply status change — guard terminal statuses (NS2 FIX)
            terminal_statuses = {"paid", "scheduled"}
            action_map = {"AUTO_APPROVE": "approved", "REVIEW": "under_review", "BLOCK": "on_hold"}
            if i["status"] not in terminal_statuses:
                i["status"] = action_map.get(lane, i["status"])

            db["activity_log"].append({
                "id": str(uuid.uuid4())[:8],
                "action": "triage_override",
                "documentId": iid,
                "documentNumber": i.get("invoiceNumber", ""),
                "vendor": i.get("vendor", ""),
                "fromLane": old_lane,
                "toLane": lane,
                "reason": reason,
                "timestamp": datetime.now().isoformat(),
                "performedBy": _by,
            })
            save_db(db)
            return {"success": True, "invoice": i}
    raise HTTPException(404)

@app.post("/api/documents/{did}/edit-fields")
async def edit_document_fields(did: str, request: Request, fields: str = Form(...)):
    """Edit extracted fields. Expects JSON string of field:value pairs.
    Editable fields: vendor, amount, subtotal, invoiceNumber, poNumber, contractNumber,
    poReference, paymentTerms, currency, issueDate, dueDate, deliveryDate, lineItems, taxDetails.
    After edit: re-runs matching + anomaly detection for invoices."""
    _user = _user_from_request(request)
    _by = _user.get("name","System") if _user else "System"
    import json as _json
    try:
        updates = _json.loads(fields)
    except:
        raise HTTPException(400, "Invalid JSON in fields parameter")

    db = get_db()
    # Find doc in any collection
    doc = None
    collection = None
    for coll_name in ["invoices", "purchase_orders", "contracts"]:
        for d in db.get(coll_name, []):
            if d["id"] == did:
                doc = d; collection = coll_name; break
        if doc: break

    if not doc: raise HTTPException(404, "Document not found")

    # Whitelist of editable fields
    editable = {"vendor", "amount", "subtotal", "invoiceNumber", "poNumber", "contractNumber",
        "documentNumber", "poReference", "paymentTerms", "currency", "issueDate", "dueDate",
        "deliveryDate", "notes", "lineItems", "taxDetails", "pricingTerms"}

    changes = {}
    for k, v in updates.items():
        if k in editable:
            old_val = doc.get(k)
            doc[k] = v
            changes[k] = {"old": old_val, "new": v}

    if not changes:
        raise HTTPException(400, "No valid editable fields provided")

    # Recalculate derived fields
    if "lineItems" in changes or "subtotal" in changes:
        li_sum = sum(li.get("total", 0) for li in doc.get("lineItems", []))
        if "subtotal" not in changes and li_sum > 0:
            doc["subtotal"] = li_sum
    if "taxDetails" in changes:
        doc["totalTax"] = sum(_n(t.get("amount")) for t in doc.get("taxDetails", []))
    # Fix #1: Always recalculate amount from current subtotal + tax
    doc["amount"] = (doc.get("subtotal") or 0) + (doc.get("totalTax") or 0)
    if "vendor" in changes:
        doc["vendorNormalized"] = normalize_vendor(doc["vendor"])

    # Mark as manually verified
    doc["manuallyVerified"] = True
    doc["verifiedAt"] = datetime.now().isoformat()
    doc["verifiedBy"] = _by
    doc["editHistory"] = doc.get("editHistory", [])
    doc["editHistory"].append({"timestamp": datetime.now().isoformat(), "editedBy": _by, "changes": {k: str(v) for k, v in changes.items()}})

    # Log the edit
    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "document_edited",
        "documentId": did, "documentType": doc["type"],
        "documentNumber": doc.get("invoiceNumber") or doc.get("poNumber") or doc.get("contractNumber"),
        "vendor": doc["vendor"], "fieldsChanged": list(changes.keys()),
        "timestamp": datetime.now().isoformat(), "performedBy": _by})

    # ── FEEDBACK LOOP: Learn from corrections ──
    # Record each field correction as a pattern. These patterns are injected
    # into future extraction prompts for the same vendor, so the AI learns
    # from human corrections over time.
    patterns_learned = 0
    for field, change in changes.items():
        if field == "lineItems":
            # Learn from line item corrections individually
            old_lis = change.get("old", []) or []
            new_lis = change.get("new", []) or []
            for i, new_li in enumerate(new_lis):
                if i < len(old_lis):
                    old_li = old_lis[i]
                    for li_field in ["description", "quantity", "unitPrice"]:
                        if str(new_li.get(li_field)) != str(old_li.get(li_field)):
                            learn_from_correction(doc, f"lineItem.{li_field}",
                                old_li.get(li_field), new_li.get(li_field), db)
                            patterns_learned += 1
        else:
            learn_from_correction(doc, field, change.get("old"), change.get("new"), db)
            patterns_learned += 1

    new_anomalies = []

    # Re-run matching + anomaly detection for invoices AND POs (Fix #10)
    if doc["type"] in ("invoice", "purchase_order"):
        if doc["type"] == "invoice":
            # Remove old matches for this invoice only
            db["matches"] = [m for m in db["matches"] if m.get("invoiceId") != did]
        elif doc["type"] == "purchase_order":
            # PO edited — remove all matches pointing to this PO so they re-evaluate
            db["matches"] = [m for m in db["matches"] if m.get("poId") != did]

        # Fix #3: Only remove OPEN anomalies for this invoice; preserve resolved/dismissed
        if doc["type"] == "invoice":
            db["anomalies"] = [a for a in db["anomalies"]
                if not (a.get("invoiceId") == did and a.get("status") == "open")]

        # Re-run matching
        new_matches = run_matching(db)
        db["matches"].extend(new_matches)

        # Re-run anomaly detection (invoices only)
        if doc["type"] == "invoice":
            mpo = None
            for m in db["matches"]:
                if m.get("invoiceId") == doc["id"]:
                    mpo = next((p for p in db["purchase_orders"] if p["id"] == m.get("poId")), None)
                    break
            vc = find_vendor_contract(doc["vendor"], db.get("contracts", []))
            vh = [i for i in db["invoices"] if i.get("vendor") and doc.get("vendor") and
                  vendor_similarity(i["vendor"], doc["vendor"]) >= 0.7 and i["id"] != doc["id"]]
            # F3: Dynamic tolerances based on vendor risk
            vendor_tols = get_dynamic_tolerances(doc["vendor"], db)
            detected = await detect_anomalies_with_claude(doc, mpo, vc, vh, tolerances=vendor_tols)
            for a in detected:
                anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": doc["id"],
                    "invoiceNumber": doc.get("invoiceNumber", ""), "vendor": doc["vendor"],
                    "currency": doc.get("currency", "USD"),
                    "detectedAt": datetime.now().isoformat(), "status": "open", **a}
                new_anomalies.append(anom)
                db["anomalies"].append(anom)

    save_db(db)

    # Re-index in RAG with corrected data
    try:
        await on_document_edited(doc)
        if new_anomalies:
            await on_anomalies_detected_batch(new_anomalies)
    except Exception as e:
        print(f"RAG re-indexing error (non-fatal): {e}")

    # ── F3: Update vendor risk profile after edit ──
    db = get_db()
    update_vendor_profile(doc["vendor"], db)

    # ── F1: Re-triage invoice / CN / DN after edit (NS3 FIX) ──
    triage_result = None
    if doc["type"] in ("invoice", "credit_note", "debit_note"):
        # Use DB copy (post-save), not stale doc reference
        db_invoice = next((i for i in db["invoices"] if i["id"] == doc["id"]), None)
        if db_invoice:
            triage_result = triage_invoice(db_invoice, db.get("anomalies", []), db)
            store_triage_decision(db_invoice["id"], triage_result, db)
            apply_triage_action(db_invoice, triage_result, db, performed_by=_by)
            doc = db_invoice

    save_db(db)

    return {"success": True, "document": doc, "changes": list(changes.keys()),
        "new_anomalies": new_anomalies, "anomalies_rerun": doc["type"] == "invoice",
        "patterns_learned": patterns_learned, "triage": triage_result}

def _compute_processing_speed(db):
    """Compute average processing times from stored document timing data."""
    docs = db["invoices"] + db["purchase_orders"] + db.get("contracts", [])
    timed = [d for d in docs if d.get("processingTime")]
    if not timed:
        return {"avg_total_ms": 0, "avg_total_seconds": 0, "avg_extraction_ms": 0,
                "avg_matching_ms": 0, "avg_anomaly_ms": 0, "avg_triage_ms": 0,
                "documents_processed": len(docs), "documents_with_timing": 0,
                "vs_manual_minutes": 15, "speedup_factor": 0}
    avg_total = sum(d["processingTime"].get("total_ms", 0) for d in timed) / len(timed)
    avg_extract = sum(d["processingTime"].get("ai_extraction_ms", 0) for d in timed) / len(timed)
    avg_triage = sum(d["processingTime"].get("triage_ms", 0) for d in timed) / len(timed)
    avg_matching = sum(d["processingTime"].get("matching_ms", 0) for d in timed) / len(timed)
    avg_anomaly = sum(d["processingTime"].get("anomaly_detection_ms", 0) for d in timed) / len(timed)
    manual_ms = 15 * 60 * 1000  # 15 minutes manual benchmark
    return {
        "avg_total_ms": round(avg_total),
        "avg_total_seconds": round(avg_total / 1000, 1),
        "avg_extraction_ms": round(avg_extract),
        "avg_matching_ms": round(avg_matching),
        "avg_anomaly_ms": round(avg_anomaly),
        "avg_triage_ms": round(avg_triage),
        "documents_processed": len(docs),
        "documents_with_timing": len(timed),
        "vs_manual_minutes": 15,
        "speedup_factor": round(manual_ms / max(avg_total, 1)),
    }

@app.get("/api/dashboard")
async def get_dashboard():
    db = get_db(); now = datetime.now()
    unpaid = [i for i in db["invoices"] if i.get("status") not in ("paid",)]
    tar = sum(i["amount"] for i in unpaid)
    bk = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0}
    bc = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0}
    for i in unpaid:
        d = i.get("dueDate")
        try: do = (now - datetime.fromisoformat(d)).days if d else 0
        except: do = 0
        k = "current" if do <= 0 else "1_30" if do <= 30 else "31_60" if do <= 60 else "61_90" if do <= 90 else "90_plus"
        bk[k] += i["amount"]; bc[k] += 1

    ad = db["invoices"] + db["purchase_orders"] + db.get("contracts", [])
    ac = (sum(d.get("confidence", 0) for d in ad) / len(ad)) if ad else 0
    oa = [a for a in db.get("anomalies", []) if a.get("status") == "open"]

    # Vendor spend analysis — track display name + spend
    vendor_spend = {}
    vendor_display = {}  # normalized -> best display name
    for inv in db["invoices"]:
        v = normalize_vendor(inv.get("vendor", ""))
        vendor_spend[v] = vendor_spend.get(v, 0) + inv.get("amount", 0)
        # Keep the longest display name (most complete version)
        if v not in vendor_display or len(inv.get("vendor", "")) > len(vendor_display[v]):
            vendor_display[v] = inv.get("vendor", v)
    top_vendors = sorted(vendor_spend.items(), key=lambda x: x[1], reverse=True)[:5]

    # Due soon
    due_soon = [i for i in unpaid if i.get("dueDate")]
    due_7d = []
    for i in due_soon:
        try:
            dd = datetime.fromisoformat(i["dueDate"])
            if 0 <= (dd - now).days <= 7: due_7d.append(i)
        except: pass

    # Early payment savings (on pre-tax subtotal)
    epd_savings = 0
    for i in db["invoices"]:
        epd = i.get("earlyPaymentDiscount")
        if epd and i.get("status") == "unpaid":
            epd_savings += (i.get("subtotal") or i["amount"]) * (epd.get("discount_percent", 0) / 100)

    # ── F1: Triage metrics ──
    triaged_invoices = [i for i in db["invoices"] if i.get("triageLane")]
    triage_auto = [i for i in triaged_invoices if i.get("triageLane") == "AUTO_APPROVE"]
    triage_review = [i for i in triaged_invoices if i.get("triageLane") == "REVIEW"]
    triage_blocked = [i for i in triaged_invoices if i.get("triageLane") == "BLOCK"]
    total_triaged = len(triaged_invoices)
    auto_approve_rate = round(len(triage_auto) / max(total_triaged, 1) * 100, 1)

    # ── F3: Vendor risk metrics ──
    profiles = db.get("vendor_profiles", [])
    high_risk_vendors = [p for p in profiles if p.get("riskLevel") == "high"]
    worsening_vendors = [p for p in profiles if p.get("trend") == "worsening"]

    return {"total_ar": round(tar, 2), "unpaid_count": len(unpaid), "total_documents": len(ad),
        "invoice_count": len(db["invoices"]), "po_count": len(db["purchase_orders"]),
        "grn_count": len(db.get("goods_receipts", [])),
        "contract_count": len(db.get("contracts", [])),
        "auto_matched": sum(1 for m in db["matches"] if m["status"] == "auto_matched"),
        "review_needed": sum(1 for m in db["matches"] if m["status"] == "review_needed"),
        "three_way_matched": sum(1 for m in db["matches"] if m.get("matchType") == "three_way"),
        "two_way_only": sum(1 for m in db["matches"] if m.get("matchType") != "three_way"),
        "avg_confidence": round(ac, 1), "anomaly_count": len(oa),
        "total_risk": round(sum(_n(a.get("amount_at_risk")) for a in oa if _n(a.get("amount_at_risk")) > 0), 2),
        "high_severity": sum(1 for a in oa if a.get("severity") == "high"),
        # ── SAVINGS DISCOVERED (VC metric) ──
        # F&A-8 FIX: Exclude dismissed anomalies — they are false positives, not real savings
        # Only open + resolved anomalies represent genuine value caught by AuditLens
        "savings_discovered": round(
            sum(_n(a.get("amount_at_risk")) for a in db.get("anomalies", [])
                if _n(a.get("amount_at_risk")) > 0 and a.get("status") != "dismissed"), 2),
        "savings_breakdown": {
            "overcharges": round(sum(_n(a.get("amount_at_risk")) for a in db.get("anomalies", [])
                if a.get("type") in ("PRICE_OVERCHARGE", "AMOUNT_DISCREPANCY", "CONTRACT_PRICE_VIOLATION")
                and _n(a.get("amount_at_risk")) > 0 and a.get("status") != "dismissed"), 2),
            "duplicates_prevented": round(sum(_n(a.get("amount_at_risk")) for a in db.get("anomalies", [])
                if a.get("type") == "DUPLICATE_INVOICE"
                and _n(a.get("amount_at_risk")) > 0 and a.get("status") != "dismissed"), 2),
            "contract_violations": round(sum(_n(a.get("amount_at_risk")) for a in db.get("anomalies", [])
                if a.get("type") == "TERMS_VIOLATION"
                and _n(a.get("amount_at_risk")) > 0 and a.get("status") != "dismissed"), 2),
            "unauthorized_items": round(sum(_n(a.get("amount_at_risk")) for a in db.get("anomalies", [])
                if a.get("type") in ("UNAUTHORIZED_ITEM", "QUANTITY_OVERCHARGE")
                and _n(a.get("amount_at_risk")) > 0 and a.get("status") != "dismissed"), 2),
            "early_payment_opportunities": round(epd_savings, 2),
        },
        # ── PROCESSING SPEED (VC metric) ──
        "processing_speed": _compute_processing_speed(db),
        "over_invoiced_pos": sum(1 for m in db["matches"] if m.get("overInvoiced")),
        "disputed_count": sum(1 for i in db["invoices"] if i.get("status") == "disputed"),
        "due_in_7_days": len(due_7d), "due_in_7_days_amount": round(sum(i["amount"] for i in due_7d), 2),
        "early_payment_savings": round(epd_savings, 2),
        "top_vendors": [{"vendor": vendor_display.get(v, v), "spend": round(s, 2)} for v, s in top_vendors],
        "aging": {"buckets": {k: round(v, 2) for k, v in bk.items()}, "counts": bc},
        "recent_activity": sorted(db.get("activity_log", []), key=lambda x: x.get("timestamp", ""), reverse=True)[:10],
        "verified_count": sum(1 for d in ad if d.get("manuallyVerified")),
        "correction_patterns": len(db.get("correction_patterns", [])),
        "rag_stats": get_rag_stats() if RAG_ENABLED else None,
        "api_mode": "claude_api" if USE_REAL_API else "no_api_key",
        "db_backend": "postgres" if DATABASE_URL else "file",
        # F1: Triage metrics
        "triage": {
            "total_triaged": total_triaged,
            "auto_approved": len(triage_auto),
            "review": len(triage_review),
            "blocked": len(triage_blocked),
            "auto_approve_rate": auto_approve_rate,
            "blocked_amount": round(sum(i.get("amount", 0) for i in triage_blocked), 2),
            "auto_approved_amount": round(sum(i.get("amount", 0) for i in triage_auto), 2),
        },
        # F3: Vendor risk metrics
        "vendor_risk": {
            "total_vendors": len(profiles),
            "high_risk": len(high_risk_vendors),
            "worsening": len(worsening_vendors),
            "high_risk_vendors": [{"vendor": p.get("vendorDisplay", ""), "score": p.get("riskScore", 0),
                                   "trend": p.get("trend", "")} for p in high_risk_vendors[:5]],
        }}

@app.get("/api/correction-patterns")
async def get_correction_patterns_endpoint():
    """View all learned correction patterns."""
    db = get_db()
    patterns = db.get("correction_patterns", [])
    by_vendor = {}
    for p in patterns:
        v = p.get("vendor", "Unknown")
        if v not in by_vendor: by_vendor[v] = []
        by_vendor[v].append(p)
    return {"patterns": patterns, "by_vendor": by_vendor,
        "total": len(patterns), "vendors_with_corrections": len(by_vendor)}

@app.get("/api/rag/stats")
async def rag_stats_endpoint():
    """Get RAG engine statistics."""
    return {"enabled": RAG_ENABLED, "stats": get_rag_stats() if RAG_ENABLED else None}

@app.get("/api/rag/vendor/{vendor_name}")
async def rag_vendor_intelligence(vendor_name: str):
    """Get RAG-retrieved intelligence about a specific vendor."""
    if not RAG_ENABLED:
        return {"error": "RAG engine not available"}
    try:
        from backend.rag_engine import retrieve_vendor_intelligence
    except ImportError:
        from rag_engine import retrieve_vendor_intelligence
    return await retrieve_vendor_intelligence(vendor_name)

def _seed_demo_data():
    """Seed the database with demo data by running the test data generator."""
    # Look for generator in multiple locations
    candidates = [
        BASE_DIR / "data" / "generate_test_data.py",   # Standard location in repo
        DATA_DIR / "generate_test_data.py",              # In data dir
        Path(__file__).parent / "generate_test_data.py", # Alongside server.py
    ]
    gen_path = None
    for p in candidates:
        if p.exists():
            gen_path = p
            break

    if gen_path:
        import subprocess
        # Run generator — it writes db.json to its own directory
        env = {**os.environ, "DB_OUTPUT_DIR": str(DATA_DIR)}
        result = subprocess.run(["python3", str(gen_path)], capture_output=True, text=True,
                                cwd=str(gen_path.parent), env=env)
        if result.returncode == 0:
            # Find the generated db.json and load it into our DB backend (file or Postgres)
            gen_db = gen_path.parent / "db.json"
            if not gen_db.exists():
                gen_db = DB_PATH  # Maybe it wrote directly here
            if gen_db.exists():
                with open(gen_db) as f:
                    data = json.load(f)
                # Ensure all required keys exist
                for k in EMPTY_DB:
                    if k not in data: data[k] = []
                save_db(data)  # This writes to Postgres or file depending on backend
                total = sum(len(v) for v in data.values() if isinstance(v, list))
                print(f"[Seed] Demo data loaded into DB ({total} records)")
            else:
                print("[Seed] Generator ran but db.json not found")
                save_db(_fresh_db())
        else:
            print(f"[Seed] Generator failed: {result.stderr}")
            save_db(_fresh_db())
    else:
        print(f"[Seed] Generator not found in any location, creating empty DB")
        save_db(_fresh_db())


@app.post("/api/seed-demo")
async def seed_demo(request: Request):
    """Seed the database with demo data. Requires VP/CFO role."""
    try:
        user = _user_from_request(request)
        if user.get("role") in ("analyst", "manager"):
            raise HTTPException(403, "Seeding data requires VP or CFO role")
    except HTTPException as e:
        if e.status_code == 403: raise
        pass
    db = get_db()
    total = sum(len(v) for v in db.values() if isinstance(v, list))
    if total > 0:
        return JSONResponse(status_code=400, content={
            "success": False, "error": f"Database has {total} records. Reset first or use force.",
            "hint": "POST /api/reset then POST /api/seed-demo"
        })
    _seed_demo_data()
    db = get_db()
    total = sum(len(v) for v in db.values() if isinstance(v, list))
    return {"success": True, "message": f"Demo data seeded ({total} records)"}


@app.post("/api/import")
async def import_db(file: UploadFile = File(...)):
    """Import a full db.json backup. Replaces current data."""
    try:
        content = await file.read()
        data = json.loads(content)
        # Validate structure
        for key in EMPTY_DB:
            if key not in data:
                data[key] = []
        save_db(data)
        total = sum(len(v) for v in data.values() if isinstance(v, list))
        return {"success": True, "message": f"Imported {total} records"}
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON file")


@app.get("/api/data-status")
async def data_status():
    """Check current data persistence status and record counts."""
    db = get_db()
    counts = {k: len(v) for k, v in db.items() if isinstance(v, list)}
    total = sum(counts.values())
    return {
        "total_records": total,
        "counts": counts,
        "backend": "postgres" if DATABASE_URL else "file",
        "persistent": bool(DATABASE_URL),
        "db_path": str(DB_PATH) if not DATABASE_URL else "PostgreSQL",
        "seed_demo": SEED_DEMO,
        "reset_on_start": RESET_ON_START,
    }


@app.post("/api/reset")
async def reset(request: Request):
    try:
        user = _user_from_request(request)
        if user.get("role") in ("analyst", "manager"):
            raise HTTPException(403, "Reset requires VP or CFO role")
    except HTTPException as e:
        if e.status_code == 403: raise
        pass
    save_db(_fresh_db())
    try:
        await reset_rag()
    except: pass
    for fp in UPLOAD_DIR.iterdir():
        try: fp.unlink()
        except: pass
    return {"success": True}

@app.get("/api/export")
async def export(request: Request):
    try:
        user = _user_from_request(request)
        if user.get("role") == "analyst":
            raise HTTPException(403, "Export requires Manager, VP, or CFO role")
    except HTTPException as e:
        if e.status_code == 403: raise
        pass
    return get_db()

@app.get("/api/uploads/{filename}")
async def serve_upload(filename: str):
    """Serve original uploaded file for verification panel."""
    # Path traversal protection
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    fp = UPLOAD_DIR / filename
    # Ensure resolved path is within uploads directory
    if fp.exists() and fp.resolve().is_relative_to(UPLOAD_DIR.resolve()):
        ext = fp.suffix.lower()
        mt = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
              ".png": "image/png", ".webp": "image/webp", ".tiff": "image/tiff"}.get(ext, "application/octet-stream")
        return FileResponse(fp, media_type=mt)

    # File not on disk — try persistent storage
    path, exists = load_uploaded_file(filename)
    if exists and path:
        ext = path.suffix.lower()
        mt = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
              ".png": "image/png", ".webp": "image/webp"}.get(ext, "application/octet-stream")
        return FileResponse(str(path), media_type=mt)

    raise HTTPException(404, "File not found")

# ============================================================
# FRONTEND
# ============================================================
@app.get("/logo.jpg")
async def serve_logo(): return FileResponse(FRONTEND_DIR / "logo.jpg", media_type="image/jpeg")

@app.get("/app.js")
async def serve_js(): return FileResponse(FRONTEND_DIR / "app.js", media_type="application/javascript")

@app.get("/")
async def serve_index(): return FileResponse(FRONTEND_DIR / "index.html", media_type="text/html")

@app.get("/{path:path}")
async def serve_static(path: str):
    fp = FRONTEND_DIR / path
    if fp.exists() and fp.is_file(): return FileResponse(fp)
    return FileResponse(FRONTEND_DIR / "index.html", media_type="text/html")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"\nStarting AuditLens v{VERSION} on port {port}")
    print(f"Claude API: {'Connected' if USE_REAL_API else 'No API Key — extraction will fail, use Manual Entry'}")
    print(f"Triage: {'Enabled' if TRIAGE_ENABLED else 'Disabled'}")
    print(f"Vendor Risk Scoring: Enabled")
    uvicorn.run(app, host="0.0.0.0", port=port)
