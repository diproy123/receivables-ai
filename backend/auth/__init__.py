"""
AuditLens — Authentication & RBAC
JWT tokens, password hashing, role-based access control, authority limits.
"""
import os, json, uuid
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from backend.config import (
    JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRY_HOURS, AUTH_ENABLED,
    AUTHORITY_MATRIX, DEFAULT_ROLE, DATA_DIR
)

# ============================================================
# PASSWORD HASHING
# ============================================================
import bcrypt

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

# ============================================================
# JWT
# ============================================================
import jwt as pyjwt

def create_jwt(user: dict) -> str:
    payload = {
        "sub": user["id"], "email": user["email"], "name": user["name"],
        "role": user["role"],
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.utcnow()
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_jwt(token: str) -> dict:
    try:
        return pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

# ============================================================
# USER STORE (stored in main DB for consistency with reset/export)
# ============================================================

def _get_users() -> list:
    from backend.db import get_db
    db = get_db()
    return db.get("users", [])

def _save_users(users: list):
    from backend.db import get_db, save_db
    db = get_db()
    db["users"] = users
    save_db(db)

# ============================================================
# REQUEST HELPERS
# ============================================================
security = HTTPBearer(auto_error=False)

def _user_from_request(request: Request) -> dict:
    """Extract user from JWT (Authorization: Bearer) or API key (X-API-Key).
    Returns empty dict if no valid auth found.
    API keys are checked against stored hashes — compatible with all existing endpoints.
    """
    # 1. Try JWT first (existing auth flow)
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            payload = decode_jwt(auth[7:])
            return {"id": payload["sub"], "email": payload["email"],
                    "name": payload["name"], "role": payload["role"], "authenticated": True}
        except: pass

    # 2. Try API key (X-API-Key header — for ERP/middleware integration)
    api_key = request.headers.get("X-API-Key", "")
    if api_key and api_key.startswith("alens_"):
        try:
            from backend.integration import authenticate_api_key
            from backend.db import get_db
            db = get_db()
            user = authenticate_api_key(api_key, db)
            if user:
                return user
        except Exception:
            pass  # Integration module not loaded or DB error — fall through

    return {}

async def get_current_user(request: Request) -> dict:
    """Dependency: require authenticated user."""
    user = _user_from_request(request)
    if user:
        return user
    # Check header-based auth (for backward compat)
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        raise HTTPException(401, "Invalid or expired token")
    raise HTTPException(401, "Authentication required")

async def get_optional_user(request: Request) -> dict:
    """Dependency: return user if authenticated, else default.
    When AUTH_ENABLED, ignores X-User-Role header to prevent privilege spoofing.
    """
    user = _user_from_request(request)
    if user:
        return user
    # When auth is enabled, always return default analyst role — don't trust headers
    if AUTH_ENABLED:
        return {"id": "anonymous", "email": "", "name": "Anonymous",
                "role": DEFAULT_ROLE, "authenticated": False}
    # Auth disabled: allow header-based role selection (dev/demo mode)
    role = request.headers.get("X-User-Role", DEFAULT_ROLE).lower()
    if role not in AUTHORITY_MATRIX:
        role = DEFAULT_ROLE
    return {"id": "anonymous", "email": "", "name": "Anonymous",
            "role": role, "authenticated": False}

def get_role_from_request(request: Request) -> str:
    """Get the role from JWT or header."""
    user = _user_from_request(request)
    if user:
        return user["role"]
    role = request.headers.get("X-User-Role", DEFAULT_ROLE).lower()
    if role not in AUTHORITY_MATRIX:
        return DEFAULT_ROLE
    return role

def get_user_display(request: Request) -> str:
    """Get display name for audit trail."""
    user = _user_from_request(request)
    if user:
        return user.get("name", "Unknown")
    return request.headers.get("X-User-Name", "System")

# ============================================================
# AUTHORITY
# ============================================================
def get_authority_limit(role: str, currency: str = "USD") -> float:
    info = AUTHORITY_MATRIX.get(role, AUTHORITY_MATRIX[DEFAULT_ROLE])
    return info["limits"].get(currency, info["limits"]["default"])

def get_required_approver(amount: float, currency: str = "USD") -> dict:
    for role in ["analyst", "manager", "vp", "cfo"]:
        if amount <= get_authority_limit(role, currency):
            return {"role": role, "title": AUTHORITY_MATRIX[role]["title"],
                    "limit": get_authority_limit(role, currency)}
    return {"role": "cfo", "title": "CFO", "limit": get_authority_limit("cfo", currency)}

# ============================================================
# VENDOR-SCOPED DATA ACCESS
# ============================================================
def get_user_vendor_scope(user: dict) -> list:
    """Return list of normalized vendor names this user can see.
    Empty list = full access (managers, VP, CFO, or unscoped analysts for backward compat).
    Non-empty list = filter all data to these vendors only.
    Special: ["__NONE__"] = no access at all (unauthenticated users when auth is enabled).
    """
    # When auth is enabled, unauthenticated users get NO data
    if AUTH_ENABLED and not user.get("authenticated", False):
        return ["__NONE__"]
    role = user.get("role", DEFAULT_ROLE)
    # Manager+ sees everything
    if AUTHORITY_MATRIX.get(role, AUTHORITY_MATRIX[DEFAULT_ROLE])["level"] >= 2:
        return []
    # Analyst: check assignedVendors (stored as normalized names)
    users = _get_users()
    stored = next((u for u in users if u["id"] == user.get("id")), None)
    if stored and stored.get("assignedVendors"):
        return stored["assignedVendors"]
    # No assignment yet = full access (backward compat during rollout)
    return []

def scope_by_vendor(records: list, vendor_scope: list, vendor_key: str = "vendor") -> list:
    """Filter a list of records by vendor scope. Empty scope = no filter.
    Uses normalize_vendor on both sides so 'GoldPak Industries Ltd.' matches 'goldpak industries'.
    """
    if not vendor_scope:
        return records
    from backend.vendor import normalize_vendor
    scope_normalized = set(normalize_vendor(v) for v in vendor_scope)
    return [r for r in records if normalize_vendor(r.get(vendor_key) or "") in scope_normalized]

def assign_vendors_to_user(user_id: str, vendor_names: list):
    """Assign vendor scope to a user. Stores normalized names. Manager+ only."""
    from backend.vendor import normalize_vendor
    normalized = [normalize_vendor(v) for v in vendor_names if normalize_vendor(v)]
    users = _get_users()
    for u in users:
        if u["id"] == user_id:
            u["assignedVendors"] = normalized
            _save_users(users)
            return u
    return None

# ============================================================
# RBAC DECORATOR
# ============================================================
def require_role(min_level: int):
    """Dependency: require minimum role level."""
    async def checker(request: Request):
        user = await get_current_user(request)
        role_info = AUTHORITY_MATRIX.get(user["role"], AUTHORITY_MATRIX[DEFAULT_ROLE])
        if role_info["level"] < min_level:
            raise HTTPException(403, f"Requires role level {min_level}+. Your role: {user['role']}")
        return user
    return checker
