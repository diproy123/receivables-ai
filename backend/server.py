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

# Initialize structured logging before anything else
from backend.logging_config import setup_logging, get_logger
_root_logger = setup_logging()
logger = get_logger("server")

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import anthropic
import time as _time

# LLM Provider abstraction (multi-provider support)
try:
    from backend.llm_provider import log_provider_config, get_provider_info
    _HAS_LLM_PROVIDER = True
except ImportError:
    _HAS_LLM_PROVIDER = False

# ============================================================
# MODULE IMPORTS
# ============================================================
from backend.config import (
    VERSION, ENSEMBLE_PRIMARY_MODEL, ENSEMBLE_SECONDARY_MODEL,
    BASE_DIR, DATA_DIR, UPLOAD_DIR, FRONTEND_DIR, DB_PATH,
    USE_REAL_API, PERSIST_DATA, SEED_DEMO, RESET_ON_START,
    AUTHORITY_MATRIX, DEFAULT_ROLE, AUTH_ENABLED, TRIAGE_ENABLED,
    FINE_TUNE_MIN_CORRECTIONS,
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
    _user_from_request, get_user_vendor_scope, scope_by_vendor,
    assign_vendors_to_user,
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
from backend.cases import (
    create_case, auto_create_cases_from_triage, transition_case,
    assign_case, add_case_note, escalate_case, check_sla_status,
    run_sla_sweep, compute_case_metrics, sync_case_on_anomaly_resolve,
    CASE_STATUSES, CASE_PRIORITIES, CASE_TYPES, ALLOWED_TRANSITIONS,
)

# Phase 2-4: Contract Intelligence, Vendor KYC/Risk, GRN Analytics
from backend.contracts import (
    analyze_contract_clauses, detect_contract_compliance_anomalies,
    compute_contract_health, get_expiring_contracts,
    compute_extended_vendor_risk, get_vendor_kyc_status,
    compute_delivery_performance, detect_delivery_anomalies,
    get_intelligence_summary, run_lifecycle_checks,
    generate_contract_intelligence_report,
)

# ERP Integration: API keys, batch import, idempotent upsert, webhooks
from backend.integration import (
    create_api_key_record, revoke_api_key, get_api_keys,
    get_integration_status, WEBHOOK_EVENTS,
    create_webhook, update_webhook, delete_webhook, get_webhook_config,
    dispatch_webhook_event,
    validate_batch_item, build_record_from_batch_item,
    find_existing_document, upsert_document_fields,
    BatchResult,
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
_allowed_origins = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(CORSMiddleware, allow_origins=_allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# Global exception handler — catches unhandled errors, returns structured JSON instead of raw 500
from starlette.responses import JSONResponse as StarletteJSONResponse
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    import traceback
    traceback.print_exc()
    return StarletteJSONResponse(status_code=500, content={
        "success": False, "error": "Internal server error", "detail": str(exc)[:200]
    })

# Request ID middleware for log correlation
from starlette.middleware.base import BaseHTTPMiddleware
from backend.logging_config import request_id_ctx

class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        rid = str(uuid.uuid4())[:8]
        request_id_ctx.set(rid)
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response

app.add_middleware(RequestIdMiddleware)

# ============================================================
# AUTH ROUTES
# ============================================================
@app.get("/api/health/ping")
async def health_check_simple():
    """Simple health check for monitoring and load balancers."""
    from backend.db import DATABASE_URL
    from backend.config import USE_S3, S3_BUCKET
    return {
        "status": "ok",
        "version": VERSION,
        "database": "postgresql" if DATABASE_URL else "sqlite",
        "llm": "connected" if USE_REAL_API else "no_api_key",
        "rag": "enabled" if RAG_ENABLED else "disabled",
        "file_storage": f"s3://{S3_BUCKET}" if USE_S3 else "local (ephemeral)",
    }


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
    if AUTHORITY_MATRIX.get(user["role"], AUTHORITY_MATRIX[DEFAULT_ROLE])["level"] < 2:
        raise HTTPException(403, "Manager+ required to view users")
    users = _get_users()
    return {"users": [{"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"],
        "roleTitle": AUTHORITY_MATRIX.get(u["role"], AUTHORITY_MATRIX[DEFAULT_ROLE])["title"],
        "active": u.get("active", True), "createdAt": u.get("createdAt"),
        "assignedVendors": u.get("assignedVendors", [])} for u in users]}

@app.post("/api/auth/users/{user_id}/assign-vendors")
async def assign_user_vendors(user_id: str, request: Request, admin: dict = Depends(get_current_user)):
    """Assign vendor scope to an analyst. Manager+ only."""
    if AUTHORITY_MATRIX.get(admin["role"], AUTHORITY_MATRIX[DEFAULT_ROLE])["level"] < 2:
        raise HTTPException(403, "Manager+ required to assign vendors")
    try: body = await request.json()
    except: raise HTTPException(400, "Invalid JSON")
    vendor_names = body.get("vendors", [])
    if not isinstance(vendor_names, list):
        raise HTTPException(400, "vendors must be a list of vendor names")
    updated = assign_vendors_to_user(user_id, vendor_names)
    if not updated: raise HTTPException(404, "User not found")
    db = get_db()
    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "vendor_assignment_updated",
        "details": f"Assigned {len(vendor_names)} vendors to {updated['name']}: {', '.join(vendor_names) if vendor_names else 'full access'}",
        "user": admin.get("name", "System"), "timestamp": datetime.now().isoformat()})
    save_db(db)
    return {"success": True, "user_id": user_id, "assignedVendors": vendor_names}

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
    import re
    from backend.config import (LOCALE_PROFILES, SUPPORTED_LANGUAGES,
        ENSEMBLE_PRIMARY_MODEL, ENSEMBLE_SECONDARY_MODEL, AUTHORITY_MATRIX)
    from backend.cases import get_sla_targets

    # Count actual anomaly rule types from the anomalies module source
    anom_src = open(str(Path(__file__).parent / "anomalies" / "__init__.py")).read()
    anomaly_types = sorted(set(re.findall(r'"type": "([A-Z_]+)"', anom_src)))
    # Separate true anomalies from opportunity flags
    opportunity_types = {"EARLY_PAYMENT_DISCOUNT"}
    anomaly_rules = [t for t in anomaly_types if t not in opportunity_types]
    opportunity_flags = [t for t in anomaly_types if t in opportunity_types]

    sla = get_sla_targets()

    # Build authority summary (USD only for display)
    authority = []
    for role_key, role_data in AUTHORITY_MATRIX.items():
        usd_limit = role_data["limits"].get("USD", role_data["limits"].get("default", 0))
        authority.append({
            "role": role_key, "title": role_data["title"], "level": role_data["level"],
            "limit_usd": usd_limit, "unlimited": usd_limit >= 999_999_999})

    # Model display names
    def model_display(m):
        parts = m.split("-")
        return f"{parts[0].title()} {parts[1].title()}" if len(parts) >= 2 else m

    # Custom model status
    from backend.custom_model import is_custom_model_enabled, get_custom_model_config, get_ensemble_model_configs
    custom_cfg = get_custom_model_config()
    ensemble_models = get_ensemble_model_configs()

    return {"status": "ok", "product": "AuditLens",
        "claude_api": "connected" if USE_REAL_API else "no_api_key", "version": VERSION,
        "llm_provider": get_provider_info() if _HAS_LLM_PROVIDER else {"provider": "anthropic", "available": USE_REAL_API},
        "features": {"agentic_triage": TRIAGE_ENABLED, "vendor_risk_scoring": True,
            "delegation_of_authority": True, "three_way_matching": True,
            "policy_engine": True, "authentication": AUTH_ENABLED,
            "rag_feedback_loop": RAG_ENABLED,
            "ensemble_extraction": USE_REAL_API,
            "multilingual_extraction": True,
            "case_management": True,
            "ai_intelligence": AI_INTELLIGENCE_ENABLED,
            "contract_intelligence": True,
            "vendor_kyc_risk": True,
            "grn_analytics": True,
            "supported_locales": list(LOCALE_PROFILES.keys()),
            "supported_languages": SUPPORTED_LANGUAGES},
        "stats": {
            "anomaly_rule_count": len(anomaly_rules),
            "anomaly_rules": anomaly_rules,
            "opportunity_flags": opportunity_flags,
            "language_count": len(SUPPORTED_LANGUAGES),
            "locale_count": len(LOCALE_PROFILES),
            "sla_targets": sla,
            "authority_tiers": authority,
            "models": {
                "primary": model_display(ENSEMBLE_PRIMARY_MODEL),
                "secondary": model_display(ENSEMBLE_SECONDARY_MODEL),
                "primary_raw": ENSEMBLE_PRIMARY_MODEL,
                "secondary_raw": ENSEMBLE_SECONDARY_MODEL,
                "custom_enabled": is_custom_model_enabled(),
                "custom_label": custom_cfg.get("label", "") if is_custom_model_enabled() else None,
                "ensemble_size": len(ensemble_models),
            },
            "finetune": {
                "together_configured": bool(os.environ.get("TOGETHER_API_KEY")),
                "base_model": "Qwen/Qwen2.5-7B-Instruct-Turbo",
                "method": "LoRA (Low-Rank Adaptation)",
                "corrections_available": len(get_db().get("correction_patterns", [])),
                "corrections_required": FINE_TUNE_MIN_CORRECTIONS,
                "ready": len(get_db().get("correction_patterns", [])) >= FINE_TUNE_MIN_CORRECTIONS,
            },
        }}

# ============================================================
# CUSTOM MODEL & TRAINING DATA
# ============================================================
@app.get("/api/custom-model")
async def get_custom_model():
    """Return custom model configuration and status."""
    from backend.custom_model import (get_custom_model_config, is_custom_model_enabled,
        get_ensemble_model_configs, get_training_data_stats, get_model_performance_summary)
    return {
        "config": get_custom_model_config(),
        "enabled": is_custom_model_enabled(),
        "ensemble_models": get_ensemble_model_configs(),
        "training_data": get_training_data_stats(),
        "performance": get_model_performance_summary(),
    }

@app.post("/api/custom-model/config")
async def update_custom_model_config(request: Request):
    """Update custom model configuration via policy engine."""
    body = await request.json()
    db = get_db()
    cfg = db.get("custom_model_config", {})
    allowed_keys = {"enabled", "provider", "model", "endpoint", "label",
                    "weight", "supports_vision", "max_tokens", "timeout_seconds"}
    for k, v in body.items():
        if k in allowed_keys:
            cfg[k] = v
    db["custom_model_config"] = cfg
    from backend.db import save_db
    save_db(db)
    return {"success": True, "config": cfg}

