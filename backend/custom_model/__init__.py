"""
AuditLens — Custom Model Integration for Ensemble Extraction
================================================================

Enables a third (or replacement) model in the extraction ensemble.
The custom model can be:

  1. Anthropic fine-tuned — same API, trained on your correction data
  2. OpenAI-compatible    — any model behind an OpenAI-format endpoint
                            (vLLM, Ollama, Together, Fireworks, local LoRA)
  3. Local endpoint       — raw HTTP POST returning JSON

Training data pipeline:
  - Exports RAG correction chunks as fine-tuning JSONL
  - Format: system prompt + user (document description) → assistant (corrected JSON)
  - Tracks per-vendor, per-field correction patterns
  - Auto-flags when enough data exists for meaningful fine-tuning

Model performance tracker:
  - Records extraction accuracy per model per vendor
  - Computes dynamic weights for ensemble merging
  - Models that perform better on a given vendor get higher weight
"""

import json, os, time as _time, uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.config import (
    CUSTOM_MODEL_CONFIG, FINE_TUNE_MIN_CORRECTIONS,
    ENSEMBLE_PRIMARY_MODEL, ENSEMBLE_SECONDARY_MODEL,
)
from backend.db import get_db

__all__ = [
    'call_custom_model', 'is_custom_model_enabled', 'get_custom_model_config',
    'export_training_data', 'get_training_data_stats',
    'record_model_accuracy', 'get_model_weights',
    'get_ensemble_model_configs',
]

# ============================================================
# PATHS
# ============================================================
BASE_DIR = Path(__file__).parent.parent.parent
TRAINING_DIR = BASE_DIR / "data" / "training"
TRAINING_DIR.mkdir(parents=True, exist_ok=True)

MODEL_PERF_PATH = BASE_DIR / "data" / "model_performance.json"


# ============================================================
# CONFIG HELPERS
# ============================================================
def is_custom_model_enabled() -> bool:
    """Check if a custom model is configured and enabled."""
    cfg = get_custom_model_config()
    return cfg["enabled"] and bool(cfg["model"])


def get_custom_model_config() -> dict:
    """Return current custom model configuration, merging env + policy."""
    db = get_db()
    policy_overrides = db.get("custom_model_config", {})

    cfg = {**CUSTOM_MODEL_CONFIG}
    # Policy overrides env vars (except secrets)
    for k in ("enabled", "provider", "model", "endpoint", "label",
              "weight", "supports_vision", "max_tokens", "timeout_seconds"):
        if k in policy_overrides:
            cfg[k] = policy_overrides[k]
    return cfg


def get_ensemble_model_configs() -> list:
    """Return list of all active ensemble models with their metadata."""
    models = [
        {"id": "primary", "model": ENSEMBLE_PRIMARY_MODEL, "provider": "anthropic",
         "label": f"Claude {ENSEMBLE_PRIMARY_MODEL.split('-')[1].title()}", "weight": 1.0,
         "supports_vision": True},
        {"id": "secondary", "model": ENSEMBLE_SECONDARY_MODEL, "provider": "anthropic",
         "label": f"Claude {ENSEMBLE_SECONDARY_MODEL.split('-')[1].title()}", "weight": 1.0,
         "supports_vision": True},
    ]
    if is_custom_model_enabled():
        cfg = get_custom_model_config()
        models.append({
            "id": "custom", "model": cfg["model"], "provider": cfg["provider"],
            "label": cfg["label"], "weight": cfg["weight"],
            "supports_vision": cfg["supports_vision"],
        })
    return models


