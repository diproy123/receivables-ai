"""
AuditLens — Configuration & Constants
All environment variables, feature flags, policy defaults, and authority matrix.
"""
import os
from pathlib import Path

# ============================================================
# PATHS
# ============================================================
BASE_DIR = Path(__file__).parent.parent.parent
BACKEND_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
FRONTEND_DIR = BASE_DIR / "frontend"

for d in (DATA_DIR, UPLOAD_DIR):
    d.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "db.json"
USE_REAL_API = bool(os.environ.get("ANTHROPIC_API_KEY"))

# ============================================================
# FEATURE FLAGS
# ============================================================
PERSIST_DATA = os.environ.get("PERSIST_DATA", "true").lower() == "true"
SEED_DEMO = os.environ.get("SEED_DEMO", "false").lower() == "true"
RESET_ON_START = os.environ.get("RESET_ON_START", "false").lower() == "true"

# ============================================================
# AUTH
# ============================================================
JWT_SECRET = os.environ.get("JWT_SECRET", os.urandom(32).hex())
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 72
AUTH_ENABLED = True

# ============================================================
# DEFAULT POLICY
# ============================================================
DEFAULT_POLICY = {
    "matching_mode": "two_way",  # two_way | three_way | flexible
    "amount_tolerance_pct": float(os.environ.get("AMOUNT_TOLERANCE_PCT", "5")),
    "price_tolerance_pct": float(os.environ.get("PRICE_TOLERANCE_PCT", "10")),
    "over_invoice_tolerance_pct": float(os.environ.get("OVER_INVOICE_PCT", "2")),
    "duplicate_window_days": int(os.environ.get("DUPLICATE_WINDOW_DAYS", "90")),
    "high_severity_threshold_pct": float(os.environ.get("HIGH_SEVERITY_PCT", "10")),
    "medium_severity_threshold_pct": float(os.environ.get("MED_SEVERITY_PCT", "5")),
    "flag_round_number_invoices": True,
    "round_number_threshold": 1000,
    "flag_weekend_invoices": True,
    "max_invoice_age_days": 180,
    "tax_rate_tolerance_pct": 2.0,
    "early_payment_discount_flag": True,
    "auto_approve_min_confidence": float(os.environ.get("TRIAGE_AUTO_APPROVE_CONFIDENCE", "85")),
    "auto_approve_max_risk": float(os.environ.get("TRIAGE_AUTO_APPROVE_MAX_RISK", "40")),
    "auto_approve_amount_limits": {"analyst": 10000, "manager": 100000, "vp": 500000, "cfo": 999999999},
    "block_duplicate_invoices": True,
    "require_po_for_auto_approve": True,
    "short_shipment_threshold_pct": 90,
}

# ============================================================
# RISK WEIGHTS
# ============================================================
RISK_WEIGHT_ANOMALY_RATE = 0.30
RISK_WEIGHT_CORRECTION_FREQ = 0.15
RISK_WEIGHT_CONTRACT_COMPLIANCE = 0.20
RISK_WEIGHT_DUPLICATE_HISTORY = 0.15
RISK_WEIGHT_VOLUME_CONSISTENCY = 0.20
HIGH_RISK_THRESHOLD = 60
MED_RISK_THRESHOLD = 30
RISK_TOLERANCE_TIGHTENING = 0.5

# ============================================================
# TRIAGE
# ============================================================
TRIAGE_ENABLED = os.environ.get("TRIAGE_ENABLED", "true").lower() == "true"

# ============================================================
# AUTHORITY MATRIX
# ============================================================
AUTHORITY_MATRIX = {
    "analyst":  {"title": "AP Analyst",     "level": 1, "limits": {"USD": 10000,     "EUR": 8000,      "GBP": 7000,      "INR": 800000,     "default": 10000}},
    "manager":  {"title": "AP Manager",     "level": 2, "limits": {"USD": 100000,    "EUR": 85000,     "GBP": 75000,     "INR": 8000000,    "default": 100000}},
    "vp":       {"title": "VP Finance",     "level": 3, "limits": {"USD": 500000,    "EUR": 425000,    "GBP": 375000,    "INR": 40000000,   "default": 500000}},
    "cfo":      {"title": "CFO",            "level": 4, "limits": {"USD": 999999999, "EUR": 999999999, "GBP": 999999999, "INR": 999999999,  "default": 999999999}},
}
DEFAULT_ROLE = "analyst"

# ============================================================
# ENSEMBLE
# ============================================================
ENSEMBLE_PRIMARY_MODEL = "claude-sonnet-4-20250514"
ENSEMBLE_SECONDARY_MODEL = "claude-haiku-4-5-20251001"

