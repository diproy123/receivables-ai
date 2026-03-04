"""
AuditLens — Fine-Tuning Integration (Multi-Provider)
=======================================================

Full lifecycle management for custom model fine-tuning:

  Provider: together (default)
    Uses Together.ai cloud for LoRA fine-tuning on Qwen2.5-7B-Instruct
    Data leaves organization → NOT suitable for enterprise/regulated clients

  Provider: local
    Writes JSONL training data to local filesystem only
    Customer runs fine-tuning in their own environment (HuggingFace PEFT/LoRA)
    Data NEVER leaves organization → suitable for SOX/GDPR/air-gapped deployments

  1. FORMAT  — Convert AuditLens correction_patterns → JSONL (both providers)
  2. UPLOAD  — Push to Together (together) or write locally (local)
  3. TRAIN   — Trigger Together job (together) or signal readiness (local)
  4. MONITOR — Poll Together status (together) or check local flag (local)
  5. ACTIVATE — Configure custom model in extraction pipeline

Env vars:
  FINETUNE_PROVIDER = together | local  (default: together)
  TOGETHER_API_KEY — your Together.ai API key (only for together provider)
  FINETUNE_LOCAL_DIR — directory for local training data export (default: data/finetune)

Together.ai SDK docs: https://docs.together.ai/docs/fine-tuning-quickstart
"""

import os, json, time
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.db import get_db, save_db
from backend.config import FINE_TUNE_MIN_CORRECTIONS

# R3: Fine-tuning provider selection
FINETUNE_PROVIDER = os.environ.get("FINETUNE_PROVIDER", "together").lower()  # together | local

__all__ = [
    'is_together_configured', 'get_together_status',
    'prepare_training_file', 'upload_training_file',
    'start_finetune_job', 'get_finetune_status', 'list_finetune_jobs',
    'activate_finetuned_model', 'get_finetune_history',
    'TOGETHER_BASE_MODEL', 'TOGETHER_LORA_INFERENCE_MODEL',
]

# ============================================================
# CONSTANTS
# ============================================================
BASE_DIR = Path(__file__).parent.parent.parent
TRAINING_DIR = BASE_DIR / "data" / "training"
TRAINING_DIR.mkdir(parents=True, exist_ok=True)

# Together uses -Reference models for fine-tuning and LoRA inference
# Turbo variants are NOT compatible with LoRA adapter upload
TOGETHER_BASE_MODEL = "Qwen/Qwen2.5-7B-Instruct-Turbo"
TOGETHER_LORA_INFERENCE_MODEL = "Qwen/Qwen2.5-7B-Instruct-Turbo"

# Default hyperparameters (optimized for small datasets like correction patterns)
DEFAULT_HYPERPARAMS = {
    "n_epochs": 3,
    "learning_rate": 1e-5,
    "batch_size": "max",
    "lora": True,
    "n_checkpoints": 1,
    "warmup_ratio": 0.1,
    "suffix": "auditlens",
    "train_on_inputs": "auto",
}


# ============================================================
# HELPERS
# ============================================================
def _get_client():
    """Get Together SDK client. Raises if not configured."""
    try:
        from together import Together
    except ImportError:
        raise RuntimeError("Together SDK not installed. Run: pip install together")
    api_key = os.environ.get("TOGETHER_API_KEY")
    if not api_key:
        raise RuntimeError("TOGETHER_API_KEY environment variable not set")
    return Together(api_key=api_key)


def is_together_configured() -> bool:
    """Check if Together.ai is configured and selected as fine-tuning provider."""
    if FINETUNE_PROVIDER != "together":
        return False  # Using local fine-tuning, Together not needed
    return bool(os.environ.get("TOGETHER_API_KEY"))


def is_local_finetune() -> bool:
    """Check if local fine-tuning mode is active (R3: data never leaves org)."""
    return FINETUNE_PROVIDER == "local"


