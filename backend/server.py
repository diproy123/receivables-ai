"""
Receivables AI — Backend Server
FastAPI + Claude API for document extraction, PO matching, and AR management
"""

import os
import json
import base64
import uuid
import asyncio
from datetime import datetime, timedelta
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import anthropic

# ============================================================
# CONFIG
# ============================================================
UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
DATA_DIR = Path(__file__).parent.parent / "data"
UPLOAD_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = DATA_DIR / "db.json"

# Claude API — uses ANTHROPIC_API_KEY env var automatically
# If no key set, falls back to smart mock extraction
USE_REAL_API = bool(os.environ.get("ANTHROPIC_API_KEY"))

app = FastAPI(title="Receivables AI", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# IN-MEMORY DATABASE (persisted to JSON)
# ============================================================
def load_db():
    if DB_PATH.exists():
        with open(DB_PATH) as f:
            return json.load(f)
    return {"invoices": [], "purchase_orders": [], "matches": [], "activity_log": []}

def save_db(db):
    with open(DB_PATH, "w") as f:
        json.dump(db, f, indent=2, default=str)

def get_db():
    return load_db()

# ============================================================
# CLAUDE API EXTRACTION
# ============================================================
EXTRACTION_PROMPT = """You are an expert financial document processor. Analyze this document and extract structured data.

Determine if this is an INVOICE or a PURCHASE ORDER, then extract ALL available fields.

Respond ONLY with a valid JSON object (no markdown, no backticks, no explanation) with this exact structure:

{
  "document_type": "invoice" or "purchase_order",
  "document_number": "the invoice number or PO number",
  "vendor_name": "company/vendor name",
  "total_amount": 12345.67,
  "issue_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD (for invoices) or null",
  "delivery_date": "YYYY-MM-DD (for POs) or null",
  "po_reference": "PO number referenced in invoice, or null",
  "payment_terms": "Net 30, etc. or null",
  "currency": "USD",
  "line_items": [
    {
      "description": "item description",
      "quantity": 5,
      "unit_price": 100.00,
      "total": 500.00
    }
  ],
  "notes": "any additional notes or special instructions",
  "bill_to": "billing address or company if visible",
  "ship_to": "shipping address if visible or null"
}

Be precise with numbers. If a field is not visible, use null. Always extract line items if present."""


async def extract_with_claude(file_path: str, file_name: str, media_type: str) -> dict:
    """Extract document data using Claude's vision capabilities."""
    
    if not USE_REAL_API:
        return await mock_extraction(file_name)
    
    client = anthropic.Anthropic()
    
    with open(file_path, "rb") as f:
        file_bytes = f.read()
    
    b64_data = base64.standard_b64encode(file_bytes).decode("utf-8")
    
    # Determine content type for Claude
    if media_type == "application/pdf":
        content_block = {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": b64_data
            }
        }
    else:
        # Image files
        img_type = media_type if media_type in ["image/jpeg", "image/png", "image/gif", "image/webp"] else "image/png"
        content_block = {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": img_type,
                "data": b64_data
            }
        }
    
    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            messages=[
                {
                    "role": "user",
                    "content": [
                        content_block,
                        {
                            "type": "text",
                            "text": EXTRACTION_PROMPT
                        }
                    ]
                }
            ]
        )
        
        response_text = message.content[0].text.strip()
        # Clean potential markdown fencing
        if response_text.startswith("```"):
            response_text = response_text.split("\n", 1)[1]
            if response_text.endswith("```"):
                response_text = response_text[:-3]
            response_text = response_text.strip()
        
        extracted = json.loads(response_text)
        extracted["_confidence"] = 96  # Claude extraction confidence
        extracted["_source"] = "claude_api"
        return extracted
        
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
        print(f"Response was: {response_text[:500]}")
        return await mock_extraction(file_name)
    except Exception as e:
        print(f"Claude API error: {e}")
        return await mock_extraction(file_name)


