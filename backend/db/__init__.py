"""
AuditLens — Database Layer
File-based JSON store with PostgreSQL upgrade path.
"""
import os, json, uuid, base64, shutil
from pathlib import Path
from datetime import datetime
from backend.config import DB_PATH, DATA_DIR, UPLOAD_DIR, PERSIST_DATA

# ============================================================
# DATABASE URL (PostgreSQL optional, file-based default)
# ============================================================
DATABASE_URL = os.environ.get("DATABASE_URL")

# ============================================================
# EMPTY DB SCHEMA
# ============================================================
EMPTY_DB = {
    "invoices": [], "purchase_orders": [], "contracts": [],
    "goods_receipts": [], "matches": [], "anomalies": [],
    "activity_log": [], "correction_patterns": [], "vendor_profiles": [],
    "users": []
}

def _fresh_db():
    """Return a fresh empty database."""
    return json.loads(json.dumps(EMPTY_DB))

# ============================================================
# FILE BACKEND
# ============================================================
_db_cache = None

def _file_load():
    global _db_cache
    if DB_PATH.exists():
        try:
            with open(DB_PATH) as f:
                _db_cache = json.load(f)
                # Ensure all collections exist
                for k, v in EMPTY_DB.items():
                    if k not in _db_cache:
                        _db_cache[k] = type(v)()
        except (json.JSONDecodeError, IOError):
            _db_cache = _fresh_db()
    else:
        _db_cache = _fresh_db()
    return _db_cache

def _file_save(db):
    global _db_cache
    _db_cache = db
    if PERSIST_DATA:
        with open(DB_PATH, "w") as f:
            json.dump(db, f, indent=2, default=str)

def _file_get():
    global _db_cache
    if _db_cache is None:
        return _file_load()
    return _db_cache

# ============================================================
# POSTGRES BACKEND (optional)
# ============================================================
_pg_pool = None

def _pg_connect():
    """Initialize PostgreSQL connection pool."""
    global _pg_pool
    if DATABASE_URL and not _pg_pool:
        try:
            import psycopg2
            from psycopg2.pool import SimpleConnectionPool
            _pg_pool = SimpleConnectionPool(1, 5, DATABASE_URL)
            _pg_init()
            print(f"[DB] Connected to PostgreSQL")
        except Exception as e:
            print(f"[DB] PostgreSQL connection failed: {e}, falling back to file")

def _pg_init():
    """Create tables if they don't exist. Migrate old schema if needed."""
    if not _pg_pool:
        return
    conn = _pg_pool.getconn()
    try:
        cur = conn.cursor()
        # Check if table exists with old INTEGER id column
        cur.execute("""
            SELECT data_type FROM information_schema.columns 
            WHERE table_name = 'app_state' AND column_name = 'id'
        """)
        row = cur.fetchone()
        if row and row[0] == 'integer':
            # Old schema — migrate: save data, drop, recreate with TEXT id
            print("[DB] Migrating app_state table from INTEGER id to TEXT id...")
            cur.execute("SELECT data FROM app_state LIMIT 1")
            old_data = cur.fetchone()
            cur.execute("DROP TABLE app_state")
            conn.commit()
            cur.execute("""
                CREATE TABLE app_state (
                    id TEXT PRIMARY KEY DEFAULT 'main',
                    data JSONB NOT NULL DEFAULT '{}',
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            if old_data:
                cur.execute("INSERT INTO app_state (id, data) VALUES ('main', %s)",
                            (json.dumps(old_data[0] if isinstance(old_data[0], dict) else json.loads(old_data[0]), default=str),))
            else:
                cur.execute("INSERT INTO app_state (id, data) VALUES ('main', %s)",
                            (json.dumps(EMPTY_DB),))
            conn.commit()
            print("[DB] Migration complete")
        else:
            # Normal path — create if not exists
            cur.execute("""
                CREATE TABLE IF NOT EXISTS app_state (
                    id TEXT PRIMARY KEY DEFAULT 'main',
                    data JSONB NOT NULL DEFAULT '{}',
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            cur.execute("INSERT INTO app_state (id, data) VALUES ('main', %s) ON CONFLICT DO NOTHING",
                        (json.dumps(EMPTY_DB),))
            conn.commit()
    except Exception as e:
        print(f"[DB] pg_init error: {e}")
        conn.rollback()
        # Last resort — try drop and recreate
        try:
            cur.execute("DROP TABLE IF EXISTS app_state")
            cur.execute("""
                CREATE TABLE app_state (
                    id TEXT PRIMARY KEY DEFAULT 'main',
                    data JSONB NOT NULL DEFAULT '{}',
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            cur.execute("INSERT INTO app_state (id, data) VALUES ('main', %s)",
                        (json.dumps(EMPTY_DB),))
            conn.commit()
            print("[DB] Recreated app_state table from scratch")
        except Exception as e2:
            print(f"[DB] Failed to recreate table: {e2}")
            conn.rollback()
    finally:
        _pg_pool.putconn(conn)

def _pg_load():
    if not _pg_pool:
        return _fresh_db()
    conn = _pg_pool.getconn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT data FROM app_state WHERE id='main'")
        row = cur.fetchone()
        return row[0] if row else _fresh_db()
    finally:
        _pg_pool.putconn(conn)

def _pg_save(db):
    if not _pg_pool:
        return
    conn = _pg_pool.getconn()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE app_state SET data=%s, updated_at=NOW() WHERE id='main'",
                    (json.dumps(db, default=str),))
        conn.commit()
    finally:
        _pg_pool.putconn(conn)

# ============================================================
# PUBLIC API
# ============================================================
if DATABASE_URL:
    print("[DB] Using PostgreSQL backend")
    _pg_connect()
    load_db = _pg_load
    save_db = _pg_save
    get_db = _pg_load
else:
    print("[DB] Using file backend (db.json)")
    load_db = _file_load
    save_db = _file_save
    get_db = _file_get

# ============================================================
# FILE STORAGE
# ============================================================
def save_uploaded_file(filename: str, content: bytes, content_type: str = "application/octet-stream") -> None:
    """Save an uploaded file to local filesystem."""
    path = UPLOAD_DIR / filename
    path.write_bytes(content)

def load_uploaded_file(filename: str) -> tuple:
    """Load an uploaded file, return (path, exists)."""
    path = UPLOAD_DIR / filename
    return path, path.exists()

# ============================================================
# UTILITIES
# ============================================================
def _n(val, default=0):
    """Safe numeric conversion: None/empty → default, strings → float."""
    if val is None or val == "":
        return float(default)
    try:
        return float(val)
    except (ValueError, TypeError):
        return float(default)
