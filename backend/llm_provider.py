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
) -> Optional[str]:
    """
    Text-only LLM call. Used by: ai_intelligence, anomalies (AI mode).
    Returns response text or None on failure.
    """
    model_name = resolve_model(model)

    try:
        if LLM_PROVIDER == "anthropic":
            return await _anthropic_text(model_name, prompt, max_tokens, system, temperature)
        elif LLM_PROVIDER == "bedrock":
            return await _bedrock_text(model_name, prompt, max_tokens, system, temperature)
        elif LLM_PROVIDER == "vertex":
            return await _vertex_text(model_name, prompt, max_tokens, system, temperature)
        elif LLM_PROVIDER == "openai":
            return await _openai_text(model_name, prompt, max_tokens, system, temperature)
        else:
            print(f"[LLM Provider] Unknown provider: {LLM_PROVIDER}")
            return None
    except Exception as e:
        print(f"[LLM Provider] {LLM_PROVIDER}:{model_name} text call failed: {e}")
        return None


async def llm_call_with_document(
    document_b64: str,
    media_type: str,
    prompt: str,
    model: str = "primary",
    max_tokens: int = 4000,
    system: str = "",
    temperature: float = 0.0,
) -> Optional[str]:
    """
    Document + text LLM call. Used by: extraction, anomaly resolution.
    Sends a PDF/image as base64 along with the prompt.
    Returns response text or None on failure.
    """
    model_name = resolve_model(model)

    try:
        if LLM_PROVIDER == "anthropic":
            return await _anthropic_document(model_name, document_b64, media_type, prompt, max_tokens, system, temperature)
        elif LLM_PROVIDER == "bedrock":
            return await _bedrock_document(model_name, document_b64, media_type, prompt, max_tokens, system, temperature)
        elif LLM_PROVIDER == "vertex":
            return await _vertex_document(model_name, document_b64, media_type, prompt, max_tokens, system, temperature)
        elif LLM_PROVIDER == "openai":
            return await _openai_document(model_name, document_b64, media_type, prompt, max_tokens, system, temperature)
        else:
            print(f"[LLM Provider] Unknown provider: {LLM_PROVIDER}")
            return None
    except Exception as e:
        print(f"[LLM Provider] {LLM_PROVIDER}:{model_name} document call failed: {e}")
        return None


# ============================================================
# PROVIDER: ANTHROPIC (Direct API)
# ============================================================

async def _anthropic_text(model, prompt, max_tokens, system, temperature):
    import anthropic

    kwargs = {}
    if LLM_ZERO_DATA_RETENTION:
        kwargs["extra_headers"] = {"anthropic-beta": "zero-data-retention"}

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

    kwargs = {}
    if LLM_ZERO_DATA_RETENTION:
        kwargs["extra_headers"] = {"anthropic-beta": "zero-data-retention"}

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
    print(f"[LLM Provider] Available:  {info['available']}")
    print(f"[LLM Provider] ═══════════════════════════════════════")
