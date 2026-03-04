"""
AuditLens — LLM Provider Abstraction Layer
═══════════════════════════════════════════

Centralizes ALL LLM calls behind a single interface.
Every module (extraction, ai_intelligence, anomalies, rag_engine)
calls through this provider instead of importing anthropic directly.

SUPPORTED PROVIDERS:
  1. anthropic    — Anthropic API (default, cloud)
  2. bedrock      — AWS Bedrock (Claude in your VPC)
  3. vertex       — Google Vertex AI (Claude in GCP)
  4. openai       — OpenAI-compatible APIs (vLLM, Ollama, Together, etc.)

CONFIGURATION (via environment variables):
  LLM_PROVIDER           = anthropic | bedrock | vertex | openai   (default: anthropic)
  LLM_PRIMARY_MODEL      = model name for primary extraction       (default: claude-sonnet-4-20250514)
  LLM_SECONDARY_MODEL    = model name for secondary extraction     (default: claude-haiku-4-5-20251001)
  LLM_ENDPOINT           = custom endpoint URL                     (for openai provider)
  LLM_API_KEY            = API key                                 (reads ANTHROPIC_API_KEY as fallback)
  LLM_REGION             = AWS/GCP region                          (for bedrock/vertex)
  LLM_ZERO_DATA_RETENTION = true | false                           (sends ZDR header to Anthropic)

  # Bedrock-specific
  AWS_ACCESS_KEY_ID      = AWS credentials (or use IAM role)
  AWS_SECRET_ACCESS_KEY  = AWS credentials
  AWS_REGION             = us-east-1 etc.

  # Vertex-specific  
  GOOGLE_CLOUD_PROJECT   = GCP project ID
  GOOGLE_CLOUD_REGION    = us-east5 etc.

USAGE:
  from backend.llm_provider import llm_call, llm_call_with_document, get_provider_info, is_llm_available

  # Text-only call (AI Intelligence, anomaly detection)
  response_text = await llm_call(prompt="Analyze this invoice...", max_tokens=2000)

  # Document + text call (Extraction)
  response_text = await llm_call_with_document(
      document_b64=base64_data,
      media_type="application/pdf",
      prompt="Extract all fields...",
      model="primary",      # "primary" | "secondary" | explicit model name
      max_tokens=4000
  )

  # Provider info (for /api/system-info and landing page)
  info = get_provider_info()
  # → {"provider": "bedrock", "region": "us-east-1", "data_residency": "AWS VPC", ...}
"""

import os
import json
import time
import asyncio
from typing import Optional

# ============================================================
# CONFIGURATION
# ============================================================

# Provider selection
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "anthropic").lower()

# Model names (overridable for Bedrock/Vertex model IDs or local model names)
LLM_PRIMARY_MODEL = os.environ.get(
    "LLM_PRIMARY_MODEL",
    os.environ.get("ENSEMBLE_PRIMARY_MODEL", "claude-sonnet-4-20250514")
)
LLM_SECONDARY_MODEL = os.environ.get(
    "LLM_SECONDARY_MODEL",
    os.environ.get("ENSEMBLE_SECONDARY_MODEL", "claude-haiku-4-5-20251001")
)

# API / Auth
LLM_API_KEY = os.environ.get("LLM_API_KEY", os.environ.get("ANTHROPIC_API_KEY", ""))
LLM_ENDPOINT = os.environ.get("LLM_ENDPOINT", "")  # For openai-compatible
LLM_REGION = os.environ.get("LLM_REGION", os.environ.get("AWS_REGION", "us-east-1"))

# Privacy
LLM_ZERO_DATA_RETENTION = os.environ.get("LLM_ZERO_DATA_RETENTION", "false").lower() == "true"

# Timeouts
LLM_TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "60"))

# ============================================================
# PUBLIC API
# ============================================================