@app.post("/api/custom-model/export-training")
async def export_training(request: Request):
    """Export correction data as fine-tuning JSONL."""
    body = await request.json()
    fmt = body.get("format", "anthropic")
    from backend.custom_model import export_training_data
    result = export_training_data(format=fmt)
    return result

@app.get("/api/custom-model/training-stats")
async def training_stats():
    """Return training data readiness statistics."""
    from backend.custom_model import get_training_data_stats
    return get_training_data_stats()

# ============================================================
# TOGETHER.AI FINE-TUNING
# ============================================================
@app.get("/api/together/status")
async def together_status():
    """Full status: config, readiness, active jobs, history."""
    from backend.together_finetune import get_together_status
    return get_together_status()

@app.post("/api/together/finetune")
async def together_finetune(request: Request):
    """One-click: prepare data → upload → start LoRA fine-tuning."""
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    from backend.together_finetune import run_full_finetune_pipeline
    return run_full_finetune_pipeline(hyperparams=body.get("hyperparams"))

@app.get("/api/together/jobs")
async def together_jobs():
    """List all fine-tuning jobs."""
    from backend.together_finetune import list_finetune_jobs
    return list_finetune_jobs()

@app.get("/api/together/job/{job_id}")
async def together_job_status(job_id: str):
    """Poll a specific fine-tuning job. Auto-activates on completion."""
    from backend.together_finetune import get_finetune_status
    return get_finetune_status(job_id)

@app.post("/api/together/activate")
async def together_activate(request: Request):
    """Manually activate a fine-tuned model by name."""
    body = await request.json()
    model_name = body.get("model")
    if not model_name:
        return {"success": False, "error": "model name required"}
    from backend.together_finetune import activate_finetuned_model
    return activate_finetuned_model(model_name)

@app.post("/api/together/deactivate")
async def together_deactivate():
    """Deactivate custom model, revert to 2-model ensemble."""
    from backend.together_finetune import deactivate_custom_model
    return deactivate_custom_model()

@app.get("/api/together/training-data/preview")
async def together_training_preview():
    """Preview what training data would be generated."""
    from backend.together_finetune import prepare_training_file
    return prepare_training_file()

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

@app.get("/api/sla")
async def get_sla_config():
    """Return current SLA targets from policy config."""
    from backend.cases import get_sla_targets, SLA_WARNING_PCT
    targets = get_sla_targets()
    return {
        "targets": targets,
        "warningThreshold": SLA_WARNING_PCT,
        "description": "Cases are auto-escalated when SLA deadline is breached. At-risk warning fires at 75% of deadline.",
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
    """Update policy fields. Requires manager+ role. Tracks per-field old→new changes."""
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

    # Capture old values BEFORE update
    current = get_policy()
    old_values = {k: current.get(k) for k in body if k in current and current.get(k) != body[k]}

    updated = update_policy(body)

    # Build per-field change record with old→new
    changes = {}
    for k, old_val in old_values.items():
        new_val = updated.get(k)
        if str(old_val) != str(new_val):
            changes[k] = {"old": old_val, "new": new_val}

    _by = user.get("name", "System") if user else "System"
    _email = user.get("email", "") if user else ""
    _ts = datetime.now().isoformat()

    db = get_db()
    # Activity log (existing)
    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "policy_updated",
        "fieldsChanged": list(body.keys()), "timestamp": _ts, "performedBy": _by})

    # Detailed policy history with per-field old→new (new)
    if changes:
        if "policy_history" not in db:
            db["policy_history"] = []
        db["policy_history"].insert(0, {
            "id": str(uuid.uuid4())[:8],
            "action": "policy_updated",
            "changes": changes,
            "fieldsChanged": list(changes.keys()),
            "timestamp": _ts,
            "performedBy": _by,
            "performedByEmail": _email,
        })
        # Keep last 100 entries
        db["policy_history"] = db["policy_history"][:100]

    import copy as _c
    db["_policy_state"] = _c.deepcopy(updated)
    save_db(db)
    return {"success": True, "policy": updated, "changes": changes}

@app.post("/api/policy/preset/{preset_name}")
async def apply_policy_preset(preset_name: str, request: Request):
    """Apply a named policy preset. Requires manager+ role. Tracks all field changes."""
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
    fields = {k: v for k, v in preset.items() if k not in ("name", "description")}

    # Capture old values BEFORE update
    current = get_policy()
    old_values = {k: current.get(k) for k in fields if k in current}

    updated = update_policy(fields)

    # Build per-field change record
    changes = {}
    for k, old_val in old_values.items():
        new_val = updated.get(k)
        if str(old_val) != str(new_val):
            changes[k] = {"old": old_val, "new": new_val}

    _by = user.get("name", "System") if user else "System"
    _email = user.get("email", "") if user else ""
    _ts = datetime.now().isoformat()

    db = get_db()
    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "policy_preset_applied",
        "preset": preset_name, "timestamp": _ts, "performedBy": _by})

    if "policy_history" not in db:
        db["policy_history"] = []
    db["policy_history"].insert(0, {
        "id": str(uuid.uuid4())[:8],
        "action": "policy_preset_applied",
        "preset": preset_name,
        "changes": changes,
        "fieldsChanged": list(changes.keys()),
        "timestamp": _ts,
        "performedBy": _by,
        "performedByEmail": _email,
    })
    db["policy_history"] = db["policy_history"][:100]

    import copy as _c
    db["_policy_state"] = _c.deepcopy(updated)
    save_db(db)
    return {"success": True, "preset": preset_name, "applied": fields, "policy": updated, "changes": changes}

@app.get("/api/policy/presets")
async def list_policy_presets():
    """List all available policy presets with descriptions."""
    return {"presets": {k: {"name": v["name"], "description": v["description"]}
        for k, v in POLICY_PRESETS.items()}}

@app.get("/api/policy/history")
async def get_policy_history():
    """Return policy change history with per-field old→new values."""
    db = get_db()
    return {"history": db.get("policy_history", [])[:50]}

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

    # ── AUTO-SUPPRESSION: repeated false positives get severity downgraded ──
    def _check_suppression(anom_dict, vendor):
        patterns = db.get("resolution_patterns", [])
        atype = anom_dict.get("type", "")
        dismiss_ct = sum(1 for p in patterns if p.get("vendor") == vendor
                         and p.get("anomalyType") == atype and p.get("outcome") == "dismissed")
        if dismiss_ct >= 3:
            anom_dict["suppressed"] = True
            anom_dict["suppressionReason"] = f"Dismissed {dismiss_ct}x for this vendor"
            orig = anom_dict.get("severity", "medium")
            anom_dict["originalSeverity"] = orig
            anom_dict["severity"] = "low" if orig in ("medium", "low") else "medium"
        return anom_dict

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
            _check_suppression(anom, record["vendor"])
            new_anomalies.append(anom)
            db["anomalies"].append(anom)

        # F5: Three-way match anomalies (GRN checks)
        matched_entry = next((m for m in db["matches"] if m.get("invoiceId") == record["id"]), None)

        # Phase 2: Contract compliance anomalies (price drift, expiry warning)
        if vc:
            contract_anoms = detect_contract_compliance_anomalies(record, vc, db)
            for a in contract_anoms:
                anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                    "invoiceNumber": record.get("invoiceNumber", ""), "vendor": record["vendor"],
                    "currency": record.get("currency", "USD"),
                    "detectedAt": datetime.now().isoformat(), "status": "open", **a}
                _check_suppression(anom, record["vendor"])
                new_anomalies.append(anom)
                db["anomalies"].append(anom)

        if matched_entry and mpo:
            grn_info = {k: matched_entry.get(k) for k in
                ("matchType", "grnStatus", "grnIds", "grnNumbers", "totalReceived", "grnLineItems")}
            grn_anomalies = detect_grn_anomalies(record, mpo, grn_info, db)
            for a in grn_anomalies:
                anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                    "invoiceNumber": record.get("invoiceNumber", ""), "vendor": record["vendor"],
                    "currency": record.get("currency", "USD"),
                    "detectedAt": datetime.now().isoformat(), "status": "open", **a}
                _check_suppression(anom, record["vendor"])
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
            # ── CASE MANAGEMENT: Auto-create cases for BLOCK/REVIEW ──
            new_cases = auto_create_cases_from_triage(
                db_invoice, db.get("anomalies", []), triage_result, db, created_by=_upload_by)
            if new_cases:
                db.setdefault("cases", []).extend(new_cases)
                for nc in new_cases:
                    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "case_created",
                        "caseId": nc["id"], "caseType": nc["type"], "title": nc["title"],
                        "invoiceId": nc.get("invoiceId"), "vendor": nc.get("vendor"),
                        "priority": nc["priority"], "amountAtRisk": nc["amountAtRisk"],
                        "timestamp": datetime.now().isoformat(), "performedBy": _upload_by})
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

    # ── Webhook notifications (fire-and-forget, use existing db ref) ──
    try:
        await dispatch_webhook_event(db, "document.created", {
            "id": record["id"], "type": record["type"],
            "documentNumber": record.get("invoiceNumber") or record.get("poNumber") or record.get("contractNumber") or record.get("grnNumber"),
            "vendor": record.get("vendor"), "amount": record.get("amount"),
        })
        if new_anomalies:
            for anom in new_anomalies:
                await dispatch_webhook_event(db, "anomaly.detected", {
                    "id": anom["id"], "type": anom["type"], "severity": anom["severity"],
                    "invoiceNumber": anom.get("invoiceNumber"), "vendor": anom.get("vendor"),
                    "amount_at_risk": anom.get("amount_at_risk", 0),
                })
        if triage_result and triage_result.get("lane") == "BLOCK":
            await dispatch_webhook_event(db, "triage.blocked", {
                "invoiceId": record["id"],
                "invoiceNumber": record.get("invoiceNumber"),
                "vendor": record.get("vendor"), "amount": record.get("amount"),
                "reasons": triage_result.get("reasons", []),
            })
    except Exception:
        pass  # Webhooks are non-critical — never block the upload

    return {"success": True, "document": record, "new_matches": new_matches,
        "new_anomalies": new_anomalies, "extraction_source": extracted.get("_source", "unknown"),
        "triage": triage_result, "processing_time": _timings,
        # ── Top-level fields for React frontend (BUG 6 fix) ──
        # Upload result card reads k.type, k.confidence directly (not k.document.type)
        "type": record.get("type"),
        "confidence": record.get("confidence", 0),
        "vendor": record.get("vendor"),
        "amount": record.get("amount"),
        "currency": record.get("currency", "USD"),
        "invoiceNumber": record.get("invoiceNumber") or record.get("poNumber") or record.get("contractNumber") or record.get("documentNumber"),
    }
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
async def get_documents(user: dict = Depends(get_optional_user)):
    db = get_db()
    scope = get_user_vendor_scope(user)
    docs = db["invoices"] + db["purchase_orders"] + db.get("contracts", []) + db.get("goods_receipts", [])
    docs = scope_by_vendor(docs, scope)
    return {"documents": sorted(docs, key=lambda x: x.get("extractedAt", ""), reverse=True), "total": len(docs)}

