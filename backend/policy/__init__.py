"""
AuditLens — Policy Engine Module

Centralized AP policy state management. Single source of truth for all
configurable thresholds, matching modes, and business rules.

Architecture:
  - DEFAULT_POLICY: Immutable base policy with env var overrides
  - _active_policy: Mutable runtime state, updated via API
  - get_policy() / update_policy(): Thread-safe accessors
  - POLICY_PRESETS: Named preset configurations (manufacturing, services, etc.)
  - Backward-compatible accessors: get_amount_tolerance(), get_price_tolerance(), etc.

Every module that needs a policy value calls get_policy() or uses an accessor.
No module stores a stale copy.
"""

import os
import copy as _copy


# ============================================================
# DEFAULT POLICY — base configuration with env var overrides
# ============================================================
DEFAULT_POLICY = {
    # ── MATCHING MODE ──
    "matching_mode": os.environ.get("MATCHING_MODE", "flexible"),

    # ── TOLERANCE THRESHOLDS ──
    "amount_tolerance_pct": float(os.environ.get("AMOUNT_TOLERANCE_PCT", "2")),
    "price_tolerance_pct": float(os.environ.get("PRICE_TOLERANCE_PCT", "1")),
    "over_invoice_pct": float(os.environ.get("OVER_INVOICE_PCT", "2")),
    "tax_tolerance_pct": float(os.environ.get("TAX_TOLERANCE_PCT", "5")),
    "grn_qty_tolerance_pct": float(os.environ.get("GRN_QTY_TOLERANCE_PCT", "2")),
    "grn_amount_tolerance_pct": float(os.environ.get("GRN_AMT_TOLERANCE_PCT", "2")),
    "short_shipment_threshold_pct": float(os.environ.get("SHORT_SHIPMENT_PCT", "90")),

    # ── DUPLICATE DETECTION ──
    "duplicate_window_days": int(os.environ.get("DUPLICATE_DAYS_WINDOW", "90")),
    "duplicate_amount_tolerance_pct": float(os.environ.get("DUP_AMT_TOLERANCE", "2")),

    # ── SEVERITY THRESHOLDS ──
    "high_severity_pct": float(os.environ.get("HIGH_SEVERITY_PCT", "10")),
    "med_severity_pct": float(os.environ.get("MED_SEVERITY_PCT", "5")),

    # ── TRIAGE RULES ──
    "triage_enabled": os.environ.get("TRIAGE_ENABLED", "true").lower() == "true",
    "auto_approve_min_confidence": float(os.environ.get("TRIAGE_AUTO_APPROVE_CONFIDENCE", "85")),
    "auto_approve_max_vendor_risk": float(os.environ.get("TRIAGE_AUTO_APPROVE_MAX_RISK", "50")),
    "block_on_high_severity": True,
    "block_min_vendor_risk": float(os.environ.get("TRIAGE_BLOCK_MIN_RISK_SCORE", "70")),
    "require_po_for_auto_approve": True,
    "require_grn_for_auto_approve": False,

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
    "auto_detect_document_type": True,
    "require_invoice_number": True,
    "flag_round_number_invoices": False,
    "max_invoice_age_days": int(os.environ.get("MAX_INVOICE_AGE_DAYS", "365")),
    "flag_weekend_invoices": False,
}


# ============================================================
# RUNTIME STATE — mutable, updated via API
# ============================================================
_active_policy = _copy.deepcopy(DEFAULT_POLICY)


def get_policy() -> dict:
    """Get the active AP policy configuration."""
    return _active_policy


def update_policy(updates: dict) -> dict:
    """Update specific policy fields. Returns the full updated policy."""
    VALID_MATCHING_MODES = ("two_way", "three_way", "flexible")
    PCT_FIELDS = {k for k, v in DEFAULT_POLICY.items()
                  if isinstance(v, (int, float)) and ('pct' in k or 'confidence' in k or 'risk' in k)}
    DAY_FIELDS = {k for k in DEFAULT_POLICY if 'days' in k or 'age' in k}

    for key, value in updates.items():
        if key in _active_policy:
            if key == "matching_mode" and value not in VALID_MATCHING_MODES:
                continue
            expected_type = type(DEFAULT_POLICY[key])
            if isinstance(value, expected_type) or (expected_type == float and isinstance(value, (int, float))):
                if key in PCT_FIELDS and isinstance(value, (int, float)):
                    value = max(0, min(100, float(value)))
                elif key in DAY_FIELDS and isinstance(value, (int, float)):
                    value = max(0, int(value))
                _active_policy[key] = value
            elif expected_type == dict and isinstance(value, dict):
                _active_policy[key].update(value)
    return _active_policy


def reset_policy():
    """Reset policy to defaults. Used in testing."""
    global _active_policy
    _active_policy.clear()
    _active_policy.update(_copy.deepcopy(DEFAULT_POLICY))


# ============================================================
# BACKWARD-COMPATIBLE ACCESSORS — read from live policy
# ============================================================
def get_amount_tolerance(): return _active_policy["amount_tolerance_pct"]
def get_price_tolerance(): return _active_policy["price_tolerance_pct"]
def get_over_invoice_pct(): return _active_policy["over_invoice_pct"]
def get_duplicate_window(): return _active_policy["duplicate_window_days"]
def get_matching_mode(): return _active_policy["matching_mode"]


# ============================================================
# POLICY PRESETS
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