def get_together_status() -> dict:
    """Return fine-tuning integration status and readiness."""
    try:
        db = get_db()
        corrections = db.get("correction_patterns", [])
        ft_history = db.get("finetune_history", [])
        active_job = db.get("active_finetune_job", None)

        return {
            "finetune_provider": FINETUNE_PROVIDER,
            "configured": is_together_configured() if FINETUNE_PROVIDER == "together" else True,
            "local_mode": is_local_finetune(),
            "data_leaves_org": FINETUNE_PROVIDER == "together",
            "base_model": TOGETHER_BASE_MODEL,
            "method": "LoRA (Low-Rank Adaptation)",
            "corrections_available": len(corrections),
            "corrections_required": FINE_TUNE_MIN_CORRECTIONS,
            "ready_to_train": len(corrections) >= FINE_TUNE_MIN_CORRECTIONS,
            "active_job": active_job,
            "completed_jobs": len([j for j in ft_history if j.get("status") == "completed"]),
            "active_custom_model": db.get("custom_model_config", {}).get("model"),
            "history": ft_history[-5:],  # last 5 jobs
        }
    except Exception as e:
        return {"finetune_provider": FINETUNE_PROVIDER, "configured": False, "error": str(e),
                "corrections_available": 0, "local_mode": is_local_finetune(),
                "corrections_required": FINE_TUNE_MIN_CORRECTIONS, "ready_to_train": False,
                "base_model": TOGETHER_BASE_MODEL, "method": "LoRA (Low-Rank Adaptation)",
                "active_job": None, "completed_jobs": 0, "active_custom_model": None, "history": []}


# ============================================================
# STEP 1: FORMAT — Corrections → Together JSONL
# ============================================================
def prepare_training_file() -> dict:
    """
    Convert correction_patterns from the DB into Together.ai training format.

    Together expects JSONL with chat-format messages:
    {"messages": [
        {"role": "system", "content": "..."},
        {"role": "user", "content": "..."},
        {"role": "assistant", "content": "..."}
    ]}

    We build training examples from:
    1. Each corrected document → (prompt about vendor/doc) → (correct extraction JSON)
    2. Correction patterns → teach the model common error patterns to avoid
    """
    db = get_db()
    corrections = db.get("correction_patterns", [])
    documents = {d["id"]: d for d in db.get("documents", [])}

    if not corrections:
        return {"success": False, "error": "No corrections available", "count": 0}

    if len(corrections) < FINE_TUNE_MIN_CORRECTIONS:
        return {
            "success": False,
            "error": f"Need at least {FINE_TUNE_MIN_CORRECTIONS} corrections, have {len(corrections)}",
            "count": len(corrections),
            "min_required": FINE_TUNE_MIN_CORRECTIONS,
        }

    examples = []
    system_msg = (
        "You are a financial document extraction AI for AuditLens. "
        "Extract all fields from the invoice/document and return ONLY valid JSON. "
        "Be precise with amounts, tax calculations, dates, and vendor names. "
        "Fields: vendor_name, document_number, document_type, issue_date, due_date, "
        "currency, subtotal, tax_amount, total_amount, payment_terms, po_reference, "
        "line_items (array of {description, quantity, unitPrice, total}), "
        "tax_details (array of {taxType, rate, amount}). "
        "No markdown, no explanation — only JSON."
    )

    # Group corrections by document
    doc_corrections = {}
    for c in corrections:
        vendor = c.get("vendor", "")
        doc_type = c.get("documentType", "invoice")
        key = f"{vendor}_{doc_type}"
        doc_corrections.setdefault(key, []).append(c)

    # Build examples from corrected documents
    for doc_id, doc in documents.items():
        if not doc.get("editHistory"):
            continue

        vendor = doc.get("vendor", "Unknown")
        doc_type = doc.get("type", "invoice")
        currency = doc.get("currency", "USD")

        # Build the correct extraction (post-correction)
        correct = {
            "vendor_name": vendor,
            "document_type": doc_type,
            "document_number": doc.get("invoiceNumber") or doc.get("poNumber", ""),
            "issue_date": doc.get("issueDate", ""),
            "due_date": doc.get("dueDate", ""),
            "currency": currency,
            "subtotal": doc.get("subtotal", 0),
            "tax_amount": doc.get("taxAmount", 0),
            "total_amount": doc.get("amount", 0),
            "payment_terms": doc.get("paymentTerms", ""),
            "po_reference": doc.get("poReference", ""),
        }
        if doc.get("lineItems"):
            correct["line_items"] = doc["lineItems"]
        if doc.get("taxDetails"):
            correct["tax_details"] = doc["taxDetails"]

        # User message: describe the document context
        user_msg = f"Extract all fields from this {doc_type}.\n\n"
        user_msg += f"Vendor: {vendor}\n"
        user_msg += f"Document number: {correct['document_number']}\n"
        user_msg += f"Currency: {currency}\n"
        user_msg += f"Amount: {currency} {correct['total_amount']}\n"
        if doc.get("lineItems"):
            user_msg += f"Line items: {len(doc['lineItems'])}\n"

        # Add correction context — this teaches the model what to avoid
        edit_notes = []
        for edit in doc.get("editHistory", []):
            for field, change in edit.get("changes", {}).items():
                edit_notes.append(f"Note: Field '{field}' was commonly misread. Correct value: {change}")
        if edit_notes:
            user_msg += "\nCorrection hints:\n" + "\n".join(edit_notes[:5])

        examples.append({
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
                {"role": "assistant", "content": json.dumps(correct, indent=2)},
            ]
        })

    # Also build vendor-pattern examples from corrections without full documents
    vendor_groups = {}
    for c in corrections:
        v = c.get("vendor", "Unknown")
        vendor_groups.setdefault(v, []).append(c)

    for vendor, corrs in vendor_groups.items():
        if len(corrs) < 2:
            continue
        # Teach the model this vendor's correction patterns
        pattern_msg = f"Extract fields for a document from vendor: {vendor}\n\n"
        pattern_msg += "Known patterns for this vendor:\n"
        for c in corrs[:10]:
            ext_val = c.get('extracted_value', c.get('old_value', ''))
            cor_val = c.get('corrected_value', c.get('new_value', ''))
            pattern_msg += f"- Field '{c['field']}': often extracted as '{ext_val}' but correct is '{cor_val}'\n"

        # Build a synthetic correct output
        synthetic = {"vendor_name": vendor, "document_type": corrs[0].get("documentType", "invoice")}
        for c in corrs:
            cor_val = c.get("corrected_value", c.get("new_value", ""))
            if c["field"] in ("total_amount", "subtotal", "tax_amount"):
                try:
                    synthetic[c["field"]] = float(cor_val)
                except (ValueError, TypeError):
                    synthetic[c["field"]] = cor_val
            else:
                synthetic[c["field"]] = cor_val

        examples.append({
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": pattern_msg},
                {"role": "assistant", "content": json.dumps(synthetic, indent=2)},
            ]
        })

    if not examples:
        return {"success": False, "error": "Could not build training examples", "count": 0}

    # Write JSONL
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"together_train_{timestamp}.jsonl"
    filepath = TRAINING_DIR / filename

    with open(filepath, "w") as f:
        for ex in examples:
            f.write(json.dumps(ex) + "\n")

    return {
        "success": True,
        "filepath": str(filepath),
        "filename": filename,
        "example_count": len(examples),
        "corrections_used": len(corrections),
        "vendors_covered": len(vendor_groups),
        "file_size_bytes": filepath.stat().st_size,
    }


