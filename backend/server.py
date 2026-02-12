"""
AuditLens — AI-Powered Spend Compliance Auditor
v2.5 — F&A hardened + Agentic Triage (F1) + Vendor Risk Scoring (F3)
        tax handling, line item verification, smart duplicate detection,
        contract pricing checks, vendor normalization, multi-invoice PO matching,
        auto-approve/review/block triage, dynamic vendor risk thresholds
"""

import os, json, base64, uuid, asyncio, re, math
from datetime import datetime, timedelta
from pathlib import Path
from difflib import SequenceMatcher
from collections import defaultdict

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import anthropic

# Auth dependencies
import bcrypt
import jwt as pyjwt

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

# ============================================================
# CONFIG
# ============================================================
BASE_DIR = Path(__file__).parent.parent

# ── Persistent storage paths ──
# On Railway: set DATA_DIR=/data (mounted volume) to persist across deploys
# Locally: defaults to ./data and ./uploads relative to project root
DATA_DIR = Path(os.environ.get("DATA_DIR", str(BASE_DIR / "data")))
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", str(DATA_DIR / "uploads")))
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "db.json"
USE_REAL_API = bool(os.environ.get("ANTHROPIC_API_KEY"))

# ── Data Persistence Config ──
# PERSIST_DATA=true (default) — keep data across restarts, never auto-wipe
# SEED_DEMO=true — if DB is empty on startup, auto-seed with demo data
# RESET_ON_START=true — wipe DB on every server start (old behavior for dev)
PERSIST_DATA = os.environ.get("PERSIST_DATA", "true").lower() == "true"
SEED_DEMO = os.environ.get("SEED_DEMO", "false").lower() == "true"
RESET_ON_START = os.environ.get("RESET_ON_START", "false").lower() == "true"

# ════════════════════════════════════════════════════════════════
# AP POLICY CONFIGURATION — Centralized, API-configurable
# Every enterprise AP department has different policies. This makes
# AuditLens adaptable to any organization's controls framework.
# ════════════════════════════════════════════════════════════════

# Default policy — can be overridden via /api/policy endpoint at runtime
DEFAULT_POLICY = {
    # ── MATCHING MODE ──
    # "three_way": Require PO + GRN + Invoice (manufacturing, logistics, procurement-heavy)
    # "two_way":   Require PO + Invoice only (SaaS, services, consulting)
    # "flexible":  Three-way if GRN exists, two-way otherwise (recommended default)
    "matching_mode": os.environ.get("MATCHING_MODE", "flexible"),

    # ── TOLERANCE THRESHOLDS ──
    "amount_tolerance_pct": float(os.environ.get("AMOUNT_TOLERANCE_PCT", "2")),       # % tolerance for amount matching
    "price_tolerance_pct": float(os.environ.get("PRICE_TOLERANCE_PCT", "1")),         # % tolerance for unit price
    "over_invoice_pct": float(os.environ.get("OVER_INVOICE_PCT", "2")),               # % over PO to flag
    "tax_tolerance_pct": float(os.environ.get("TAX_TOLERANCE_PCT", "5")),             # % tolerance on tax calc mismatch
    "grn_qty_tolerance_pct": float(os.environ.get("GRN_QTY_TOLERANCE_PCT", "2")),     # % tolerance on GRN qty vs invoice qty
    "grn_amount_tolerance_pct": float(os.environ.get("GRN_AMT_TOLERANCE_PCT", "2")),  # % tolerance on GRN value vs invoice value
    "short_shipment_threshold_pct": float(os.environ.get("SHORT_SHIPMENT_PCT", "90")),# Below this % of PO = short shipment

    # ── DUPLICATE DETECTION ──
    "duplicate_window_days": int(os.environ.get("DUPLICATE_DAYS_WINDOW", "90")),      # Days to look back for duplicates
    "duplicate_amount_tolerance_pct": float(os.environ.get("DUP_AMT_TOLERANCE", "2")),# % tolerance for amount-based dup match

    # ── SEVERITY THRESHOLDS ──
    "high_severity_pct": float(os.environ.get("HIGH_SEVERITY_PCT", "10")),            # % variance for high severity
    "med_severity_pct": float(os.environ.get("MED_SEVERITY_PCT", "5")),               # % variance for medium severity

    # ── TRIAGE RULES ──
    "triage_enabled": os.environ.get("TRIAGE_ENABLED", "true").lower() == "true",
    "auto_approve_min_confidence": float(os.environ.get("TRIAGE_AUTO_APPROVE_CONFIDENCE", "85")),
    "auto_approve_max_vendor_risk": float(os.environ.get("TRIAGE_AUTO_APPROVE_MAX_RISK", "50")),
    "block_on_high_severity": True,                                                    # Block if any high-severity anomaly
    "block_min_vendor_risk": float(os.environ.get("TRIAGE_BLOCK_MIN_RISK_SCORE", "70")),
    "require_po_for_auto_approve": True,                                               # No-PO invoices cannot auto-approve
    "require_grn_for_auto_approve": False,                                             # If true, only 3-way matched invoices auto-approve

    # ── APPROVAL LIMITS (per currency) ──
    "auto_approve_limits": {
        "USD": 100000, "EUR": 90000, "GBP": 80000,
        "INR": 7500000, "AED": 350000, "JPY": 15000000,
        "CAD": 130000, "AUD": 150000,
    },
    "default_auto_approve_limit": 100000,

    # ── VENDOR RISK WEIGHTS ──
    "vendor_risk_weights": {
        "anomaly_rate": float(os.environ.get("RISK_WEIGHT_ANOMALY_RATE", "0.30")),
        "correction_frequency": float(os.environ.get("RISK_WEIGHT_CORRECTION_FREQ", "0.15")),
        "contract_compliance": float(os.environ.get("RISK_WEIGHT_CONTRACT_COMPLIANCE", "0.25")),
        "duplicate_history": float(os.environ.get("RISK_WEIGHT_DUPLICATE_HISTORY", "0.15")),
        "volume_consistency": float(os.environ.get("RISK_WEIGHT_VOLUME_CONSISTENCY", "0.15")),
    },
    "high_risk_threshold": float(os.environ.get("HIGH_RISK_THRESHOLD", "65")),
    "med_risk_threshold": float(os.environ.get("MED_RISK_THRESHOLD", "35")),
    "risk_tolerance_tightening": float(os.environ.get("RISK_TOLERANCE_TIGHTENING", "0.50")),

    # ── INVOICE PROCESSING ──
    "auto_detect_document_type": True,                                                 # Let AI determine doc type
    "require_invoice_number": True,                                                    # Flag missing invoice number
    "flag_round_number_invoices": False,                                               # Flag suspiciously round amounts ($10,000.00)
    "max_invoice_age_days": int(os.environ.get("MAX_INVOICE_AGE_DAYS", "365")),       # Flag invoices older than this
    "flag_weekend_invoices": False,                                                    # Flag invoices dated on weekends
}

# Runtime policy — starts as copy of default, updated via API
import copy as _copy
_active_policy = _copy.deepcopy(DEFAULT_POLICY)

def get_policy() -> dict:
    """Get the active AP policy configuration."""
    return _active_policy

def update_policy(updates: dict) -> dict:
    """Update specific policy fields. Returns the full updated policy."""
    VALID_MATCHING_MODES = ("two_way", "three_way", "flexible")
    PCT_FIELDS = {k for k, v in DEFAULT_POLICY.items() if isinstance(v, (int, float)) and ('pct' in k or 'confidence' in k or 'risk' in k)}
    DAY_FIELDS = {k for k in DEFAULT_POLICY if 'days' in k or 'age' in k}

    for key, value in updates.items():
        if key in _active_policy:
            # Enum validation
            if key == "matching_mode" and value not in VALID_MATCHING_MODES:
                continue  # Skip invalid matching mode
            # Type validation — ensure we don't break types
            expected_type = type(DEFAULT_POLICY[key])
            if isinstance(value, expected_type) or (expected_type == float and isinstance(value, (int, float))):
                # Clamp percentage fields to 0-100, day fields to >= 0
                if key in PCT_FIELDS and isinstance(value, (int, float)):
                    value = max(0, min(100, float(value)))
                elif key in DAY_FIELDS and isinstance(value, (int, float)):
                    value = max(0, int(value))
                _active_policy[key] = value
            elif expected_type == dict and isinstance(value, dict):
                _active_policy[key].update(value)
    return _active_policy

# ── Backward-compatible accessors (used throughout codebase) ──
# These read from active policy so changes take effect immediately
def _pol(key):
    return _active_policy.get(key, DEFAULT_POLICY.get(key))

AMOUNT_TOLERANCE_PCT = property(lambda self: _pol("amount_tolerance_pct"))
PRICE_TOLERANCE_PCT = property(lambda self: _pol("price_tolerance_pct"))

# Simple module-level accessors for hot path
def get_amount_tolerance(): return _active_policy["amount_tolerance_pct"]
def get_price_tolerance(): return _active_policy["price_tolerance_pct"]
def get_over_invoice_pct(): return _active_policy["over_invoice_pct"]
def get_duplicate_window(): return _active_policy["duplicate_window_days"]
def get_matching_mode(): return _active_policy["matching_mode"]

# Keep old names for backward compat in code that reads them directly
AMOUNT_TOLERANCE_PCT = _active_policy["amount_tolerance_pct"]
PRICE_TOLERANCE_PCT = _active_policy["price_tolerance_pct"]
OVER_INVOICE_PCT = _active_policy["over_invoice_pct"]
DUPLICATE_DAYS_WINDOW = _active_policy["duplicate_window_days"]
HIGH_SEVERITY_PCT = _active_policy["high_severity_pct"]
MED_SEVERITY_PCT = _active_policy["med_severity_pct"]

# Vendor risk weights
RISK_WEIGHT_ANOMALY_RATE = _active_policy["vendor_risk_weights"]["anomaly_rate"]
RISK_WEIGHT_CORRECTION_FREQ = _active_policy["vendor_risk_weights"]["correction_frequency"]
RISK_WEIGHT_CONTRACT_COMPLIANCE = _active_policy["vendor_risk_weights"]["contract_compliance"]
RISK_WEIGHT_DUPLICATE_HISTORY = _active_policy["vendor_risk_weights"]["duplicate_history"]
RISK_WEIGHT_VOLUME_CONSISTENCY = _active_policy["vendor_risk_weights"]["volume_consistency"]
HIGH_RISK_THRESHOLD = _active_policy["high_risk_threshold"]
MED_RISK_THRESHOLD = _active_policy["med_risk_threshold"]
RISK_TOLERANCE_TIGHTENING = _active_policy["risk_tolerance_tightening"]

# Triage
TRIAGE_AUTO_APPROVE_CONFIDENCE = _active_policy["auto_approve_min_confidence"]
TRIAGE_AUTO_APPROVE_MAX_RISK = _active_policy["auto_approve_max_vendor_risk"]
TRIAGE_BLOCK_SEVERITY = "high"
TRIAGE_BLOCK_MIN_RISK_SCORE = _active_policy["block_min_vendor_risk"]
TRIAGE_ENABLED = _active_policy["triage_enabled"]
AUTO_APPROVE_AMOUNT_LIMITS = _active_policy["auto_approve_limits"]
DEFAULT_AUTO_APPROVE_LIMIT = _active_policy["default_auto_approve_limit"]

# ── DELEGATION OF AUTHORITY (F4) ──
# Role hierarchy with per-currency approval limits
# Invoices exceeding a role's limit require escalation to the next level
AUTHORITY_MATRIX = {
    "analyst":  {"level": 1, "title": "AP Analyst",     "limits": {"USD": 10000,  "EUR": 9000,   "GBP": 8000,   "INR": 800000,   "AED": 35000,  "JPY": 1500000,  "default": 10000}},
    "manager":  {"level": 2, "title": "AP Manager",     "limits": {"USD": 100000, "EUR": 90000,  "GBP": 80000,  "INR": 8000000,  "AED": 350000, "JPY": 15000000, "default": 100000}},
    "vp":       {"level": 3, "title": "VP Finance",     "limits": {"USD": 500000, "EUR": 450000, "GBP": 400000, "INR": 40000000, "AED": 1800000,"JPY": 75000000, "default": 500000}},
    "cfo":      {"level": 4, "title": "CFO",            "limits": {"USD": 999999999, "EUR": 999999999, "GBP": 999999999, "INR": 999999999, "default": 999999999}},
}
DEFAULT_ROLE = "analyst"

def get_authority_limit(role: str, currency: str) -> float:
    """Get the approval limit for a role in a given currency."""
    info = AUTHORITY_MATRIX.get(role, AUTHORITY_MATRIX[DEFAULT_ROLE])
    return info["limits"].get(currency, info["limits"]["default"])

def get_required_approver(amount: float, currency: str) -> dict:
    """Determine the minimum role required to approve a given amount."""
    for role_key in ["analyst", "manager", "vp", "cfo"]:
        info = AUTHORITY_MATRIX[role_key]
        limit = info["limits"].get(currency, info["limits"]["default"])
        if amount <= limit:
            return {"role": role_key, "title": info["title"], "level": info["level"], "limit": limit}
    return {"role": "cfo", "title": "CFO", "level": 4, "limit": 999999999}