# ============================================================
# CUSTOM MODEL CALLER — supports Anthropic, OpenAI, local
# ============================================================
async def call_custom_model(content_block: dict, prompt: str, label: str = "Custom") -> dict:
    """
    Call the custom model for extraction. Returns dict in same format as _call_model.

    Adapts to different providers:
    - anthropic: Uses anthropic SDK (fine-tuned model)
    - openai_compatible: Uses httpx to call OpenAI-format endpoint
    - local: Raw HTTP POST
    """
    cfg = get_custom_model_config()
    if not cfg["enabled"] or not cfg["model"]:
        return {"_error": "Custom model not configured", "_model": "custom"}

    provider = cfg["provider"]
    model = cfg["model"]
    t0 = _time.time()

    try:
        if provider == "anthropic":
            result = await _call_anthropic_model(cfg, content_block, prompt, label)
        elif provider == "openai_compatible":
            result = await _call_openai_compatible(cfg, content_block, prompt, label)
        elif provider == "local":
            result = await _call_local_endpoint(cfg, content_block, prompt, label)
        else:
            return {"_error": f"Unknown provider: {provider}", "_model": model}

        elapsed = round((_time.time() - t0) * 1000)
        result["_model"] = model
        result["_latency_ms"] = elapsed
        result["_provider"] = provider
        print(f"[Ensemble:{label}] OK in {elapsed}ms — type={result.get('document_type')}, "
              f"vendor={result.get('vendor_name')}, total={result.get('total_amount')}")
        return result

    except Exception as e:
        elapsed = round((_time.time() - t0) * 1000)
        print(f"[Ensemble:{label}] Error after {elapsed}ms: {type(e).__name__}: {e}")
        return {"_error": str(e), "_model": model, "_latency_ms": elapsed}


async def _call_anthropic_model(cfg: dict, content_block: dict, prompt: str, label: str) -> dict:
    """Call an Anthropic fine-tuned model — same SDK, different model ID."""
    import anthropic
    client = anthropic.AsyncAnthropic()
    print(f"[Ensemble:{label}] Calling Anthropic fine-tuned: {cfg['model']}...")

    msg = await client.messages.create(
        model=cfg["model"],
        max_tokens=cfg["max_tokens"],
        messages=[{"role": "user", "content": [content_block, {"type": "text", "text": prompt}]}]
    )
    text = msg.content[0].text.strip()
    return _parse_json_response(text)


async def _call_openai_compatible(cfg: dict, content_block: dict, prompt: str, label: str) -> dict:
    """
    Call an OpenAI-compatible endpoint (vLLM, Ollama, Together, Fireworks, etc.).
    These endpoints accept /v1/chat/completions format.
    """
    import httpx

    endpoint = cfg["endpoint"].rstrip("/") + "/chat/completions"
    api_key = cfg["api_key"] or "not-needed"

    print(f"[Ensemble:{label}] Calling OpenAI-compatible: {cfg['model']} at {cfg['endpoint']}...")

    # Build messages — handle vision vs text-only
    if cfg["supports_vision"] and content_block.get("type") in ("image", "document"):
        # Convert Anthropic content_block format to OpenAI vision format
        user_content = [
            _convert_content_block_to_openai(content_block),
            {"type": "text", "text": prompt}
        ]
    else:
        # Text-only: describe the document in the prompt (no image)
        user_content = prompt + "\n\n[Note: This model does not support vision. " \
                       "Please extract based on any text context provided above.]"

    messages = [
        {"role": "system", "content": "You are a financial document extraction AI. "
                                       "Respond ONLY with valid JSON. No markdown, no explanation."},
        {"role": "user", "content": user_content}
    ]

    async with httpx.AsyncClient(timeout=cfg["timeout_seconds"]) as client:
        resp = await client.post(
            endpoint,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": cfg["model"], "max_tokens": cfg["max_tokens"],
                  "messages": messages, "temperature": 0}
        )
        resp.raise_for_status()
        data = resp.json()
        text = data["choices"][0]["message"]["content"].strip()
        return _parse_json_response(text)


async def _call_local_endpoint(cfg: dict, content_block: dict, prompt: str, label: str) -> dict:
    """Call a local HTTP endpoint that accepts a simple JSON POST and returns extraction JSON."""
    import httpx

    endpoint = cfg["endpoint"]
    print(f"[Ensemble:{label}] Calling local endpoint: {endpoint}...")

    payload = {"prompt": prompt, "model": cfg["model"]}

    # Include document data if vision is supported
    if cfg["supports_vision"] and content_block.get("source", {}).get("data"):
        payload["document_base64"] = content_block["source"]["data"]
        payload["document_type"] = content_block["source"].get("media_type", "application/pdf")

    async with httpx.AsyncClient(timeout=cfg["timeout_seconds"]) as client:
        resp = await client.post(endpoint, json=payload)
        resp.raise_for_status()
        data = resp.json()
        # Local endpoint can return extraction directly or wrapped
        if "extraction" in data:
            return data["extraction"]
        return _parse_json_response(json.dumps(data) if isinstance(data, dict) else data)


