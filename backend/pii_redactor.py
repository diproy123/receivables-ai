"""
AuditLens PII Redactor — Pre-LLM Data Sanitization Layer
═══════════════════════════════════════════════════════════

Detects and redacts sensitive Personally Identifiable Information (PII)
from text BEFORE it is sent to any LLM provider. Redaction is reversible —
tokens are replaced with placeholders and a mapping is maintained so the
extraction output can be de-redacted after the LLM responds.

SUPPORTED PII TYPES:
  - Bank account numbers (various formats)
  - Routing / SWIFT / IBAN numbers
  - Tax IDs (US EIN, India PAN/GST, UK VAT, EU VAT)
  - Social Security Numbers (US SSN)
  - Credit card numbers (Luhn-validated)
  - Email addresses
  - Phone numbers (international formats)

CONFIGURATION (environment variables):
  PII_REDACTION_ENABLED = true | false  (default: false)
  PII_REDACTION_MODE    = redact | detect_only  (default: redact)
  PII_REDACTION_FIELDS  = comma-separated list of types to redact
                          (default: all)

USAGE:
  from backend.pii_redactor import redact_prompt, restore_pii, is_redaction_enabled

  # Before LLM call
  redacted_prompt, pii_map = redact_prompt(original_prompt)

  # After LLM response
  restored_text = restore_pii(llm_response, pii_map)
"""

import os
import re
from typing import Tuple


# ============================================================
# CONFIGURATION
# ============================================================
PII_REDACTION_ENABLED = os.environ.get("PII_REDACTION_ENABLED", "false").lower() == "true"
PII_REDACTION_MODE = os.environ.get("PII_REDACTION_MODE", "redact")  # "redact" | "detect_only"

# Which PII types to redact (default: all)
_configured_fields = os.environ.get("PII_REDACTION_FIELDS", "all").lower()
PII_FIELDS = set(f.strip() for f in _configured_fields.split(",")) if _configured_fields != "all" else {"all"}


def is_redaction_enabled() -> bool:
    return PII_REDACTION_ENABLED


# ============================================================
# PII PATTERNS — Regex-based detection
# ============================================================

PII_PATTERNS = {
    # US Social Security Number: 123-45-6789 or 123456789
    "ssn": {
        "pattern": re.compile(r'\b(\d{3}[-\s]?\d{2}[-\s]?\d{4})\b'),
        "label": "SSN",
        "validate": lambda m: _validate_ssn(m.group(1)),
    },
    # US EIN (Employer Identification Number): 12-3456789
    "ein": {
        "pattern": re.compile(r'\b(\d{2}-\d{7})\b'),
        "label": "TAX_ID",
        "validate": None,
    },
    # India PAN: ABCDE1234F
    "pan": {
        "pattern": re.compile(r'\b([A-Z]{5}\d{4}[A-Z])\b'),
        "label": "TAX_ID",
        "validate": None,
    },
    # India GSTIN: 22AAAAA0000A1Z5
    "gstin": {
        "pattern": re.compile(r'\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d][A-Z\d])\b'),
        "label": "TAX_ID",
        "validate": None,
    },
    # UK/EU VAT numbers: GB123456789, DE123456789, FR12345678901
    "vat": {
        "pattern": re.compile(r'\b((?:GB|DE|FR|IT|ES|NL|BE|AT|IE|PT|SE|DK|FI|PL|CZ|HU|RO|BG|HR|SI|SK|LT|LV|EE|CY|MT|LU)\d{8,12})\b'),
        "label": "TAX_ID",
        "validate": None,
    },
    # IBAN: GB29 NWBK 6016 1331 9268 19
    "iban": {
        "pattern": re.compile(r'\b([A-Z]{2}\d{2}[\s]?[A-Z0-9]{4}[\s]?[\d]{4}[\s]?[\d]{4}[\s]?[\d]{4}[\s]?[\d]{0,4}[\s]?[\d]{0,2})\b'),
        "label": "BANK_ACCT",
        "validate": None,
    },
    # SWIFT/BIC: DEUTDEFF, CHASUS33XXX
    "swift": {
        "pattern": re.compile(r'\b([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b'),
        "label": "SWIFT",
        "validate": lambda m: len(m.group(1)) in (8, 11),
    },
    # US Bank routing number: 9 digits
    "routing": {
        "pattern": re.compile(r'\b(?:routing|ABA|RTN)[\s:#]*(\d{9})\b', re.IGNORECASE),
        "label": "ROUTING",
        "validate": None,
    },
    # Bank account numbers: preceded by "account" keyword, 8-17 digits
    "bank_account": {
        "pattern": re.compile(r'(?:account|acct|a/c)[\s:#]*(\d{8,17})\b', re.IGNORECASE),
        "label": "BANK_ACCT",
        "validate": None,
    },
    # Credit card: 13-19 digits, optionally with spaces/dashes
    "credit_card": {
        "pattern": re.compile(r'\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7})\b'),
        "label": "CARD",
        "validate": lambda m: _luhn_check(re.sub(r'[\s-]', '', m.group(1))),
    },
    # Email addresses
    "email": {
        "pattern": re.compile(r'\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b'),
        "label": "EMAIL",
        "validate": None,
    },
    # Phone numbers (international): +1-234-567-8901 or (234) 567-8901 or +91 98765 43210
    "phone": {
        "pattern": re.compile(r'(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{4,5}\b'),
        "label": "PHONE",
        "validate": lambda m: len(re.sub(r'[\s.()\-+]', '', m.group(0))) >= 10,
    },
}