app = FastAPI(title="AuditLens", version="2.5.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ════════════════════════════════════════════════════════════════
# AUTHENTICATION & RBAC (F6)
# JWT-based auth with bcrypt password hashing
# ════════════════════════════════════════════════════════════════
JWT_SECRET = os.environ.get("JWT_SECRET", "auditlens_dev_secret_change_in_production_" + uuid.uuid4().hex[:16])
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = int(os.environ.get("JWT_EXPIRY_HOURS", "24"))
AUTH_ENABLED = os.environ.get("AUTH_ENABLED", "true").lower() == "true"

# In-memory user store (Postgres-backed in production)
_users_store = []

def _get_users() -> list:
    """Get users from DB or in-memory store."""
    db = get_db()
    return db.get("users", _users_store)

def _save_users(users: list):
    """Save users to DB."""
    db = get_db()
    db["users"] = users
    save_db(db)

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_jwt(user: dict) -> str:
    payload = {
        "user_id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.utcnow(),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_jwt(token: str) -> dict:
    try:
        return pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired — please login again")
    except pyjwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

security = HTTPBearer(auto_error=False)

def _user_from_request(request: Request) -> dict:
    """Extract user from request headers (standalone, no DI). Returns empty dict if no auth."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            payload = decode_jwt(auth[7:])
            return {"id": payload["user_id"], "email": payload["email"],
                    "name": payload["name"], "role": payload["role"]}
        except: pass
    return {}

def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Extract current user from JWT token. Falls back to X-User-Role header for backward compat."""
    # Try JWT first
    if credentials and credentials.credentials:
        payload = decode_jwt(credentials.credentials)
        return {
            "id": payload["user_id"],
            "email": payload["email"],
            "name": payload["name"],
            "role": payload["role"],
            "authenticated": True,
        }

    # Check Authorization header directly (in case of non-standard passing)
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        payload = decode_jwt(token)
        return {
            "id": payload["user_id"],
            "email": payload["email"],
            "name": payload["name"],
            "role": payload["role"],
            "authenticated": True,
        }

    # Backward compat: X-User-Role header (unauthenticated mode)
    if not AUTH_ENABLED:
        role = (request.headers.get("X-User-Role") or DEFAULT_ROLE).lower().strip()
        if role not in AUTHORITY_MATRIX:
            role = DEFAULT_ROLE
        return {
            "id": "anonymous",
            "email": "anonymous@local",
            "name": AUTHORITY_MATRIX.get(role, AUTHORITY_MATRIX[DEFAULT_ROLE])["title"],
            "role": role,
            "authenticated": False,
        }

    raise HTTPException(401, "Authentication required. Please login.")

def get_optional_user(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Like get_current_user but never raises — returns anonymous fallback."""
    try:
        return get_current_user(request, credentials)
    except HTTPException:
        role = (request.headers.get("X-User-Role") or DEFAULT_ROLE).lower().strip()
        if role not in AUTHORITY_MATRIX:
            role = DEFAULT_ROLE
        return {
            "id": "anonymous",
            "email": "anonymous@local",
            "name": AUTHORITY_MATRIX.get(role, AUTHORITY_MATRIX[DEFAULT_ROLE])["title"],
            "role": role,
            "authenticated": False,
        }

def get_role_from_request(request: Request = None) -> str:
    """Extract user role — from JWT if available, else X-User-Role header. Defaults to analyst."""
    if request:
        # Check JWT
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                payload = decode_jwt(auth_header[7:])
                return payload.get("role", DEFAULT_ROLE)
            except:
                pass
        # Fallback to header
        role = (request.headers.get("X-User-Role") or DEFAULT_ROLE).lower().strip()
        if role in AUTHORITY_MATRIX:
            return role
    return DEFAULT_ROLE

def get_user_display(request: Request) -> str:
    """Get display name for audit trail — real name if JWT, role title if header."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            payload = decode_jwt(auth_header[7:])
            return f"{payload.get('name', 'Unknown')} ({payload.get('email', '')})"
        except:
            pass
    role = get_role_from_request(request)
    return AUTHORITY_MATRIX.get(role, AUTHORITY_MATRIX[DEFAULT_ROLE])["title"]

# ── Auth API Endpoints ──

@app.post("/api/auth/register")
async def register(request: Request):
    """Register a new user. First user becomes admin."""
    try:
        body = await request.json()
    except:
        raise HTTPException(400, "Invalid JSON")

    email = (body.get("email") or "").strip().lower()
    password = body.get("password", "")
    name = (body.get("name") or "").strip()
    role = (body.get("role") or "analyst").lower().strip()

    if not email or "@" not in email:
        raise HTTPException(400, "Valid email required")
    if len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    if not name:
        raise HTTPException(400, "Name required")
    if role not in AUTHORITY_MATRIX:
        raise HTTPException(400, f"Invalid role. Must be one of: {list(AUTHORITY_MATRIX.keys())}")

    users = _get_users()

    # Check duplicate email
    if any(u["email"] == email for u in users):
        raise HTTPException(409, "Email already registered")

    user = {
        "id": str(uuid.uuid4())[:12],
        "email": email,
        "name": name,
        "role": role,
        "password_hash": hash_password(password),
        "active": True,
        "createdAt": datetime.now().isoformat(),
    }
    users.append(user)
    _save_users(users)

    token = create_jwt(user)
    return {
        "success": True,
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"],
                 "role": user["role"], "roleTitle": AUTHORITY_MATRIX[user["role"]]["title"]},
    }

@app.post("/api/auth/login")
async def login(request: Request):
    """Login with email + password. Returns JWT token."""
    try:
        body = await request.json()
    except:
        raise HTTPException(400, "Invalid JSON")

    email = (body.get("email") or "").strip().lower()
    password = body.get("password", "")

    users = _get_users()
    user = next((u for u in users if u["email"] == email and u.get("active", True)), None)

    if not user or not verify_password(password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")

    token = create_jwt(user)
    return {
        "success": True,
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"],
                 "role": user["role"], "roleTitle": AUTHORITY_MATRIX[user["role"]]["title"]},
    }

@app.get("/api/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Return current user info from JWT token."""
    return {
        "user": user,
        "roleTitle": AUTHORITY_MATRIX.get(user["role"], AUTHORITY_MATRIX[DEFAULT_ROLE])["title"],
        "limits": AUTHORITY_MATRIX.get(user["role"], AUTHORITY_MATRIX[DEFAULT_ROLE])["limits"],
    }

@app.get("/api/auth/users")
async def list_users(user: dict = Depends(get_current_user)):
    """List all users (admin/cfo only)."""
    if user["role"] not in ("cfo", "vp"):
        raise HTTPException(403, "Insufficient permissions to view users")
    users = _get_users()
    return {"users": [{
        "id": u["id"], "email": u["email"], "name": u["name"],
        "role": u["role"], "roleTitle": AUTHORITY_MATRIX.get(u["role"], AUTHORITY_MATRIX[DEFAULT_ROLE])["title"],
        "active": u.get("active", True), "createdAt": u.get("createdAt"),
    } for u in users]}

@app.post("/api/auth/users/{user_id}/role")
async def update_user_role(user_id: str, request: Request, admin: dict = Depends(get_current_user)):
    """Change a user's role (cfo only)."""
    if admin["role"] != "cfo":
        raise HTTPException(403, "Only CFO can change roles")
    try:
        body = await request.json()
    except:
        raise HTTPException(400, "Invalid JSON")
    new_role = body.get("role", "").lower().strip()
    if new_role not in AUTHORITY_MATRIX:
        raise HTTPException(400, f"Invalid role: {new_role}")

    users = _get_users()
    user = next((u for u in users if u["id"] == user_id), None)
    if not user:
        raise HTTPException(404, "User not found")
    user["role"] = new_role
    _save_users(users)
    return {"success": True, "user": {"id": user["id"], "name": user["name"], "role": new_role}}

@app.post("/api/auth/users/{user_id}/deactivate")
async def deactivate_user(user_id: str, admin: dict = Depends(get_current_user)):
    """Deactivate a user (cfo only)."""
    if admin["role"] != "cfo":
        raise HTTPException(403, "Only CFO can deactivate users")
    users = _get_users()
    user = next((u for u in users if u["id"] == user_id), None)
    if not user:
        raise HTTPException(404, "User not found")
    if user["id"] == admin["id"]:
        raise HTTPException(400, "Cannot deactivate yourself")
    user["active"] = False
    _save_users(users)
    return {"success": True}

@app.get("/api/auth/status")
async def auth_status():
    """Check if auth is enabled and if any users exist."""
    users = _get_users()
    return {"auth_enabled": AUTH_ENABLED, "has_users": len(users) > 0, "user_count": len(users)}
    """Handle data persistence on startup — runs whether launched via __main__ or uvicorn."""
    backend = "Postgres" if DATABASE_URL else "file"
    print(f"[Data] Backend: {backend} | seed_demo={SEED_DEMO} | reset_on_start={RESET_ON_START}")

    if RESET_ON_START:
        print("[Data] RESET_ON_START=true — wiping database")
        save_db(_fresh_db())
        for fp in UPLOAD_DIR.iterdir():
            try: fp.unlink()
            except: pass
        if SEED_DEMO:
            print("[Data] Seeding fresh demo data...")
            _seed_demo_data()
        return

    db = load_db()
    total = sum(len(v) for v in db.values() if isinstance(v, list))
    if total > 0:
        print(f"[Data] Loaded existing DB ({total} records)")
        return

    # DB is empty
    if SEED_DEMO:
        print("[Data] DB is empty, SEED_DEMO=true — seeding...")
        _seed_demo_data()
    else:
        print("[Data] DB is empty (set SEED_DEMO=true to auto-populate)")

# ============================================================
# DATABASE — Postgres (Railway) with file fallback
# ============================================================
# If DATABASE_URL is set → use Postgres (persists across deploys)
# Otherwise → fall back to db.json file (ephemeral on Railway)
# ============================================================

DATABASE_URL = os.environ.get("DATABASE_URL")

EMPTY_DB = {"invoices": [], "purchase_orders": [], "contracts": [], "goods_receipts": [], "matches": [], "anomalies": [],
            "activity_log": [], "correction_patterns": [], "vendor_profiles": [], "triage_decisions": [], "users": []}

def _fresh_db():
    """Return a fresh deep copy of EMPTY_DB to prevent shared list references."""
    return {k: list(v) if isinstance(v, list) else v for k, v in EMPTY_DB.items()}

if DATABASE_URL:
    # ── Postgres Backend ──
    try:
        import psycopg2
        from psycopg2.extras import Json
    except ImportError:
        print("[DB] psycopg2 not installed — falling back to file backend")
        print("[DB] Run: pip install psycopg2-binary")
        DATABASE_URL = None

if DATABASE_URL:
    def _pg_connect():
        return psycopg2.connect(DATABASE_URL, connect_timeout=5)

    def _pg_init():
        """Create tables if they don't exist."""
        with _pg_connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS app_state (
                        id INTEGER PRIMARY KEY DEFAULT 1,
                        data JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ DEFAULT NOW()
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS uploaded_files (
                        filename TEXT PRIMARY KEY,
                        content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                        data BYTEA NOT NULL,
                        uploaded_at TIMESTAMPTZ DEFAULT NOW()
                    )
                """)
                # Ensure app_state row exists
                cur.execute("INSERT INTO app_state (id, data) VALUES (1, %s) ON CONFLICT (id) DO NOTHING", [Json(_fresh_db())])
            conn.commit()
        print("[DB] Postgres tables initialized (app_state + uploaded_files)")

    # Init on import
    try:
        _pg_init()
        print(f"[DB] Connected to Postgres")
    except Exception as e:
        print(f"[DB] Postgres init failed: {e} — falling back to file")
        DATABASE_URL = None  # Fall back

if DATABASE_URL:
    def load_db():
        try:
            with _pg_connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT data FROM app_state WHERE id = 1")
                    row = cur.fetchone()
                    if row and row[0]:
                        db = row[0]
                        for k in EMPTY_DB:
                            if k not in db: db[k] = []
                        return db
        except Exception as e:
            print(f"[DB] Postgres read error: {e}")
        return _fresh_db()

    def save_db(db):
        try:
            with _pg_connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("UPDATE app_state SET data = %s, updated_at = NOW() WHERE id = 1", [Json(db)])
                conn.commit()
        except Exception as e:
            print(f"[DB] Postgres write error: {e}")
            # Emergency file fallback
            with open(DB_PATH, "w") as f:
                json.dump(db, f, indent=2, default=str)

    def get_db():
        return load_db()

    def save_uploaded_file(filename: str, content: bytes, content_type: str):
        """Store uploaded file in Postgres."""
        try:
            with _pg_connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO uploaded_files (filename, content_type, data) VALUES (%s, %s, %s) "
                        "ON CONFLICT (filename) DO UPDATE SET data = %s, content_type = %s",
                        [filename, content_type, content, content, content_type])
                conn.commit()
        except Exception as e:
            print(f"[DB] File save error: {e}")

    def load_uploaded_file(filename: str):
        """Load uploaded file from Postgres. Returns (content_bytes, content_type) or (None, None)."""
        try:
            with _pg_connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT data, content_type FROM uploaded_files WHERE filename = %s", [filename])
                    row = cur.fetchone()
                    if row:
                        return bytes(row[0]), row[1]
        except Exception as e:
            print(f"[DB] File load error: {e}")
        return None, None

    print("[DB] Using Postgres backend (persistent — data + files)")

else:
    # ── File Backend (fallback) ──
    import fcntl
    DB_LOCK_PATH = DATA_DIR / "db.lock"

    def load_db():
        if DB_PATH.exists():
            with open(DB_LOCK_PATH, "a+") as lock_file:
                fcntl.flock(lock_file, fcntl.LOCK_SH)
                try:
                    with open(DB_PATH) as f:
                        db = json.load(f)
                finally:
                    fcntl.flock(lock_file, fcntl.LOCK_UN)
            for k in EMPTY_DB:
                if k not in db: db[k] = []
            return db
        return _fresh_db()

    def save_db(db):
        with open(DB_LOCK_PATH, "w") as lock_file:
            fcntl.flock(lock_file, fcntl.LOCK_EX)
            try:
                with open(DB_PATH, "w") as f:
                    json.dump(db, f, indent=2, default=str)
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)

    def get_db():
        return load_db()

    def save_uploaded_file(filename: str, content: bytes, content_type: str):
        """Store uploaded file on local filesystem."""
        fp = UPLOAD_DIR / filename
        fp.write_bytes(content)

    def load_uploaded_file(filename: str):
        """Load uploaded file from local filesystem."""
        fp = UPLOAD_DIR / filename
        if fp.exists():
            ext = fp.suffix.lower()
            mt = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                  ".png": "image/png", ".webp": "image/webp"}.get(ext, "application/octet-stream")
            return fp.read_bytes(), mt
        return None, None

    print("[DB] Using file backend (db.json)")

# ============================================================
# VENDOR NAME NORMALIZATION
# ============================================================
VENDOR_SUFFIXES = re.compile(
    r'\b(inc|incorporated|llc|ltd|limited|pvt|private|co|corp|corporation|'
    r'group|enterprises|solutions|services|systems|technologies|consulting|'
    r'manufacturing|international|intl)\b\.?', re.IGNORECASE)

def normalize_vendor(name: str) -> str:
    """Normalize vendor name for comparison: strip suffixes, punctuation, extra spaces."""
    if not name: return ""
    n = name.lower().strip()
    n = VENDOR_SUFFIXES.sub('', n)
    n = re.sub(r'[.,&\-\'\"]+', ' ', n)
    n = re.sub(r'\s+', ' ', n).strip()
    return n

def vendor_similarity(a: str, b: str) -> float:
    """Score vendor name similarity 0-1. Uses normalized names + fuzzy matching."""
    if not a or not b: return 0
    na, nb = normalize_vendor(a), normalize_vendor(b)
    if na == nb: return 1.0
    if na in nb or nb in na: return 0.85
    return SequenceMatcher(None, na, nb).ratio()

# ============================================================
# CURRENCY HELPERS
# ============================================================
CURRENCY_SYMBOLS = {"USD": "$", "INR": "\u20b9", "EUR": "\u20ac", "GBP": "\u00a3", "AED": "AED ", "JPY": "\u00a5", "CAD": "C$", "AUD": "A$"}

def _n(v, default=0):
    """Safe numeric: convert None/str to float. Use throughout for Claude API data."""
    if v is None: return float(default)
    try: return float(v)
    except (ValueError, TypeError): return float(default)

def currency_symbol(code: str) -> str:
    code = code or "USD"
    return CURRENCY_SYMBOLS.get(code, code + " ")

def severity_for_amount(amount: float, total: float) -> str:
    """Percentage-based severity — works across currencies."""
    amount = float(amount or 0)
    total = float(total or 0)
    if total <= 0: return "medium"
    pct = (amount / total) * 100
    if pct >= HIGH_SEVERITY_PCT: return "high"
    if pct >= MED_SEVERITY_PCT: return "medium"
    return "low"


# ============================================================
# F3: VENDOR RISK SCORING ENGINE
# ============================================================
def compute_vendor_risk_score(vendor_name: str, db: dict) -> dict:
    """Compute composite risk score (0-100) for a vendor based on 5 weighted factors.
    Higher score = higher risk. Returns score, factor breakdown, risk level, and trend."""
    vn = normalize_vendor(vendor_name)
    if not vn:
        return {"score": 50, "level": "medium", "factors": {}, "trend": "stable", "invoiceCount": 0,
                "totalSpend": 0, "openAnomalyCount": 0, "totalAnomalyCount": 0}

    # ── Gather vendor data ──
    vendor_invoices = [i for i in db.get("invoices", [])
                       if vendor_similarity(i.get("vendor", ""), vendor_name) >= 0.7]
    vendor_anomalies = [a for a in db.get("anomalies", [])
                        if vendor_similarity(a.get("vendor", ""), vendor_name) >= 0.7]
    vendor_corrections = [p for p in db.get("correction_patterns", [])
                          if vendor_similarity(p.get("vendor", ""), vendor_name) >= 0.7]
    vendor_contracts = [c for c in db.get("contracts", [])
                        if vendor_similarity(c.get("vendor", ""), vendor_name) >= 0.7]

    inv_count = len(vendor_invoices)
    if inv_count == 0:
        # New vendor — no invoice history to assess. Only contract status is evaluable.
        # Default to low-moderate score: no evidence of problems, but no track record either.
        contract_score = 55 if not vendor_contracts else 20
        return {"score": round(contract_score * RISK_WEIGHT_CONTRACT_COMPLIANCE + 15, 1),
                "level": "low", "factors": {
            "anomaly_rate": {"score": 0, "weight": RISK_WEIGHT_ANOMALY_RATE, "detail": "New vendor, no invoice history"},
            "correction_freq": {"score": 0, "weight": RISK_WEIGHT_CORRECTION_FREQ, "detail": "No corrections yet"},
            "contract_compliance": {"score": contract_score, "weight": RISK_WEIGHT_CONTRACT_COMPLIANCE,
                                    "detail": "No contract on file" if not vendor_contracts else "Contract exists"},
            "duplicate_history": {"score": 0, "weight": RISK_WEIGHT_DUPLICATE_HISTORY, "detail": "No history"},
            "volume_consistency": {"score": 0, "weight": RISK_WEIGHT_VOLUME_CONSISTENCY, "detail": "No invoices to assess"},
        }, "trend": "new", "invoiceCount": 0,
           "totalSpend": 0, "openAnomalyCount": 0, "totalAnomalyCount": 0}

    # ── Factor 1: Anomaly Rate (0-100) ──
    # What % of invoices had non-EPD anomalies?
    real_anomalies = [a for a in vendor_anomalies if a.get("type") != "EARLY_PAYMENT_DISCOUNT"]
    inv_ids_with_anomalies = set(a.get("invoiceId") for a in real_anomalies if a.get("status") == "open")
    resolved_anomalies = [a for a in real_anomalies if a.get("status") in ("resolved", "dismissed")]
    anom_rate = len(inv_ids_with_anomalies) / inv_count if inv_count > 0 else 0
    # Weight by severity: high anomalies count 3x, medium 1.5x
    severity_weight = 0
    for a in real_anomalies:
        if a.get("status") == "open":
            severity_weight += 3 if a.get("severity") == "high" else 1.5 if a.get("severity") == "medium" else 0.5
    severity_adj = min(severity_weight / max(inv_count, 1), 2.0)  # Cap at 2.0
    anomaly_score = min(100, anom_rate * 100 * (1 + severity_adj * 0.5))
    anomaly_detail = f"{len(inv_ids_with_anomalies)}/{inv_count} invoices had anomalies"
    if severity_weight > 0:
        anomaly_detail += f" ({sum(1 for a in real_anomalies if a.get('severity')=='high' and a.get('status')=='open')} high severity)"

    # ── Factor 2: Correction Frequency (0-100) ──
    # How often does AI extraction need human correction for this vendor?
    correction_count = sum(p.get("correctionCount", 1) for p in vendor_corrections)
    correction_rate = correction_count / inv_count if inv_count > 0 else 0
    correction_score = min(100, correction_rate * 40)  # 2.5 corrections per invoice = max score
    correction_detail = f"{correction_count} corrections across {inv_count} invoices"

    # ── Factor 3: Contract Compliance (0-100) ──
    # Is there a valid contract? Is it expired? Are pricing terms defined?
    contract_score = 50  # Default: unknown
    contract_detail = "No contract on file"
    if vendor_contracts:
        best_contract = vendor_contracts[0]
        ct = best_contract.get("contractTerms") or {}
        expiry = ct.get("expiry_date")
        has_pricing = bool(best_contract.get("pricingTerms"))

        if expiry:
            try:
                exp_date = datetime.fromisoformat(expiry)
                if exp_date < datetime.now():
                    days_expired = (datetime.now() - exp_date).days
                    contract_score = min(100, 60 + days_expired * 0.2)  # Gets worse the longer expired
                    contract_detail = f"Contract expired {days_expired} days ago"
                else:
                    days_remaining = (exp_date - datetime.now()).days
                    contract_score = 10 if has_pricing else 25
                    contract_detail = f"Active, expires in {days_remaining} days"
                    if has_pricing:
                        contract_detail += ", pricing enforced"
            except:
                contract_score = 40
                contract_detail = "Contract date parse error"
        elif has_pricing:
            contract_score = 20
            contract_detail = "Contract active, pricing terms defined"
        else:
            contract_score = 35
            contract_detail = "Contract exists but no pricing terms"
    else:
        # No contract at all — risky for compliance
        contract_score = 55
        contract_detail = "No contract on file — pricing unverified"

    # ── Factor 4: Duplicate History (0-100) ──
    dup_anomalies = [a for a in vendor_anomalies if a.get("type") == "DUPLICATE_INVOICE"]
    dup_count = len(dup_anomalies)
    dup_score = min(100, dup_count * 30)  # Each duplicate incident is a big red flag
    dup_detail = f"{dup_count} duplicate submissions detected" if dup_count else "No duplicates"

    # ── Factor 5: Volume Consistency (0-100) ──
    # Erratic invoicing patterns suggest problems. Measure coefficient of variation of monthly amounts.
    if inv_count >= 3:
        amounts = [i.get("subtotal", i.get("amount", 0)) for i in vendor_invoices]
        mean_amt = sum(amounts) / len(amounts)
        if mean_amt > 0:
            variance = sum((a - mean_amt) ** 2 for a in amounts) / len(amounts)
            std_dev = math.sqrt(variance)
            cv = std_dev / mean_amt  # Coefficient of variation
            volume_score = min(100, cv * 60)  # CV of 1.67 = max score
            volume_detail = f"Amount CV: {cv:.2f} across {inv_count} invoices"
        else:
            volume_score = 30
            volume_detail = "Cannot assess volume pattern"
    else:
        volume_score = 40
        volume_detail = f"Insufficient data ({inv_count} invoices)"

    # ── Weighted Composite Score ──
    raw_score = (
        anomaly_score * RISK_WEIGHT_ANOMALY_RATE +
        correction_score * RISK_WEIGHT_CORRECTION_FREQ +
        contract_score * RISK_WEIGHT_CONTRACT_COMPLIANCE +
        dup_score * RISK_WEIGHT_DUPLICATE_HISTORY +
        volume_score * RISK_WEIGHT_VOLUME_CONSISTENCY
    )

    # Clamp to 0-100
    final_score = max(0, min(100, round(raw_score, 1)))

    # ── Risk Level ──
    if final_score >= HIGH_RISK_THRESHOLD:
        level = "high"
    elif final_score >= MED_RISK_THRESHOLD:
        level = "medium"
    else:
        level = "low"

    # ── Trend Detection ──
    # Compare anomaly rate of recent invoices (last 3) vs older ones
    trend = "stable"
    if inv_count >= 6:
        sorted_inv = sorted(vendor_invoices, key=lambda x: x.get("extractedAt", ""))
        recent_ids = {i["id"] for i in sorted_inv[-3:]}
        older_ids = {i["id"] for i in sorted_inv[:-3]}
        recent_anom = sum(1 for a in real_anomalies if a.get("invoiceId") in recent_ids and a.get("status") == "open")
        older_anom = sum(1 for a in real_anomalies if a.get("invoiceId") in older_ids and a.get("status") == "open")
        recent_rate = recent_anom / 3
        older_rate = older_anom / max(len(older_ids), 1)
        if recent_rate > older_rate * 1.5:
            trend = "worsening"
        elif recent_rate < older_rate * 0.5:
            trend = "improving"

    return {
        "score": final_score,
        "level": level,
        "trend": trend,
        "invoiceCount": inv_count,
        "totalSpend": round(sum(i.get("amount", 0) for i in vendor_invoices), 2),
        "openAnomalyCount": len([a for a in real_anomalies if a.get("status") == "open"]),
        "totalAnomalyCount": len(real_anomalies),
        "factors": {
            "anomaly_rate": {"score": round(anomaly_score, 1), "weight": RISK_WEIGHT_ANOMALY_RATE, "detail": anomaly_detail},
            "correction_freq": {"score": round(correction_score, 1), "weight": RISK_WEIGHT_CORRECTION_FREQ, "detail": correction_detail},
            "contract_compliance": {"score": round(contract_score, 1), "weight": RISK_WEIGHT_CONTRACT_COMPLIANCE, "detail": contract_detail},
            "duplicate_history": {"score": round(dup_score, 1), "weight": RISK_WEIGHT_DUPLICATE_HISTORY, "detail": dup_detail},
            "volume_consistency": {"score": round(volume_score, 1), "weight": RISK_WEIGHT_VOLUME_CONSISTENCY, "detail": volume_detail},
        }
    }


def get_dynamic_tolerances(vendor_name: str, db: dict) -> dict:
    """Adjust anomaly detection tolerances based on vendor risk.
    Uses continuous linear interpolation: score 0 = full tolerance, score 100 = max tightening.
    NC1 FIX: replaces discrete 3-level steps with smooth gradient."""
    risk = compute_vendor_risk_score(vendor_name, db)
    score = risk["score"]

    # Continuous: tightening scales linearly from 0% (score 0) to RISK_TOLERANCE_TIGHTENING (score 100)
    # Floor at 30% of original tolerance to avoid zero/near-zero thresholds
    tightening = (score / 100.0) * RISK_TOLERANCE_TIGHTENING
    factor = max(0.3, 1.0 - tightening)

    return {
        "amount_tolerance_pct": round(AMOUNT_TOLERANCE_PCT * factor, 3),
        "price_tolerance_pct": round(PRICE_TOLERANCE_PCT * factor, 3),
        "risk_adjusted": score > 15,  # Only flag as adjusted if meaningfully above baseline
        "risk_score": risk["score"],
        "risk_level": risk["level"]
    }


def update_vendor_profile(vendor_name: str, db: dict):
    """Recompute and store/update vendor risk profile. Called after every invoice upload."""
    vn = normalize_vendor(vendor_name)
    if not vn:
        return

    risk = compute_vendor_risk_score(vendor_name, db)
    profiles = db.setdefault("vendor_profiles", [])

    # Find existing profile
    existing = None
    for p in profiles:
        if p.get("vendorNormalized") == vn:
            existing = p
            break

    profile_data = {
        "vendorNormalized": vn,
        "vendorDisplay": vendor_name,
        "riskScore": risk["score"],
        "riskLevel": risk["level"],
        "trend": risk["trend"],
        "invoiceCount": risk["invoiceCount"],
        "totalSpend": risk["totalSpend"],
        "openAnomalies": risk["openAnomalyCount"],
        "totalAnomalies": risk["totalAnomalyCount"],
        "factors": risk["factors"],
        "updatedAt": datetime.now().isoformat(),
    }

    if existing:
        # Track score history for trend visualization
        history = existing.get("scoreHistory", [])
        history.append({"score": existing.get("riskScore", 50), "at": existing.get("updatedAt")})
        if len(history) > 20:
            history = history[-20:]
        profile_data["scoreHistory"] = history
        existing.update(profile_data)
    else:
        profile_data["scoreHistory"] = []
        profile_data["firstSeen"] = datetime.now().isoformat()
        profiles.append(profile_data)


# ============================================================
# F1: AGENTIC INVOICE TRIAGE ENGINE
# ============================================================
def triage_invoice(invoice: dict, anomalies: list, db: dict, role: str = None, performed_by: str = "System") -> dict:
    """Classify invoice into AUTO_APPROVE / REVIEW / BLOCK with reasoning.
    Uses multi-factor analysis: anomaly severity, confidence, vendor risk, amount.
    F4: Delegation of Authority — auto-approve gated by role's authority limit.

    Returns: {lane, reasons[], confidence, vendorRisk, triageAt, autoAction, requiredApprover}
    """
    if not TRIAGE_ENABLED:
        return {"lane": "REVIEW", "reasons": ["Triage disabled"], "confidence": 0,
                "vendorRisk": None, "triageAt": datetime.now().isoformat(), "autoAction": None}

    active_role = role or DEFAULT_ROLE

    inv_id = invoice.get("id", "")
    confidence = float(invoice.get("confidence") or 0)
    vendor = invoice.get("vendor", "")
    inv_amount = invoice.get("amount") or 0
    inv_amount = float(inv_amount) if inv_amount is not None else 0

    # Get vendor risk
    vendor_risk = compute_vendor_risk_score(vendor, db)
    risk_score = vendor_risk["score"]
    risk_level = vendor_risk["level"]

    # Filter anomalies for THIS invoice (open only, exclude EPD which is informational)
    # Support two modes: (1) DB anomalies with invoiceId field, (2) direct list without invoiceId
    has_invoice_ids = any(a.get("invoiceId") for a in anomalies)
    if has_invoice_ids:
        inv_anomalies = [a for a in anomalies
                         if a.get("invoiceId") == inv_id
                         and a.get("status", "open") == "open"
                         and a.get("type") != "EARLY_PAYMENT_DISCOUNT"]
        epd_anomalies = [a for a in anomalies
                         if a.get("invoiceId") == inv_id and a.get("type") == "EARLY_PAYMENT_DISCOUNT"]
    else:
        # Direct anomalies passed (e.g. from tests or inline calls)
        inv_anomalies = [a for a in anomalies
                         if a.get("status", "open") == "open"
                         and a.get("type") != "EARLY_PAYMENT_DISCOUNT"]
        epd_anomalies = [a for a in anomalies if a.get("type") == "EARLY_PAYMENT_DISCOUNT"]

    high_anomalies = [a for a in inv_anomalies if a.get("severity") == "high"]
    medium_anomalies = [a for a in inv_anomalies if a.get("severity") == "medium"]
    low_anomalies = [a for a in inv_anomalies if a.get("severity") == "low"]
    total_risk_amount = sum(a.get("amount_at_risk", 0) for a in inv_anomalies if a.get("amount_at_risk", 0) > 0)

    # Match quality
    match = None
    for m in db.get("matches", []):
        if m.get("invoiceId") == inv_id:
            match = m
            break
    match_score = match.get("matchScore", 0) if match else 0
    is_over_invoiced = match.get("overInvoiced", False) if match else False

    reasons = []
    lane = "REVIEW"  # Default

    # ═══════════════════════════════════════════════
    # BLOCK LOGIC — any of these force a block
    # ═══════════════════════════════════════════════
    block = False

    # Rule B1: Any HIGH severity anomaly
    if high_anomalies:
        block = True
        types = list(set(a.get("type", "?") for a in high_anomalies))
        reasons.append(f"BLOCK: {len(high_anomalies)} high-severity anomal{'y' if len(high_anomalies)==1 else 'ies'} ({', '.join(t.replace('_',' ') for t in types)})")

    # Rule B2: Over-invoiced PO
    if is_over_invoiced:
        block = True
        reasons.append("BLOCK: PO over-invoiced — cumulative invoices exceed PO amount")

    # Rule B3: Duplicate invoice detected
    dup_anomalies = [a for a in inv_anomalies if a.get("type") == "DUPLICATE_INVOICE"]
    if dup_anomalies:
        block = True
        reasons.append(f"BLOCK: Potential duplicate invoice detected (confidence: {dup_anomalies[0].get('description', '').split('Confidence: ')[-1] if 'Confidence:' in (dup_anomalies[0].get('description', '')) else 'high'})")

    # Rule B4: High-risk vendor WITH anomalies
    if risk_score >= TRIAGE_BLOCK_MIN_RISK_SCORE and inv_anomalies:
        block = True
        reasons.append(f"BLOCK: High-risk vendor (score: {risk_score:.0f}) with {len(inv_anomalies)} open anomal{'y' if len(inv_anomalies)==1 else 'ies'}")

    # Rule B5: Very low extraction confidence
    if confidence < 60:
        block = True
        reasons.append(f"BLOCK: Low extraction confidence ({confidence:.0f}%) — data unreliable")

    # Rule B6: Risk amount exceeds 20% of invoice
    if inv_amount > 0 and total_risk_amount > inv_amount * 0.20:
        block = True
        risk_pct = (total_risk_amount / inv_amount) * 100
        reasons.append(f"BLOCK: At-risk amount is {risk_pct:.0f}% of invoice total")

    if block:
        lane = "BLOCK"
        auto_action = "on_hold"
        triage_confidence = min(99, 70 + len([r for r in reasons if r.startswith("BLOCK")]) * 8)
    else:
        # ═══════════════════════════════════════════════
        # AUTO-APPROVE LOGIC — all conditions must be met
        # ═══════════════════════════════════════════════
        approve_conditions = []
        approve_fails = []

        # Rule A1: No real anomalies (EPD-only is fine)
        if not inv_anomalies:
            approve_conditions.append("No anomalies detected")
        else:
            approve_fails.append(f"{len(inv_anomalies)} anomal{'y' if len(inv_anomalies)==1 else 'ies'} found")

        # Rule A2: High extraction confidence
        if confidence >= TRIAGE_AUTO_APPROVE_CONFIDENCE:
            approve_conditions.append(f"High confidence ({confidence:.0f}%)")
        else:
            approve_fails.append(f"Confidence below threshold ({confidence:.0f}% < {TRIAGE_AUTO_APPROVE_CONFIDENCE:.0f}%)")

        # Rule A3: Low vendor risk
        if risk_score <= TRIAGE_AUTO_APPROVE_MAX_RISK:
            approve_conditions.append(f"Trusted vendor (risk: {risk_score:.0f})")
        else:
            approve_fails.append(f"Vendor risk above threshold ({risk_score:.0f} > {TRIAGE_AUTO_APPROVE_MAX_RISK:.0f})")

        # Rule A4: PO matched (if invoice has PO reference)
        if invoice.get("poReference"):
            if match and match_score >= 60:
                approve_conditions.append(f"PO matched (score: {match_score})")
            else:
                approve_fails.append(f"PO reference not matched adequately")
        else:
            # F&A-6 FIX: No PO reference = cannot auto-approve
            # In standard AP, every invoice must either match a PO or go through non-PO approval
            approve_fails.append("No PO reference — requires manual authorization")

        # Rule A6: Three-way match — goods must be receipted (F5)
        # Controlled by matching_mode policy: "three_way" | "two_way" | "flexible"
        policy = get_policy()
        matching_mode = policy["matching_mode"]
        if matching_mode == "three_way":
            # Strict: require GRN for auto-approve
            if match and match.get("matchType") == "three_way":
                approve_conditions.append("Goods received (3-way match \u2713)")
            else:
                approve_fails.append("No goods receipt — 3-way matching required by policy")
        elif matching_mode == "flexible":
            # Flexible: 3-way is a plus, 2-way works but unreceipted is a flag
            if match and match.get("matchType") == "three_way":
                approve_conditions.append("Goods received (3-way match)")
            elif match and match.get("grnStatus") == "no_grn":
                unreceipted_anomaly = [a for a in inv_anomalies if a.get("type") == "UNRECEIPTED_INVOICE"]
                if unreceipted_anomaly:
                    approve_fails.append("No goods receipt on file — cannot confirm delivery")
        # "two_way" mode: GRN not required, skip this check entirely

        # Rule A5: Delegation of Authority — amount must be within active role's limit
        inv_currency = invoice.get("currency", "USD")
        role_limit = get_authority_limit(active_role, inv_currency)
        required = get_required_approver(inv_amount, inv_currency)
        role_info = AUTHORITY_MATRIX.get(active_role, AUTHORITY_MATRIX[DEFAULT_ROLE])

        if inv_amount <= role_limit:
            approve_conditions.append(f"Within {role_info['title']} authority ({currency_symbol(inv_currency)}{role_limit:,.0f})")
        else:
            approve_fails.append(f"Exceeds {role_info['title']} limit ({currency_symbol(inv_currency)}{inv_amount:,.0f} > {currency_symbol(inv_currency)}{role_limit:,.0f}) — requires {required['title']} approval")

        if not approve_fails:
            lane = "AUTO_APPROVE"
            auto_action = "approved"
            reasons = [f"APPROVED: {c}" for c in approve_conditions]
            if epd_anomalies:
                reasons.append(f"NOTE: Early payment discount available")
            triage_confidence = min(99, 80 + len(approve_conditions) * 4)
        else:
            # ═══════════════════════════════════════════════
            # REVIEW — default lane
            # ═══════════════════════════════════════════════
            lane = "REVIEW"
            auto_action = "under_review"
            reasons = [f"REVIEW: {f}" for f in approve_fails]
            if approve_conditions:
                reasons.append(f"Passed: {', '.join(approve_conditions)}")
            if medium_anomalies:
                types = list(set(a.get("type", "?") for a in medium_anomalies))
                reasons.append(f"Medium anomalies: {', '.join(t.replace('_',' ') for t in types)}")
            triage_confidence = max(40, 70 - len(approve_fails) * 10)

    return {
        "lane": lane,
        "reasons": reasons,
        "confidence": min(99, triage_confidence),
        "vendorRisk": {
            "score": vendor_risk["score"],
            "level": vendor_risk["level"],
            "trend": vendor_risk["trend"],
        },
        "anomalySummary": {
            "total": len(inv_anomalies),
            "high": len(high_anomalies),
            "medium": len(medium_anomalies),
            "low": len(low_anomalies),
            "totalRisk": round(total_risk_amount, 2),
            "hasEPD": len(epd_anomalies) > 0,
        },
        "matchQuality": match_score,
        "triageAt": datetime.now().isoformat(),
        "autoAction": auto_action,
        # F4: Delegation of Authority
        "activeRole": active_role,
        "activeRoleTitle": AUTHORITY_MATRIX.get(active_role, AUTHORITY_MATRIX[DEFAULT_ROLE])["title"],
        "requiredApprover": get_required_approver(inv_amount, invoice.get("currency", "USD")),
    }


def store_triage_decision(invoice_id: str, triage: dict, db: dict):
    """Store triage decision for audit trail and dashboard metrics."""
    decisions = db.setdefault("triage_decisions", [])
    # Remove previous decision for this invoice (re-triage on edit)
    decisions[:] = [d for d in decisions if d.get("invoiceId") != invoice_id]
    decisions.append({
        "id": str(uuid.uuid4())[:8].upper(),
        "invoiceId": invoice_id,
        **triage,
    })


def apply_triage_action(invoice: dict, triage: dict, db: dict, performed_by: str = "System"):
    """Apply triage result: update invoice status and log to activity trail.
    NC2 FIX: Transitions allowed from triage-managed statuses, not just initial.
    Terminal statuses (paid, disputed, scheduled) are never overridden by AI."""
    action = triage.get("autoAction")
    lane = triage.get("lane")
    old_status = invoice.get("status", "unpaid")

    # Terminal statuses: human decisions that outrank AI triage
    terminal = {"paid", "disputed", "scheduled"}
    # Triage-managed statuses: AI can transition between these
    triage_managed = {"unpaid", "pending", "on_hold", "under_review", "approved"}

    if old_status in triage_managed and old_status not in terminal:
        if lane == "AUTO_APPROVE" and action == "approved":
            invoice["status"] = "approved"
            invoice["autoApproved"] = True
            invoice["autoApprovedAt"] = datetime.now().isoformat()
        elif lane == "BLOCK" and action == "on_hold":
            invoice["status"] = "on_hold"
            invoice["autoBlocked"] = True
            invoice["autoBlockedAt"] = datetime.now().isoformat()
        elif lane == "REVIEW" and action == "under_review":
            invoice["status"] = "under_review"
            invoice["autoReview"] = True

    # Store triage result on the invoice itself
    invoice["triageLane"] = lane
    invoice["triageReasons"] = triage.get("reasons", [])
    invoice["triageConfidence"] = triage.get("confidence", 0)
    invoice["triageAt"] = triage.get("triageAt")
    invoice["vendorRiskScore"] = (triage.get("vendorRisk") or {}).get("score", 0)
    invoice["vendorRiskLevel"] = (triage.get("vendorRisk") or {}).get("level", "unknown")

    # Activity log
    db["activity_log"].append({
        "id": str(uuid.uuid4())[:8],
        "action": f"triage_{lane.lower()}",
        "documentId": invoice["id"],
        "documentNumber": invoice.get("invoiceNumber", ""),
        "vendor": invoice.get("vendor", ""),
        "lane": lane,
        "autoAction": action,
        "triageConfidence": triage.get("confidence", 0),
        "vendorRisk": (triage.get("vendorRisk") or {}).get("score", 0),
        "anomalyCount": (triage.get("anomalySummary") or {}).get("total", 0),
        "reasons": triage.get("reasons", [])[:3],  # First 3 reasons for log compactness
        "timestamp": datetime.now().isoformat(),
        "performedBy": performed_by,
    })

# ============================================================
# EXTRACTION PROMPT
# ============================================================

def build_correction_hints(vendor_name: str, doc_type: str, db: dict) -> str:
    """Build extraction hints from past human corrections for this vendor.
    This is the feedback loop: corrections improve future extractions."""
    patterns = db.get("correction_patterns", [])
    if not patterns:
        return ""

    # Find patterns matching this vendor (fuzzy)
    relevant = []
    for p in patterns:
        if vendor_similarity(vendor_name, p.get("vendor", "")) >= 0.7:
            relevant.append(p)
        elif p.get("vendor") == "_global":  # Global patterns apply to all vendors
            relevant.append(p)

    if not relevant:
        return ""

    hints = ["\n\nCORRECTION HISTORY (learn from past human corrections for this vendor):"]
    for p in relevant[-10:]:  # Last 10 relevant corrections
        field = p.get("field", "")
        wrong = p.get("extracted_value", "")
        correct = p.get("corrected_value", "")
        note = p.get("note", "")
        if field and (wrong or correct):
            hints.append(f"- Field '{field}': AI extracted '{wrong}' but human corrected to '{correct}'.{' ' + note if note else ''}")

    if len(hints) == 1:
        return ""

    hints.append("Apply these learned patterns to improve extraction accuracy.")
    return "\n".join(hints)


def learn_from_correction(doc: dict, field: str, old_value, new_value, db: dict):
    """Record a correction pattern so future extractions can learn from it."""
    if old_value == new_value:
        return

    pattern = {
        "id": str(uuid.uuid4())[:8],
        "vendor": doc.get("vendor", ""),
        "vendorNormalized": doc.get("vendorNormalized", ""),
        "documentType": doc.get("type", ""),
        "field": field,
        "extracted_value": str(old_value) if old_value is not None else "",
        "corrected_value": str(new_value) if new_value is not None else "",
        "note": "",
        "learnedAt": datetime.now().isoformat(),
        "documentId": doc.get("id", ""),
        "correctionCount": 1
    }

    # Check if we already have a similar pattern — increment count instead of duplicating
    existing = db.get("correction_patterns", [])
    for ep in existing:
        if (ep.get("vendorNormalized") == pattern["vendorNormalized"]
            and ep.get("field") == field
            and ep.get("extracted_value") == pattern["extracted_value"]):
            ep["corrected_value"] = pattern["corrected_value"]
            ep["correctionCount"] = ep.get("correctionCount", 1) + 1
            ep["learnedAt"] = pattern["learnedAt"]
            return

    existing.append(pattern)
    # Keep max 200 patterns
    if len(existing) > 200:
        db["correction_patterns"] = existing[-200:]


EXTRACTION_PROMPT = """You are an expert financial document processor. Analyze this document and extract structured data.

Determine if this is an INVOICE, PURCHASE ORDER, CONTRACT, CREDIT NOTE, DEBIT NOTE, or GOODS RECEIPT (also known as GRN, Delivery Note, Packing Slip, Receiving Report), then extract ALL available fields.

Respond ONLY with a valid JSON object (no markdown, no backticks) with this structure:

{
  "document_type": "invoice" or "purchase_order" or "contract" or "credit_note" or "debit_note" or "goods_receipt",
  "document_number": "the document number (GRN number, delivery note number, etc.)",
  "vendor_name": "company/vendor name",
  "currency": "USD or INR or EUR or GBP — detect from currency symbols ($, Rs, ₹, €, £) or text",
  "subtotal": 10000.00,
  "tax_details": [
    {"type": "GST/CGST/SGST/IGST/VAT/Sales Tax/etc", "rate": 18.0, "amount": 1800.00}
  ],
  "total_amount": 11800.00,
  "issue_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD or null",
  "delivery_date": "YYYY-MM-DD or null",
  "po_reference": "PO number referenced in invoice or goods receipt, or null",
  "original_invoice_ref": "for credit/debit notes — the original invoice number, or null",
  "received_date": "YYYY-MM-DD — date goods were received (for goods receipts), or null",
  "received_by": "name of person who received goods, or null",
  "condition_notes": "quality/condition notes on receipt, or null",
  "payment_terms": "Net 30, 2/10 Net 30, etc. or null",
  "early_payment_discount": {"discount_percent": 2.0, "days": 10} or null,
  "line_items": [{"description": "item", "quantity": 5, "unit_price": 100.00, "total": 500.00}],
  "pricing_terms": [{"item": "item name", "rate": 100.00, "unit": "per unit/per hour/per year"}],
  "contract_terms": {
    "effective_date": "YYYY-MM-DD or null",
    "expiry_date": "YYYY-MM-DD or null",
    "auto_renewal": true/false,
    "renewal_notice_days": 60,
    "liability_cap": 500000 or null,
    "warranty_months": 36 or null
  },
  "parties": ["Party A", "Party B"],
  "notes": "any notes",
  "bill_to": "billing address or null",
  "ship_to": "shipping address or null",
  "extraction_confidence": 0-100
}

CRITICAL RULES:
- subtotal = sum of all line_items totals (pre-tax)
- total_amount = subtotal + all taxes
- If the document shows a single total with no tax breakdown, set subtotal = total_amount and tax_details = []
- Detect "2/10 Net 30" style terms as early_payment_discount
- For credit/debit notes, extract original_invoice_ref
- For goods receipts: extract po_reference, received_date, received_by, and line_items with quantities actually received. If the document shows "ordered qty" vs "received qty", use received qty in quantity field.
- Be precise with numbers. If a field is not visible, use null."""

ANOMALY_PROMPT = """You are an expert F&A auditor. Analyze this invoice against the PO, contract, and history.

INVOICE:
{invoice_json}

PURCHASE ORDER:
{po_json}

CONTRACT:
{contract_json}

PREVIOUS INVOICES FROM THIS VENDOR:
{history_json}

Check for ALL anomaly types:
1. PRICE_OVERCHARGE — unit price exceeds contract rate or PO price
2. QUANTITY_MISMATCH — billed quantity exceeds PO authorized quantity
3. TERMS_VIOLATION — payment terms differ from contract
4. UNAUTHORIZED_ITEM — line items on invoice not present in PO
5. DUPLICATE_INVOICE — same invoice number, or same vendor+amount+date as previous invoice
6. RATE_OVERCHARGE — hourly/daily rates exceed contract rates
7. HOURS_EXCEEDED — billed hours/quantities exceed PO authorization
8. AMOUNT_DISCREPANCY — total differs significantly from PO (account for tax — POs are typically pre-tax, invoices include tax)
9. MISSING_PO — invoice has no PO reference
10. OVER_INVOICED — cumulative invoices against this PO exceed PO total
11. LINE_ITEM_TOTAL_MISMATCH — sum of line items doesn't equal subtotal
12. TAX_RATE_ANOMALY — tax rate seems incorrect for the jurisdiction or item type
13. EARLY_PAYMENT_DISCOUNT — eligible for discount if paid early, flag as opportunity
14. CURRENCY_MISMATCH — invoice currency differs from PO currency

IMPORTANT: When comparing invoice total vs PO total, account for tax. POs are typically pre-tax amounts. Compare invoice SUBTOTAL (pre-tax) against PO total, NOT invoice total (post-tax) vs PO total.

Use the actual currency ({currency}) in descriptions. Do not assume USD.

Severity: high (>10% variance or systematic issue), medium (5-10% or one-off), low (<5% or informational).

Respond ONLY with JSON array:
[{{"type": "PRICE_OVERCHARGE", "severity": "high", "description": "explanation with {currency} amounts", "amount_at_risk": 70.00, "contract_clause": "Section 2", "recommendation": "action"}}]

If no anomalies: []
Be thorough. Check every line item."""


# ============================================================
# CLAUDE API
# ============================================================
async def extract_with_claude(file_path: str, file_name: str, media_type: str, vendor_hint: str = "", doc_type_hint: str = "") -> dict:
    if not USE_REAL_API:
        return await mock_extraction(file_name)

    client = anthropic.Anthropic()
    with open(file_path, "rb") as f:
        b64_data = base64.standard_b64encode(f.read()).decode("utf-8")

    if media_type == "application/pdf":
        content_block = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64_data}}
    else:
        img_type = media_type if media_type in ["image/jpeg", "image/png", "image/gif", "image/webp"] else "image/png"
        content_block = {"type": "image", "source": {"type": "base64", "media_type": img_type, "data": b64_data}}

    # Build prompt with correction hints + RAG context
    db = get_db()
    hints = build_correction_hints(vendor_hint or file_name, doc_type_hint or "auto", db)
    rag_context = await get_extraction_context(vendor_hint or file_name, doc_type_hint or "auto")
    prompt = EXTRACTION_PROMPT + hints + rag_context

    try:
        print(f"[Extract] Calling Claude API for '{file_name}' (media_type={media_type})")
        msg = client.messages.create(model="claude-sonnet-4-20250514", max_tokens=4000,
            messages=[{"role": "user", "content": [content_block, {"type": "text", "text": prompt}]}])
        text = msg.content[0].text.strip()
        print(f"[Extract] Raw response (first 200 chars): {text[:200]}")

        # Strip markdown code fences if present
        if text.startswith("```"):
            first_newline = text.index("\n") if "\n" in text else len(text)
            text = text[first_newline + 1:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        result = json.loads(text)
        result["_confidence"] = result.pop("extraction_confidence", 92)
        result["_source"] = "claude_api"
        print(f"[Extract] Success: type={result.get('document_type')}, vendor={result.get('vendor_name')}")
        return result
    except Exception as e:
        print(f"[Extract] ERROR for '{file_name}': {type(e).__name__}: {e}")
        import traceback; traceback.print_exc()
        return await mock_extraction(file_name)


async def detect_anomalies_with_claude(invoice, po, contract, history, tolerances=None) -> list:
    if not USE_REAL_API:
        return detect_anomalies_rule_based(invoice, po, contract, history, tolerances)

    client = anthropic.Anthropic()
    def clean(d):
        if not d: return "Not available"
        skip = {"rawExtraction", "extractionSource", "extractedAt", "billTo", "shipTo"}
        return json.dumps({k: v for k, v in d.items() if k not in skip}, indent=2, default=str)

    cur = invoice.get("currency", "USD")
    rag_context = await get_anomaly_context(invoice)

    # Inject dynamic tolerances into prompt so Claude adjusts its sensitivity
    tol_context = ""
    if tolerances and tolerances.get("risk_adjusted"):
        tol_context = f"""

VENDOR RISK ADJUSTMENT: This vendor has a risk score of {tolerances.get('risk_score', 0):.0f}/100 ({tolerances.get('risk_level', 'unknown')} risk).
Apply TIGHTER thresholds: amount tolerance {tolerances['amount_tolerance_pct']:.1f}% (normal: {AMOUNT_TOLERANCE_PCT}%), price tolerance {tolerances['price_tolerance_pct']:.1f}% (normal: {PRICE_TOLERANCE_PCT}%).
Be more aggressive flagging anomalies for this vendor."""

    prompt = ANOMALY_PROMPT.format(
        invoice_json=clean(invoice), po_json=clean(po), contract_json=clean(contract),
        currency=cur,
        history_json=json.dumps([{"invoiceNumber": h.get("invoiceNumber"), "vendor": h.get("vendor"),
            "amount": h.get("amount"), "subtotal": h.get("subtotal"), "lineItems": h.get("lineItems", []),
            "issueDate": h.get("issueDate"), "currency": h.get("currency")
        } for h in history[-10:]], indent=2, default=str) if history else "No previous invoices")
    prompt += tol_context + rag_context

    try:
        msg = client.messages.create(model="claude-sonnet-4-20250514", max_tokens=4000,
            messages=[{"role": "user", "content": prompt}])
        text = msg.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"): text = text[:-3]
            text = text.strip()
        result = json.loads(text)
        return result if isinstance(result, list) else []
    except Exception as e:
        print(f"Anomaly detection error: {e}")
        return detect_anomalies_rule_based(invoice, po, contract, history, tolerances)


# ============================================================
# RULE-BASED ANOMALY DETECTION (F&A hardened)
# ============================================================
def detect_anomalies_rule_based(invoice, po, contract, history, tolerances=None) -> list:
    anomalies = []
    cur = invoice.get("currency") or "USD"
    sym = currency_symbol(cur)
    inv_total = float(invoice.get("amount") or 0)
    inv_subtotal = float(invoice.get("subtotal") or inv_total or 0)

    # Sanitize PO amount if PO exists
    if po:
        po_amt_raw = po.get("amount")
        if po_amt_raw is None:
            po["amount"] = 0

    # ── F3 Integration: Use dynamic tolerances if provided ──
    amt_tol_pct = (tolerances or {}).get("amount_tolerance_pct", AMOUNT_TOLERANCE_PCT)
    prc_tol_pct = (tolerances or {}).get("price_tolerance_pct", PRICE_TOLERANCE_PCT)
    risk_adjusted = (tolerances or {}).get("risk_adjusted", False)
    risk_note = f" [Tightened: vendor risk {tolerances.get('risk_level', '?')} ({tolerances.get('risk_score', 0):.0f})]" if risk_adjusted else ""

    # ── 1. LINE ITEM TOTAL VERIFICATION ──────────────────────
    li_sum = sum(float(li.get("total") or 0) for li in (invoice.get("lineItems") or []))
    if li_sum > 0 and inv_subtotal > 0:
        diff = abs(li_sum - inv_subtotal)
        if diff > 0.50:  # Allow for rounding
            anomalies.append({"type": "LINE_ITEM_TOTAL_MISMATCH",
                "severity": severity_for_amount(diff, inv_subtotal),
                "description": f"Sum of line items ({sym}{li_sum:,.2f}) does not match subtotal ({sym}{inv_subtotal:,.2f}). Difference: {sym}{diff:,.2f}",
                "amount_at_risk": round(diff, 2), "contract_clause": None,
                "recommendation": "Verify line item totals. Possible hidden charges or calculation error."})

    # ── 2. MISSING PO CHECK ──────────────────────────────────
    if not po and not invoice.get("poReference"):
        anomalies.append({"type": "MISSING_PO", "severity": "medium",
            "description": f"Invoice {invoice.get('invoiceNumber', '?')} has no purchase order reference.",
            "amount_at_risk": inv_total, "contract_clause": None,
            "recommendation": "Verify this purchase was authorized before payment."})
    elif not po and invoice.get("poReference"):
        # PO reference exists on invoice but no matching PO found in system
        anomalies.append({"type": "MISSING_PO", "severity": "medium",
            "description": f"Invoice references {invoice['poReference']} but no matching PO found in the system.",
            "amount_at_risk": inv_total, "contract_clause": None,
            "recommendation": f"Upload or locate PO {invoice['poReference']} before approving payment."})

    # ── 3. PO COMPARISON (tax-aware) ─────────────────────────
    po_level_diff = 0  # Track the aggregate PO discrepancy for dedup
    if po:
        po_amt = float(po.get("amount") or 0)
        # Compare SUBTOTAL (pre-tax) against PO amount (which is typically pre-tax)
        compare_amt = inv_subtotal
        tolerance = po_amt * (amt_tol_pct / 100)

        if po_amt > 0 and compare_amt > po_amt + tolerance:
            po_level_diff = compare_amt - po_amt

        # Line item comparison
        inv_items = {((li.get("description") or "")).lower().strip(): li for li in invoice.get("lineItems", [])}
        po_items = {((li.get("description") or "")).lower().strip(): li for li in po.get("lineItems", [])}

        line_item_risk_total = 0  # Track how much line-item anomalies explain

        for desc, inv_li in inv_items.items():
            # Fuzzy match line item descriptions
            matched = None
            best_sim = 0
            for pd, pli in po_items.items():
                sim = SequenceMatcher(None, desc, pd).ratio()
                if sim > 0.7 and sim > best_sim:
                    matched = pli; best_sim = sim
                elif desc in pd or pd in desc:
                    matched = pli; best_sim = 1.0

            if matched:
                # Quantity check
                iq, pq = _n(inv_li.get("quantity")), _n(matched.get("quantity"))
                if iq > pq > 0:
                    extra = iq - pq
                    price = _n(inv_li.get("unitPrice"))
                    risk = extra * price
                    line_item_risk_total += risk
                    anomalies.append({"type": "QUANTITY_MISMATCH",
                        "severity": severity_for_amount(risk, po_amt),
                        "description": f"'{inv_li['description']}': Billed {iq} units, PO authorized {pq}. {extra} unauthorized.",
                        "amount_at_risk": round(risk, 2), "contract_clause": None,
                        "recommendation": f"Dispute {extra} extra units ({sym}{risk:,.2f})"})

                # Price check (against PO)
                ip, pp = _n(inv_li.get("unitPrice")), _n(matched.get("unitPrice"))
                price_tol = pp * (prc_tol_pct / 100)
                if ip > pp + price_tol and pp > 0:
                    d = ip - pp; q = _n(inv_li.get("quantity"), 1); risk = d * q
                    line_item_risk_total += risk
                    anomalies.append({"type": "PRICE_OVERCHARGE",
                        "severity": severity_for_amount(risk, po_amt),
                        "description": f"'{inv_li['description']}': {sym}{ip:,.2f}/unit vs PO {sym}{pp:,.2f}/unit{risk_note}",
                        "amount_at_risk": round(risk, 2), "contract_clause": None,
                        "recommendation": f"Request credit: {sym}{risk:,.2f}"})
            else:
                if _n(inv_li.get("total")) > 0:
                    line_item_risk_total += _n(inv_li.get("total"))
                    anomalies.append({"type": "UNAUTHORIZED_ITEM",
                        "severity": severity_for_amount(inv_li["total"], po_amt) if po_amt > 0 else "medium",
                        "description": f"'{inv_li['description']}' ({sym}{inv_li['total']:,.2f}) not found in purchase order.",
                        "amount_at_risk": inv_li["total"], "contract_clause": None,
                        "recommendation": "Verify authorization before payment."})

        # Add AMOUNT_DISCREPANCY only if line-item anomalies don't fully explain the difference
        # This prevents double-counting: if overcharges on CDN ($1500) + Compute ($3000) = $4500 = total diff,
        # the aggregate discrepancy is redundant
        if po_level_diff > 0 and line_item_risk_total < po_level_diff * 0.9:
            # Line items explain less than 90% of the difference — flag the aggregate too
            unexplained = po_level_diff - line_item_risk_total
            anomalies.append({"type": "AMOUNT_DISCREPANCY",
                "severity": severity_for_amount(unexplained, po_amt),
                "description": f"Invoice subtotal ({sym}{compare_amt:,.2f}) exceeds PO total ({sym}{po_amt:,.2f}) by {sym}{po_level_diff:,.2f}"
                    + (f". {sym}{line_item_risk_total:,.2f} explained by line-item overcharges, {sym}{unexplained:,.2f} unexplained." if line_item_risk_total > 0 else f", representing a {po_level_diff/po_amt*100:.2f}% variance which exceeds the {amt_tol_pct}% tolerance threshold{risk_note}."),
                "amount_at_risk": round(unexplained, 2), "contract_clause": "Purchase order authorization limits",
                "recommendation": f"Reject invoice pending price correction to match contracted rates. Total should be {sym}{po_amt:,.2f} based on contract pricing."})

    # ── 4. CONTRACT PRICING CHECK ────────────────────────────
    if contract:
        # Check if contract is expired (F&A critical)
        ct = contract.get("contractTerms") or {}
        expiry = ct.get("expiry_date")
        if expiry:
            try:
                exp_date = datetime.fromisoformat(expiry)
                inv_date = datetime.fromisoformat(invoice.get("issueDate", "")) if invoice.get("issueDate") else datetime.now()
                if inv_date > exp_date:
                    days_expired = (inv_date - exp_date).days
                    anomalies.append({"type": "TERMS_VIOLATION", "severity": "high",
                        "description": f"Invoice issued {days_expired} days after contract expired on {expiry}. Billing under expired contract.",
                        "amount_at_risk": inv_total, "contract_clause": f"Contract expired: {expiry}",
                        "recommendation": "Do not pay. Renew contract or negotiate new terms before processing."})
            except: pass

        if contract.get("pricingTerms"):
            for pt in contract.get("pricingTerms", []):
                contract_item = (pt.get("item") or "").lower().strip()
                contract_rate = _n(pt.get("rate"))
                if not contract_item or not contract_rate: continue

                for inv_li in invoice.get("lineItems", []):
                    inv_desc = (inv_li.get("description") or "").lower().strip()
                    sim = SequenceMatcher(None, contract_item, inv_desc).ratio()
                    if sim > 0.6 or contract_item in inv_desc or inv_desc in contract_item:
                        inv_price = _n(inv_li.get("unitPrice"))
                        if inv_price > contract_rate * (1 + prc_tol_pct / 100):
                            diff = inv_price - contract_rate
                            qty = _n(inv_li.get("quantity"), 1)
                            risk = diff * qty
                            anomalies.append({"type": "PRICE_OVERCHARGE",
                                "severity": severity_for_amount(risk, inv_total),
                                "description": f"'{inv_li['description']}': {sym}{inv_price:,.2f}/{pt.get('unit', 'unit')} vs contract rate {sym}{contract_rate:,.2f}/{pt.get('unit', 'unit')}",
                                "amount_at_risk": round(risk, 2),
                                "contract_clause": f"Contract pricing: {pt.get('item')} at {sym}{contract_rate:,.2f}/{pt.get('unit', 'unit')}",
                                "recommendation": f"Vendor overcharging vs contract. Dispute {sym}{risk:,.2f}"})
                        break

    # Contract terms check
    if contract:
        it = (invoice.get("paymentTerms") or "").lower().strip()
        ct = (contract.get("paymentTerms") or "").lower().strip()
        if it and ct and it != ct:
            anomalies.append({"type": "TERMS_VIOLATION", "severity": "medium",
                "description": f"Invoice terms '{invoice.get('paymentTerms')}' differ from contract '{contract.get('paymentTerms')}'",
                "amount_at_risk": 0, "contract_clause": f"Contract: {contract.get('paymentTerms')}",
                "recommendation": "Enforce contract payment terms."})

    # ── 5. SMART DUPLICATE DETECTION ─────────────────────────
    for h in history:
        if h.get("id") == invoice.get("id"): continue

        dup_score = 0
        dup_reasons = []

        # Same invoice number from same vendor = definite duplicate
        if (h.get("invoiceNumber") and invoice.get("invoiceNumber") and
                h["invoiceNumber"].strip().lower() == invoice["invoiceNumber"].strip().lower()):
            dup_score = 100
            dup_reasons.append("identical invoice number")

        else:
            # Same amount check
            h_amt = _n(h.get("amount"))
            if h_amt > 0 and inv_total > 0 and abs(h_amt - inv_total) / max(h_amt, inv_total) < 0.02:
                dup_score += 40
                dup_reasons.append("same amount")

            # Same date check
            if h.get("issueDate") and invoice.get("issueDate") and h["issueDate"] == invoice["issueDate"]:
                dup_score += 25
                dup_reasons.append("same date")
            elif h.get("issueDate") and invoice.get("issueDate"):
                try:
                    d1 = datetime.fromisoformat(h["issueDate"])
                    d2 = datetime.fromisoformat(invoice["issueDate"])
                    if abs((d1 - d2).days) <= DUPLICATE_DAYS_WINDOW:
                        dup_score += 10
                        dup_reasons.append(f"within {DUPLICATE_DAYS_WINDOW} days")
                except: pass

            # Same line items check
            h_items = set((((li.get("description") or "")).lower(), _n(li.get("quantity")), _n(li.get("unitPrice")))
                         for li in h.get("lineItems", []))
            i_items = set((((li.get("description") or "")).lower(), _n(li.get("quantity")), _n(li.get("unitPrice")))
                         for li in invoice.get("lineItems", []))
            if h_items and i_items and h_items == i_items:
                dup_score += 35
                dup_reasons.append("identical line items")
            elif h_items and i_items and len(h_items & i_items) > len(h_items) * 0.7:
                dup_score += 20
                dup_reasons.append("similar line items")

        if dup_score >= 60:
            anomalies.append({"type": "DUPLICATE_INVOICE",
                "severity": "high" if dup_score >= 80 else "medium",
                "description": f"Likely duplicate of {h.get('invoiceNumber', '?')} ({sym}{h.get('amount', 0):,.2f}). Signals: {', '.join(dup_reasons)}. Confidence: {dup_score}%",
                "amount_at_risk": inv_total, "contract_clause": None,
                "recommendation": "Verify this is not a duplicate payment. Do not process until confirmed."})
            # Report all potential duplicates for the auditor

    # ── 6. EARLY PAYMENT DISCOUNT OPPORTUNITY ────────────────
    epd = invoice.get("earlyPaymentDiscount")
    if epd and epd.get("discount_percent") and epd.get("days"):
        # EPD applies to pre-tax subtotal, not post-tax total
        savings = inv_subtotal * (epd["discount_percent"] / 100)
        anomalies.append({"type": "EARLY_PAYMENT_DISCOUNT", "severity": "low",
            "description": f"Eligible for {epd['discount_percent']}% discount ({sym}{savings:,.2f}) on subtotal if paid within {epd['days']} days",
            "amount_at_risk": round(-savings, 2),  # Negative = savings opportunity
            "contract_clause": f"Terms: {invoice.get('paymentTerms', '')}",
            "recommendation": f"Pay within {epd['days']} days to save {sym}{savings:,.2f}"})

    # ── 7. TAX RATE SANITY CHECK ─────────────────────────────
    tax_details = invoice.get("taxDetails", [])
    if tax_details and inv_subtotal > 0:
        total_tax = sum(_n(t.get("amount")) for t in tax_details)
        effective_rate = (total_tax / inv_subtotal) * 100 if inv_subtotal > 0 else 0
        # Flag unusual tax rates
        if effective_rate > 30:
            anomalies.append({"type": "TAX_RATE_ANOMALY", "severity": "medium",
                "description": f"Effective tax rate is {effective_rate:.1f}% ({sym}{total_tax:,.2f} on {sym}{inv_subtotal:,.2f}). Unusually high.",
                "amount_at_risk": round(total_tax, 2), "contract_clause": None,
                "recommendation": "Verify tax calculation. Rate seems excessive."})
        elif effective_rate > 0 and effective_rate < 1:
            anomalies.append({"type": "TAX_RATE_ANOMALY", "severity": "low",
                "description": f"Effective tax rate is only {effective_rate:.1f}%. Unusually low — verify tax is applied correctly.",
                "amount_at_risk": 0, "contract_clause": None,
                "recommendation": "Confirm tax exemption or verify rate."})

        # F&A-3 FIX: Check stated rate vs actual amount — catch miscalculations
        for td in tax_details:
            stated_rate = _n(td.get("rate"))
            tax_amount = _n(td.get("amount"))
            if stated_rate > 0 and tax_amount > 0 and inv_subtotal > 0:
                expected_tax = inv_subtotal * (stated_rate / 100)
                tax_diff = abs(tax_amount - expected_tax)
                if tax_diff > max(1.0, expected_tax * 0.05):  # >5% or >$1 discrepancy
                    anomalies.append({"type": "TAX_RATE_ANOMALY", "severity": "medium",
                        "description": f"Tax amount {sym}{tax_amount:,.2f} doesn't match stated {td.get('type', 'tax')} rate of {stated_rate}%. Expected {sym}{expected_tax:,.2f}, difference: {sym}{tax_diff:,.2f}.",
                        "amount_at_risk": round(tax_diff, 2), "contract_clause": None,
                        "recommendation": f"Verify tax calculation. Stated rate {stated_rate}% on {sym}{inv_subtotal:,.2f} should be {sym}{expected_tax:,.2f}."})
    # ── 8. CURRENCY MISMATCH ─────────────────────────────────
    if po:
        po_cur = po.get("currency", "USD")
        inv_cur = invoice.get("currency", "USD")
        if po_cur != inv_cur:
            anomalies.append({"type": "CURRENCY_MISMATCH", "severity": "medium",
                "description": f"Currency mismatch: Invoice in {inv_cur}, PO in {po_cur}. Cannot compare amounts directly.",
                "amount_at_risk": 0, "contract_clause": None,
                "recommendation": f"Verify exchange rate and ensure amounts align. Invoice: {inv_cur}, PO: {po_cur}"})

    # ── 9. POLICY-DRIVEN CHECKS ─────────────────────────────
    policy = get_policy()

    # Round number flag
    if policy.get("flag_round_number_invoices") and inv_total >= 5000:
        if inv_total == round(inv_total, -3):  # Exact multiple of 1000
            anomalies.append({"type": "ROUND_NUMBER_INVOICE", "severity": "low",
                "description": f"Suspiciously round invoice amount: {sym}{inv_total:,.2f}. Legitimate invoices rarely land on exact thousands.",
                "amount_at_risk": 0, "contract_clause": None,
                "recommendation": "Verify invoice is for actual goods/services delivered."})

    # Weekend invoice flag
    if policy.get("flag_weekend_invoices"):
        issue_date = invoice.get("issueDate") or invoice.get("issue_date")
        if issue_date:
            try:
                dt = datetime.strptime(str(issue_date)[:10], "%Y-%m-%d")
                if dt.weekday() >= 5:
                    anomalies.append({"type": "WEEKEND_INVOICE", "severity": "low",
                        "description": f"Invoice dated on {'Saturday' if dt.weekday()==5 else 'Sunday'} ({issue_date}).",
                        "amount_at_risk": 0, "contract_clause": None,
                        "recommendation": "Verify vendor legitimacy. Weekend invoicing is a minor fraud indicator."})
            except: pass

    # Stale invoice flag
    max_age = policy.get("max_invoice_age_days", 365)
    issue_date_str = invoice.get("issueDate") or invoice.get("issue_date")
    if issue_date_str and max_age > 0:
        try:
            dt = datetime.strptime(str(issue_date_str)[:10], "%Y-%m-%d")
            age = (datetime.now() - dt).days
            if age > max_age:
                anomalies.append({"type": "STALE_INVOICE", "severity": "medium",
                    "description": f"Invoice is {age} days old (issued {issue_date_str}). Policy max: {max_age} days.",
                    "amount_at_risk": inv_total, "contract_clause": None,
                    "recommendation": f"Investigate why this invoice is {age} days old."})
        except: pass

    return anomalies


# ============================================================
# MOCK EXTRACTION
# ============================================================
async def mock_extraction(file_name: str) -> dict:
    """Mock extraction that returns deterministic data matching test documents.
    If file_name matches a known test document, returns exact data.
    Otherwise falls back to random generation for unknown files."""
    import random
    await asyncio.sleep(1.0)

    fn = file_name.lower().replace(" ", "_")

    # ── Deterministic test document library ──
    TEST_DOCS = _get_test_doc_library()
    for key, doc in TEST_DOCS.items():
        if key in fn:
            print(f"  Mock extraction: matched '{key}' → {doc.get('document_type')} / {doc.get('vendor_name')}")
            doc["_confidence"] = doc.pop("_confidence", 93)
            doc["_source"] = "mock_extraction"
            return doc

    # ── Fallback: random generation for unknown files ──
    print(f"  Mock extraction: no match for '{file_name}', generating random data")
    vendors = ["Acme Manufacturing Co.", "TechNova Systems", "GlobalParts International", "Meridian Supply Group", "Atlas Industrial Corp."]
    items_pool = [("Server Rack Units (42U)", 2, 4500), ("Managed Network Switch", 5, 1200), ("Cloud License (Annual)", 1, 24000),
        ("Consulting Hours", 40, 175), ("Maintenance Contract", 1, 8500), ("Power Distribution Unit", 4, 850)]

    is_contract = "contract" in fn or "agreement" in fn
    is_credit = "credit" in fn or "cn_" in fn
    is_debit = "debit" in fn or "dn_" in fn
    is_invoice = "inv" in fn or "invoice" in fn
    is_po = "po" in fn or "purchase" in fn
    if not any([is_contract, is_credit, is_debit, is_invoice, is_po]):
        is_invoice = random.random() > 0.4; is_po = not is_invoice

    vendor = random.choice(vendors)
    items = random.sample(items_pool, random.randint(1, 4))
    line_items = [{"description": d, "quantity": max(1, q + random.randint(-1, 3)),
        "unit_price": round(p * (0.9 + random.random() * 0.2), 2),
        "total": round(max(1, q + random.randint(-1, 3)) * round(p * (0.9 + random.random() * 0.2), 2), 2)} for d, q, p in items]
    subtotal = sum(li["total"] for li in line_items)
    tax_rate = random.choice([0, 5, 12, 18])
    tax_amt = round(subtotal * tax_rate / 100, 2)
    total = round(subtotal + tax_amt, 2)
    issue = datetime.now() - timedelta(days=random.randint(5, 60))

    base = {"vendor_name": vendor, "subtotal": round(subtotal, 2), "total_amount": total,
        "tax_details": [{"type": "GST", "rate": tax_rate, "amount": tax_amt}] if tax_rate > 0 else [],
        "issue_date": issue.strftime("%Y-%m-%d"), "line_items": line_items,
        "currency": random.choice(["USD", "INR"]), "notes": None, "bill_to": "Acme Corporation",
        "_confidence": round(85 + random.random() * 13, 1), "_source": "mock_extraction",
        "pricing_terms": [], "contract_terms": {}, "parties": [], "early_payment_discount": None}

    if is_contract:
        base.update({"document_type": "contract", "document_number": f"AGR-{random.randint(100, 999)}",
            "payment_terms": "Net 30",
            "pricing_terms": [{"item": li["description"], "rate": li["unit_price"], "unit": "per unit"} for li in line_items[:3]],
            "contract_terms": {"effective_date": issue.strftime("%Y-%m-%d"),
                "expiry_date": (issue + timedelta(days=730)).strftime("%Y-%m-%d"),
                "auto_renewal": True, "renewal_notice_days": 60, "liability_cap": 500000},
            "parties": ["Acme Corporation", vendor]})
    elif is_credit or is_debit:
        base.update({"document_type": "credit_note" if is_credit else "debit_note",
            "document_number": f"{'CN' if is_credit else 'DN'}-{random.randint(1000, 9999)}",
            "original_invoice_ref": f"INV-{random.randint(10000, 99999)}",
            "payment_terms": "Net 30"})
    elif is_invoice:
        terms = random.choice(["Net 30", "Net 45", "2/10 Net 30"])
        epd = {"discount_percent": 2.0, "days": 10} if "2/10" in terms else None
        base.update({"document_type": "invoice", "document_number": f"INV-{random.randint(10000, 99999)}",
            "due_date": (issue + timedelta(days=30)).strftime("%Y-%m-%d"),
            "po_reference": f"PO-2025-{random.randint(1000, 9999)}" if random.random() > 0.3 else None,
            "payment_terms": terms, "early_payment_discount": epd})
    else:
        base.update({"document_type": "purchase_order",
            "document_number": f"PO-2025-{random.randint(1000, 9999)}",
            "delivery_date": (issue + timedelta(days=30)).strftime("%Y-%m-%d"), "payment_terms": "Net 30"})
    return base


def _get_test_doc_library() -> dict:
    """Returns a dictionary of filename-key → extraction data for all test documents.
    Keys are lowercase substrings matched against the uploaded filename."""
    now = datetime.now()
    d = lambda days_ago: (now - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    dfwd = lambda days: (now + timedelta(days=days)).strftime("%Y-%m-%d")

    return {
        # ═══════════════════════ CONTRACTS ═══════════════════════
        "contract_meridian": {
            "document_type": "contract", "document_number": "AGR-2025-001",
            "vendor_name": "Meridian Supply Group LLC", "currency": "USD",
            "subtotal": 200000, "total_amount": 200000,
            "issue_date": d(180), "tax_details": [], "line_items": [],
            "payment_terms": "Net 30", "notes": "Master Supply Agreement",
            "bill_to": None, "early_payment_discount": None,
            "pricing_terms": [
                {"item": "Office Furniture Set", "rate": 1500, "unit": "unit"},
                {"item": "Ergonomic Desk Chair", "rate": 500, "unit": "unit"},
                {"item": "Dell Latitude Laptop", "rate": 1800, "unit": "unit"},
                {"item": "Monitor 27-inch 4K", "rate": 600, "unit": "unit"},
            ],
            "contract_terms": {"effective_date": d(180), "expiry_date": dfwd(365),
                "liability_cap": 200000, "payment_terms": "Net 30", "auto_renewal": True},
            "parties": ["Acme Corporation", "Meridian Supply Group LLC"],
            "_confidence": 95,
        },
        "contract_techvista": {
            "document_type": "contract", "document_number": "AGR-2025-002",
            "vendor_name": "TechVista Solutions Pvt Ltd", "currency": "INR",
            "subtotal": 10000000, "total_amount": 10000000,
            "issue_date": d(120), "tax_details": [], "line_items": [],
            "payment_terms": "Net 45", "notes": "IT Services Agreement",
            "bill_to": None, "early_payment_discount": None,
            "pricing_terms": [
                {"item": "Software Development Services", "rate": 3500, "unit": "hour"},
                {"item": "QA Testing Services", "rate": 2500, "unit": "hour"},
                {"item": "Project Management", "rate": 3000, "unit": "hour"},
            ],
            "contract_terms": {"effective_date": d(120), "expiry_date": dfwd(365),
                "liability_cap": 10000000, "payment_terms": "Net 45"},
            "parties": ["Acme Corporation", "TechVista Solutions Pvt Ltd"],
            "_confidence": 93,
        },
        "contract_pinnacle": {
            "document_type": "contract", "document_number": "AGR-2024-005",
            "vendor_name": "Pinnacle Industrial Services", "currency": "USD",
            "subtotal": 100000, "total_amount": 100000,
            "issue_date": d(400), "tax_details": [], "line_items": [],
            "payment_terms": "Net 30", "notes": "Maintenance Agreement",
            "bill_to": None, "early_payment_discount": None,
            "pricing_terms": [
                {"item": "Annual Maintenance Contract", "rate": 18000, "unit": "unit"},
                {"item": "Emergency Repair Services", "rate": 1200, "unit": "unit"},
            ],
            "contract_terms": {"effective_date": d(400), "expiry_date": d(45),
                "liability_cap": 100000, "payment_terms": "Net 30"},
            "parties": ["Acme Corporation", "Pinnacle Industrial Services"],
            "_confidence": 91,
        },
        "contract_atlas": {
            "document_type": "contract", "document_number": "AGR-2025-004",
            "vendor_name": "Atlas Cloud Infrastructure Inc", "currency": "USD",
            "subtotal": 150000, "total_amount": 150000,
            "issue_date": d(200), "tax_details": [], "line_items": [],
            "payment_terms": "Net 30", "notes": "Cloud Services Agreement",
            "bill_to": None, "early_payment_discount": None,
            "pricing_terms": [
                {"item": "Cloud Compute Instance", "rate": 4000, "unit": "month"},
                {"item": "Managed Database Service", "rate": 1500, "unit": "month"},
                {"item": "CDN & Storage", "rate": 500, "unit": "month"},
            ],
            "contract_terms": {"effective_date": d(200), "expiry_date": dfwd(365),
                "liability_cap": 150000, "payment_terms": "Net 30"},
            "parties": ["Acme Corporation", "Atlas Cloud Infrastructure Inc"],
            "_confidence": 94,
        },

        # ═══════════════════════ PURCHASE ORDERS ═══════════════════════
        "po_meridian_office": {
            "document_type": "purchase_order", "document_number": "PO-2025-1001",
            "vendor_name": "Meridian Supply Group LLC", "currency": "USD",
            "subtotal": 25000, "total_amount": 25000,
            "issue_date": d(60), "delivery_date": d(30), "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Office Furniture Set", "quantity": 10, "unit_price": 1500, "total": 15000},
                {"description": "Ergonomic Desk Chair", "quantity": 20, "unit_price": 500, "total": 10000},
            ],
            "bill_to": None, "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 95,
        },
        "po_meridian_it": {
            "document_type": "purchase_order", "document_number": "PO-2025-1002",
            "vendor_name": "Meridian Supply Group LLC", "currency": "USD",
            "subtotal": 45000, "total_amount": 45000,
            "issue_date": d(90), "delivery_date": d(45), "tax_details": [], "payment_terms": "2/10 Net 30",
            "line_items": [
                {"description": "Dell Latitude Laptop", "quantity": 15, "unit_price": 1800, "total": 27000},
                {"description": "Monitor 27-inch 4K", "quantity": 15, "unit_price": 600, "total": 9000},
                {"description": "Docking Station USB-C", "quantity": 15, "unit_price": 200, "total": 3000},
                {"description": "Wireless Keyboard Mouse Set", "quantity": 15, "unit_price": 80, "total": 1200},
                {"description": "Laptop Bag Premium", "quantity": 15, "unit_price": 120, "total": 1800},
                {"description": "Setup & Configuration", "quantity": 15, "unit_price": 200, "total": 3000},
            ],
            "bill_to": None, "notes": None,
            "early_payment_discount": {"discount_percent": 2, "days": 10},
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 92,
        },
        "po_techvista": {
            "document_type": "purchase_order", "document_number": "PO-2025-2001",
            "vendor_name": "TechVista Solutions Pvt Ltd", "currency": "INR",
            "subtotal": 3500000, "total_amount": 3500000,
            "issue_date": d(45), "delivery_date": d(15), "tax_details": [], "payment_terms": "Net 45",
            "line_items": [
                {"description": "Software Development Services", "quantity": 700, "unit_price": 3500, "total": 2450000},
                {"description": "QA Testing Services", "quantity": 300, "unit_price": 2500, "total": 750000},
                {"description": "Project Management", "quantity": 100, "unit_price": 3000, "total": 300000},
            ],
            "bill_to": None, "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 93,
        },
        "po_atlas": {
            "document_type": "purchase_order", "document_number": "PO-2025-4001",
            "vendor_name": "Atlas Cloud Infrastructure Inc", "currency": "USD",
            "subtotal": 72000, "total_amount": 72000,
            "issue_date": d(40), "delivery_date": d(10), "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Cloud Compute Instance (Annual)", "quantity": 12, "unit_price": 4000, "total": 48000},
                {"description": "Managed Database Service", "quantity": 12, "unit_price": 1500, "total": 18000},
                {"description": "CDN & Storage", "quantity": 12, "unit_price": 500, "total": 6000},
            ],
            "bill_to": None, "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 91,
        },
        "po_pinnacle_maint": {
            "document_type": "purchase_order", "document_number": "PO-2025-6001",
            "vendor_name": "Pinnacle Industrial Services", "currency": "USD",
            "subtotal": 35000, "total_amount": 35000,
            "issue_date": d(55), "delivery_date": d(25), "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Annual Maintenance Contract", "quantity": 1, "unit_price": 20000, "total": 20000},
                {"description": "Emergency Repair Services", "quantity": 10, "unit_price": 1500, "total": 15000},
            ],
            "bill_to": None, "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 88,
        },
        "po_pinnacle_parts": {
            "document_type": "purchase_order", "document_number": "PO-2025-6002",
            "vendor_name": "Pinnacle Industrial Services", "currency": "USD",
            "subtotal": 12000, "total_amount": 12000,
            "issue_date": d(40), "delivery_date": d(10), "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Replacement Parts Kit", "quantity": 6, "unit_price": 2000, "total": 12000},
            ],
            "bill_to": None, "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 90,
        },

        # ═══════════════════════ INVOICES: CLEAN → AUTO_APPROVE ═══════════════════════
        "inv_meridian_office": {
            "document_type": "invoice", "document_number": "INV-2025-001",
            "vendor_name": "Meridian Supply Group LLC", "currency": "USD",
            "subtotal": 25000, "total_amount": 25000,
            "issue_date": d(14), "due_date": dfwd(15), "po_reference": "PO-2025-1001",
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Office Furniture Set", "quantity": 10, "unit_price": 1500, "total": 15000},
                {"description": "Ergonomic Desk Chair", "quantity": 20, "unit_price": 500, "total": 10000},
            ],
            "bill_to": "Acme Corporation", "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 95,
        },
        "inv_techvista_dev_jan": {
            "document_type": "invoice", "document_number": "TV-INV-2025-0042",
            "vendor_name": "TechVista Solutions Pvt Ltd", "currency": "INR",
            "subtotal": 1800000, "total_amount": 2124000,
            "issue_date": d(12), "due_date": dfwd(5), "po_reference": "PO-2025-2001",
            "tax_details": [{"type": "CGST", "rate": 9, "amount": 162000}, {"type": "SGST", "rate": 9, "amount": 162000}],
            "payment_terms": "Net 45",
            "line_items": [
                {"description": "Software Development Services", "quantity": 400, "unit_price": 3500, "total": 1400000},
                {"description": "QA Testing Services", "quantity": 160, "unit_price": 2500, "total": 400000},
            ],
            "bill_to": "Acme Corporation", "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 93,
        },
        "inv_meridian_it_batch": {
            "document_type": "invoice", "document_number": "INV-2025-004",
            "vendor_name": "Meridian Supply Group LLC", "currency": "USD",
            "subtotal": 22500, "total_amount": 22500,
            "issue_date": d(10), "due_date": dfwd(10), "po_reference": "PO-2025-1002",
            "tax_details": [], "payment_terms": "2/10 Net 30",
            "line_items": [
                {"description": "Dell Latitude Laptop", "quantity": 8, "unit_price": 1800, "total": 14400},
                {"description": "Monitor 27-inch 4K", "quantity": 8, "unit_price": 600, "total": 4800},
                {"description": "Docking Station USB-C", "quantity": 8, "unit_price": 200, "total": 1600},
                {"description": "Wireless Keyboard Mouse Set", "quantity": 8, "unit_price": 80, "total": 640},
                {"description": "Laptop Bag Premium", "quantity": 8, "unit_price": 120, "total": 960},
                {"description": "Setup & Configuration", "quantity": 1, "unit_price": 100, "total": 100},
            ],
            "bill_to": "Acme Corporation", "notes": None,
            "early_payment_discount": {"discount_percent": 2, "days": 10},
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 92,
        },

        # ═══════════════════════ INVOICES: REVIEW ═══════════════════════
        "inv_atlas_cloud_overcharge": {
            "document_type": "invoice", "document_number": "AC-INV-2025-0112",
            "vendor_name": "Atlas Cloud Infrastructure Inc", "currency": "USD",
            "subtotal": 76500, "total_amount": 76500,
            "issue_date": d(5), "due_date": dfwd(5), "po_reference": "PO-2025-4001",
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Cloud Compute Instance (Annual)", "quantity": 12, "unit_price": 4250, "total": 51000},
                {"description": "Managed Database Service", "quantity": 12, "unit_price": 1500, "total": 18000},
                {"description": "CDN & Storage", "quantity": 12, "unit_price": 625, "total": 7500},
            ],
            "bill_to": "Acme Corporation", "notes": "Rate adjustment applied per Q1 review",
            "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 91,
        },
        "inv_techvista_feb_igst": {
            "document_type": "invoice", "document_number": "TV-INV-2025-0056",
            "vendor_name": "TechVista Solutions Pvt Ltd", "currency": "INR",
            "subtotal": 1200000, "total_amount": 1416000,
            "issue_date": d(1), "due_date": dfwd(1), "po_reference": "PO-2025-2001",
            "tax_details": [{"type": "IGST", "rate": 18, "amount": 216000}],
            "payment_terms": "Net 45",
            "line_items": [
                {"description": "Software Development Services", "quantity": 300, "unit_price": 3500, "total": 1050000},
                {"description": "Project Management", "quantity": 50, "unit_price": 3000, "total": 150000},
            ],
            "bill_to": "Acme Corporation", "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 92,
        },
        "inv_atlas_no_po": {
            "document_type": "invoice", "document_number": "AC-INV-2025-0145",
            "vendor_name": "Atlas Cloud Infrastructure Inc", "currency": "USD",
            "subtotal": 23000, "total_amount": 23000,
            "issue_date": d(1), "due_date": dfwd(2), "po_reference": None,
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Premium Support Package", "quantity": 1, "unit_price": 18000, "total": 18000},
                {"description": "Data Migration Service", "quantity": 1, "unit_price": 5000, "total": 5000},
            ],
            "bill_to": "Acme Corporation",
            "notes": "Standalone service — no PO required per verbal agreement",
            "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 90,
        },

        # ═══════════════════════ INVOICES: BLOCK ═══════════════════════
        "inv_pinnacle_expired": {
            "document_type": "invoice", "document_number": "PIN-2025-0033",
            "vendor_name": "Pinnacle Industrial Services", "currency": "USD",
            "subtotal": 22500, "total_amount": 22500,
            "issue_date": d(4), "due_date": dfwd(10), "po_reference": "PO-2025-6001",
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Annual Maintenance Contract", "quantity": 1, "unit_price": 20000, "total": 20000},
                {"description": "Emergency Repair Services", "quantity": 1, "unit_price": 2500, "total": 2500},
            ],
            "bill_to": "Acme Corporation", "notes": "Service period: January 2025",
            "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 90,
        },
        "inv_pinnacle_over": {
            "document_type": "invoice", "document_number": "PIN-2025-0041",
            "vendor_name": "Pinnacle Industrial Services", "currency": "USD",
            "subtotal": 14500, "total_amount": 14500,
            "issue_date": d(2), "due_date": dfwd(3), "po_reference": "PO-2025-6002",
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Replacement Parts Kit", "quantity": 6, "unit_price": 2000, "total": 12000},
                {"description": "Expedited Shipping", "quantity": 1, "unit_price": 2500, "total": 2500},
            ],
            "bill_to": "Acme Corporation", "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 89,
        },
        "inv_gulf_freight_original": {
            "document_type": "invoice", "document_number": "GT-2025-0456",
            "vendor_name": "Gulf Trading & Logistics FZE", "currency": "AED",
            "subtotal": 95000, "total_amount": 95000,
            "issue_date": d(25), "due_date": dfwd(5), "po_reference": "PO-2025-7001",
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Freight Forwarding Services", "quantity": 10, "unit_price": 5000, "total": 50000},
                {"description": "Customs Brokerage", "quantity": 10, "unit_price": 2500, "total": 25000},
                {"description": "Warehouse Storage (Monthly)", "quantity": 4, "unit_price": 5000, "total": 20000},
            ],
            "bill_to": "Acme Corporation", "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 88,
        },
        "inv_gulf_freight_duplicate": {
            "document_type": "invoice", "document_number": "GT-2025-0456",
            "vendor_name": "Gulf Trading & Logistics FZE", "currency": "AED",
            "subtotal": 95000, "total_amount": 95000,
            "issue_date": d(2), "due_date": dfwd(5), "po_reference": "PO-2025-7001",
            "tax_details": [], "payment_terms": "Net 30",
            "line_items": [
                {"description": "Freight Forwarding Services", "quantity": 10, "unit_price": 5000, "total": 50000},
                {"description": "Customs Brokerage", "quantity": 10, "unit_price": 2500, "total": 25000},
                {"description": "Warehouse Storage (Monthly)", "quantity": 4, "unit_price": 5000, "total": 20000},
            ],
            "bill_to": "Acme Corporation",
            "notes": "Resubmitted per accounts department request",
            "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 87,
        },

        # ═══════════════════════ CREDIT NOTE ═══════════════════════
        "cn_gulf": {
            "document_type": "credit_note", "document_number": "GT-CN-2025-0012",
            "vendor_name": "Gulf Trading & Logistics FZE", "currency": "AED",
            "subtotal": 15000, "total_amount": 15000,
            "issue_date": d(1), "tax_details": [], "payment_terms": None,
            "original_invoice_ref": "GT-2025-0456",
            "line_items": [
                {"description": "Warehouse Storage Overcharge Refund", "quantity": 2, "unit_price": 5000, "total": 10000},
                {"description": "Customs Brokerage Error Correction", "quantity": 2, "unit_price": 2500, "total": 5000},
            ],
            "bill_to": "Acme Corporation", "notes": None, "early_payment_discount": None,
            "pricing_terms": [], "contract_terms": {}, "parties": [],
            "_confidence": 90,
        },
    }


# ============================================================
# MATCHING (multi-invoice PO, vendor normalization)
# ============================================================
def get_po_fulfillment(po_id, matches, invoices):
    inv_ids = [m["invoiceId"] for m in matches if m.get("poId") == po_id]
    return sum(i.get("subtotal", i["amount"]) for i in invoices if i["id"] in inv_ids), len(inv_ids)

def match_invoice_to_po(invoice, purchase_orders, existing_matches, all_invoices):
    best, best_score = None, 0
    inv_subtotal = _n(invoice.get("subtotal") or invoice.get("amount"))

    for po in purchase_orders:
        score, signals = 0, []

        # PO reference
        if invoice.get("poReference") and invoice["poReference"] == po.get("poNumber"):
            score += 50; signals.append("po_reference_exact")

        # Vendor (fuzzy)
        vs = vendor_similarity(invoice.get("vendor"), po.get("vendor"))
        if vs >= 0.95: score += 25; signals.append("vendor_exact")
        elif vs >= 0.7: score += 15; signals.append("vendor_partial")

        # Amount (compare invoice SUBTOTAL vs PO amount — tax-aware)
        pa = _n(po.get("amount"))
        already, cnt = get_po_fulfillment(po["id"], existing_matches, all_invoices)
        remaining = pa - already

        if inv_subtotal > 0 and pa > 0:
            target = remaining if remaining > 0 else pa
            dp = abs(inv_subtotal - target) / max(inv_subtotal, target)
            if dp < 0.02: score += 20; signals.append("amount_near_exact")
            elif dp < 0.10: score += 12; signals.append("amount_close")
            elif dp < 0.25: score += 5; signals.append("amount_approximate")
            if remaining > 0 and inv_subtotal <= remaining * 1.1:
                score += 5; signals.append("within_po_budget")

        # Line items
        inv_set = set(((li.get("description") or "")).lower() for li in invoice.get("lineItems", []))
        po_set = set(((li.get("description") or "")).lower() for li in po.get("lineItems", []))
        if inv_set and po_set:
            if len(inv_set & po_set) / max(len(inv_set), len(po_set)) > 0.5:
                score += 10; signals.append("line_items_overlap")

        ns = min(100, score)
        over = (already + inv_subtotal) > pa * (1 + OVER_INVOICE_PCT / 100) if pa > 0 else False
        # Invoice exceeds PO at all — even below the OVER_INVOICE_PCT flag threshold
        exceeds_po = (already + inv_subtotal) > pa * 1.005 if pa > 0 else False  # 0.5% tolerance for rounding

        # Match status: high score = correct PO identified, but over-billing needs human review
        match_status = "auto_matched" if ns >= 75 else "review_needed"
        if over or exceeds_po:
            match_status = "review_needed"  # Never auto-match when invoice exceeds PO

        if ns > best_score and ns >= 40:
            best_score = ns
            best = {"poId": po["id"], "poNumber": po["poNumber"], "poAmount": pa,
                "matchScore": ns, "signals": signals,
                "amountDifference": round(abs(inv_subtotal - (remaining if remaining > 0 else pa)), 2),
                "status": match_status,
                "poAlreadyInvoiced": round(already, 2), "poRemaining": round(remaining, 2),
                "poInvoiceCount": cnt, "overInvoiced": over}
    return best

def find_vendor_contract(vendor, contracts):
    best, best_sim = None, 0
    for c in contracts:
        s = vendor_similarity(vendor, c.get("vendor"))
        if s > best_sim and s >= 0.7:
            best = c; best_sim = s
    return best

def run_matching(db):
    matched_ids = {m["invoiceId"] for m in db["matches"]}
    unmatched = [i for i in db["invoices"] if i["id"] not in matched_ids]
    new = []
    for inv in unmatched:
        r = match_invoice_to_po(inv, db["purchase_orders"], db["matches"] + new, db["invoices"])
        if r:
            # Enrich with GRN data for three-way matching
            grn_info = get_grn_for_po(r["poId"], db.get("goods_receipts", []), db["purchase_orders"])
            r.update(grn_info)
            new.append({"id": str(uuid.uuid4())[:8].upper(), "invoiceId": inv["id"],
                "invoiceNumber": inv.get("invoiceNumber", ""), "invoiceAmount": inv["amount"],
                "invoiceSubtotal": inv.get("subtotal", inv["amount"]),
                "vendor": inv["vendor"], "matchedAt": datetime.now().isoformat(), **r})
    return new


# ============================================================
# THREE-WAY MATCHING: PO ↔ GRN ↔ INVOICE
# ============================================================
def get_grn_for_po(po_id: str, goods_receipts: list, purchase_orders: list = None) -> dict:
    """Find GRN(s) linked to a PO and compute three-way match status.

    Three-way match = PO authorized it, GRN proves it was received, Invoice bills for it.
    Without GRN, it's a two-way match (PO + Invoice) which is weaker assurance.

    Returns dict with GRN info to merge into match record.
    """
    # Build set of identifiers for this PO (both ID and poNumber)
    po_identifiers = {po_id}
    if purchase_orders:
        for po in purchase_orders:
            if po["id"] == po_id:
                pn = po.get("poNumber", "")
                if pn:
                    po_identifiers.add(pn)
                break

    # Find GRNs referencing this PO by poReference matching either ID or poNumber
    linked_grns = []
    for grn in goods_receipts:
        grn_ref = grn.get("poReference", "")
        if grn_ref and grn_ref in po_identifiers:
            linked_grns.append(grn)

    if not linked_grns:
        return {
            "matchType": "two_way",   # PO + Invoice only
            "grnStatus": "no_grn",    # No goods receipt on file
            "grnIds": [],
            "grnNumbers": [],
            "totalReceived": 0,
            "grnLineItems": [],
        }

    # Aggregate received quantities across all GRNs for this PO
    total_received = sum(grn.get("amount", 0) or grn.get("subtotal", 0) or 0 for grn in linked_grns)
    grn_line_items = []
    for grn in linked_grns:
        for li in grn.get("lineItems", []):
            grn_line_items.append({
                "description": li.get("description", ""),
                "quantityReceived": li.get("quantity", 0),
                "grnNumber": grn.get("grnNumber", grn.get("id", "?")),
                "receivedDate": grn.get("receivedDate", grn.get("issueDate")),
            })

    return {
        "matchType": "three_way",  # PO + GRN + Invoice
        "grnStatus": "received",
        "grnIds": [g["id"] for g in linked_grns],
        "grnNumbers": [g.get("grnNumber", g["id"]) for g in linked_grns],
        "totalReceived": round(total_received, 2),
        "grnLineItems": grn_line_items,
        "receivedDate": linked_grns[-1].get("receivedDate") or linked_grns[-1].get("issueDate"),
    }


def run_grn_matching(db):
    """Match GRNs to POs and update existing match records with three-way status.
    Called when a GRN is uploaded."""
    updated = 0
    grns = db.get("goods_receipts", [])
    if not grns:
        return 0

    for match in db["matches"]:
        if match.get("matchType") == "three_way":
            continue  # Already three-way matched
        po_id = match.get("poId")
        if not po_id:
            continue
        grn_info = get_grn_for_po(po_id, grns, db.get("purchase_orders", []))
        if grn_info["matchType"] == "three_way":
            match.update(grn_info)
            updated += 1

    return updated


def detect_grn_anomalies(invoice: dict, po: dict, grn_info: dict, db: dict) -> list:
    """Detect anomalies specific to three-way matching.

    These are F&A-critical checks that only fire when a GRN exists:
    - UNRECEIPTED_INVOICE: Invoice billed but goods never received
    - SHORT_SHIPMENT: GRN qty < PO qty (vendor didn't deliver everything)
    - QUANTITY_RECEIVED_MISMATCH: Invoice qty > GRN received qty (billing for more than received)
    - OVERBILLED_VS_RECEIVED: Invoice amount > GRN received value
    """
    anomalies = []
    cur = invoice.get("currency", "USD")
    sym = currency_symbol(cur)
    inv_subtotal = float(invoice.get("subtotal") or invoice.get("amount") or 0)

    # Check 1: Invoice exists but no GRN at all → flag as unreceipted
    # Only flag if matching_mode requires GRN (three_way or flexible)
    policy = get_policy()
    matching_mode = policy["matching_mode"]
    if grn_info.get("grnStatus") == "no_grn" and po:
        if matching_mode in ("three_way", "flexible"):
            anomalies.append({
                "type": "UNRECEIPTED_INVOICE",
                "severity": "high" if matching_mode == "three_way" else "medium",
                "description": f"Invoice {invoice.get('invoiceNumber', '?')} has no goods receipt (GRN) on file. Cannot confirm goods/services were received.",
                "amount_at_risk": inv_subtotal,
                "contract_clause": "Three-way match policy: No payment without receipt confirmation",
                "recommendation": "Upload GRN/delivery note to confirm receipt before approving payment."
            })
        return anomalies  # No point checking line items without GRN

    if grn_info.get("grnStatus") != "received":
        return anomalies

    # Check 2: Invoice amount vs received amount
    total_received = grn_info.get("totalReceived", 0)
    grn_amt_tol = policy.get("grn_amount_tolerance_pct", 2) / 100
    if total_received > 0 and inv_subtotal > total_received * (1 + grn_amt_tol):
        diff = inv_subtotal - total_received
        anomalies.append({
            "type": "OVERBILLED_VS_RECEIVED",
            "severity": "high" if diff > inv_subtotal * 0.1 else "medium",
            "description": f"Invoice subtotal ({sym}{inv_subtotal:,.2f}) exceeds total received value ({sym}{total_received:,.2f}) by {sym}{diff:,.2f}.",
            "amount_at_risk": round(diff, 2),
            "contract_clause": "Three-way match: pay only for goods/services actually received",
            "recommendation": f"Reduce invoice to match received value ({sym}{total_received:,.2f}) or obtain additional GRN."
        })

    # Check 3: Line-item level — quantity billed vs quantity received
    inv_items = {(li.get("description") or "").lower().strip(): li for li in invoice.get("lineItems", [])}
    grn_items_agg = {}  # Aggregate received quantities per description
    for gli in grn_info.get("grnLineItems", []):
        desc = (gli.get("description") or "").lower().strip()
        grn_items_agg[desc] = grn_items_agg.get(desc, 0) + float(gli.get("quantityReceived") or 0)

    for desc, inv_li in inv_items.items():
        inv_qty = float(inv_li.get("quantity") or 0)
        if inv_qty <= 0:
            continue

        # Find matching GRN line (fuzzy)
        best_grn_qty = 0
        best_match_desc = None
        for grn_desc, grn_qty in grn_items_agg.items():
            from difflib import SequenceMatcher
            sim = SequenceMatcher(None, desc, grn_desc).ratio()
            if sim > 0.6 or desc in grn_desc or grn_desc in desc:
                best_grn_qty = grn_qty
                best_match_desc = grn_desc
                break

        grn_qty_tol = policy.get("grn_qty_tolerance_pct", 2) / 100
        if best_match_desc is not None and inv_qty > best_grn_qty * (1 + grn_qty_tol):
            excess = inv_qty - best_grn_qty
            unit_price = float(inv_li.get("unitPrice") or 0)
            risk = excess * unit_price
            anomalies.append({
                "type": "QUANTITY_RECEIVED_MISMATCH",
                "severity": "high" if risk > inv_subtotal * 0.05 else "medium",
                "description": f"'{inv_li.get('description')}': billed {inv_qty:.0f} units but only {best_grn_qty:.0f} received (excess: {excess:.0f}).",
                "amount_at_risk": round(risk, 2),
                "contract_clause": "Three-way match: bill only for quantities actually received",
                "recommendation": f"Reduce billed quantity to {best_grn_qty:.0f} or provide proof of additional delivery."
            })

    # Check 4: PO qty vs GRN qty (short shipment — informational for AP)
    if po:
        po_amt = float(po.get("amount") or 0)
        short_threshold = policy.get("short_shipment_threshold_pct", 90) / 100
        if total_received > 0 and po_amt > 0 and total_received < po_amt * short_threshold:
            short_pct = round((1 - total_received / po_amt) * 100, 1)
            anomalies.append({
                "type": "SHORT_SHIPMENT",
                "severity": "low",
                "description": f"Only {sym}{total_received:,.2f} of {sym}{po_amt:,.2f} PO value received ({short_pct}% short). Partial delivery.",
                "amount_at_risk": 0,  # Informational — not a risk per se
                "contract_clause": "PO fulfillment tracking",
                "recommendation": f"Track remaining delivery. {short_pct}% of PO value outstanding."
            })

    return anomalies


# ============================================================
# RECORD TRANSFORMATION
# ============================================================
def transform_extracted_to_record(extracted, file_name, file_id):
    dt = extracted.get("document_type", "invoice")
    li = [{"description": l.get("description") or "?", "quantity": float(l.get("quantity") or 0),
        "unitPrice": float(l.get("unit_price") or l.get("unitPrice") or 0), "total": float(l.get("total") or 0)
    } for l in (extracted.get("line_items") or [])]

    subtotal = extracted.get("subtotal") or extracted.get("total_amount") or 0
    subtotal = float(subtotal) if subtotal is not None else 0
    total = extracted.get("total_amount") or subtotal or 0
    total = float(total) if total is not None else 0

    tax_details = []
    for t in extracted.get("tax_details", []) or []:
        tax_details.append({"type": t.get("type", "Tax"), "rate": float(t.get("rate") or 0), "amount": float(t.get("amount") or 0)})

    # ── Multi-Factor Confidence Scoring ──
    confidence, confidence_factors = compute_extraction_confidence(extracted, li, subtotal, total, tax_details, dt)

    base = {"id": file_id, "type": dt, "documentName": file_name,
        "vendor": extracted.get("vendor_name") or "Unknown",
        "vendorNormalized": normalize_vendor(extracted.get("vendor_name") or ""),
        "amount": total, "subtotal": subtotal,
        "taxDetails": tax_details, "totalTax": sum(t["amount"] for t in tax_details),
        "issueDate": extracted.get("issue_date"), "status": "pending", "lineItems": li,
        "confidence": confidence, "confidenceFactors": confidence_factors,
        "extractionSource": extracted.get("_source", "unknown"),
        "extractedAt": datetime.now().isoformat(), "currency": extracted.get("currency") or "USD",
        "paymentTerms": extracted.get("payment_terms"), "notes": extracted.get("notes"),
        "earlyPaymentDiscount": extracted.get("early_payment_discount"),
        "uploadedFile": f"{file_id}_{file_name}",
        "uploadedBy": None, "uploadedByEmail": None}

    if dt == "invoice":
        base.update({"status": "unpaid", "invoiceNumber": extracted.get("document_number", f"INV-{file_id}"),
            "poReference": extracted.get("po_reference"), "dueDate": extracted.get("due_date")})
    elif dt == "purchase_order":
        base.update({"status": "open", "poNumber": extracted.get("document_number", f"PO-{file_id}"),
            "deliveryDate": extracted.get("delivery_date")})
    elif dt == "contract":
        base.update({"status": "active", "contractNumber": extracted.get("document_number", f"AGR-{file_id}"),
            "pricingTerms": extracted.get("pricing_terms") or [], "contractTerms": extracted.get("contract_terms") or {},
            "parties": extracted.get("parties", [])})
    elif dt in ("credit_note", "debit_note"):
        base.update({"status": "pending",
            "documentNumber": extracted.get("document_number", f"{'CN' if dt == 'credit_note' else 'DN'}-{file_id}"),
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
    """
    Multi-factor extraction confidence scoring (0-100).

    Evaluates 7 independent quality signals from the extracted data, each scoring 0-100.
    Final score = weighted average, penalized for critical missing fields.

    Returns (score, factors_dict) for auditability.
    """
    factors = {}

    # ── Factor 1: Field Completeness (weight: 25%) ──
    # Are the required fields present and non-null?
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

    # ── Factor 2: Line Item Integrity (weight: 20%) ──
    # Do line items have descriptions, valid quantities, prices, and totals?
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
                valid_items += 0.5  # Partial credit
        li_score = round((valid_items / len(line_items)) * 100)
        li_detail = f"{valid_items}/{len(line_items)} line items fully valid"
    else:
        li_score = 30 if doc_type == "contract" else 40  # Contracts may not have line items
        li_detail = "No line items extracted"
    factors["line_item_integrity"] = {"score": li_score, "weight": 0.20, "detail": li_detail}

    # ── Factor 3: Mathematical Consistency (weight: 20%) ──
    # Does subtotal = sum(line_item_totals)? Does total = subtotal + taxes?
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

    # ── Factor 4: Date Validity (weight: 10%) ──
    # Are dates parseable and reasonable?
    date_score = 100
    date_issues = []
    date_fields = ["issue_date", "due_date"]
    if doc_type == "contract":
        ct = extracted.get("contract_terms") or {}
        date_fields_vals = [ct.get("effective_date"), ct.get("expiry_date")]
    else:
        date_fields_vals = [extracted.get(f) for f in date_fields]

    for dval in date_fields_vals:
        if dval:
            try:
                d = datetime.fromisoformat(str(dval).replace("Z", "+00:00"))
                # Check: date not in the distant past (before 2020) or far future (after 2030)
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

    # ── Factor 5: Amount Plausibility (weight: 10%) ──
    # Is the total amount a reasonable number (not negative, not zero for invoices, not absurdly large)?
    amt_score = 100
    amt_issues = []
    if total <= 0 and doc_type in ("invoice", "purchase_order"):
        amt_score = 20
        amt_issues.append(f"Total amount is {total} — expected positive")
    elif total > 100_000_000:  # >100M might be a parsing error
        amt_score = 50
        amt_issues.append(f"Unusually large amount: {total:,.2f}")

    # Check: unit prices shouldn't be negative
    neg_prices = [li for li in line_items if (li.get("unitPrice") or 0) < 0]
    if neg_prices:
        amt_score -= 25
        amt_issues.append(f"{len(neg_prices)} line items with negative unit prices")

    amt_score = max(0, amt_score)
    factors["amount_plausibility"] = {
        "score": amt_score, "weight": 0.10,
        "detail": "; ".join(amt_issues) if amt_issues else "Amounts plausible"
    }

    # ── Factor 6: Vendor Identification (weight: 10%) ──
    # Is the vendor name meaningful (not "Unknown", not just numbers)?
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

    # ── Factor 7: AI Self-Assessment (weight: 5%) ──
    # Claude's own extraction_confidence as a secondary signal (low weight)
    ai_conf = extracted.get("_confidence") or extracted.get("extraction_confidence") or 85
    ai_conf = float(ai_conf) if ai_conf is not None else 85
    factors["ai_self_assessment"] = {
        "score": round(float(ai_conf)), "weight": 0.05,
        "detail": f"AI model self-reported: {ai_conf}%"
    }

    # ── Weighted Composite ──
    weighted_sum = sum(f["score"] * f["weight"] for f in factors.values())
    final_score = round(max(0, min(100, weighted_sum)), 1)

    # ── Critical field penalty: if vendor or total is missing, hard cap at 60 ──
    if not vendor or vendor.lower() in ("unknown", "n/a"):
        final_score = min(final_score, 55)
    if total <= 0 and doc_type in ("invoice", "purchase_order"):
        final_score = min(final_score, 50)

    return final_score, factors


# ============================================================
# ROUTES
# ============================================================
@app.get("/api/health")
async def health():
    return {"status": "ok", "product": "AuditLens",
        "claude_api": "connected" if USE_REAL_API else "mock_mode", "version": "2.5.0",
        "features": {"agentic_triage": TRIAGE_ENABLED, "vendor_risk_scoring": True,
            "delegation_of_authority": True, "three_way_matching": True,
            "policy_engine": True, "authentication": AUTH_ENABLED,
            "rag_feedback_loop": RAG_ENABLED}}

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
POLICY_PRESETS = {
    "manufacturing": {
        "name": "Manufacturing / Procurement",
        "description": "Strict three-way matching, tight tolerances for physical goods",
        "matching_mode": "three_way",
        "amount_tolerance_pct": 1, "price_tolerance_pct": 0.5, "over_invoice_pct": 1,
        "grn_qty_tolerance_pct": 1, "grn_amount_tolerance_pct": 1,
        "short_shipment_threshold_pct": 95,
        "duplicate_window_days": 180,
        "auto_approve_min_confidence": 90,
        "require_grn_for_auto_approve": True,
        "flag_round_number_invoices": True,
    },
    "services": {
        "name": "Services / SaaS / Consulting",
        "description": "Two-way matching, no GRN required, wider tolerances for service invoices",
        "matching_mode": "two_way",
        "amount_tolerance_pct": 3, "price_tolerance_pct": 2, "over_invoice_pct": 5,
        "duplicate_window_days": 90,
        "auto_approve_min_confidence": 80,
        "require_grn_for_auto_approve": False,
        "flag_round_number_invoices": False,
    },
    "enterprise_default": {
        "name": "Enterprise Default",
        "description": "Flexible matching — three-way when GRN available, two-way otherwise",
        "matching_mode": "flexible",
        "amount_tolerance_pct": 2, "price_tolerance_pct": 1, "over_invoice_pct": 2,
        "grn_qty_tolerance_pct": 2, "grn_amount_tolerance_pct": 2,
        "short_shipment_threshold_pct": 90,
        "duplicate_window_days": 90,
        "auto_approve_min_confidence": 85,
        "require_grn_for_auto_approve": False,
    },
    "strict_audit": {
        "name": "Strict Audit / Regulated Industry",
        "description": "Maximum controls — three-way required, low auto-approve threshold, tight tolerances",
        "matching_mode": "three_way",
        "amount_tolerance_pct": 0.5, "price_tolerance_pct": 0.5, "over_invoice_pct": 0.5,
        "grn_qty_tolerance_pct": 0.5, "grn_amount_tolerance_pct": 0.5,
        "short_shipment_threshold_pct": 98,
        "duplicate_window_days": 365,
        "auto_approve_min_confidence": 95,
        "auto_approve_max_vendor_risk": 25,
        "block_min_vendor_risk": 50,
        "require_grn_for_auto_approve": True,
        "flag_round_number_invoices": True,
        "flag_weekend_invoices": True,
        "max_invoice_age_days": 180,
    },
}

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
        "api_mode": "claude_api" if USE_REAL_API else "mock_extraction",
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

    # File not on disk — try persistent storage (Postgres)
    content, content_type = load_uploaded_file(filename)
    if content:
        from fastapi.responses import Response
        return Response(content=content, media_type=content_type)

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
    print(f"\nStarting AuditLens v2.5 on port {port}")
    print(f"Claude API: {'Connected' if USE_REAL_API else 'Mock Mode'}")
    print(f"Triage: {'Enabled' if TRIAGE_ENABLED else 'Disabled'}")
    print(f"Vendor Risk Scoring: Enabled")
    uvicorn.run(app, host="0.0.0.0", port=port)