def _convert_content_block_to_openai(block: dict) -> dict:
    """Convert Anthropic content block format to OpenAI vision format."""
    if block.get("type") == "image":
        media_type = block["source"].get("media_type", "image/png")
        data = block["source"]["data"]
        return {"type": "image_url",
                "image_url": {"url": f"data:{media_type};base64,{data}"}}
    elif block.get("type") == "document":
        # PDFs aren't standard in OpenAI vision — send as base64 with description
        return {"type": "text",
                "text": "[PDF document provided as base64 — extract fields from context]"}
    return {"type": "text", "text": "[Document content]"}


def _parse_json_response(text: str) -> dict:
    """Parse JSON from model response, handling markdown fences."""
    if text.startswith("```"):
        first_nl = text.index("\n") if "\n" in text else len(text)
        text = text[first_nl + 1:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    return json.loads(text)


# ============================================================
# TRAINING DATA EXPORT — RAG corrections → fine-tuning JSONL
# ============================================================
def export_training_data(format: str = "anthropic") -> dict:
    """
    Export correction data as fine-tuning training pairs.

    Each correction becomes a training example:
      Input:  extraction prompt + vendor context + document description
      Output: corrected extraction JSON

    Supports formats:
      - "anthropic": Anthropic fine-tuning JSONL format
      - "openai":    OpenAI fine-tuning JSONL format
      - "alpaca":    Alpaca instruction-following format
    """
    db = get_db()
    corrections = db.get("correction_patterns", [])
    documents = {d["id"]: d for d in db.get("documents", [])}

    if not corrections:
        return {"success": False, "error": "No corrections available",
                "count": 0, "min_required": FINE_TUNE_MIN_CORRECTIONS}

    # Group corrections by document
    doc_corrections = {}
    for c in corrections:
        # Find the document this correction belongs to
        doc_id = None
        for d_id, d in documents.items():
            for edit in d.get("editHistory", []):
                if c["field"] in (edit.get("changes", {}) or {}):
                    if c["vendor"] == d.get("vendor", ""):
                        doc_id = d_id
                        break
            if doc_id:
                break
        if doc_id:
            doc_corrections.setdefault(doc_id, []).append(c)

    # Build training examples
    examples = []
    for doc_id, corrs in doc_corrections.items():
        doc = documents.get(doc_id, {})
        if not doc:
            continue

        # Build the "before" extraction (with errors)
        before = {}
        after = {}
        for c in corrs:
            field = c["field"]
            before[field] = c["extracted_value"]
            after[field] = c["corrected_value"]

        # Build the "correct" full extraction
        correct_extraction = {}
        for field in ["vendor_name", "invoice_number", "issue_date", "due_date",
                       "currency", "subtotal", "tax_amount", "total_amount",
                       "payment_terms", "po_reference", "document_type"]:
            val = doc.get(field) or doc.get(field.replace("_", ""), "")
            # Apply corrections
            if field in after:
                val = after[field]
            elif val:
                correct_extraction[field] = val

        correct_extraction.update(after)
        if doc.get("lineItems"):
            correct_extraction["line_items"] = doc["lineItems"]

        # Build vendor context (same as what extraction prompt uses)
        vendor = doc.get("vendor", "")
        vendor_context = f"Vendor: {vendor}" if vendor else ""

        example = _format_training_example(
            vendor_context=vendor_context,
            doc_type=doc.get("type", "invoice"),
            doc_description=_build_doc_description(doc),
            correct_extraction=correct_extraction,
            corrections_applied=corrs,
            format=format
        )
        if example:
            examples.append(example)

    if not examples:
        return {"success": False, "error": "Could not build training examples from corrections",
                "count": 0, "corrections_count": len(corrections)}

    # Write JSONL
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"training_{format}_{timestamp}.jsonl"
    filepath = TRAINING_DIR / filename

    with open(filepath, "w") as f:
        for ex in examples:
            f.write(json.dumps(ex) + "\n")

    return {
        "success": True,
        "format": format,
        "filepath": str(filepath),
        "filename": filename,
        "example_count": len(examples),
        "corrections_used": len(corrections),
        "vendors_covered": len(set(c["vendor"] for c in corrections if c.get("vendor"))),
        "ready_for_fine_tuning": len(examples) >= FINE_TUNE_MIN_CORRECTIONS,
        "min_recommended": FINE_TUNE_MIN_CORRECTIONS,
    }


def _build_doc_description(doc: dict) -> str:
    """Build a text description of a document for training examples."""
    parts = [
        f"Type: {doc.get('type', 'invoice')}",
        f"Vendor: {doc.get('vendor', 'Unknown')}",
        f"Number: {doc.get('invoiceNumber') or doc.get('poNumber', '')}",
        f"Date: {doc.get('issueDate', '')}",
        f"Amount: {doc.get('currency', 'USD')} {doc.get('amount', 0)}",
    ]
    if doc.get("lineItems"):
        parts.append(f"Line items: {len(doc['lineItems'])}")
    return ". ".join(parts)


def _format_training_example(vendor_context: str, doc_type: str,
                              doc_description: str, correct_extraction: dict,
                              corrections_applied: list, format: str) -> Optional[dict]:
    """Format a single training example for the target fine-tuning format."""
    system = ("You are a financial document extraction AI. Extract all fields from the "
              "document and return valid JSON. Be precise with numbers, dates, and vendor names.")

    user_prompt = f"Extract all fields from this {doc_type}.\n\n"
    if vendor_context:
        user_prompt += f"Context: {vendor_context}\n\n"
    user_prompt += f"Document info: {doc_description}\n\n"
    user_prompt += ("Fields needed: vendor_name, invoice_number, issue_date, due_date, "
                    "currency, subtotal, tax_amount, total_amount, payment_terms, "
                    "po_reference, document_type, line_items, tax_details")

    assistant_response = json.dumps(correct_extraction, indent=2)

    # Add correction context as metadata
    correction_notes = [f"Field '{c['field']}': extracted '{c['extracted_value']}' → "
                        f"corrected to '{c['corrected_value']}'" for c in corrections_applied]

    if format == "anthropic":
        return {
            "messages": [
                {"role": "user", "content": user_prompt},
                {"role": "assistant", "content": assistant_response}
            ],
            "_metadata": {
                "system": system,
                "corrections": correction_notes,
                "doc_type": doc_type,
                "vendor": corrections_applied[0].get("vendor", "") if corrections_applied else ""
            }
        }
    elif format == "openai":
        return {
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
                {"role": "assistant", "content": assistant_response}
            ]
        }
    elif format == "alpaca":
        return {
            "instruction": system,
            "input": user_prompt,
            "output": assistant_response,
            "metadata": {"corrections": correction_notes}
        }
    return None