@app.get("/api/invoices")
async def get_invoices(user: dict = Depends(get_optional_user)):
    scope = get_user_vendor_scope(user)
    return {"invoices": scope_by_vendor(get_db()["invoices"], scope)}

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

# ============================================================
# PHASE 2-4: CONTRACT INTELLIGENCE, VENDOR KYC, GRN ANALYTICS
# ============================================================

@app.get("/api/contracts/{contract_id}/analysis")
async def get_contract_analysis(contract_id: str):
    """Phase 2: Clause-level risk analysis for a contract."""
    db = get_db()
    contract = next((c for c in db.get("contracts", []) if c["id"] == contract_id), None)
    if not contract:
        raise HTTPException(404, "Contract not found")
    analysis = analyze_contract_clauses(contract)
    health = compute_contract_health(contract, db)
    return {"contract_id": contract_id, "analysis": analysis, "health": health}

@app.get("/api/contracts/health")
async def get_all_contract_health():
    """Phase 2: Health scores for all contracts."""
    db = get_db()
    results = []
    for c in db.get("contracts", []):
        h = compute_contract_health(c, db)
        results.append({
            "id": c.get("id"), "vendor": c.get("vendor"),
            "number": c.get("contractNumber") or c.get("id"),
            "amount": c.get("amount"), "currency": c.get("currency", "USD"),
            **h
        })
    return {"contracts": sorted(results, key=lambda x: x.get("health_score", 100))}

@app.get("/api/contracts/expiring")
async def get_expiring_contracts_endpoint(days: int = 90):
    """Phase 2: Contracts expiring within N days."""
    db = get_db()
    return {"expiring": get_expiring_contracts(db, days)}

@app.get("/api/vendors/{vendor_name}/extended-risk")
async def get_vendor_extended_risk(vendor_name: str):
    """Phase 3: Extended 9-factor vendor risk profile."""
    db = get_db()
    risk = compute_extended_vendor_risk(vendor_name, db)
    kyc = get_vendor_kyc_status(vendor_name, db)
    return {"vendor": vendor_name, "risk": risk, "kyc": kyc}

@app.get("/api/vendors/{vendor_name}/delivery")
async def get_vendor_delivery(vendor_name: str):
    """Phase 4: GRN delivery performance analytics."""
    db = get_db()
    return {"vendor": vendor_name, "delivery": compute_delivery_performance(vendor_name, db)}

@app.get("/api/intelligence/summary")
async def get_intelligence_summary_endpoint():
    """Phase 2-4: Dashboard intelligence metrics."""
    db = get_db()
    return get_intelligence_summary(db)


@app.post("/api/contracts/lifecycle-check")
async def run_lifecycle_check_endpoint(request: Request):
    """Run contract lifecycle scheduler.
    - Creates AP cases ONLY for over-utilization (the one event AP can act on)
    - Generates intelligence alerts for CFO/Procurement (expiry, renewal, SLA, penalties)
    Idempotent: won't create duplicates."""
    user = _user_from_request(request)
    if not user:
        raise HTTPException(401, "Unauthorized")
    db = get_db()
    results = run_lifecycle_checks(db)
    if results["cases_created"] or results["alerts"]:
        for case in results["cases_created"]:
            db["activity_log"].append({
                "id": str(uuid.uuid4())[:8],
                "action": "lifecycle_case_created",
                "documentId": case.get("contractId", ""),
                "vendor": case.get("vendor", ""),
                "caseId": case["id"],
                "caseType": case.get("type", ""),
                "priority": case.get("priority", ""),
                "timestamp": datetime.now().isoformat(),
                "performedBy": user.get("email", "system"),
            })
        save_db(db)
    return {
        "status": "completed",
        "summary": results["summary"],
        "cases_created": [{
            "id": c["id"], "type": c.get("type"), "title": c.get("title"),
            "priority": c.get("priority"), "vendor": c.get("vendor"),
        } for c in results["cases_created"]],
        "alerts_generated": [{
            "category": a["category"], "headline": a["headline"],
            "urgency": a["urgency"], "vendor": a["vendor"], "audience": a["audience"],
        } for a in results["alerts"]],
    }


@app.get("/api/contracts/intelligence-report")
async def get_intelligence_report(request: Request):
    """Monthly Contract Intelligence Report for CFO/Procurement.
    Packages lifecycle data for executive audience — not AP investigation tickets."""
    user = _user_from_request(request)
    if not user:
        raise HTTPException(401, "Unauthorized")
    db = get_db()
    return generate_contract_intelligence_report(db)

@app.get("/api/matches")
async def get_matches(user: dict = Depends(get_optional_user)):
    db = get_db()
    scope = get_user_vendor_scope(user)
    matches = scope_by_vendor(db["matches"], scope)
    three_way = sum(1 for m in matches if m.get("matchType") == "three_way")
    two_way = sum(1 for m in matches if m.get("matchType") == "two_way" or not m.get("matchType"))
    return {"matches": matches, "summary": {"total": len(matches),
        "auto_matched": sum(1 for m in matches if m["status"] == "auto_matched"),
        "review_needed": sum(1 for m in matches if m["status"] == "review_needed"),
        "three_way": three_way, "two_way": two_way}}

@app.get("/api/anomalies")
async def get_anomalies(user: dict = Depends(get_optional_user)):
    db = get_db()
    an = db.get("anomalies", [])
    scope = get_user_vendor_scope(user)
    an = scope_by_vendor(an, scope)
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
            if a.get("status") != "open":
                return {"success": False, "error": f"Anomaly already {a.get('status')} — cannot resolve again"}
            body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
            a["status"] = "resolved"
            a["resolution"] = body.get("resolution", "")
            a["resolvedAt"] = datetime.now().isoformat()
            a["resolvedBy"] = user_display
            # ── AUDIT TRAIL: Log the resolution action ──
            db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "anomaly_resolved",
                "anomalyId": aid, "anomalyType": a.get("type", ""),
                "vendor": a.get("vendor", ""), "severity": a.get("severity", ""),
                "amountAtRisk": a.get("amount_at_risk", 0),
                "resolution": a.get("resolution", ""),
                "timestamp": datetime.now().isoformat(), "performedBy": user_display})
            # ── RESOLUTION PATTERN: Capture for model training ──
            db.setdefault("resolution_patterns", []).append({
                "id": str(uuid.uuid4())[:8],
                "anomalyType": a.get("type", ""),
                "severity": a.get("severity", ""),
                "vendor": a.get("vendor", ""),
                "amountAtRisk": a.get("amount_at_risk", 0),
                "outcome": "resolved",
                "resolution": a.get("resolution", ""),
                "daysOpen": round((datetime.now() - datetime.fromisoformat(a.get("detectedAt", datetime.now().isoformat()))).total_seconds() / 86400, 1) if a.get("detectedAt") else 0,
                "resolvedBy": user_display,
                "timestamp": datetime.now().isoformat()
            })
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
            # ── CASE SYNC: Check if parent case can be auto-resolved ──
            auto_resolved = sync_case_on_anomaly_resolve(aid, db.get("cases", []), db.get("anomalies", []))
            for cid in auto_resolved:
                db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "case_auto_resolved",
                    "caseId": cid, "trigger": f"anomaly_{aid}_resolved",
                    "timestamp": datetime.now().isoformat(), "performedBy": "system"})
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
            if a.get("status") != "open":
                return {"success": False, "error": f"Anomaly already {a.get('status')} — cannot dismiss again"}
            body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
            a["status"] = "dismissed"
            a["dismissReason"] = body.get("reason", "")
            a["dismissedAt"] = datetime.now().isoformat()
            a["dismissedBy"] = user_display
            # ── AUDIT TRAIL: Log the dismissal action ──
            db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "anomaly_dismissed",
                "anomalyId": aid, "anomalyType": a.get("type", ""),
                "vendor": a.get("vendor", ""), "severity": a.get("severity", ""),
                "amountAtRisk": a.get("amount_at_risk", 0),
                "dismissReason": a.get("dismissReason", ""),
                "timestamp": datetime.now().isoformat(), "performedBy": user_display})
            # ── RESOLUTION PATTERN: Capture for model training ──
            db.setdefault("resolution_patterns", []).append({
                "id": str(uuid.uuid4())[:8],
                "anomalyType": a.get("type", ""),
                "severity": a.get("severity", ""),
                "vendor": a.get("vendor", ""),
                "amountAtRisk": a.get("amount_at_risk", 0),
                "outcome": "dismissed",
                "resolution": a.get("dismissReason", ""),
                "daysOpen": round((datetime.now() - datetime.fromisoformat(a.get("detectedAt", datetime.now().isoformat()))).total_seconds() / 86400, 1) if a.get("detectedAt") else 0,
                "resolvedBy": user_display,
                "timestamp": datetime.now().isoformat()
            })
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
            # ── CASE SYNC: Check if parent case can be auto-resolved ──
            auto_resolved = sync_case_on_anomaly_resolve(aid, db.get("cases", []), db.get("anomalies", []))
            for cid in auto_resolved:
                db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "case_auto_resolved",
                    "caseId": cid, "trigger": f"anomaly_{aid}_dismissed",
                    "timestamp": datetime.now().isoformat(), "performedBy": "system"})
            save_db(db)
            return {"success": True, "anomaly": a}
    raise HTTPException(404)


# ── Resolution Patterns & Training Data ──

