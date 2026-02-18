"""
AuditLens — Database Engine & Session Management
SQLAlchemy async engine with connection pooling.
Supports PostgreSQL (production) and SQLite (local dev).
"""

import os
import logging
from contextlib import asynccontextmanager
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from backend.models import Base

logger = logging.getLogger("auditlens.db")

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# Handle Railway/Render Postgres URLs (postgres:// → postgresql://)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)


def get_engine():
    """Create SQLAlchemy engine based on DATABASE_URL."""
    if DATABASE_URL and DATABASE_URL.startswith("postgresql"):
        logger.info("Using PostgreSQL backend: %s", DATABASE_URL.split("@")[-1] if "@" in DATABASE_URL else "***")
        return create_engine(
            DATABASE_URL,
            pool_size=5,
            max_overflow=10,
            pool_pre_ping=True,
            pool_recycle=300,
            echo=False,
        )
    else:
        # SQLite fallback for local development
        from backend.config import DATA_DIR
        db_path = DATA_DIR / "auditlens.db"
        logger.info("Using SQLite backend: %s", db_path)
        return create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
            echo=False,
        )


try:
    engine = get_engine()
except Exception as e:
    logger.warning("Engine creation deferred: %s", e)
    engine = None

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False) if engine else None


def _get_session_factory():
    """Get or create session factory (handles deferred engine creation)."""
    global engine, SessionLocal
    if engine is None:
        engine = get_engine()
        SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    return SessionLocal


def init_db():
    """Create all tables. Safe to call multiple times."""
    global engine
    if engine is None:
        engine = get_engine()
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables initialized")


def get_session() -> Session:
    """Get a database session. Use as a context manager or dependency."""
    session = SessionLocal()
    try:
        return session
    except Exception:
        session.close()
        raise


def close_db():
    """Dispose of the engine connection pool."""
    engine.dispose()
    logger.info("Database connections closed")