# ============================================================
# VALIDATORS
# ============================================================
def _validate_ssn(ssn: str) -> bool:
    """Basic SSN validation — exclude known non-SSN patterns."""
    digits = re.sub(r'[\s-]', '', ssn)
    if len(digits) != 9:
        return False
    # SSN cannot start with 000, 666, or 900-999
    area = int(digits[:3])
    if area == 0 or area == 666 or area >= 900:
        return False
    # Group and serial cannot be 0000 or 00
    if digits[3:5] == "00" or digits[5:] == "0000":
        return False
    return True


def _luhn_check(number: str) -> bool:
    """Luhn algorithm for credit card validation."""
    if not number.isdigit() or len(number) < 13:
        return False
    total = 0
    for i, d in enumerate(reversed(number)):
        n = int(d)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


# ============================================================
# REDACTION ENGINE
# ============================================================
def detect_pii(text: str) -> list:
    """Detect all PII occurrences in text. Returns list of (type, value, start, end)."""
    findings = []
    for pii_type, config in PII_PATTERNS.items():
        if PII_FIELDS != {"all"} and pii_type not in PII_FIELDS:
            continue
        for match in config["pattern"].finditer(text):
            if config.get("validate") and not config["validate"](match):
                continue
            value = match.group(1) if match.lastindex else match.group(0)
            findings.append({
                "type": pii_type,
                "label": config["label"],
                "value": value,
                "start": match.start(),
                "end": match.end(),
            })
    # De-duplicate overlapping matches (keep longer match)
    findings.sort(key=lambda f: (f["start"], -(f["end"] - f["start"])))
    deduped = []
    last_end = -1
    for f in findings:
        if f["start"] >= last_end:
            deduped.append(f)
            last_end = f["end"]
    return deduped


def redact_prompt(text: str) -> Tuple[str, dict]:
    """
    Redact PII from text before sending to LLM.
    Returns (redacted_text, pii_map) where pii_map can be used with restore_pii().
    """
    if not PII_REDACTION_ENABLED or PII_REDACTION_MODE == "detect_only":
        return text, {}

    findings = detect_pii(text)
    if not findings:
        return text, {}

    pii_map = {}
    counters = {}

    # Process in reverse order to maintain string positions
    redacted = text
    for f in reversed(findings):
        label = f["label"]
        counters[label] = counters.get(label, 0) + 1
        token = f"[{label}_{counters[label]}]"
        pii_map[token] = f["value"]
        redacted = redacted[:f["start"]] + token + redacted[f["end"]:]

    pii_count = len(findings)
    types = set(f["label"] for f in findings)
    print(f"[PII Redactor] Redacted {pii_count} PII item(s): {', '.join(types)}")
    return redacted, pii_map


def restore_pii(text: str, pii_map: dict) -> str:
    """Restore redacted PII tokens in LLM response using the mapping from redact_prompt()."""
    if not pii_map:
        return text
    result = text
    for token, original in pii_map.items():
        result = result.replace(token, original)
    return result


def get_pii_summary(text: str) -> dict:
    """Get a summary of PII detected in text without redacting. For audit/reporting."""
    findings = detect_pii(text)
    summary = {"total_pii_items": len(findings), "types": {}}
    for f in findings:
        t = f["type"]
        summary["types"][t] = summary["types"].get(t, 0) + 1
    summary["redaction_enabled"] = PII_REDACTION_ENABLED
    summary["redaction_mode"] = PII_REDACTION_MODE
    return summary