@app.get("/api/anomalies/resolution-patterns")
async def get_resolution_patterns(request: Request):
    """Return analyst resolution patterns for training and analytics."""
    db = get_db()
    patterns = db.get("resolution_patterns", [])
    # Aggregate by anomaly type
    type_stats = {}
    for p in patterns:
        t = p.get("anomalyType", "unknown")
        if t not in type_stats:
            type_stats[t] = {"type": t, "total": 0, "resolved": 0, "dismissed": 0,
                "avg_days_open": 0, "vendors": set(), "total_risk": 0}
        ts = type_stats[t]
        ts["total"] += 1
        ts["resolved" if p.get("outcome") == "resolved" else "dismissed"] += 1
        ts["avg_days_open"] += p.get("daysOpen", 0)
        ts["vendors"].add(p.get("vendor", ""))
        ts["total_risk"] += p.get("amountAtRisk", 0)
    for ts in type_stats.values():
        ts["avg_days_open"] = round(ts["avg_days_open"] / max(ts["total"], 1), 1)
        ts["dismiss_rate"] = round(ts["dismissed"] / max(ts["total"], 1) * 100, 1)
        ts["unique_vendors"] = len(ts["vendors"])
        ts["vendors"] = list(ts["vendors"])[:5]
    return {
        "total_patterns": len(patterns),
        "by_type": sorted(type_stats.values(), key=lambda x: x["total"], reverse=True),
        "recent": patterns[-20:] if patterns else [],
        "training_ready": len(patterns) >= 10,
        "training_message": f"{len(patterns)} resolution patterns captured. {max(0, 10 - len(patterns))} more needed for training export." if len(patterns) < 10 else f"{len(patterns)} patterns ready for model training."
    }


@app.get("/api/anomalies/escalation-targets")
async def get_escalation_targets(request: Request):
    """Return smart escalation targets based on anomaly type and policy."""
    db = get_db()
    policy = db.get("policy", {})
    authority = policy.get("authority_tiers", [
        {"role": "ap_clerk", "limit": 5000, "label": "AP Clerk"},
        {"role": "ap_manager", "limit": 25000, "label": "AP Manager"},
        {"role": "controller", "limit": 100000, "label": "Controller"},
        {"role": "vp_finance", "limit": 500000, "label": "VP Finance"},
        {"role": "cfo", "limit": None, "label": "CFO"},
    ])
    # Escalation routing — read from policy if configured, else use defaults
    default_routing = {
        "TERMS_VIOLATION": {"primary": "AP Manager", "secondary": "Procurement Lead", "reason": "Contract/PO terms discrepancy requires procurement review"},
        "PRICE_VARIANCE": {"primary": "AP Manager", "secondary": "Category Manager", "reason": "Price discrepancy needs vendor negotiation oversight"},
        "DUPLICATE_INVOICE": {"primary": "AP Manager", "secondary": "Internal Audit", "reason": "Potential duplicate payment requires investigation"},
        "MISSING_PO": {"primary": "Procurement Lead", "secondary": "AP Manager", "reason": "Missing purchase order — procurement must validate"},
        "CONTRACT_EXPIRY_WARNING": {"primary": "Procurement Lead", "secondary": "Legal", "reason": "Expired contract needs renewal or new agreement"},
        "CONTRACT_PRICE_DRIFT": {"primary": "Category Manager", "secondary": "Controller", "reason": "Systematic price drift from contract rates"},
        "CONTRACT_OVER_UTILIZATION": {"primary": "Controller", "secondary": "VP Finance", "reason": "Contract budget exceeded — requires financial review"},
        "AMOUNT_SPIKE": {"primary": "AP Manager", "secondary": "Controller", "reason": "Unusual amount increase needs approval"},
        "SHORT_SHIPMENT": {"primary": "Receiving/Warehouse", "secondary": "Procurement Lead", "reason": "Goods received less than PO — vendor follow-up needed"},
    }
    routing = policy.get("escalation_routing", default_routing)
    return {"authority_tiers": authority, "routing_suggestions": routing}


# ── Activity Log / Audit Trail ──

@app.get("/api/activity-log")
async def get_activity_log(request: Request, limit: int = 100, action: str = None):
    """Full audit trail — every action with who, what, when."""
    _user_from_request(request)
    db = get_db()
    log = db.get("activity_log", [])
    if action:
        log = [e for e in log if e.get("action") == action]
    log = sorted(log, key=lambda x: x.get("timestamp", ""), reverse=True)[:limit]
    action_counts = {}
    for e in db.get("activity_log", []):
        a = e.get("action", "unknown")
        action_counts[a] = action_counts.get(a, 0) + 1
    return {"log": log, "total": len(db.get("activity_log", [])), "action_counts": action_counts}


# ── In-App Notifications ──

@app.get("/api/notifications")
async def get_notifications(request: Request):
    """Cases assigned to current user + recent team activity."""
    user = _user_from_request(request)
    user_name = user.get("name", "")
    user_role = user.get("role", "")
    db = get_db()
    role_labels = {"cfo": "CFO", "vp_finance": "VP Finance", "controller": "Controller",
                   "ap_manager": "AP Manager", "ap_clerk": "AP Clerk"}
    my_label = role_labels.get(user_role, user_role)
    active = [c for c in db.get("cases", []) if c.get("status") in ("open", "in_progress", "escalated")]
    my_cases = [c for c in active
                if (c.get("assignedTo") or "").lower() in (user_name.lower(), my_label.lower(), user_role.lower())
                or not c.get("assignedTo") or c.get("assignedTo") == "unassigned"]
    escalations = [c for c in my_cases if c.get("type") == "anomaly_escalation"]
    recent = sorted([e for e in db.get("activity_log", [])
                     if e.get("action") in ("anomaly_resolved", "anomaly_dismissed", "case_created",
                                             "case_auto_resolved", "escalation_matrix_updated")],
                    key=lambda x: x.get("timestamp", ""), reverse=True)[:15]
    return {"my_cases": len(my_cases), "cases": my_cases[:10],
            "unread_escalations": len(escalations), "recent_activity": recent}


# ── Configurable Escalation Matrix ──

@app.get("/api/policy/escalation-matrix")
async def get_escalation_matrix(request: Request):
    _user_from_request(request)
    db = get_db()
    policy = db.get("policy", {})
    default = {
        "TERMS_VIOLATION": {"primary": "AP Manager", "secondary": "Procurement Lead"},
        "PRICE_VARIANCE": {"primary": "AP Manager", "secondary": "Category Manager"},
        "DUPLICATE_INVOICE": {"primary": "AP Manager", "secondary": "Internal Audit"},
        "MISSING_PO": {"primary": "Procurement Lead", "secondary": "AP Manager"},
        "CONTRACT_EXPIRY_WARNING": {"primary": "Procurement Lead", "secondary": "Legal"},
        "CONTRACT_PRICE_DRIFT": {"primary": "Category Manager", "secondary": "Controller"},
        "CONTRACT_OVER_UTILIZATION": {"primary": "Controller", "secondary": "VP Finance"},
        "AMOUNT_SPIKE": {"primary": "AP Manager", "secondary": "Controller"},
        "SHORT_SHIPMENT": {"primary": "Receiving/Warehouse", "secondary": "Procurement Lead"},
    }
    matrix = policy.get("escalation_routing", default)
    roles = ["AP Clerk", "AP Manager", "Procurement Lead", "Category Manager",
             "Controller", "VP Finance", "CFO", "Legal", "Internal Audit", "Receiving/Warehouse"]
    return {"matrix": matrix, "available_roles": roles}