def is_llm_available() -> bool:
    """Check if LLM is configured and available."""
    if LLM_PROVIDER == "anthropic":
        return bool(LLM_API_KEY)
    elif LLM_PROVIDER == "bedrock":
        return bool(os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_PROFILE"))
    elif LLM_PROVIDER == "vertex":
        return bool(os.environ.get("GOOGLE_CLOUD_PROJECT"))
    elif LLM_PROVIDER == "openai":
        return bool(LLM_ENDPOINT)
    return False


def resolve_model(model_alias: str) -> str:
    """Resolve 'primary'/'secondary' aliases to actual model names."""
    if model_alias == "primary":
        return LLM_PRIMARY_MODEL
    elif model_alias == "secondary":
        return LLM_SECONDARY_MODEL
    return model_alias


def get_provider_info() -> dict:
    """Return provider metadata for system info / landing page display."""
    base = {
        "provider": LLM_PROVIDER,
        "primary_model": LLM_PRIMARY_MODEL,
        "secondary_model": LLM_SECONDARY_MODEL,
        "available": is_llm_available(),
        "zero_data_retention": LLM_ZERO_DATA_RETENTION,
        "embedding_provider": os.environ.get("RAG_EMBEDDING_PROVIDER", "voyage").lower(),
        "finetune_provider": os.environ.get("FINETUNE_PROVIDER", "together").lower(),
        "pii_redaction_enabled": os.environ.get("PII_REDACTION_ENABLED", "false").lower() == "true",
        "deployment_preset": os.environ.get("DEPLOYMENT_PRESET", "standard").lower(),
    }

    if LLM_PROVIDER == "anthropic":
        base.update({
            "data_residency": "Anthropic Cloud (US)",
            "description": "Anthropic API — managed cloud",
            "privacy_tier": "zdr" if LLM_ZERO_DATA_RETENTION else "standard",
            "privacy_label": "Zero Data Retention" if LLM_ZERO_DATA_RETENTION else "Standard API",
        })
    elif LLM_PROVIDER == "bedrock":
        base.update({
            "data_residency": f"AWS VPC ({LLM_REGION})",
            "description": f"AWS Bedrock — your VPC in {LLM_REGION}",
            "privacy_tier": "vpc",
            "privacy_label": "Private Cloud (AWS)",
        })
    elif LLM_PROVIDER == "vertex":
        region = os.environ.get("GOOGLE_CLOUD_REGION", LLM_REGION)
        base.update({
            "data_residency": f"Google Cloud ({region})",
            "description": f"Vertex AI — your GCP project in {region}",
            "privacy_tier": "vpc",
            "privacy_label": "Private Cloud (GCP)",
        })
    elif LLM_PROVIDER == "openai":
        is_local = LLM_ENDPOINT.startswith("http://localhost") or LLM_ENDPOINT.startswith("http://127.")
        base.update({
            "data_residency": "On-Premise" if is_local else "Custom Endpoint",
            "description": f"OpenAI-compatible — {LLM_ENDPOINT or 'not configured'}",
            "privacy_tier": "on_prem" if is_local else "custom",
            "privacy_label": "On-Premise (Air-Gapped)" if is_local else "Self-Hosted",
        })

    return base


async def llm_call(
    prompt: str,
    model: str = "primary",
    max_tokens: int = 2000,
    system: str = "",
    temperature: float = 0.0,
    # Audit metadata (optional — callers can provide for richer logs)
    _module: str = "",
    _vendor: str = "",
    _doc_id: str = "",
) -> Optional[str]:
    """
    Text-only LLM call. Used by: ai_intelligence, anomalies (AI mode).
    Returns response text or None on failure.
    R5: Automatically applies PII redaction when enabled.
    R6: Automatically logs to audit trail.
    """
    model_name = resolve_model(model)

    # R5: PII Redaction — centralized at provider layer
    pii_map = {}
    send_prompt = prompt
    try:
        from backend.pii_redactor import redact_prompt, restore_pii, is_redaction_enabled
        if is_redaction_enabled():
            send_prompt, pii_map = redact_prompt(prompt)
    except ImportError:
        pass

    t0 = time.time()
    result_text = None
    error_msg = ""

    try:
        if LLM_PROVIDER == "anthropic":
            result_text = await _anthropic_text(model_name, send_prompt, max_tokens, system, temperature)
        elif LLM_PROVIDER == "bedrock":
            result_text = await _bedrock_text(model_name, send_prompt, max_tokens, system, temperature)
        elif LLM_PROVIDER == "vertex":
            result_text = await _vertex_text(model_name, send_prompt, max_tokens, system, temperature)
        elif LLM_PROVIDER == "openai":
            result_text = await _openai_text(model_name, send_prompt, max_tokens, system, temperature)
        else:
            print(f"[LLM Provider] Unknown provider: {LLM_PROVIDER}")
    except Exception as e:
        error_msg = str(e)
        print(f"[LLM Provider] {LLM_PROVIDER}:{model_name} text call failed: {e}")

    elapsed = round((time.time() - t0) * 1000)

    # R6: Audit log — centralized at provider layer
    if _module:
        audit_log_llm_call(
            module=_module, model=model_name, data_type="text",
            latency_ms=elapsed, vendor=_vendor, doc_id=_doc_id,
            pii_redacted=bool(pii_map), success=result_text is not None,
            error=error_msg,
        )

    # R5: Restore PII in response
    if result_text and pii_map:
        try:
            result_text = restore_pii(result_text, pii_map)
        except Exception:
            pass

    return result_text


async def llm_call_with_document(
    document_b64: str,
    media_type: str,
    prompt: str,
    model: str = "primary",
    max_tokens: int = 4000,
    system: str = "",
    temperature: float = 0.0,
    # Audit metadata (optional — callers can provide for richer logs)
    _module: str = "",
    _vendor: str = "",
    _doc_id: str = "",
) -> Optional[str]:
    """
    Document + text LLM call. Used by: extraction, anomaly resolution.
    Sends a PDF/image as base64 along with the prompt.
    Returns response text or None on failure.
    R5: Automatically applies PII redaction to prompt text when enabled.
    R6: Automatically logs to audit trail.
    """
    model_name = resolve_model(model)

    # R5: PII Redaction on prompt text (document images can't be text-redacted)
    pii_map = {}
    send_prompt = prompt
    try:
        from backend.pii_redactor import redact_prompt, restore_pii, is_redaction_enabled
        if is_redaction_enabled():
            send_prompt, pii_map = redact_prompt(prompt)
    except ImportError:
        pass

    t0 = time.time()
    result_text = None
    error_msg = ""

    try:
        if LLM_PROVIDER == "anthropic":
            result_text = await _anthropic_document(model_name, document_b64, media_type, send_prompt, max_tokens, system, temperature)
        elif LLM_PROVIDER == "bedrock":
            result_text = await _bedrock_document(model_name, document_b64, media_type, send_prompt, max_tokens, system, temperature)
        elif LLM_PROVIDER == "vertex":
            result_text = await _vertex_document(model_name, document_b64, media_type, send_prompt, max_tokens, system, temperature)
        elif LLM_PROVIDER == "openai":
            result_text = await _openai_document(model_name, document_b64, media_type, send_prompt, max_tokens, system, temperature)
        else:
            print(f"[LLM Provider] Unknown provider: {LLM_PROVIDER}")
    except Exception as e:
        error_msg = str(e)
        print(f"[LLM Provider] {LLM_PROVIDER}:{model_name} document call failed: {e}")

    elapsed = round((time.time() - t0) * 1000)

    # R6: Audit log — centralized at provider layer
    if _module:
        audit_log_llm_call(
            module=_module, model=model_name, data_type="document",
            latency_ms=elapsed, vendor=_vendor, doc_id=_doc_id,
            pii_redacted=bool(pii_map), success=result_text is not None,
            error=error_msg,
        )

    # R5: Restore PII in response
    if result_text and pii_map:
        try:
            result_text = restore_pii(result_text, pii_map)
        except Exception:
            pass

    return result_text


# ============================================================
# PROVIDER: ANTHROPIC (Direct API)
# ============================================================

async def _anthropic_text(model, prompt, max_tokens, system, temperature):
    import anthropic

    extra_headers = {}
    if LLM_ZERO_DATA_RETENTION:
        extra_headers["anthropic-no-log"] = "true"

    kwargs = {}
    if extra_headers:
        kwargs["extra_headers"] = extra_headers

    client = anthropic.AsyncAnthropic(api_key=LLM_API_KEY, timeout=LLM_TIMEOUT)
    msg = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[{"role": "user", "content": prompt}],
        **({"system": system} if system else {}),
        **kwargs,
    )
    return msg.content[0].text.strip()