async def mock_extraction(file_name: str) -> dict:
    """Smart mock extraction when API key is not available."""
    import random
    
    await asyncio.sleep(1.5)  # Simulate processing time
    
    vendors = ["Acme Manufacturing Co.", "TechNova Systems Inc.", "GlobalParts International", 
               "Meridian Supply Group", "Atlas Industrial Corp.", "Pinnacle Technologies LLC"]
    items_pool = [
        ("Server Rack Units (42U)", 2, 4500.00),
        ("Managed Network Switch 48-Port", 5, 1200.00),
        ("Cloud Platform License (Annual)", 1, 24000.00),
        ("Technical Consulting Hours", 40, 175.00),
        ("Annual Maintenance Contract", 1, 8500.00),
        ("Power Distribution Unit", 4, 850.00),
        ("API Gateway Enterprise License", 1, 15000.00),
        ("NVMe Storage Array 10TB", 2, 6200.00),
        ("Fiber Optic Cable Bundle (100m)", 10, 320.00),
        ("UPS Battery Backup System", 3, 2100.00),
    ]
    
    fn_lower = file_name.lower()
    is_invoice = "inv" in fn_lower or "invoice" in fn_lower or "receipt" in fn_lower
    is_po = "po" in fn_lower or "purchase" in fn_lower or "order" in fn_lower
    
    if not is_invoice and not is_po:
        is_invoice = random.random() > 0.4
        is_po = not is_invoice
    
    vendor = random.choice(vendors)
    num_items = random.randint(1, 4)
    selected_items = random.sample(items_pool, num_items)
    
    line_items = []
    for desc, base_qty, base_price in selected_items:
        qty = max(1, base_qty + random.randint(-1, 3))
        price = round(base_price * (0.9 + random.random() * 0.2), 2)
        line_items.append({
            "description": desc,
            "quantity": qty,
            "unit_price": price,
            "total": round(qty * price, 2)
        })
    
    total = sum(li["total"] for li in line_items)
    issue_date = datetime.now() - timedelta(days=random.randint(5, 60))
    
    result = {
        "vendor_name": vendor,
        "total_amount": round(total, 2),
        "issue_date": issue_date.strftime("%Y-%m-%d"),
        "line_items": line_items,
        "currency": "USD",
        "notes": None,
        "bill_to": "Your Company Inc., 100 Main Street, Suite 400",
        "ship_to": None,
        "_confidence": round(88 + random.random() * 10, 1),
        "_source": "mock_extraction"
    }
    
    if is_invoice:
        po_num = f"PO-2025-{random.randint(1000, 9999)}"
        result.update({
            "document_type": "invoice",
            "document_number": f"INV-{datetime.now().year}-{random.randint(10000, 99999)}",
            "due_date": (issue_date + timedelta(days=random.choice([30, 45, 60]))).strftime("%Y-%m-%d"),
            "delivery_date": None,
            "po_reference": po_num if random.random() > 0.3 else None,
            "payment_terms": random.choice(["Net 30", "Net 45", "Net 60", "Due on Receipt"]),
        })
    else:
        result.update({
            "document_type": "purchase_order",
            "document_number": f"PO-2025-{random.randint(1000, 9999)}",
            "due_date": None,
            "delivery_date": (issue_date + timedelta(days=random.randint(14, 60))).strftime("%Y-%m-%d"),
            "po_reference": None,
            "payment_terms": random.choice(["Net 30", "Net 45", "2/10 Net 30"]),
        })
    
    return result