@app.post("/api/policy/escalation-matrix")
async def update_escalation_matrix(request: Request):
    user = _user_from_request(request)
    user_display = get_user_display(request)
    body = await request.json()
    matrix = body.get("matrix", {})
    db = get_db()
    db.setdefault("policy", {})["escalation_routing"] = matrix
    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "escalation_matrix_updated",
        "timestamp": datetime.now().isoformat(), "performedBy": user_display,
        "changes": f"{len(matrix)} routing rules updated"})
    save_db(db)
    return {"success": True, "matrix": matrix}


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
async def get_vendors(user: dict = Depends(get_optional_user)):
    """List all vendors with risk scores, spend, anomaly data."""
    db = get_db()
    scope = get_user_vendor_scope(user)
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

    # Scope vendor profiles: filter by vendor display name
    if scope:
        scope_lower = [v.lower() for v in scope]
        scope_normalized = [normalize_vendor(v) for v in scope]
        profiles = [p for p in profiles if p.get("vendorNormalized") in scope_normalized
                    or (p.get("vendor") or "").lower() in scope_lower]

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
async def get_triage_overview(user: dict = Depends(get_optional_user)):
    """Get triage overview: lane counts, auto-approve rate, blocked invoices."""
    db = get_db()
    decisions = db.get("triage_decisions", [])
    scope = get_user_vendor_scope(user)
    invoices = scope_by_vendor(db.get("invoices", []), scope)

    # Build lane counts from invoice records (source of truth after edits)
    auto_approved = [i for i in invoices if i.get("triageLane") == "AUTO_APPROVE"]
    review = [i for i in invoices if i.get("triageLane") in ("REVIEW", "MANAGER_REVIEW", "VP_REVIEW", "CFO_REVIEW")]
    manager_review = [i for i in invoices if i.get("triageLane") == "MANAGER_REVIEW"]
    vp_review = [i for i in invoices if i.get("triageLane") == "VP_REVIEW"]
    cfo_review = [i for i in invoices if i.get("triageLane") == "CFO_REVIEW"]
    blocked = [i for i in invoices if i.get("triageLane") == "BLOCK"]
    untriaged = [i for i in invoices if not i.get("triageLane")]
    total_triaged = len(auto_approved) + len(review) + len(blocked)

    # React frontend (bU component) reads triageData["AUTO_APPROVE"] etc. as invoice arrays
    return {
        # ── Lane-keyed invoice arrays for React Triage page ──
        "AUTO_APPROVE": auto_approved,
        "MANAGER_REVIEW": manager_review if manager_review else review,
        "VP_REVIEW": vp_review,
        "CFO_REVIEW": cfo_review,
        "BLOCK": blocked,
        "REVIEW": review,
        # ── Legacy structured response ──
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

# ============================================================
# CASE MANAGEMENT API
# ============================================================

@app.get("/api/cases")
async def list_cases(request: Request, status: str = None, priority: str = None, assigned_to: str = None,
                     user: dict = Depends(get_optional_user)):
    """List all cases with optional filters."""
    db = get_db()
    scope = get_user_vendor_scope(user)
    cases = scope_by_vendor(db.get("cases", []), scope)
    if status:
        cases = [c for c in cases if c["status"] == status]
    if priority:
        cases = [c for c in cases if c["priority"] == priority]
    if assigned_to:
        if assigned_to == "unassigned":
            cases = [c for c in cases if not c.get("assignedTo")]
        else:
            cases = [c for c in cases if c.get("assignedTo") == assigned_to]
    # Enrich with SLA status
    for c in cases:
        c["_slaStatus"] = check_sla_status(c)
    return {"cases": cases, "total": len(cases)}

@app.get("/api/cases/metrics")
async def case_metrics():
    """Dashboard metrics for case management."""
    db = get_db()
    cases = db.get("cases", [])
    users = db.get("users", [])
    return compute_case_metrics(cases, users)

@app.get("/api/cases/sla-alerts")
async def sla_alerts():
    """Get cases with SLA breaches or at-risk SLA."""
    db = get_db()
    alerts = run_sla_sweep(db.get("cases", []))
    return {"alerts": alerts, "total": len(alerts)}

@app.get("/api/cases/invoice/{invoice_id}")
async def cases_for_invoice(invoice_id: str):
    """Get all cases linked to a specific invoice."""
    db = get_db()
    cases = [c for c in db.get("cases", []) if c.get("invoiceId") == invoice_id]
    for c in cases:
        c["_slaStatus"] = check_sla_status(c)
    return {"cases": cases}

@app.get("/api/cases/{case_id}")
async def get_case(case_id: str):
    """Get a single case with full detail."""
    db = get_db()
    case = next((c for c in db.get("cases", []) if c["id"] == case_id), None)
    if not case:
        raise HTTPException(404, "Case not found")
    case["_slaStatus"] = check_sla_status(case)
    # Enrich: fetch linked anomalies and invoice
    case["_anomalies"] = [a for a in db.get("anomalies", []) if a["id"] in case.get("anomalyIds", [])]
    if case.get("invoiceId"):
        case["_invoice"] = next((i for i in db["invoices"] if i["id"] == case["invoiceId"]), None)
    return case

@app.post("/api/cases")
async def create_case_manual(request: Request):
    """Manually create a case (for ad-hoc investigations)."""
    user_display = get_user_display(request)
    body = await request.json()
    case = create_case(
        case_type=body.get("type", "general_investigation"),
        title=body.get("title", "Manual Investigation"),
        description=body.get("description", ""),
        priority=body.get("priority", "medium"),
        invoice_id=body.get("invoiceId"),
        anomaly_ids=body.get("anomalyIds", []),
        vendor=body.get("vendor"),
        amount_at_risk=float(body.get("amountAtRisk", 0)),
        currency=body.get("currency", "USD"),
        created_by=user_display,
        assigned_to=body.get("assignedTo"),
    )
    db = get_db()
    db.setdefault("cases", []).append(case)
    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "case_created",
        "caseId": case["id"], "caseType": case["type"], "title": case["title"],
        "priority": case["priority"], "assignedTo": case.get("assignedTo", "unassigned"),
        "timestamp": datetime.now().isoformat(),
        "performedBy": user_display})
    save_db(db)
    # Notify via webhook (email/Slack/Teams integration)
    await dispatch_webhook_event(db, "case.created", {
        "caseId": case["id"], "title": case["title"], "type": case["type"],
        "priority": case["priority"], "assignedTo": case.get("assignedTo", "unassigned"),
        "description": case.get("description", ""), "createdBy": user_display,
    })
    return {"success": True, "case": case}

@app.post("/api/cases/{case_id}/transition")
async def transition_case_endpoint(case_id: str, request: Request):
    """Transition case status."""
    user_display = get_user_display(request)
    body = await request.json()
    new_status = body.get("status")
    reason = body.get("reason", "").strip()
    if not new_status:
        raise HTTPException(400, "Missing 'status' field")
    # F&A audit trail: resolution documentation is mandatory
    if new_status in ("resolved", "closed") and not reason:
        raise HTTPException(400, f"A reason is required when setting status to '{new_status}'. F&A audit trail requires resolution documentation.")
    db = get_db()
    case = next((c for c in db.get("cases", []) if c["id"] == case_id), None)
    if not case:
        raise HTTPException(404, "Case not found")
    try:
        transition_case(case, new_status, user_display, reason)
    except ValueError as e:
        raise HTTPException(400, str(e))
    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "case_status_changed",
        "caseId": case_id, "newStatus": new_status, "reason": reason,
        "timestamp": datetime.now().isoformat(), "performedBy": user_display})
    save_db(db)
    return {"success": True, "case": case}

@app.post("/api/cases/{case_id}/assign")
async def assign_case_endpoint(case_id: str, request: Request):
    """Assign or reassign a case."""
    user_display = get_user_display(request)
    body = await request.json()
    assigned_to = body.get("assignedTo")
    if not assigned_to:
        raise HTTPException(400, "Missing 'assignedTo' field")
    db = get_db()
    case = next((c for c in db.get("cases", []) if c["id"] == case_id), None)
    if not case:
        raise HTTPException(404, "Case not found")
    assign_case(case, assigned_to, user_display)
    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "case_assigned",
        "caseId": case_id, "assignedTo": assigned_to,
        "timestamp": datetime.now().isoformat(), "performedBy": user_display})
    save_db(db)
    return {"success": True, "case": case}

@app.post("/api/cases/{case_id}/note")
async def add_note_endpoint(case_id: str, request: Request):
    """Add a note/comment to a case."""
    user_display = get_user_display(request)
    body = await request.json()
    text = body.get("text", "").strip()
    if not text:
        raise HTTPException(400, "Note text cannot be empty")
    db = get_db()
    case = next((c for c in db.get("cases", []) if c["id"] == case_id), None)
    if not case:
        raise HTTPException(404, "Case not found")
    add_case_note(case, text, user_display)
    save_db(db)
    return {"success": True, "case": case}