# ============================================================
# STEP 2: UPLOAD — Push training file to Together OR write locally
# ============================================================
def upload_training_file(filepath: str = None) -> dict:
    """
    Upload a training JSONL file to Together.ai, or write to local directory.
    If FINETUNE_PROVIDER=local, data stays on-premise — never uploaded externally.
    If no filepath given, prepares one automatically.
    Returns the file info needed for fine-tuning.
    """
    # R3: LOCAL MODE — data never leaves the organization
    if is_local_finetune():
        if not filepath:
            prep = prepare_training_file()
            if not prep["success"]:
                return prep
            filepath = prep["filepath"]

        if not Path(filepath).exists():
            return {"success": False, "error": f"File not found: {filepath}"}

        # Copy to configured local finetune directory
        local_dir = Path(os.environ.get("FINETUNE_LOCAL_DIR",
                         str(Path(__file__).parent.parent.parent / "data" / "finetune")))
        local_dir.mkdir(parents=True, exist_ok=True)
        dest = local_dir / Path(filepath).name
        import shutil
        shutil.copy2(filepath, dest)

        # Record in DB
        db = get_db()
        file_id = f"local_{int(time.time())}"
        db.setdefault("together_files", []).append({
            "file_id": file_id,
            "filename": Path(filepath).name,
            "local_path": str(dest),
            "uploaded_at": datetime.now().isoformat(),
            "provider": "local",
        })
        save_db(db)

        print(f"[FineTune:Local] Training data saved: {dest} ({dest.stat().st_size} bytes)")
        print(f"[FineTune:Local] Data stays on-premise. Run HuggingFace PEFT/LoRA training externally.")
        return {
            "success": True,
            "file_id": file_id,
            "filename": Path(filepath).name,
            "local_path": str(dest),
            "provider": "local",
            "message": "Training data saved locally. Use HuggingFace PEFT/LoRA for fine-tuning in your environment.",
        }

    # TOGETHER MODE — upload to Together.ai cloud
    if not is_together_configured():
        return {"success": False, "error": "TOGETHER_API_KEY not set (or set FINETUNE_PROVIDER=local for on-premise)"}

    # Prepare file if none provided
    if not filepath:
        prep = prepare_training_file()
        if not prep["success"]:
            return prep
        filepath = prep["filepath"]

    if not Path(filepath).exists():
        return {"success": False, "error": f"File not found: {filepath}"}

    # R9: Check vendor AI controls — exclude opted-out vendors from training data
    try:
        from backend.llm_provider import get_vendor_ai_controls
        # Read the JSONL and filter out vendors that opted out of training
        filtered_lines = []
        with open(filepath, "r") as f:
            for line in f:
                try:
                    entry = json.loads(line)
                    # Check if any vendor name in messages is opted out
                    messages_text = json.dumps(entry.get("messages", []))
                    # Simple heuristic: check vendor_name in synthetic output
                    vendor = ""
                    for msg in entry.get("messages", []):
                        if msg.get("role") == "assistant":
                            try:
                                content = json.loads(msg.get("content", "{}"))
                                vendor = content.get("vendor_name", "")
                            except Exception:
                                pass
                    if vendor:
                        controls = get_vendor_ai_controls(vendor)
                        if not controls.get("include_in_training", True):
                            print(f"[FineTune] Excluding vendor '{vendor}' from training (opted out)")
                            continue
                    filtered_lines.append(line)
                except Exception:
                    filtered_lines.append(line)

        # Rewrite filtered file
        if len(filtered_lines) < sum(1 for _ in open(filepath)):
            with open(filepath, "w") as f:
                f.writelines(filtered_lines)
            print(f"[FineTune] Filtered training data: {len(filtered_lines)} examples after vendor opt-out")
    except ImportError:
        pass  # R9 not yet fully integrated

    client = _get_client()

    try:
        response = client.files.upload(
            file=open(filepath, "rb"),
            purpose="fine-tune"
        )

        file_id = response.id
        print(f"[Together] File uploaded: {file_id} ({Path(filepath).name})")

        # Store upload info in DB
        db = get_db()
        db.setdefault("together_files", []).append({
            "file_id": file_id,
            "filename": Path(filepath).name,
            "local_path": filepath,
            "uploaded_at": datetime.now().isoformat(),
        })
        save_db(db)

        return {
            "success": True,
            "file_id": file_id,
            "filename": Path(filepath).name,
        }
    except Exception as e:
        return {"success": False, "error": f"Upload failed: {e}"}