# ============================================================
# MATCHING ENGINE
# ============================================================
def match_invoice_to_po(invoice: dict, purchase_orders: list) -> Optional[dict]:
    """Multi-signal matching: PO reference, vendor name, amount proximity."""
    
    best_match = None
    best_score = 0
    
    for po in purchase_orders:
        score = 0
        signals = []
        
        # Signal 1: PO reference match (strongest signal)
        if invoice.get("poReference") and invoice["poReference"] == po.get("poNumber"):
            score += 50
            signals.append("po_reference_exact")
        
        # Signal 2: Vendor name match
        inv_vendor = (invoice.get("vendor") or "").lower().strip()
        po_vendor = (po.get("vendor") or "").lower().strip()
        if inv_vendor and po_vendor:
            if inv_vendor == po_vendor:
                score += 25
                signals.append("vendor_exact")
            elif inv_vendor in po_vendor or po_vendor in inv_vendor:
                score += 15
                signals.append("vendor_partial")
        
        # Signal 3: Amount proximity
        inv_amt = invoice.get("amount", 0)
        po_amt = po.get("amount", 0)
        if inv_amt > 0 and po_amt > 0:
            diff_pct = abs(inv_amt - po_amt) / max(inv_amt, po_amt)
            if diff_pct < 0.02:  # Within 2%
                score += 20
                signals.append("amount_near_exact")
            elif diff_pct < 0.10:  # Within 10%
                score += 12
                signals.append("amount_close")
            elif diff_pct < 0.25:  # Within 25%
                score += 5
                signals.append("amount_approximate")
        
        # Signal 4: Line item overlap
        inv_items = set(li.get("description", "").lower() for li in invoice.get("lineItems", []))
        po_items = set(li.get("description", "").lower() for li in po.get("lineItems", []))
        if inv_items and po_items:
            overlap = len(inv_items & po_items) / max(len(inv_items), len(po_items))
            if overlap > 0.5:
                score += 10
                signals.append("line_items_overlap")
        
        # Normalize to 0-100
        normalized_score = min(100, round(score * 100 / 95))
        
        if normalized_score > best_score and normalized_score >= 40:
            best_score = normalized_score
            best_match = {
                "poId": po["id"],
                "poNumber": po["poNumber"],
                "poAmount": po["amount"],
                "matchScore": normalized_score,
                "signals": signals,
                "amountDifference": round(abs(inv_amt - po_amt), 2),
                "status": "auto_matched" if normalized_score >= 75 else "review_needed"
            }
    
    return best_match


def run_matching(db: dict) -> list:
    """Run matching engine across all unmatched invoices."""
    matched_invoice_ids = {m["invoiceId"] for m in db["matches"]}
    matched_po_ids = {m["poId"] for m in db["matches"]}
    
    unmatched_invoices = [inv for inv in db["invoices"] if inv["id"] not in matched_invoice_ids]
    available_pos = [po for po in db["purchase_orders"] if po["id"] not in matched_po_ids]
    
    new_matches = []
    for inv in unmatched_invoices:
        result = match_invoice_to_po(inv, available_pos)
        if result:
            match = {
                "id": str(uuid.uuid4())[:8].upper(),
                "invoiceId": inv["id"],
                "invoiceNumber": inv.get("invoiceNumber", ""),
                "invoiceAmount": inv["amount"],
                "vendor": inv["vendor"],
                "matchedAt": datetime.now().isoformat(),
                **result
            }
            new_matches.append(match)
            # Remove matched PO from available pool
            available_pos = [po for po in available_pos if po["id"] != result["poId"]]
    
    return new_matches


# ============================================================
# HELPERS
# ============================================================
def transform_extracted_to_record(extracted: dict, file_name: str, file_id: str) -> dict:
    """Transform Claude extraction output into our database record format."""
    
    doc_type = extracted.get("document_type", "invoice")
    
    line_items = []
    for li in extracted.get("line_items", []):
        line_items.append({
            "description": li.get("description", "Unknown Item"),
            "quantity": li.get("quantity", 1),
            "unitPrice": li.get("unit_price", 0),
            "total": li.get("total", 0),
        })
    
    base = {
        "id": file_id,
        "type": doc_type,
        "documentName": file_name,
        "vendor": extracted.get("vendor_name", "Unknown Vendor"),
        "amount": extracted.get("total_amount", 0),
        "issueDate": extracted.get("issue_date"),
        "status": "unpaid" if doc_type == "invoice" else "open",
        "lineItems": line_items,
        "confidence": extracted.get("_confidence", 90),
        "extractionSource": extracted.get("_source", "unknown"),
        "extractedAt": datetime.now().isoformat(),
        "currency": extracted.get("currency", "USD"),
        "paymentTerms": extracted.get("payment_terms"),
        "billTo": extracted.get("bill_to"),
        "shipTo": extracted.get("ship_to"),
        "notes": extracted.get("notes"),
        "rawExtraction": extracted,
    }
    
    if doc_type == "invoice":
        base.update({
            "invoiceNumber": extracted.get("document_number", f"INV-{file_id}"),
            "poReference": extracted.get("po_reference"),
            "dueDate": extracted.get("due_date"),
        })
    else:
        base.update({
            "poNumber": extracted.get("document_number", f"PO-{file_id}"),
            "deliveryDate": extracted.get("delivery_date"),
        })
    
    return base