@app.post("/api/cases/{case_id}/escalate")
async def escalate_case_endpoint(case_id: str, request: Request):
    """Escalate a case to a higher authority."""
    user_display = get_user_display(request)
    role = get_role_from_request(request)
    body = await request.json()
    escalated_to = body.get("escalatedTo", "")
    reason = body.get("reason", "")
    if not reason:
        raise HTTPException(400, "Escalation reason is required")
    db = get_db()
    case = next((c for c in db.get("cases", []) if c["id"] == case_id), None)
    if not case:
        raise HTTPException(404, "Case not found")
    try:
        escalate_case(case, escalated_to, reason, user_display)
    except ValueError as e:
        raise HTTPException(400, str(e))
    db["activity_log"].append({"id": str(uuid.uuid4())[:8], "action": "case_escalated",
        "caseId": case_id, "escalatedTo": escalated_to, "reason": reason,
        "timestamp": datetime.now().isoformat(), "performedBy": user_display})
    save_db(db)
    return {"success": True, "case": case}

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
async def get_dashboard(user: dict = Depends(get_optional_user)):
    db = get_db(); now = datetime.now()
    scope = get_user_vendor_scope(user)
    all_invoices = scope_by_vendor(db["invoices"], scope)
    all_anomalies = scope_by_vendor(db.get("anomalies", []), scope)
    all_matches = scope_by_vendor(db["matches"], scope)
    unpaid = [i for i in all_invoices if i.get("status") not in ("paid",)]
    tar = sum(i["amount"] for i in unpaid)
    bk = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0}
    bc = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0}
    for i in unpaid:
        d = i.get("dueDate")
        try: do = (now - datetime.fromisoformat(d)).days if d else 0
        except: do = 0
        k = "current" if do <= 0 else "1_30" if do <= 30 else "31_60" if do <= 60 else "61_90" if do <= 90 else "90_plus"
        bk[k] += i["amount"]; bc[k] += 1

    ad = all_invoices + scope_by_vendor(db["purchase_orders"], scope) + scope_by_vendor(db.get("contracts", []), scope)
    ac = (sum(d.get("confidence", 0) for d in ad) / len(ad)) if ad else 0
    oa = [a for a in all_anomalies if a.get("status") == "open"]

    # Vendor spend analysis — track display name + spend
    vendor_spend = {}
    vendor_display = {}  # normalized -> best display name
    for inv in all_invoices:
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
    for i in all_invoices:
        epd = i.get("earlyPaymentDiscount")
        if epd and i.get("status") == "unpaid":
            epd_savings += (i.get("subtotal") or i["amount"]) * (epd.get("discount_percent", 0) / 100)

    # ── F1: Triage metrics ──
    triaged_invoices = [i for i in all_invoices if i.get("triageLane")]
    triage_auto = [i for i in triaged_invoices if i.get("triageLane") == "AUTO_APPROVE"]
    triage_review = [i for i in triaged_invoices if i.get("triageLane") in ("REVIEW", "MANAGER_REVIEW", "VP_REVIEW", "CFO_REVIEW")]
    triage_blocked = [i for i in triaged_invoices if i.get("triageLane") == "BLOCK"]
    total_triaged = len(triaged_invoices)
    auto_approve_rate = round(len(triage_auto) / max(total_triaged, 1) * 100, 1)

    # ── F3: Vendor risk metrics ──
    profiles = db.get("vendor_profiles", [])
    high_risk_vendors = [p for p in profiles if p.get("riskLevel") == "high"]
    worsening_vendors = [p for p in profiles if p.get("trend") == "worsening"]

    # ── Pre-compute values needed by both legacy and React frontend ──
    _total_risk = round(sum(_n(a.get("amount_at_risk")) for a in oa if _n(a.get("amount_at_risk")) > 0), 2)
    _high_severity = sum(1 for a in oa if a.get("severity") == "high")
    # Savings = only RESOLVED anomalies (confirmed and acted upon).
    # Open anomalies are unconfirmed risk, NOT savings.
    # Dismissed anomalies are false positives, NOT savings.
    _resolved = [a for a in all_anomalies if a.get("status") == "resolved"]
    _savings_discovered = round(
        sum(_n(a.get("amount_at_risk")) for a in _resolved
            if _n(a.get("amount_at_risk")) > 0), 2)
    _processing_speed = _compute_processing_speed(db)
    _total_invoices = len(all_invoices)

    # ── React frontend reads dash.summary_bar for stat cards ──
    _summary_bar = {
        "total_invoices": _total_invoices,
        "total_ap": round(tar, 2),
        "auto_approve_rate": auto_approve_rate,
        "total_risk": _total_risk,
        "avg_confidence": round(ac, 1),
        "high_severity": _high_severity,
        "savings_discovered": _savings_discovered,
        "processing_speed": _processing_speed,
    }

    # ── React frontend reads aging["0-30"], ["31-60"], ["61-90"], ["90+"] ──
    _aging_react = {
        "0-30": round(bk.get("current", 0) + bk.get("1_30", 0), 2),
        "31-60": round(bk.get("31_60", 0), 2),
        "61-90": round(bk.get("61_90", 0), 2),
        "90+": round(bk.get("90_plus", 0), 2),
        # Legacy keys preserved
        "buckets": {k: round(v, 2) for k, v in bk.items()},
        "counts": bc,
    }

    return {
        # ── React frontend stat cards (BUG 2 fix) ──
        "summary_bar": _summary_bar,
        # ── React frontend aging chart (BUG 3 fix) ──
        "aging": _aging_react,
        # ── React frontend triage donut + sidebar badge (BUG 4 fix) ──
        "triage": {
            "total_triaged": total_triaged,
            "auto_approved": len(triage_auto),
            "review": len(triage_review),
            "in_review": len(triage_review),   # React reads i.in_review
            "blocked": len(triage_blocked),
            "auto_approve_rate": auto_approve_rate,
            "blocked_amount": round(sum(i.get("amount", 0) for i in triage_blocked), 2),
            "auto_approved_amount": round(sum(i.get("amount", 0) for i in triage_auto), 2),
        },
        # ── Vendor risk metrics (sidebar badge reads dash.vendor_risk.high_risk) ──
        "vendor_risk": {
            "total_vendors": len(profiles),
            "high_risk": len(high_risk_vendors),
            "worsening": len(worsening_vendors),
            "high_risk_vendors": [{"vendor": p.get("vendorDisplay", ""), "score": p.get("riskScore", 0),
                                   "trend": p.get("trend", "")} for p in high_risk_vendors[:5]],
        },
        # ── Case metrics (sidebar badge reads dash.cases.active) ──
        "cases": compute_case_metrics(db.get("cases", []), db.get("users", [])),
        # ── Legacy/backward-compat top-level fields ──
        "total_ap": round(tar, 2), "total_ar": round(tar, 2),
        "unpaid_count": len(unpaid), "total_documents": len(ad),
        "invoice_count": _total_invoices, "po_count": len(db["purchase_orders"]),
        "grn_count": len(db.get("goods_receipts", [])),
        "contract_count": len(db.get("contracts", [])),
        "auto_matched": sum(1 for m in all_matches if m["status"] == "auto_matched"),
        "review_needed": sum(1 for m in all_matches if m["status"] == "review_needed"),
        "three_way_matched": sum(1 for m in all_matches if m.get("matchType") == "three_way"),
        "two_way_only": sum(1 for m in all_matches if m.get("matchType") != "three_way"),
        "avg_confidence": round(ac, 1), "anomaly_count": len(oa),
        "total_risk": _total_risk, "high_severity": _high_severity,
        "savings_discovered": _savings_discovered,
        "savings_breakdown": {
            "overcharges": round(sum(_n(a.get("amount_at_risk")) for a in _resolved
                if a.get("type") in ("PRICE_OVERCHARGE", "AMOUNT_DISCREPANCY", "CONTRACT_PRICE_VIOLATION")
                and _n(a.get("amount_at_risk")) > 0), 2),
            "duplicates_prevented": round(sum(_n(a.get("amount_at_risk")) for a in _resolved
                if a.get("type") == "DUPLICATE_INVOICE"
                and _n(a.get("amount_at_risk")) > 0), 2),
            "contract_violations": round(sum(_n(a.get("amount_at_risk")) for a in _resolved
                if a.get("type") == "TERMS_VIOLATION"
                and _n(a.get("amount_at_risk")) > 0), 2),
            "unauthorized_items": round(sum(_n(a.get("amount_at_risk")) for a in _resolved
                if a.get("type") in ("UNAUTHORIZED_ITEM", "QUANTITY_OVERCHARGE")
                and _n(a.get("amount_at_risk")) > 0), 2),
            "early_payment_opportunities": round(epd_savings, 2),
        },
        "processing_speed": _processing_speed,
        "over_invoiced_pos": sum(1 for m in all_matches if m.get("overInvoiced")),
        "disputed_count": sum(1 for i in all_invoices if i.get("status") == "disputed"),
        "due_in_7_days": len(due_7d), "due_in_7_days_amount": round(sum(i["amount"] for i in due_7d), 2),
        "early_payment_savings": round(epd_savings, 2),
        "top_vendors": [{"vendor": vendor_display.get(v, v), "spend": round(s, 2)} for v, s in top_vendors],
        "recent_activity": sorted(db.get("activity_log", []), key=lambda x: x.get("timestamp", ""), reverse=True)[:10],
        "verified_count": sum(1 for d in ad if d.get("manuallyVerified")),
        "correction_patterns": len(db.get("correction_patterns", [])),
        "rag_stats": get_rag_stats() if RAG_ENABLED else None,
        "api_mode": "claude_api" if USE_REAL_API else "no_api_key",
        "db_backend": "postgres" if DATABASE_URL else "file",
        # Legacy total_invoices at top level
        "total_invoices": _total_invoices,
        # ── Phase 2-4: Intelligence metrics ──
        "intelligence": get_intelligence_summary(db),
        # ── Lifecycle scheduler: auto-create cases for contract events ──
        "lifecycle_last_run": _run_lifecycle_on_dashboard(db),
    }

def _run_lifecycle_on_dashboard(db):
    """Run lifecycle checks silently on dashboard load. Lightweight dedup prevents duplicates."""
    try:
        meta = db.get("_lifecycle_meta", {})
        last_run = meta.get("last_run", "")
        today = datetime.now().strftime("%Y-%m-%d")
        if last_run == today:
            return {"ran": False, "reason": "already_run_today"}
        results = run_lifecycle_checks(db)
        db["_lifecycle_meta"] = {"last_run": today, "last_results": results.get("summary", {})}
        if results["cases_created"] or results["alerts"]:
            save_db(db)
        return {"ran": True, "cases_created": len(results.get("cases_created", [])),
                "alerts": len(results.get("alerts", []))}
    except Exception as e:
        return {"ran": False, "error": str(e)}

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

# ============================================================
# AI INTELLIGENCE LAYER — 8 AI-Powered Features
# ============================================================
try:
    from backend.ai_intelligence import (
        generate_investigation_brief, smart_match_invoice,
        parse_natural_language_policy, generate_payment_priorities,
        generate_anomaly_explanation, generate_all_anomaly_explanations,
        draft_vendor_communication, generate_vendor_insights,
        recommend_case_assignment, AI_FEATURES)
    AI_INTELLIGENCE_ENABLED = True
except ImportError:
    AI_INTELLIGENCE_ENABLED = False

@app.get("/api/ai/features")
async def ai_features():
    """List all AI intelligence features and their status."""
    if not AI_INTELLIGENCE_ENABLED:
        return {"enabled": False, "features": {}}
    return {"enabled": True, "features": AI_FEATURES, "api_connected": USE_REAL_API}

@app.get("/api/ai/investigation-brief/{case_id}")
async def ai_investigation_brief(case_id: str):
    """F1: Generate AI investigation brief for a case."""
    if not AI_INTELLIGENCE_ENABLED:
        raise HTTPException(503, "AI Intelligence module not available")
    return await generate_investigation_brief(case_id)

@app.get("/api/ai/smart-match/{invoice_id}")
async def ai_smart_match(invoice_id: str):
    """F2: AI-powered fuzzy PO matching."""
    if not AI_INTELLIGENCE_ENABLED:
        raise HTTPException(503, "AI Intelligence module not available")
    return await smart_match_invoice(invoice_id)

@app.post("/api/ai/policy-parse")
async def ai_policy_parse(request: Request):
    """F3: Natural language policy configuration. Requires manager+ role."""
    if not AI_INTELLIGENCE_ENABLED:
        raise HTTPException(503, "AI Intelligence module not available")
    try:
        user = _user_from_request(request)
        if user.get("role") == "analyst":
            raise HTTPException(403, "Policy configuration requires Manager, VP, or CFO role")
    except HTTPException as e:
        if e.status_code == 403: raise
        pass
    body = await request.json()
    user_input = body.get("input", "")
    if not user_input:
        raise HTTPException(400, "Missing 'input' field")
    return await parse_natural_language_policy(user_input)

@app.get("/api/ai/payment-priorities")
async def ai_payment_priorities(budget: float = None, currency: str = None):
    """F4: AI-optimized payment run recommendations. Requires manager+ role."""
    if not AI_INTELLIGENCE_ENABLED:
        raise HTTPException(503, "AI Intelligence module not available")
    return await generate_payment_priorities(budget_limit=budget, currency_filter=currency)

@app.get("/api/ai/explain-anomaly/{anomaly_id}")
async def ai_explain_anomaly(anomaly_id: str):
    """F5: Plain English anomaly explanation."""
    if not AI_INTELLIGENCE_ENABLED:
        raise HTTPException(503, "AI Intelligence module not available")
    return await generate_anomaly_explanation(anomaly_id)

@app.get("/api/ai/explain-invoice-anomalies/{invoice_id}")
async def ai_explain_invoice_anomalies(invoice_id: str):
    """F5 batch: Explain all anomalies on an invoice."""
    if not AI_INTELLIGENCE_ENABLED:
        raise HTTPException(503, "AI Intelligence module not available")
    return await generate_all_anomaly_explanations(invoice_id)

