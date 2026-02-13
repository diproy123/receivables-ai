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
    """Extract user from JWT in Authorization header. Returns empty dict if no auth."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            payload = decode_jwt(auth[7:])
            return {"id": payload["sub"], "email": payload["email"],
                    "name": payload["name"], "role": payload["role"], "authenticated": True}
        except: pass
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
    """Dependency: return user if authenticated, else default."""
    user = _user_from_request(request)
    if user:
        return user
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

def get_user_display(request: Request) -> tuple:
    """Get (name, email) for audit trail."""
    user = _user_from_request(request)
    if user:
        return user.get("name", "Unknown"), user.get("email", "")
    return request.headers.get("X-User-Name", "System"), ""

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