# ============================================================
# VENDOR CONSTANTS
# ============================================================
VENDOR_SUFFIXES = [
    "ltd", "limited", "pvt", "private", "inc", "incorporated",
    "llc", "corp", "corporation", "co", "company", "gmbh", "ag",
    "sa", "srl", "bv", "nv", "plc", "lp", "llp", "pte"
]

CURRENCY_SYMBOLS = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹", "JPY": "¥", "CAD": "C$", "AUD": "A$", "CNY": "¥", "KRW": "₩", "BRL": "R$", "MXN": "MX$", "SAR": "﷼", "AED": "AED"}

# ============================================================
# MULTILINGUAL / LOCALE SUPPORT
# ============================================================
# Locale profiles: detected from document content or currency
# Each locale defines: date formats to try, decimal separator, tax system rules
LOCALE_PROFILES = {
    "en_US": {
        "name": "English (US)", "languages": ["en"],
        "date_formats": ["%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%B %d, %Y", "%b %d, %Y"],
        "decimal_sep": ".", "thousands_sep": ",",
        "tax_systems": {"Sales Tax": {"min": 0, "max": 15}},
        "tax_rate_floor": 0, "tax_rate_ceiling": 15,
        "common_currencies": ["USD"],
    },
    "en_GB": {
        "name": "English (UK)", "languages": ["en"],
        "date_formats": ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %B %Y", "%d %b %Y"],
        "decimal_sep": ".", "thousands_sep": ",",
        "tax_systems": {"VAT": {"min": 0, "max": 20, "standard": 20, "reduced": 5}},
        "tax_rate_floor": 0, "tax_rate_ceiling": 25,
        "common_currencies": ["GBP"],
    },
    "en_IN": {
        "name": "English (India)", "languages": ["en", "hi"],
        "date_formats": ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %B %Y"],
        "decimal_sep": ".", "thousands_sep": ",",
        "tax_systems": {
            "GST": {"min": 0, "max": 28, "rates": [0, 5, 12, 18, 28]},
            "CGST": {"min": 0, "max": 14}, "SGST": {"min": 0, "max": 14},
            "IGST": {"min": 0, "max": 28}, "Cess": {"min": 0, "max": 15},
        },
        "tax_rate_floor": 0, "tax_rate_ceiling": 40,
        "common_currencies": ["INR"],
    },
    "de_DE": {
        "name": "German", "languages": ["de"],
        "date_formats": ["%Y-%m-%d", "%d.%m.%Y", "%d.%m.%y", "%d. %B %Y"],
        "decimal_sep": ",", "thousands_sep": ".",
        "tax_systems": {"MwSt": {"min": 0, "max": 19, "standard": 19, "reduced": 7}, "USt": {"min": 0, "max": 19}},
        "tax_rate_floor": 0, "tax_rate_ceiling": 25,
        "common_currencies": ["EUR"],
    },
    "fr_FR": {
        "name": "French", "languages": ["fr"],
        "date_formats": ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %B %Y"],
        "decimal_sep": ",", "thousands_sep": " ",
        "tax_systems": {"TVA": {"min": 0, "max": 20, "standard": 20, "reduced": [5.5, 10]}},
        "tax_rate_floor": 0, "tax_rate_ceiling": 25,
        "common_currencies": ["EUR"],
    },
    "es_ES": {
        "name": "Spanish", "languages": ["es"],
        "date_formats": ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d de %B de %Y"],
        "decimal_sep": ",", "thousands_sep": ".",
        "tax_systems": {"IVA": {"min": 0, "max": 21, "standard": 21, "reduced": 10}},
        "tax_rate_floor": 0, "tax_rate_ceiling": 25,
        "common_currencies": ["EUR"],
    },
    "pt_BR": {
        "name": "Portuguese (Brazil)", "languages": ["pt"],
        "date_formats": ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"],
        "decimal_sep": ",", "thousands_sep": ".",
        "tax_systems": {"ICMS": {"min": 0, "max": 25}, "IPI": {"min": 0, "max": 15}, "PIS/COFINS": {"min": 0, "max": 10}},
        "tax_rate_floor": 0, "tax_rate_ceiling": 50,
        "common_currencies": ["BRL"],
    },
    "zh_CN": {
        "name": "Chinese (Simplified)", "languages": ["zh"],
        "date_formats": ["%Y-%m-%d", "%Y年%m月%d日", "%Y/%m/%d"],
        "decimal_sep": ".", "thousands_sep": ",",
        "tax_systems": {"增值税": {"min": 0, "max": 13, "rates": [0, 6, 9, 13]}, "VAT": {"min": 0, "max": 13}},
        "tax_rate_floor": 0, "tax_rate_ceiling": 20,
        "common_currencies": ["CNY"],
    },
    "ja_JP": {
        "name": "Japanese", "languages": ["ja"],
        "date_formats": ["%Y-%m-%d", "%Y年%m月%d日", "%Y/%m/%d"],
        "decimal_sep": ".", "thousands_sep": ",",
        "tax_systems": {"消費税": {"min": 8, "max": 10, "standard": 10, "reduced": 8}},
        "tax_rate_floor": 0, "tax_rate_ceiling": 15,
        "common_currencies": ["JPY"],
    },
    "ko_KR": {
        "name": "Korean", "languages": ["ko"],
        "date_formats": ["%Y-%m-%d", "%Y년%m월%d일", "%Y/%m/%d"],
        "decimal_sep": ".", "thousands_sep": ",",
        "tax_systems": {"부가가치세": {"min": 10, "max": 10, "standard": 10}},
        "tax_rate_floor": 0, "tax_rate_ceiling": 15,
        "common_currencies": ["KRW"],
    },
    "ar_SA": {
        "name": "Arabic (Saudi)", "languages": ["ar"],
        "date_formats": ["%Y-%m-%d", "%d/%m/%Y"],
        "decimal_sep": ".", "thousands_sep": ",",
        "tax_systems": {"VAT": {"min": 15, "max": 15, "standard": 15}},
        "tax_rate_floor": 0, "tax_rate_ceiling": 20,
        "common_currencies": ["SAR", "AED"],
    },
}