# ============================================================
# STEP 3: TRAIN — Trigger LoRA fine-tuning
# ============================================================
def start_finetune_job(file_id: str = None, hyperparams: dict = None) -> dict:
    """
    Start a LoRA fine-tuning job on Together.ai.

    If no file_id given, uploads training data automatically.
    Returns job ID and status.

    This is the one API call that kicks off training:
      together.fine_tuning.create(
          model="Qwen/Qwen2.5-7B-Instruct-Turbo",
          training_file="file-xxxx",
          lora=True, ...
      )

    Training typically takes 10-30 minutes for small datasets.
    """
    if not is_together_configured():
        return {"success": False, "error": "TOGETHER_API_KEY not set"}

    # Auto-upload if no file_id
    if not file_id:
        upload_result = upload_training_file()
        if not upload_result["success"]:
            return upload_result
        file_id = upload_result["file_id"]

    client = _get_client()
    params = {**DEFAULT_HYPERPARAMS, **(hyperparams or {})}

    try:
        response = client.fine_tuning.create(
            model=TOGETHER_BASE_MODEL,
            training_file=file_id,
            n_epochs=params["n_epochs"],
            learning_rate=params["learning_rate"],
            batch_size=params["batch_size"],
            lora=params["lora"],
            n_checkpoints=params["n_checkpoints"],
            warmup_ratio=params["warmup_ratio"],
            suffix=params["suffix"],
            train_on_inputs=params["train_on_inputs"],
        )

        job_id = response.id
        print(f"[Together] Fine-tuning job started: {job_id}")

        # Store job info
        db = get_db()
        job_record = {
            "job_id": job_id,
            "file_id": file_id,
            "base_model": TOGETHER_BASE_MODEL,
            "method": "lora",
            "hyperparams": params,
            "status": "pending",
            "started_at": datetime.now().isoformat(),
            "output_model": None,
        }
        db["active_finetune_job"] = job_record
        db.setdefault("finetune_history", []).append(job_record)
        save_db(db)

        return {
            "success": True,
            "job_id": job_id,
            "base_model": TOGETHER_BASE_MODEL,
            "method": "lora",
            "status": "pending",
            "message": "Fine-tuning job submitted. Typically takes 10-30 minutes.",
        }
    except Exception as e:
        return {"success": False, "error": f"Fine-tuning failed to start: {e}"}