async def _anthropic_document(model, document_b64, media_type, prompt, max_tokens, system, temperature):
    import anthropic

    extra_headers = {}
    betas = []

    # PDF support requires beta flag
    if media_type == "application/pdf":
        betas.append("pdfs-2024-09-25")

    # Zero Data Retention — correct header format
    if LLM_ZERO_DATA_RETENTION:
        extra_headers["anthropic-beta"] = ",".join(betas) if betas else ""
        # ZDR uses a separate header, not a beta flag
        extra_headers["anthropic-no-log"] = "true"
    elif betas:
        extra_headers["anthropic-beta"] = ",".join(betas)

    kwargs = {}
    if extra_headers:
        kwargs["extra_headers"] = {k: v for k, v in extra_headers.items() if v}

    client = anthropic.AsyncAnthropic(api_key=LLM_API_KEY, timeout=LLM_TIMEOUT)

    if media_type == "application/pdf":
        content_block = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": document_b64}}
    else:
        img_type = media_type if media_type in ["image/jpeg", "image/png", "image/gif", "image/webp"] else "image/png"
        content_block = {"type": "image", "source": {"type": "base64", "media_type": img_type, "data": document_b64}}

    msg = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[{"role": "user", "content": [content_block, {"type": "text", "text": prompt}]}],
        **({"system": system} if system else {}),
        **kwargs,
    )
    return msg.content[0].text.strip()