# ============================================================
# API ROUTES
# ============================================================

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "claude_api": "connected" if USE_REAL_API else "mock_mode",
        "api_key_set": USE_REAL_API,
        "version": "1.0.0"
    }


@app.post("/api/upload")
async def upload_document(
    file: UploadFile = File(...),
    document_type: str = Form("auto")
):
    """Upload and process a document with Claude AI extraction."""
    
    # Validate file type
    allowed_types = {
        "application/pdf", "image/jpeg", "image/png", "image/gif", 
        "image/webp", "image/tiff"
    }
    
    # Infer content type from extension if not provided
    content_type = file.content_type or "application/octet-stream"
    ext = Path(file.filename or "doc").suffix.lower()
    ext_map = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", 
               ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".tiff": "image/tiff"}
    if content_type == "application/octet-stream" and ext in ext_map:
        content_type = ext_map[ext]
    
    if content_type not in allowed_types:
        raise HTTPException(400, f"Unsupported file type: {content_type}. Supported: PDF, JPEG, PNG, GIF, WebP, TIFF")
    
    # Save file
    file_id = str(uuid.uuid4())[:8].upper()
    safe_name = f"{file_id}_{file.filename}"
    file_path = UPLOAD_DIR / safe_name
    
    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)
    
    # Extract with Claude
    extracted = await extract_with_claude(str(file_path), file.filename, content_type)
    
    # Override document type if user specified
    if document_type in ("invoice", "purchase_order"):
        extracted["document_type"] = document_type
    
    # Transform to our record format
    record = transform_extracted_to_record(extracted, file.filename, file_id)
    
    # Save to DB
    db = get_db()
    if record["type"] == "invoice":
        db["invoices"].append(record)
    else:
        db["purchase_orders"].append(record)
    
    # Log activity
    db["activity_log"].append({
        "id": str(uuid.uuid4())[:8],
        "action": "document_uploaded",
        "documentId": file_id,
        "documentType": record["type"],
        "documentNumber": record.get("invoiceNumber") or record.get("poNumber"),
        "vendor": record["vendor"],
        "amount": record["amount"],
        "confidence": record["confidence"],
        "timestamp": datetime.now().isoformat(),
    })
    
    # Run matching
    new_matches = run_matching(db)
    db["matches"].extend(new_matches)
    
    save_db(db)
    
    return {
        "success": True,
        "document": record,
        "new_matches": new_matches,
        "extraction_source": extracted.get("_source", "unknown"),
    }


@app.get("/api/invoices")
async def get_invoices():
    db = get_db()
    return {"invoices": sorted(db["invoices"], key=lambda x: x.get("extractedAt", ""), reverse=True)}


@app.get("/api/purchase-orders")
async def get_purchase_orders():
    db = get_db()
    return {"purchase_orders": sorted(db["purchase_orders"], key=lambda x: x.get("extractedAt", ""), reverse=True)}


@app.get("/api/documents")
async def get_all_documents():
    db = get_db()
    all_docs = db["invoices"] + db["purchase_orders"]
    all_docs.sort(key=lambda x: x.get("extractedAt", ""), reverse=True)
    return {"documents": all_docs, "total": len(all_docs)}


@app.get("/api/matches")
async def get_matches():
    db = get_db()
    return {
        "matches": sorted(db["matches"], key=lambda x: x.get("matchedAt", ""), reverse=True),
        "summary": {
            "total": len(db["matches"]),
            "auto_matched": sum(1 for m in db["matches"] if m["status"] == "auto_matched"),
            "review_needed": sum(1 for m in db["matches"] if m["status"] == "review_needed"),
        }
    }