# ============================================================
# STEP 4: MONITOR — Poll job status
# ============================================================
def get_finetune_status(job_id: str = None) -> dict:
    """
    Check the status of a fine-tuning job.

    Possible statuses: pending, running, completed, failed, cancelled

    When completed, the response includes the output model name
    which can be used for inference.
    """
    if not is_together_configured():
        return {"success": False, "error": "TOGETHER_API_KEY not set"}

    # Use active job if none specified
    if not job_id:
        db = get_db()
        active = db.get("active_finetune_job")
        if not active:
            return {"success": False, "error": "No active fine-tuning job"}
        job_id = active["job_id"]

    client = _get_client()

    try:
        response = client.fine_tuning.retrieve(id=job_id)

        status = str(response.status).split(".")[-1].strip("'\"").lower()
        # Extract status string from enum like FinetuneJobStatus.STATUS_COMPLETED
        if "complete" in status:
            status = "completed"
        elif "running" in status or "processing" in status:
            status = "running"
        elif "pending" in status or "queued" in status:
            status = "pending"
        elif "fail" in status or "error" in status:
            status = "failed"
        elif "cancel" in status:
            status = "cancelled"

        result = {
            "success": True,
            "job_id": job_id,
            "status": status,
            "base_model": TOGETHER_BASE_MODEL,
        }

        # Extract output model name if completed
        output_name = getattr(response, "output_name", None) or getattr(response, "model_output_name", None)
        if output_name:
            result["output_model"] = output_name

        # Get events/progress
        try:
            events = client.fine_tuning.list_events(id=job_id)
            if events:
                event_list = [str(e) for e in (events.data if hasattr(events, 'data') else events)]
                result["events"] = event_list[-10:]  # last 10 events
        except Exception:
            pass

        # Update DB
        db = get_db()
        active = db.get("active_finetune_job")
        if active and active.get("job_id") == job_id:
            active["status"] = status
            if output_name:
                active["output_model"] = output_name
            if status in ("completed", "failed", "cancelled"):
                active["completed_at"] = datetime.now().isoformat()

        # Update history too
        for j in db.get("finetune_history", []):
            if j.get("job_id") == job_id:
                j["status"] = status
                if output_name:
                    j["output_model"] = output_name
                if status in ("completed", "failed", "cancelled"):
                    j["completed_at"] = datetime.now().isoformat()
                break

        save_db(db)

        # Auto-activate if completed
        if status == "completed" and output_name:
            result["auto_activate"] = True
            result["message"] = f"Training complete! Model: {output_name}. Activating in ensemble..."
            activate_finetuned_model(output_name)

        return result

    except Exception as e:
        return {"success": False, "error": f"Status check failed: {e}"}


def list_finetune_jobs() -> dict:
    """List all fine-tuning jobs from Together.ai."""
    if not is_together_configured():
        return {"success": False, "error": "TOGETHER_API_KEY not set"}

    client = _get_client()
    try:
        response = client.fine_tuning.list()
        jobs = []
        for j in (response.data if hasattr(response, 'data') else response):
            jobs.append({
                "id": getattr(j, 'id', str(j)),
                "model": getattr(j, 'model', ''),
                "status": str(getattr(j, 'status', '')),
                "created": str(getattr(j, 'created_at', '')),
            })
        return {"success": True, "jobs": jobs}
    except Exception as e:
        return {"success": False, "error": f"List failed: {e}"}