# Currency → locale mapping (for auto-detection)
CURRENCY_LOCALE_MAP = {}
for _loc_id, _loc in LOCALE_PROFILES.items():
    for _cur in _loc["common_currencies"]:
        CURRENCY_LOCALE_MAP[_cur] = _loc_id
# Default fallback
CURRENCY_LOCALE_MAP.setdefault("USD", "en_US")

# Default locale when nothing can be detected
DEFAULT_LOCALE = "en_US"

# Supported languages for extraction prompt
SUPPORTED_LANGUAGES = sorted(set(
    lang for loc in LOCALE_PROFILES.values() for lang in loc["languages"]
))

# ============================================================
# POLICY PRESETS
# ============================================================
POLICY_PRESETS = {
    "manufacturing": {
        "name": "Manufacturing / Procurement",
        "description": "Strict three-way matching, tight tolerances for physical goods",
        "matching_mode": "three_way",
        "amount_tolerance_pct": 2.0,
        "price_tolerance_pct": 5.0,
        "over_invoice_tolerance_pct": 1.0,
        "flag_round_number_invoices": True,
        "flag_weekend_invoices": True,
        "require_po_for_auto_approve": True,
        "short_shipment_threshold_pct": 95,
    },
    "services": {
        "name": "Professional Services / IT",
        "description": "Flexible matching, wider tolerances for variable billing",
        "matching_mode": "flexible",
        "amount_tolerance_pct": 10.0,
        "price_tolerance_pct": 15.0,
        "over_invoice_tolerance_pct": 5.0,
        "flag_round_number_invoices": False,
        "flag_weekend_invoices": False,
        "require_po_for_auto_approve": True,
        "short_shipment_threshold_pct": 80,
    },
    "enterprise_default": {
        "name": "Enterprise Default",
        "description": "Balanced controls suitable for mixed procurement",
        "matching_mode": "two_way",
        "amount_tolerance_pct": 5.0,
        "price_tolerance_pct": 10.0,
        "over_invoice_tolerance_pct": 2.0,
        "flag_round_number_invoices": True,
        "flag_weekend_invoices": True,
        "require_po_for_auto_approve": True,
        "short_shipment_threshold_pct": 90,
    },
    "startup": {
        "name": "Startup / Fast-moving",
        "description": "Minimal friction, catch only high-risk anomalies",
        "matching_mode": "flexible",
        "amount_tolerance_pct": 15.0,
        "price_tolerance_pct": 20.0,
        "over_invoice_tolerance_pct": 10.0,
        "flag_round_number_invoices": False,
        "flag_weekend_invoices": False,
        "require_po_for_auto_approve": False,
        "short_shipment_threshold_pct": 70,
    },
    "government": {
        "name": "Government / Compliance-heavy",
        "description": "Strictest controls, zero tolerance on overcharges",
        "matching_mode": "three_way",
        "amount_tolerance_pct": 1.0,
        "price_tolerance_pct": 2.0,
        "over_invoice_tolerance_pct": 0.5,
        "flag_round_number_invoices": True,
        "flag_weekend_invoices": True,
        "require_po_for_auto_approve": True,
        "short_shipment_threshold_pct": 98,
    },
}

# ============================================================
# VERSION
# ============================================================
VERSION = "2.8.0"