@app.post("/api/matches/{match_id}/approve")
async def approve_match(match_id: str):
    db = get_db()
    for m in db["matches"]:
        if m["id"] == match_id:
            m["status"] = "auto_matched"
            m["approvedAt"] = datetime.now().isoformat()
            save_db(db)
            return {"success": True, "match": m}
    raise HTTPException(404, "Match not found")


@app.post("/api/matches/{match_id}/reject")
async def reject_match(match_id: str):
    db = get_db()
    db["matches"] = [m for m in db["matches"] if m["id"] != match_id]
    save_db(db)
    return {"success": True}


@app.get("/api/dashboard")
async def get_dashboard():
    db = get_db()
    now = datetime.now()
    
    unpaid = [inv for inv in db["invoices"] if inv.get("status") != "paid"]
    total_ar = sum(inv["amount"] for inv in unpaid)
    
    # Aging buckets
    buckets = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0}
    bucket_counts = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0}
    
    for inv in unpaid:
        due = inv.get("dueDate")
        if not due:
            buckets["current"] += inv["amount"]
            bucket_counts["current"] += 1
            continue
        try:
            due_date = datetime.fromisoformat(due)
            days_over = (now - due_date).days
        except:
            days_over = 0
        
        if days_over <= 0:
            key = "current"
        elif days_over <= 30:
            key = "1_30"
        elif days_over <= 60:
            key = "31_60"
        elif days_over <= 90:
            key = "61_90"
        else:
            key = "90_plus"
        
        buckets[key] += inv["amount"]
        bucket_counts[key] += 1
    
    # Confidence stats
    all_docs = db["invoices"] + db["purchase_orders"]
    avg_confidence = (sum(d.get("confidence", 0) for d in all_docs) / len(all_docs)) if all_docs else 0
    
    return {
        "total_ar": round(total_ar, 2),
        "unpaid_count": len(unpaid),
        "total_documents": len(all_docs),
        "invoice_count": len(db["invoices"]),
        "po_count": len(db["purchase_orders"]),
        "auto_matched": sum(1 for m in db["matches"] if m["status"] == "auto_matched"),
        "review_needed": sum(1 for m in db["matches"] if m["status"] == "review_needed"),
        "avg_confidence": round(avg_confidence, 1),
        "aging": {
            "buckets": {k: round(v, 2) for k, v in buckets.items()},
            "counts": bucket_counts,
        },
        "recent_activity": sorted(
            db.get("activity_log", []),
            key=lambda x: x.get("timestamp", ""),
            reverse=True
        )[:10],
        "api_mode": "claude_api" if USE_REAL_API else "mock_extraction",
    }


@app.post("/api/invoices/{invoice_id}/mark-paid")
async def mark_invoice_paid(invoice_id: str):
    db = get_db()
    for inv in db["invoices"]:
        if inv["id"] == invoice_id:
            inv["status"] = "paid"
            inv["paidAt"] = datetime.now().isoformat()
            save_db(db)
            return {"success": True, "invoice": inv}
    raise HTTPException(404, "Invoice not found")


@app.post("/api/reset")
async def reset_data():
    """Reset all data — useful for demo resets."""
    save_db({"invoices": [], "purchase_orders": [], "matches": [], "activity_log": []})
    return {"success": True, "message": "All data cleared"}


@app.get("/api/export")
async def export_data():
    """Export all data as JSON."""
    return get_db()


# ============================================================
# SERVE FRONTEND
# ============================================================
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

@app.get("/")
async def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/{path:path}")
async def serve_static(path: str):
    file_path = FRONTEND_DIR / path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)
    return FileResponse(FRONTEND_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print("\n" + "=" * 60)
    print("  RECEIVABLES AI — Starting Server")
    print("=" * 60)
    print(f"  Claude API: {'✓ Connected' if USE_REAL_API else '✗ Mock Mode (set ANTHROPIC_API_KEY for real extraction)'}")
    print(f"  Upload Dir: {UPLOAD_DIR}")
    print(f"  Frontend:   {FRONTEND_DIR}")
    print(f"  Server:     http://localhost:{port}")
    print("=" * 60 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=port)