# ============================================================
# STEP 5: ACTIVATE — Configure the fine-tuned model in ensemble
# ============================================================
def activate_finetuned_model(model_name: str) -> dict:
    """
    Activate a fine-tuned model in the AuditLens extraction ensemble.

    This updates custom_model_config so the ensemble pipeline will
    call the fine-tuned model alongside Sonnet + Haiku.

    For LoRA fine-tunes on Together, inference is serverless — you just
    call the model by name and Together handles adapter loading.
    """
    try:
        db = get_db()

        db["custom_model_config"] = {
            "enabled": True,
            "provider": "openai_compatible",
            "model": model_name,
            "endpoint": "https://api.together.xyz/v1",
            "api_key": os.environ.get("TOGETHER_API_KEY", ""),
            "label": f"Qwen-AuditLens-LoRA",
            "weight": 1.2,  # Slightly higher weight — it knows your data
            "supports_vision": False,  # Text-only for Qwen 7B
            "max_tokens": 4000,
            "timeout_seconds": 30,
        }
        save_db(db)

        print(f"[Together] Activated fine-tuned model: {model_name}")
        print(f"[Together] Ensemble is now: Sonnet + Haiku + {model_name}")

        return {
            "success": True,
            "model": model_name,
            "label": "Qwen-AuditLens-LoRA",
            "ensemble": ["Claude Sonnet (primary)", "Claude Haiku (secondary)", f"{model_name} (custom)"],
            "weight": 1.2,
            "message": "Fine-tuned model activated in ensemble. Next extraction will use 3-model pipeline.",
        }
    except Exception as e:
        return {"success": False, "error": f"Activation failed: {str(e)}"}


def deactivate_custom_model() -> dict:
    """Disable the custom model, reverting to 2-model ensemble."""
    try:
        db = get_db()
        if "custom_model_config" in db:
            db["custom_model_config"]["enabled"] = False
        save_db(db)
        return {"success": True, "message": "Custom model deactivated. Using Sonnet + Haiku only."}
    except Exception as e:
        return {"success": False, "error": f"Deactivation failed: {str(e)}"}


# ============================================================
# HISTORY & STATS
# ============================================================
def get_finetune_history() -> list:
    """Return all fine-tuning job history."""
    try:
        db = get_db()
        return db.get("finetune_history", [])
    except Exception:
        return []


# ============================================================
# ONE-CLICK PIPELINE — prepare + upload + train
# ============================================================
def run_full_finetune_pipeline(hyperparams: dict = None) -> dict:
    """
    One-click: prepare training data → upload → start fine-tuning.

    This is the function called by POST /api/together/finetune.
    Returns immediately with job_id. Training happens async on Together.

    Use GET /api/together/status?job_id=xxx to poll progress.
    When training completes, model is auto-activated in ensemble.
    """
    try:
        print("[Together] Starting full fine-tuning pipeline...")

        # Step 1: Prepare
        print("[Together] Step 1/3: Preparing training data...")
        prep = prepare_training_file()
        if not prep["success"]:
            return prep
        print(f"[Together] Prepared {prep['example_count']} training examples")

        # Step 2: Upload
        print("[Together] Step 2/3: Uploading to Together.ai...")
        upload = upload_training_file(prep["filepath"])
        if not upload["success"]:
            return upload
        print(f"[Together] File uploaded: {upload['file_id']}")

        # Step 3: Start training
        print("[Together] Step 3/3: Starting LoRA fine-tuning...")
        job = start_finetune_job(upload["file_id"], hyperparams)
        if not job["success"]:
            return job

        job["training_examples"] = prep["example_count"]
        job["vendors_covered"] = prep.get("vendors_covered", 0)
        job["file_id"] = upload["file_id"]

        print(f"[Together] Pipeline complete. Job {job['job_id']} is training.")
        print(f"[Together] Model will auto-activate when training finishes.")

        return job
    except Exception as e:
        return {"success": False, "error": f"Pipeline failed: {str(e)}"}