def get_training_data_stats() -> dict:
    """Return statistics about available training data."""
    db = get_db()
    corrections = db.get("correction_patterns", [])

    if not corrections:
        return {"total_corrections": 0, "unique_vendors": 0,
                "unique_fields": 0, "ready": False, "min_required": FINE_TUNE_MIN_CORRECTIONS,
                "exported_files": []}

    vendors = set(c.get("vendor", "") for c in corrections)
    fields = set(c.get("field", "") for c in corrections)

    # Vendor breakdown
    vendor_counts = {}
    for c in corrections:
        v = c.get("vendor", "Unknown")
        vendor_counts[v] = vendor_counts.get(v, 0) + 1

    # Field breakdown
    field_counts = {}
    for c in corrections:
        f = c.get("field", "unknown")
        field_counts[f] = field_counts.get(f, 0) + 1

    # Check existing exports
    exports = sorted(TRAINING_DIR.glob("training_*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)

    return {
        "total_corrections": len(corrections),
        "unique_vendors": len(vendors),
        "unique_fields": len(fields),
        "vendor_breakdown": dict(sorted(vendor_counts.items(), key=lambda x: -x[1])[:10]),
        "field_breakdown": dict(sorted(field_counts.items(), key=lambda x: -x[1])),
        "ready": len(corrections) >= FINE_TUNE_MIN_CORRECTIONS,
        "min_required": FINE_TUNE_MIN_CORRECTIONS,
        "exported_files": [{"name": f.name, "size": f.stat().st_size,
                            "created": datetime.fromtimestamp(f.stat().st_mtime).isoformat()}
                           for f in exports[:5]],
    }


# ============================================================
# MODEL PERFORMANCE TRACKER — per-vendor accuracy weighting
# ============================================================
def _load_performance() -> dict:
    if MODEL_PERF_PATH.exists():
        try:
            return json.loads(MODEL_PERF_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"models": {}, "updated": None}


def _save_performance(data: dict):
    data["updated"] = datetime.now().isoformat()
    MODEL_PERF_PATH.write_text(json.dumps(data, indent=2))


def record_model_accuracy(model_id: str, vendor: str, field: str,
                           was_correct: bool, was_corrected_to: str = None):
    """
    Record whether a model's extraction for a given vendor/field was correct.
    Called when human corrections are applied.

    This builds a per-model, per-vendor accuracy profile that informs
    dynamic ensemble weighting.
    """
    perf = _load_performance()
    models = perf.setdefault("models", {})
    model_data = models.setdefault(model_id, {"total": 0, "correct": 0, "vendors": {}})

    model_data["total"] += 1
    if was_correct:
        model_data["correct"] += 1

    # Per-vendor tracking
    vendor_data = model_data["vendors"].setdefault(vendor, {"total": 0, "correct": 0, "fields": {}})
    vendor_data["total"] += 1
    if was_correct:
        vendor_data["correct"] += 1

    # Per-field tracking
    field_data = vendor_data["fields"].setdefault(field, {"total": 0, "correct": 0})
    field_data["total"] += 1
    if was_correct:
        field_data["correct"] += 1

    _save_performance(perf)


def get_model_weights(vendor: str = None) -> dict:
    """
    Compute dynamic ensemble weights based on model track record.

    If a custom model has higher accuracy for a specific vendor,
    it gets higher weight in the ensemble merge for that vendor.

    Returns: {"primary": 1.0, "secondary": 0.8, "custom": 1.2}
    """
    perf = _load_performance()
    models = perf.get("models", {})

    weights = {
        "primary": 1.0,
        "secondary": 1.0,
    }

    if is_custom_model_enabled():
        cfg = get_custom_model_config()
        weights["custom"] = cfg.get("weight", 1.0)

    if not models:
        return weights

    # Compute accuracy-based weights
    for model_key in weights:
        model_data = models.get(model_key, {})
        if not model_data.get("total"):
            continue

        if vendor:
            # Vendor-specific accuracy
            vendor_data = model_data.get("vendors", {}).get(vendor, {})
            if vendor_data.get("total", 0) >= 5:  # Minimum 5 extractions for statistical confidence
                accuracy = vendor_data["correct"] / vendor_data["total"]
                # Scale weight: 50% accuracy = 0.5x, 100% accuracy = 1.5x
                weights[model_key] = 0.5 + accuracy
        else:
            # Global accuracy
            if model_data["total"] >= 10:
                accuracy = model_data["correct"] / model_data["total"]
                weights[model_key] = 0.5 + accuracy

    return weights


def get_model_performance_summary() -> dict:
    """Return a summary of all model performance metrics."""
    perf = _load_performance()
    models = perf.get("models", {})

    summary = {}
    for model_id, data in models.items():
        total = data.get("total", 0)
        correct = data.get("correct", 0)
        vendors = data.get("vendors", {})

        vendor_stats = {}
        for v_name, v_data in sorted(vendors.items(), key=lambda x: -x[1].get("total", 0))[:10]:
            v_total = v_data.get("total", 0)
            v_correct = v_data.get("correct", 0)
            vendor_stats[v_name] = {
                "total": v_total,
                "correct": v_correct,
                "accuracy": round(v_correct / v_total * 100, 1) if v_total > 0 else 0,
            }

        summary[model_id] = {
            "total_extractions": total,
            "correct_extractions": correct,
            "global_accuracy": round(correct / total * 100, 1) if total > 0 else 0,
            "top_vendors": vendor_stats,
        }

    return summary