@app.post("/api/ai/vendor-draft/{case_id}")
async def ai_vendor_draft(case_id: str, request: Request):
    """F6: AI-drafted vendor communication."""
    if not AI_INTELLIGENCE_ENABLED:
        raise HTTPException(503, "AI Intelligence module not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    comm_type = body.get("type", "dispute")
    return await draft_vendor_communication(case_id, comm_type)

@app.get("/api/ai/vendor-insights/{vendor_name}")
async def ai_vendor_insights(vendor_name: str):
    """F7: AI-synthesized vendor behavior analysis."""
    if not AI_INTELLIGENCE_ENABLED:
        raise HTTPException(503, "AI Intelligence module not available")
    return await generate_vendor_insights(vendor_name)

@app.get("/api/ai/route-case/{case_id}")
async def ai_route_case(case_id: str):
    """F8: AI-recommended case assignment."""
    if not AI_INTELLIGENCE_ENABLED:
        raise HTTPException(503, "AI Intelligence module not available")
    return await recommend_case_assignment(case_id)


# ╔══════════════════════════════════════════════════════════════╗
# ║  ERP INTEGRATION ENDPOINTS                                  ║
# ║  API Key Management, Batch Import, Webhooks, Status         ║
# ╚══════════════════════════════════════════════════════════════╝

# ── API Key Management ──

@app.get("/api/integration/status")
async def integration_status(request: Request):
    """Integration health dashboard — API keys, webhooks, sync activity."""
    db = get_db()
    return get_integration_status(db)

@app.get("/api/integration/api-keys")
async def list_api_keys(user: dict = Depends(get_current_user)):
    """List all API keys (without secrets). Requires authenticated user."""
    if AUTHORITY_MATRIX.get(user["role"], {}).get("level", 0) < 3:  # VP+ only
        raise HTTPException(403, "API key management requires VP or CFO role")
    db = get_db()
    keys = get_api_keys(db)
    # Strip sensitive fields
    return {"api_keys": [
        {k: v for k, v in key.items() if k != "key_hash"}
        for key in keys
    ]}

@app.post("/api/integration/api-keys")
async def create_api_key(request: Request, user: dict = Depends(get_current_user)):
    """Create a new API key. Returns the raw key ONCE — store it securely."""
    if AUTHORITY_MATRIX.get(user["role"], {}).get("level", 0) < 3:
        raise HTTPException(403, "API key creation requires VP or CFO role")
    body = await request.json()
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "API key 'name' is required (e.g., 'SAP Integration', 'Coupa Sync')")
    role = body.get("role", "analyst")
    scopes = body.get("scopes", ["read", "write", "batch"])
    db = get_db()
    record = create_api_key_record(db, name=name, role=role, created_by=user["name"], scopes=scopes)
    save_db(db)
    return {
        "success": True,
        "api_key": record["raw_key"],
        "key_id": record["id"],
        "key_prefix": record["key_prefix"],
        "role": record["role"],
        "scopes": record["scopes"],
        "message": "Store this API key securely — it will not be shown again.",
    }

@app.delete("/api/integration/api-keys/{key_id}")
async def revoke_api_key_endpoint(key_id: str, user: dict = Depends(get_current_user)):
    """Revoke an API key."""
    if AUTHORITY_MATRIX.get(user["role"], {}).get("level", 0) < 3:
        raise HTTPException(403, "API key revocation requires VP or CFO role")
    db = get_db()
    if revoke_api_key(db, key_id):
        save_db(db)
        return {"success": True, "message": f"API key {key_id} revoked"}
    raise HTTPException(404, f"API key {key_id} not found")


# ── Webhook Management ──

@app.get("/api/integration/webhooks")
async def list_webhooks(request: Request):
    """List configured webhooks."""
    db = get_db()
    webhooks = get_webhook_config(db)
    return {"webhooks": [
        {k: v for k, v in wh.items() if k != "secret"}  # Don't expose signing secret
        for wh in webhooks
    ], "available_events": sorted(WEBHOOK_EVENTS)}

@app.post("/api/integration/webhooks")
async def create_webhook_endpoint(request: Request):
    """Register a new webhook endpoint."""
    body = await request.json()
    url = body.get("url", "").strip()
    if not url or not url.startswith("http"):
        raise HTTPException(400, "Valid webhook 'url' (https://...) is required")
    events = body.get("events", [])
    if not events:
        raise HTTPException(400, "'events' array is required (e.g., ['anomaly.detected', 'case.created'])")
    name = body.get("name", "")
    _user = _user_from_request(request)
    db = get_db()
    wh = create_webhook(db, url=url, events=events, name=name,
                        created_by=_user.get("name", "System"))
    save_db(db)
    return {"success": True, "webhook": wh,
            "message": "Store the 'secret' for payload signature verification."}

@app.put("/api/integration/webhooks/{webhook_id}")
async def update_webhook_endpoint(webhook_id: str, request: Request):
    """Update a webhook configuration."""
    body = await request.json()
    db = get_db()
    wh = update_webhook(db, webhook_id, body)
    if wh:
        save_db(db)
        return {"success": True, "webhook": {k: v for k, v in wh.items() if k != "secret"}}
    raise HTTPException(404, f"Webhook {webhook_id} not found")

@app.delete("/api/integration/webhooks/{webhook_id}")
async def delete_webhook_endpoint(webhook_id: str):
    """Remove a webhook."""
    db = get_db()
    if delete_webhook(db, webhook_id):
        save_db(db)
        return {"success": True, "message": f"Webhook {webhook_id} deleted"}
    raise HTTPException(404, f"Webhook {webhook_id} not found")


# ── Batch Import (core integration endpoint) ──

