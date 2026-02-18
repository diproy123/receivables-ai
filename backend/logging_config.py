"""
AuditLens — Structured Logging
Replaces print() with proper Python logging.
JSON output in production, readable format in development.
"""

import os
import logging
import sys
import uuid
from datetime import datetime, timezone
from contextvars import ContextVar

# Context var for request correlation ID
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


class AuditLensFormatter(logging.Formatter):
    """Custom formatter that includes request_id for correlation."""

    def format(self, record):
        record.request_id = request_id_ctx.get("-")
        return super().format(record)


class JsonFormatter(logging.Formatter):
    """JSON formatter for production environments."""

    def format(self, record):
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_ctx.get("-"),
        }
        if record.exc_info and record.exc_info[0]:
            log_entry["exception"] = self.formatException(record.exc_info)
        if hasattr(record, "extra_data"):
            log_entry.update(record.extra_data)
        # Simple JSON without external deps
        import json
        return json.dumps(log_entry, default=str)


def setup_logging():
    """Configure logging for the application."""
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    log_format = os.environ.get("LOG_FORMAT", "text")  # "text" or "json"

    root = logging.getLogger()
    root.setLevel(log_level)

    # Remove existing handlers
    for handler in root.handlers[:]:
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)

    if log_format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        formatter = AuditLensFormatter(
            fmt="%(asctime)s [%(levelname)-5s] %(name)-20s | %(request_id)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)

    root.addHandler(handler)

    # Suppress noisy loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if os.environ.get("SQL_ECHO") else logging.WARNING
    )

    return logging.getLogger("auditlens")


def get_logger(name: str) -> logging.Logger:
    """Get a named logger for a module."""
    return logging.getLogger(f"auditlens.{name}")