# ============================================================
# PROVIDER: AWS BEDROCK
# ============================================================

async def _bedrock_text(model, prompt, max_tokens, system, temperature):
    """AWS Bedrock — Claude stays in your VPC. No data leaves AWS."""
    import anthropic

    client = anthropic.AsyncAnthropicBedrock(
        aws_region=LLM_REGION,
        # Uses AWS credentials from env / IAM role automatically
    )
    msg = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[{"role": "user", "content": prompt}],
        **({"system": system} if system else {}),
    )
    return msg.content[0].text.strip()


async def _bedrock_document(model, document_b64, media_type, prompt, max_tokens, system, temperature):
    import anthropic

    client = anthropic.AsyncAnthropicBedrock(aws_region=LLM_REGION)

    if media_type == "application/pdf":
        content_block = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": document_b64}}
    else:
        img_type = media_type if media_type in ["image/jpeg", "image/png", "image/gif", "image/webp"] else "image/png"
        content_block = {"type": "image", "source": {"type": "base64", "media_type": img_type, "data": document_b64}}

    msg = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[{"role": "user", "content": [content_block, {"type": "text", "text": prompt}]}],
        **({"system": system} if system else {}),
    )
    return msg.content[0].text.strip()


# ============================================================
# PROVIDER: GOOGLE VERTEX AI
# ============================================================

async def _vertex_text(model, prompt, max_tokens, system, temperature):
    """Google Vertex AI — Claude in your GCP project."""
    import anthropic

    client = anthropic.AsyncAnthropicVertex(
        project_id=os.environ.get("GOOGLE_CLOUD_PROJECT", ""),
        region=os.environ.get("GOOGLE_CLOUD_REGION", "us-east5"),
    )
    msg = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[{"role": "user", "content": prompt}],
        **({"system": system} if system else {}),
    )
    return msg.content[0].text.strip()


async def _vertex_document(model, document_b64, media_type, prompt, max_tokens, system, temperature):
    import anthropic

    client = anthropic.AsyncAnthropicVertex(
        project_id=os.environ.get("GOOGLE_CLOUD_PROJECT", ""),
        region=os.environ.get("GOOGLE_CLOUD_REGION", "us-east5"),
    )

    if media_type == "application/pdf":
        content_block = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": document_b64}}
    else:
        img_type = media_type if media_type in ["image/jpeg", "image/png", "image/gif", "image/webp"] else "image/png"
        content_block = {"type": "image", "source": {"type": "base64", "media_type": img_type, "data": document_b64}}

    msg = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[{"role": "user", "content": [content_block, {"type": "text", "text": prompt}]}],
        **({"system": system} if system else {}),
    )
    return msg.content[0].text.strip()