@app.post("/api/integration/batch")
async def batch_import(request: Request):
    """Bulk import documents from ERP systems.

    Accepts an array of structured documents and runs the FULL processing pipeline
    (matching, anomaly detection, contract compliance, triage, case creation)
    on each one — identical to /api/upload but without AI extraction.

    Supports idempotent upsert: if `upsert: true`, existing documents with the
    same (documentNumber, vendor, type) are updated instead of creating duplicates.

    Example request body:
    {
      "documents": [
        {
          "type": "purchase_order",
          "documentNumber": "PO-2025-301",
          "vendor": "GoldPak Industries Ltd.",
          "amount": 9211.58,
          "currency": "USD",
          "lineItems": [...],
          "paymentTerms": "2/10 Net 30",
          "source": "sap_s4hana"
        }
      ],
      "upsert": true,
      "source": "sap_integration"
    }
    """
    import time as _time
    _t0 = _time.time()

    _user = _user_from_request(request)
    _by = _user.get("name", "System") if _user else "System"

    # Validate scope (API key users need 'batch' scope)
    if _user.get("is_api_key") and "batch" not in _user.get("scopes", []):
        raise HTTPException(403, "This API key does not have 'batch' scope")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    documents = body.get("documents", [])
    if not documents:
        raise HTTPException(400, "Request must contain a 'documents' array")
    if len(documents) > 500:
        raise HTTPException(400, f"Maximum 500 documents per batch (received {len(documents)})")

    upsert_mode = body.get("upsert", False)
    source_label = body.get("source", "erp_integration")
    result = BatchResult()

    db = get_db()

    for idx, item in enumerate(documents):
        # Validate
        err = validate_batch_item(item, idx)
        if err:
            result.errors.append({"index": idx, "documentNumber": item.get("documentNumber"), "error": err})
            continue

        item["source"] = item.get("source", source_label)
        doc_type = item["type"]

        try:
            # ── Idempotent upsert check ──
            if upsert_mode:
                existing = find_existing_document(db, item["documentNumber"], item["vendor"], doc_type)
                if existing:
                    upsert_document_fields(existing, item)
                    result.updated.append({
                        "index": idx, "id": existing["id"],
                        "documentNumber": item["documentNumber"],
                        "action": "updated",
                    })
                    continue

            # ── Build record ──
            record = build_record_from_batch_item(item)
            record["uploadedBy"] = _by
            record["uploadedByEmail"] = _user.get("email", "") if _user else ""

            # ── Store in DB ──
            store_map = {"invoice": "invoices", "purchase_order": "purchase_orders",
                         "contract": "contracts", "credit_note": "invoices",
                         "debit_note": "invoices", "goods_receipt": "goods_receipts"}
            db[store_map.get(doc_type, "invoices")].append(record)

            # ── Run pipeline (mirrors /api/upload logic per document type) ──
            new_matches = []
            new_anomalies = []

            # Matching (invoices and POs)
            if doc_type in ("invoice", "purchase_order"):
                new_matches = run_matching(db)
                db["matches"].extend(new_matches)

            # ── INVOICE pipeline: anomalies, contract compliance, GRN, triage, cases ──
            if doc_type == "invoice":
                mpo = None
                for m in db["matches"]:
                    if m.get("invoiceId") == record["id"]:
                        mpo = next((p for p in db["purchase_orders"] if p["id"] == m.get("poId")), None)
                        break
                vc = find_vendor_contract(record["vendor"], db.get("contracts", []))
                vh = [i for i in db["invoices"] if i.get("vendor") and record.get("vendor") and
                      vendor_similarity(i["vendor"], record["vendor"]) >= 0.7 and i["id"] != record["id"]]
                vendor_tols = get_dynamic_tolerances(record["vendor"], db)

                detected = detect_anomalies_rule_based(record, mpo, vc, vh, tolerances=vendor_tols)
                for a in detected:
                    anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                            "invoiceNumber": record.get("invoiceNumber", ""), "vendor": record["vendor"],
                            "currency": record.get("currency", "USD"),
                            "detectedAt": datetime.now().isoformat(), "status": "open", **a}
                    new_anomalies.append(anom)
                    db["anomalies"].append(anom)

                if vc:
                    contract_anoms = detect_contract_compliance_anomalies(record, vc, db)
                    for a in contract_anoms:
                        anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                                "invoiceNumber": record.get("invoiceNumber", ""), "vendor": record["vendor"],
                                "currency": record.get("currency", "USD"),
                                "detectedAt": datetime.now().isoformat(), "status": "open", **a}
                        new_anomalies.append(anom)
                        db["anomalies"].append(anom)

                matched_entry = next((m for m in db["matches"] if m.get("invoiceId") == record["id"]), None)
                if matched_entry and mpo:
                    grn_info = {k: matched_entry.get(k) for k in
                                ("matchType", "grnStatus", "grnIds", "grnNumbers", "totalReceived", "grnLineItems")}
                    grn_anoms = detect_grn_anomalies(record, mpo, grn_info, db)
                    for a in grn_anoms:
                        anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                                "invoiceNumber": record.get("invoiceNumber", ""), "vendor": record["vendor"],
                                "currency": record.get("currency", "USD"),
                                "detectedAt": datetime.now().isoformat(), "status": "open", **a}
                        new_anomalies.append(anom)
                        db["anomalies"].append(anom)

                update_vendor_profile(record["vendor"], db)

                triage_result = triage_invoice(record, db.get("anomalies", []), db, performed_by=_by)
                store_triage_decision(record["id"], triage_result, db)
                apply_triage_action(record, triage_result, db, performed_by=_by)

                new_cases = auto_create_cases_from_triage(
                    record, db.get("anomalies", []), triage_result, db, created_by=_by)
                if new_cases:
                    db.setdefault("cases", []).extend(new_cases)
                    result.cases_created.extend(new_cases)

            # ── PO pipeline: contract compliance checks ──
            if doc_type == "purchase_order":
                vc = find_vendor_contract(record["vendor"], db.get("contracts", []))
                if vc:
                    sym = currency_symbol(record.get("currency", "USD"))
                    po_amt = record.get("amount", 0)
                    po_num = record.get("poNumber", record["id"])
                    ct = vc.get("contractTerms") or {}

                    cap = ct.get("liability_cap")
                    if cap and po_amt > cap:
                        diff = po_amt - cap
                        anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                                "invoiceNumber": po_num, "vendor": record["vendor"],
                                "currency": record.get("currency", "USD"),
                                "detectedAt": datetime.now().isoformat(), "status": "open",
                                "type": "AMOUNT_DISCREPANCY", "severity": "high",
                                "description": f"PO amount {sym}{po_amt:,.2f} exceeds contract liability cap {sym}{cap:,.2f}.",
                                "amount_at_risk": round(diff, 2),
                                "recommendation": "PO exceeds contractual limits."}
                        new_anomalies.append(anom); db["anomalies"].append(anom)

                    expiry = ct.get("expiry_date")
                    if expiry:
                        try:
                            exp_date = datetime.fromisoformat(expiry)
                            po_date = datetime.fromisoformat(record.get("issueDate", "")) if record.get("issueDate") else datetime.now()
                            if po_date > exp_date:
                                anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                                        "invoiceNumber": po_num, "vendor": record["vendor"],
                                        "currency": record.get("currency", "USD"),
                                        "detectedAt": datetime.now().isoformat(), "status": "open",
                                        "type": "TERMS_VIOLATION", "severity": "high",
                                        "description": f"PO issued after contract expired on {expiry}.",
                                        "amount_at_risk": po_amt,
                                        "recommendation": "Renew contract before issuing new POs."}
                                new_anomalies.append(anom); db["anomalies"].append(anom)
                        except: pass

                    po_terms = (record.get("paymentTerms") or "").lower().strip()
                    c_terms = (vc.get("paymentTerms") or "").lower().strip()
                    if po_terms and c_terms and po_terms != c_terms:
                        anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                                "invoiceNumber": po_num, "vendor": record["vendor"],
                                "currency": record.get("currency", "USD"),
                                "detectedAt": datetime.now().isoformat(), "status": "open",
                                "type": "TERMS_VIOLATION", "severity": "medium",
                                "description": f"PO terms '{record.get('paymentTerms')}' differ from contract.",
                                "amount_at_risk": 0,
                                "recommendation": "Align PO terms with contract."}
                        new_anomalies.append(anom); db["anomalies"].append(anom)

            # ── CONTRACT pipeline: clause analysis ──
            if doc_type == "contract":
                try:
                    clause_analysis = analyze_contract_clauses(record)
                    record["clauseAnalysis"] = clause_analysis
                    health = compute_contract_health(record, db)
                    record["healthScore"] = health.get("score")
                    record["healthLevel"] = health.get("level")
                except Exception as e:
                    logger.warning("Batch contract clause analysis failed: %s", e)

            # ── GRN pipeline: run grn matching + re-check anomalies for affected invoices ──
            if doc_type == "goods_receipt":
                grn_updated = run_grn_matching(db)
                if grn_updated:
                    for match in db["matches"]:
                        if match.get("matchType") == "three_way":
                            inv = next((i for i in db["invoices"] if i["id"] == match.get("invoiceId")), None)
                            po = next((p for p in db["purchase_orders"] if p["id"] == match.get("poId")), None)
                            if inv and po:
                                grn_types = {"UNRECEIPTED_INVOICE", "OVERBILLED_VS_RECEIVED",
                                             "QUANTITY_RECEIVED_MISMATCH", "SHORT_SHIPMENT"}
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

            # ── CREDIT/DEBIT NOTE pipeline: validate against original invoice ──
            if doc_type in ("credit_note", "debit_note"):
                orig_ref = record.get("originalInvoiceRef")
                cn_amount = record.get("amount", 0)
                sym = currency_symbol(record.get("currency", "USD"))
                dt_label = "Credit note" if doc_type == "credit_note" else "Debit note"
                doc_num = record.get("documentNumber", record["id"])

                if not orig_ref:
                    anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                            "invoiceNumber": doc_num, "vendor": record["vendor"],
                            "currency": record.get("currency", "USD"),
                            "detectedAt": datetime.now().isoformat(), "status": "open",
                            "type": "MISSING_PO", "severity": "medium",
                            "description": f"{dt_label} {doc_num} has no original invoice reference.",
                            "amount_at_risk": cn_amount, "contract_clause": None,
                            "recommendation": "Verify which invoice this note applies to."}
                    new_anomalies.append(anom); db["anomalies"].append(anom)
                else:
                    orig = next((i for i in db["invoices"]
                        if i.get("invoiceNumber", "").strip().lower() == orig_ref.strip().lower()), None)
                    if orig and cn_amount > orig.get("amount", 0):
                        diff = cn_amount - orig["amount"]
                        anom = {"id": str(uuid.uuid4())[:8].upper(), "invoiceId": record["id"],
                                "invoiceNumber": doc_num, "vendor": record["vendor"],
                                "currency": record.get("currency", "USD"),
                                "detectedAt": datetime.now().isoformat(), "status": "open",
                                "type": "AMOUNT_DISCREPANCY", "severity": "high",
                                "description": f"{dt_label} amount {sym}{cn_amount:,.2f} exceeds original invoice {orig_ref} amount {sym}{orig['amount']:,.2f} by {sym}{diff:,.2f}.",
                                "amount_at_risk": round(diff, 2), "contract_clause": None,
                                "recommendation": f"Do not process. {dt_label} cannot exceed original invoice."}
                        new_anomalies.append(anom); db["anomalies"].append(anom)

                # Triage credit/debit notes (same as upload pipeline)
                triage_result = triage_invoice(record, db.get("anomalies", []), db, performed_by=_by)
                store_triage_decision(record["id"], triage_result, db)
                apply_triage_action(record, triage_result, db, performed_by=_by)
                new_cases = auto_create_cases_from_triage(
                    record, db.get("anomalies", []), triage_result, db, created_by=_by)
                if new_cases:
                    db.setdefault("cases", []).extend(new_cases)
                    result.cases_created.extend(new_cases)

            result.created.append({
                "index": idx, "id": record["id"],
                "documentNumber": item["documentNumber"],
                "type": doc_type,
                "action": "created",
                "anomalies": len(new_anomalies),
            })
            result.anomalies_detected.extend(new_anomalies)
            result.matches_created.extend(new_matches)

        except Exception as e:
            result.errors.append({
                "index": idx,
                "documentNumber": item.get("documentNumber"),
                "error": f"Processing error: {str(e)}",
            })
            logger.error("Batch item %d (%s) failed: %s", idx, item.get("documentNumber"), e, exc_info=True)

    # ── Save all changes ──
    db["activity_log"].append({
        "id": str(uuid.uuid4())[:8], "action": "batch_import",
        "count": len(documents), "source": source_label,
        "created": len(result.created), "updated": len(result.updated),
        "errors": len(result.errors), "anomalies": len(result.anomalies_detected),
        "timestamp": datetime.now().isoformat(), "performedBy": _by})
    save_db(db)

    # ── Dispatch webhook ──
    try:
        await dispatch_webhook_event(db, "batch.completed", {
            "source": source_label,
            "total": len(documents),
            "created": len(result.created),
            "updated": len(result.updated),
            "errors": len(result.errors),
            "anomalies_detected": len(result.anomalies_detected),
        })
    except Exception:
        pass  # Webhooks are non-critical

    processing_ms = round((_time.time() - _t0) * 1000)
    response = result.to_dict()
    response["processing_ms"] = processing_ms
    response["summary"]["processing_ms"] = processing_ms

    return response


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
    reset_policy()
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
    from fastapi.responses import Response
    # Path traversal protection
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")

    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    mt = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".png": "image/png", ".webp": "image/webp", ".tiff": "image/tiff"}.get(ext, "application/octet-stream")

    # Try S3/R2 first, then local filesystem
    result, exists = load_uploaded_file(filename)
    if exists and result:
        if isinstance(result, bytes):
            # S3 returned raw bytes
            return Response(content=result, media_type=mt,
                            headers={"Content-Disposition": f'inline; filename="{filename}"'})
        else:
            # Local Path object
            if result.exists() and result.resolve().is_relative_to(UPLOAD_DIR.resolve()):
                return FileResponse(str(result), media_type=mt)

    # Direct local check as final fallback
    fp = UPLOAD_DIR / filename
    if fp.exists() and fp.resolve().is_relative_to(UPLOAD_DIR.resolve()):
        return FileResponse(fp, media_type=mt)

    raise HTTPException(404, "File not found — original document lost after redeployment. Enable S3_BUCKET for persistent storage.")

# ============================================================
# FRONTEND (Vite build output: index.html + assets/)
# ============================================================
import mimetypes
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

@app.get("/")
async def serve_index(): return FileResponse(FRONTEND_DIR / "index.html", media_type="text/html", headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"})

@app.get("/{path:path}")
async def serve_static(path: str):
    fp = FRONTEND_DIR / path
    if fp.exists() and fp.is_file():
        mt = mimetypes.guess_type(str(fp))[0] or "application/octet-stream"
        # Hashed assets (e.g. index-BDP-Ij1Q.js) can be cached forever
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if "/assets/" in path else {"Cache-Control": "no-cache"}
        return FileResponse(fp, media_type=mt, headers=headers)
    return FileResponse(FRONTEND_DIR / "index.html", media_type="text/html", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"\nStarting AuditLens v{VERSION} on port {port}")
    if _HAS_LLM_PROVIDER:
        log_provider_config()
    print(f"Claude API: {'Connected' if USE_REAL_API else 'No API Key — extraction will fail, use Manual Entry'}")
    print(f"Triage: {'Enabled' if TRIAGE_ENABLED else 'Disabled'}")
    print(f"Vendor Risk Scoring: Enabled")
    uvicorn.run(app, host="0.0.0.0", port=port)