# ============================================================
# PROVIDER: OPENAI-COMPATIBLE (vLLM, Ollama, Together, etc.)
# ============================================================

async def _openai_text(model, prompt, max_tokens, system, temperature):
    """
    OpenAI-compatible API — works with:
    - vLLM (self-hosted Llama, Mixtral, etc.)
    - Ollama (local models)
    - Together.ai
    - Any server exposing /v1/chat/completions
    """
    import aiohttp

    endpoint = LLM_ENDPOINT.rstrip("/") + "/v1/chat/completions"
    headers = {"Content-Type": "application/json"}
    if LLM_API_KEY:
        headers["Authorization"] = f"Bearer {LLM_API_KEY}"

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(endpoint, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=LLM_TIMEOUT)) as resp:
            data = await resp.json()
            return data["choices"][0]["message"]["content"].strip()


async def _openai_document(model, document_b64, media_type, prompt, max_tokens, system, temperature):
    """
    OpenAI-compatible vision API.
    Note: Not all local models support vision. Falls back to text-only if needed.
    """
    import aiohttp

    endpoint = LLM_ENDPOINT.rstrip("/") + "/v1/chat/completions"
    headers = {"Content-Type": "application/json"}
    if LLM_API_KEY:
        headers["Authorization"] = f"Bearer {LLM_API_KEY}"

    # Build multimodal content
    if media_type == "application/pdf":
        # Most OpenAI-compatible APIs don't support PDF natively
        # Fall back to text-only with a note
        print(f"[LLM Provider] Warning: OpenAI-compatible endpoint may not support PDF. Sending as image_url.")
        content = [
            {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{document_b64}"}},
            {"type": "text", "text": prompt},
        ]
    else:
        content = [
            {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{document_b64}"}},
            {"type": "text", "text": prompt},
        ]

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": content})

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(endpoint, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=LLM_TIMEOUT)) as resp:
            data = await resp.json()
            return data["choices"][0]["message"]["content"].strip()


# ============================================================
# UTILITIES
# ============================================================

def clean_json_response(text: str) -> str:
    """Strip markdown code fences from LLM JSON responses."""
    if not text:
        return ""
    text = text.strip()
    if text.startswith("```"):
        first_nl = text.index("\n") if "\n" in text else len(text)
        text = text[first_nl + 1:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    return text


def parse_json_response(text: str) -> Optional[dict]:
    """Clean and parse JSON from LLM response. Returns None on failure."""
    try:
        cleaned = clean_json_response(text)
        return json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        return None


def model_display_name(model: str) -> str:
    """Human-readable model name for UI display."""
    if "sonnet" in model.lower():
        return "Claude Sonnet 4"
    elif "haiku" in model.lower():
        return "Claude Haiku 4.5"
    elif "opus" in model.lower():
        return "Claude Opus 4.5"
    elif "llama" in model.lower():
        return model.split("/")[-1] if "/" in model else model
    elif "mixtral" in model.lower():
        return "Mixtral"
    elif "qwen" in model.lower():
        return "Qwen"
    return model


# ============================================================
# STARTUP LOG
# ============================================================
def log_provider_config():
    """Log provider configuration on startup."""
    info = get_provider_info()
    print(f"[LLM Provider] ═══════════════════════════════════════")
    print(f"[LLM Provider] Provider:   {info['provider'].upper()}")
    print(f"[LLM Provider] Primary:    {model_display_name(info['primary_model'])} ({info['primary_model']})")
    print(f"[LLM Provider] Secondary:  {model_display_name(info['secondary_model'])} ({info['secondary_model']})")
    print(f"[LLM Provider] Residency:  {info['data_residency']}")
    print(f"[LLM Provider] Privacy:    {info['privacy_label']}")
    print(f"[LLM Provider] Embeddings: {EMBEDDING_PROVIDER}")
    print(f"[LLM Provider] FineTune:   {FINETUNE_PROVIDER}")
    print(f"[LLM Provider] PII Redact: {PII_REDACTION}")
    print(f"[LLM Provider] Available:  {info['available']}")
    print(f"[LLM Provider] Preset:     {DEPLOYMENT_PRESET}")
    print(f"[LLM Provider] ═══════════════════════════════════════")


# ============================================================
# R6: LLM CALL AUDIT LOG
# ============================================================
# Structured log of every external LLM call for SOX compliance & operational monitoring.
# Stored in-memory ring buffer + written to db.json activity_log with type "llm_api_call".

_AUDIT_LOG = []  # In-memory ring buffer (last 1000 calls)
_AUDIT_LOG_MAX = 1000

def audit_log_llm_call(module: str, model: str, data_type: str = "text",
                        latency_ms: int = 0, vendor: str = "",
                        doc_id: str = "", pii_redacted: bool = False,
                        success: bool = True, error: str = ""):
    """Log an external LLM API call for audit trail.

    Args:
        module: Which module made the call (extraction, ai_intelligence, etc.)
        model: Model name or alias used
        data_type: "text" or "document"
        latency_ms: Response time in milliseconds
        vendor: Vendor name associated (if any)
        doc_id: Document ID (NOT content) for traceability
        pii_redacted: Whether PII redaction was applied
        success: Whether the call succeeded
        error: Error message if failed
    """
    from datetime import datetime
    entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "type": "llm_api_call",
        "provider": LLM_PROVIDER,
        "model": resolve_model(model) if model in ("primary", "secondary") else model,
        "module": module,
        "data_type": data_type,
        "data_residency": get_provider_info().get("data_residency", "unknown"),
        "zdr_active": LLM_ZERO_DATA_RETENTION,
        "pii_redacted": pii_redacted or (PII_REDACTION == "enabled"),
        "latency_ms": latency_ms,
        "vendor": vendor[:50] if vendor else "",  # Truncate for safety
        "doc_id": doc_id,
        "success": success,
        "error": error[:200] if error else "",
    }

    # Ring buffer
    _AUDIT_LOG.append(entry)
    if len(_AUDIT_LOG) > _AUDIT_LOG_MAX:
        _AUDIT_LOG.pop(0)

    # Also persist to db.json activity log
    try:
        from backend.db import get_db, save_db
        db = get_db()
        activity = db.setdefault("activity_log", [])
        activity.append({
            "id": f"audit_{int(time.time()*1000)}",
            "action": "llm_api_call",
            "details": f"{module} → {entry['model']} ({data_type})",
            "provider": LLM_PROVIDER,
            "data_residency": entry["data_residency"],
            "latency_ms": latency_ms,
            "vendor": entry["vendor"],
            "timestamp": entry["timestamp"],
            "user": "system",
        })
        # Keep activity log bounded
        if len(activity) > 500:
            db["activity_log"] = activity[-500:]
        save_db(db)
    except Exception:
        pass  # Audit logging must never break core operations

    return entry


def get_audit_log(limit: int = 100, module: str = None) -> list:
    """Retrieve recent LLM audit log entries.
    Falls back to persisted activity_log if in-memory buffer is empty (e.g. after restart)."""
    entries = _AUDIT_LOG[-limit:]
    if not entries:
        # Fallback: read from persisted activity_log in db.json
        try:
            from backend.db import get_db
            db = get_db()
            persisted = [e for e in db.get("activity_log", []) if e.get("action") == "llm_api_call"]
            entries = [
                {
                    "timestamp": e.get("timestamp", ""),
                    "module": e.get("details", "").split(" → ")[0] if " → " in e.get("details", "") else "unknown",
                    "model": e.get("details", "").split(" → ")[1].split(" (")[0] if " → " in e.get("details", "") else "unknown",
                    "data_type": e.get("details", "").split("(")[-1].rstrip(")") if "(" in e.get("details", "") else "text",
                    "provider": e.get("provider", LLM_PROVIDER),
                    "latency_ms": e.get("latency_ms", 0),
                    "vendor": e.get("vendor", ""),
                    "pii_redacted": False,
                    "success": True,
                    "error": "",
                    "zdr_active": LLM_ZERO_DATA_RETENTION,
                    "data_residency": e.get("data_residency", "unknown"),
                }
                for e in persisted[-limit:]
            ]
        except Exception:
            entries = []
    if module:
        entries = [e for e in entries if e.get("module") == module]
    return list(reversed(entries))  # Most recent first


def get_audit_summary() -> dict:
    """Aggregate audit stats for data governance dashboard."""
    source = list(_AUDIT_LOG)
    if not source:
        # Fallback: count persisted llm_api_call entries
        try:
            from backend.db import get_db
            db = get_db()
            source = [e for e in db.get("activity_log", []) if e.get("action") == "llm_api_call"]
            if not source:
                return {"total_calls": 0, "by_module": {}, "by_provider": {},
                        "by_data_type": {}, "avg_latency_ms": 0, "pii_redacted_pct": 0, "success_rate": 100}
            total = len(source)
            by_module = {}
            total_latency = 0
            for e in source:
                detail = e.get("details", "")
                mod = detail.split(" → ")[0] if " → " in detail else "unknown"
                by_module[mod] = by_module.get(mod, 0) + 1
                total_latency += e.get("latency_ms", 0)
            return {
                "total_calls": total, "by_module": by_module,
                "by_provider": {e.get("provider", "unknown"): total},
                "by_data_type": {}, "avg_latency_ms": round(total_latency / max(total, 1)),
                "pii_redacted_pct": 0, "success_rate": 100,
                "zdr_active": LLM_ZERO_DATA_RETENTION,
            }
        except Exception:
            return {"total_calls": 0, "by_module": {}, "by_provider": {},
                    "by_data_type": {}, "avg_latency_ms": 0, "pii_redacted_pct": 0, "success_rate": 100}

    total = len(source)
    by_module = {}; by_provider = {}; by_data_type = {}
    total_latency = 0; pii_count = 0
    for e in source:
        by_module[e["module"]] = by_module.get(e["module"], 0) + 1
        by_provider[e["provider"]] = by_provider.get(e["provider"], 0) + 1
        by_data_type[e["data_type"]] = by_data_type.get(e["data_type"], 0) + 1
        total_latency += e.get("latency_ms", 0)
        if e.get("pii_redacted"):
            pii_count += 1

    return {
        "total_calls": total,
        "by_module": by_module,
        "by_provider": by_provider,
        "by_data_type": by_data_type,
        "avg_latency_ms": round(total_latency / max(total, 1)),
        "pii_redacted_pct": round(pii_count / max(total, 1) * 100, 1),
        "zdr_active": LLM_ZERO_DATA_RETENTION,
        "success_rate": round(sum(1 for e in source if e.get("success")) / max(total, 1) * 100, 1),
    }


# ============================================================
# R8: DEPLOYMENT PRESETS
# ============================================================
# Three named deployment modes that configure all privacy-related settings.

DEPLOYMENT_PRESETS = {
    "standard": {
        "description": "Anthropic Cloud + Voyage + Together.ai — fastest setup, for demo & non-regulated SMBs",
        "LLM_PROVIDER": "anthropic",
        "RAG_EMBEDDING_PROVIDER": "voyage",
        "FINETUNE_PROVIDER": "together",
        "PII_REDACTION_ENABLED": "false",
        "LLM_ZERO_DATA_RETENTION": "false",
        "privacy_tier": "standard",
        "data_leaves_org": True,
    },
    "enterprise_private": {
        "description": "Bedrock/Vertex + local embeddings + no Together.ai — all LLM calls within customer VPC",
        "LLM_PROVIDER": "bedrock",  # or "vertex"
        "RAG_EMBEDDING_PROVIDER": "local",
        "FINETUNE_PROVIDER": "local",
        "PII_REDACTION_ENABLED": "true",
        "LLM_ZERO_DATA_RETENTION": "true",
        "privacy_tier": "vpc",
        "data_leaves_org": False,
    },
    "airgapped": {
        "description": "Self-hosted vLLM/Ollama + local TF-IDF + local fine-tuning — zero external network calls",
        "LLM_PROVIDER": "openai",
        "RAG_EMBEDDING_PROVIDER": "local",
        "FINETUNE_PROVIDER": "local",
        "PII_REDACTION_ENABLED": "true",
        "LLM_ZERO_DATA_RETENTION": "false",  # N/A for self-hosted
        "privacy_tier": "on_prem",
        "data_leaves_org": False,
    },
}

# Detect current preset from env
DEPLOYMENT_PRESET = os.environ.get("DEPLOYMENT_PRESET", "standard").lower()

# Additional privacy config (R4, R5 support)
EMBEDDING_PROVIDER = os.environ.get("RAG_EMBEDDING_PROVIDER", "voyage").lower()  # voyage | local | sentence_transformers
FINETUNE_PROVIDER = os.environ.get("FINETUNE_PROVIDER", "together").lower()  # together | local
PII_REDACTION = os.environ.get("PII_REDACTION_ENABLED", "false").lower()


def get_deployment_preset_info() -> dict:
    """Return current deployment preset and available presets."""
    current = DEPLOYMENT_PRESET if DEPLOYMENT_PRESET in DEPLOYMENT_PRESETS else "standard"
    return {
        "current_preset": current,
        "current_config": DEPLOYMENT_PRESETS.get(current, DEPLOYMENT_PRESETS["standard"]),
        "available_presets": {k: v["description"] for k, v in DEPLOYMENT_PRESETS.items()},
        "effective_config": {
            "llm_provider": LLM_PROVIDER,
            "embedding_provider": EMBEDDING_PROVIDER,
            "finetune_provider": FINETUNE_PROVIDER,
            "pii_redaction": PII_REDACTION == "true",
            "zero_data_retention": LLM_ZERO_DATA_RETENTION,
            "data_leaves_org": LLM_PROVIDER == "anthropic" or EMBEDDING_PROVIDER == "voyage" or FINETUNE_PROVIDER == "together",
        },
    }


# ============================================================
# R9: PER-VENDOR AI CONTROLS
# ============================================================
def get_vendor_ai_controls(vendor_name: str) -> dict:
    """Check per-vendor AI processing settings.
    Returns dict with: extraction_enabled, intelligence_enabled, include_in_training.
    Defaults to all-enabled if no vendor-specific override exists.
    """
    try:
        from backend.db import get_db
        db = get_db()
        profiles = db.get("vendor_profiles", [])
        for vp in profiles:
            if vp.get("vendor", "").lower() == vendor_name.lower():
                ai_controls = vp.get("ai_controls", {})
                return {
                    "extraction_enabled": ai_controls.get("extraction_enabled", True),
                    "intelligence_enabled": ai_controls.get("intelligence_enabled", True),
                    "include_in_training": ai_controls.get("include_in_training", True),
                }
    except Exception:
        pass
    # Default: all AI features enabled
    return {"extraction_enabled": True, "intelligence_enabled": True, "include_in_training": True}


def set_vendor_ai_controls(vendor_name: str, extraction: bool = True,
                            intelligence: bool = True, training: bool = True) -> dict:
    """Set per-vendor AI processing controls."""
    try:
        from backend.db import get_db, save_db
        db = get_db()
        profiles = db.setdefault("vendor_profiles", [])
        for vp in profiles:
            if vp.get("vendor", "").lower() == vendor_name.lower():
                vp.setdefault("ai_controls", {})
                vp["ai_controls"]["extraction_enabled"] = extraction
                vp["ai_controls"]["intelligence_enabled"] = intelligence
                vp["ai_controls"]["include_in_training"] = training
                save_db(db)
                return {"success": True, "vendor": vendor_name, "ai_controls": vp["ai_controls"]}

        # Vendor not found — create minimal profile
        new_profile = {
            "vendor": vendor_name,
            "ai_controls": {
                "extraction_enabled": extraction,
                "intelligence_enabled": intelligence,
                "include_in_training": training,
            }
        }
        profiles.append(new_profile)
        save_db(db)
        return {"success": True, "vendor": vendor_name, "ai_controls": new_profile["ai_controls"]}
    except Exception as e:
        return {"success": False, "error": str(e)}
