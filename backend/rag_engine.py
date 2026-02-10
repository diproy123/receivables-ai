"""
AuditLens RAG Engine — Retrieval-Augmented Generation for F&A Auditing
=======================================================================

Architecture:
  1. INGEST: When documents are uploaded/edited, chunk them into semantic units
     and generate embeddings. Store in a local vector store (JSON + numpy).

  2. RETRIEVE: Before extraction or anomaly detection, query the vector store
     for relevant context: past corrections, similar invoices, contract clauses,
     vendor-specific patterns.

  3. AUGMENT: Inject retrieved context into Claude prompts for better extraction
     and more accurate anomaly detection.

Embedding options:
  - Anthropic Voyage (voyage-3) via API — high quality, requires API key
  - Local TF-IDF fallback — no external dependencies, works offline

Vector store: Local JSON file with numpy cosine similarity search.
No Pinecone/Weaviate needed for <10K documents.
"""

import os, json, hashlib, re
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np

# ============================================================
# CONFIG
# ============================================================
BASE_DIR = Path(__file__).parent.parent
RAG_DIR = BASE_DIR / "data" / "rag"
RAG_DIR.mkdir(parents=True, exist_ok=True)

VECTOR_STORE_PATH = RAG_DIR / "vectors.json"
CHUNK_STORE_PATH = RAG_DIR / "chunks.json"

USE_VOYAGE = bool(os.environ.get("ANTHROPIC_API_KEY"))

# Chunk size targets
MAX_CHUNK_TOKENS = 300  # ~300 tokens per chunk
OVERLAP_TOKENS = 50     # overlap between chunks for context continuity


# ============================================================
# VECTOR STORE — Local JSON + numpy
# ============================================================
class VectorStore:
    """Simple local vector store. Good for <10K documents.
    For production at scale, swap this for Pinecone/Weaviate/pgvector."""

    def __init__(self):
        self.chunks = self._load(CHUNK_STORE_PATH, [])
        self.vectors = self._load_vectors()

    def _load(self, path, default):
        if path.exists():
            with open(path) as f:
                return json.load(f)
        return default

    def _load_vectors(self):
        if VECTOR_STORE_PATH.exists():
            with open(VECTOR_STORE_PATH) as f:
                data = json.load(f)
                return {k: np.array(v) for k, v in data.items()}
        return {}

    def save(self):
        with open(CHUNK_STORE_PATH, "w") as f:
            json.dump(self.chunks, f, indent=2, default=str)
        with open(VECTOR_STORE_PATH, "w") as f:
            json.dump({k: v.tolist() for k, v in self.vectors.items()}, f)

    def add(self, chunk_id: str, text: str, embedding: list, metadata: dict):
        """Add a chunk with its embedding and metadata."""
        # Remove existing chunk with same ID
        self.chunks = [c for c in self.chunks if c["id"] != chunk_id]
        self.chunks.append({
            "id": chunk_id,
            "text": text,
            "metadata": metadata,
            "addedAt": datetime.now().isoformat()
        })
        self.vectors[chunk_id] = np.array(embedding)

    def search(self, query_embedding: list, top_k: int = 5, filter_fn=None) -> list:
        """Cosine similarity search. Returns top_k most similar chunks."""
        if not self.vectors:
            return []

        qv = np.array(query_embedding)
        qv_norm = np.linalg.norm(qv)
        if qv_norm == 0:
            return []

        scores = []
        for chunk_id, vec in self.vectors.items():
            v_norm = np.linalg.norm(vec)
            if v_norm == 0:
                continue
            sim = float(np.dot(qv, vec) / (qv_norm * v_norm))

            # Find the chunk metadata
            chunk = next((c for c in self.chunks if c["id"] == chunk_id), None)
            if chunk and (filter_fn is None or filter_fn(chunk)):
                scores.append((sim, chunk))

        scores.sort(key=lambda x: x[0], reverse=True)
        return scores[:top_k]

    def delete_by_document(self, document_id: str):
        """Remove all chunks for a document."""
        to_remove = [c["id"] for c in self.chunks if c.get("metadata", {}).get("documentId") == document_id]
        self.chunks = [c for c in self.chunks if c["id"] not in to_remove]
        for cid in to_remove:
            self.vectors.pop(cid, None)

    def stats(self):
        return {
            "total_chunks": len(self.chunks),
            "total_vectors": len(self.vectors),
            "unique_documents": len(set(c.get("metadata", {}).get("documentId", "") for c in self.chunks)),
            "unique_vendors": len(set(c.get("metadata", {}).get("vendor", "") for c in self.chunks)),
            "chunk_types": {t: sum(1 for c in self.chunks if c.get("metadata", {}).get("type") == t)
                           for t in set(c.get("metadata", {}).get("type", "") for c in self.chunks)}
        }

    def clear(self):
        self.chunks = []
        self.vectors = {}
        self.save()


# Global instance
store = VectorStore()


# ============================================================
# EMBEDDINGS
# ============================================================

# --- TF-IDF Local Embeddings (fallback) ---
class TFIDFEmbedder:
    """Lightweight local embeddings using TF-IDF.
    Dimension = vocabulary size (capped at 512 for efficiency).
    Not as good as Voyage, but works offline with zero dependencies."""

    def __init__(self):
        self.vocab = {}       # word -> index
        self.idf = {}         # word -> idf score
        self.dim = 512        # fixed output dimension
        self._fitted = False

    def _tokenize(self, text: str) -> list:
        return re.findall(r'\b[a-z0-9]+\b', text.lower())

    def fit(self, corpus: list):
        """Build vocabulary from all existing chunk texts."""
        doc_count = len(corpus) + 1  # +1 smoothing
        word_doc_count = {}

        for text in corpus:
            words = set(self._tokenize(text))
            for w in words:
                word_doc_count[w] = word_doc_count.get(w, 0) + 1

        # Sort by frequency and take top `dim` words
        sorted_words = sorted(word_doc_count.items(), key=lambda x: x[1], reverse=True)[:self.dim]
        self.vocab = {w: i for i, (w, _) in enumerate(sorted_words)}

        import math
        self.idf = {w: math.log(doc_count / (c + 1)) for w, c in word_doc_count.items() if w in self.vocab}
        self._fitted = True

    def embed(self, text: str) -> list:
        """Generate TF-IDF embedding vector."""
        # Always refit on existing chunks + current text for best results
        corpus = [c["text"] for c in store.chunks] + [text]
        if len(corpus) > 1 or not self._fitted:
            self.fit(corpus)

        tokens = self._tokenize(text)
        if not tokens:
            return [0.0] * self.dim

        # Term frequency
        tf = {}
        for t in tokens:
            tf[t] = tf.get(t, 0) + 1
        max_tf = max(tf.values()) if tf else 1

        vec = [0.0] * self.dim
        for word, count in tf.items():
            if word in self.vocab:
                idx = self.vocab[word]
                normalized_tf = 0.5 + 0.5 * (count / max_tf)
                vec[idx] = normalized_tf * self.idf.get(word, 1.0)

        # L2 normalize
        norm = sum(v**2 for v in vec) ** 0.5
        if norm > 0:
            vec = [v / norm for v in vec]

        return vec

    def embed_batch(self, texts: list) -> list:
        return [self.embed(t) for t in texts]


tfidf_embedder = TFIDFEmbedder()


# --- Voyage Embeddings (production quality) ---
async def embed_with_voyage(texts: list) -> list:
    """Use Anthropic's Voyage embedding model for high-quality vectors."""
    try:
        import anthropic
        # Voyage embeddings via Anthropic's API
        # Using the voyageai client through anthropic
        import httpx
        api_key = os.environ.get("ANTHROPIC_API_KEY")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.voyageai.com/v1/embeddings",
                headers={
                    "Authorization": f"Bearer {os.environ.get('VOYAGE_API_KEY', api_key)}",
                    "Content-Type": "application/json"
                },
                json={"model": "voyage-3-lite", "input": texts},
                timeout=30.0
            )
            if response.status_code == 200:
                data = response.json()
                return [d["embedding"] for d in data["data"]]
    except Exception as e:
        print(f"Voyage embedding error: {e}, falling back to TF-IDF")

    # Fallback to local TF-IDF
    return tfidf_embedder.embed_batch(texts)


async def get_embedding(text: str) -> list:
    """Get embedding for a single text. Uses Voyage if available, else TF-IDF."""
    if USE_VOYAGE and os.environ.get("VOYAGE_API_KEY"):
        results = await embed_with_voyage([text])
        return results[0]
    return tfidf_embedder.embed(text)


async def get_embeddings_batch(texts: list) -> list:
    """Get embeddings for multiple texts."""
    if USE_VOYAGE and os.environ.get("VOYAGE_API_KEY"):
        # Voyage supports batches up to 128
        all_embeds = []
        for i in range(0, len(texts), 128):
            batch = texts[i:i+128]
            embeds = await embed_with_voyage(batch)
            all_embeds.extend(embeds)
        return all_embeds
    return tfidf_embedder.embed_batch(texts)


# ============================================================
# DOCUMENT CHUNKING
# ============================================================

def chunk_document(doc: dict) -> list:
    """Break a document record into semantic chunks for RAG retrieval.

    Chunk types:
    1. HEADER — vendor, amounts, dates, terms (always retrieved for vendor queries)
    2. LINE_ITEM — one chunk per line item (retrieved for price/item queries)
    3. CONTRACT_CLAUSE — one chunk per pricing term (retrieved for compliance checks)
    4. CORRECTION — one chunk per human correction (retrieved to improve future extraction)
    5. ANOMALY — one chunk per detected anomaly (retrieved for pattern detection)
    """
    chunks = []
    doc_id = doc.get("id", "")
    vendor = doc.get("vendor", "Unknown")
    doc_type = doc.get("type", "unknown")
    cur = doc.get("currency", "USD")

    # 1. HEADER chunk
    header_text = f"Document: {doc_type}. Vendor: {vendor}. "
    header_text += f"Number: {doc.get('invoiceNumber') or doc.get('poNumber') or doc.get('contractNumber', '')}. "
    header_text += f"Amount: {cur} {doc.get('amount', 0)}. Subtotal: {cur} {doc.get('subtotal', 0)}. "
    header_text += f"Date: {doc.get('issueDate', '')}. Terms: {doc.get('paymentTerms', '')}. "
    header_text += f"Currency: {cur}. "
    if doc.get("poReference"):
        header_text += f"PO Reference: {doc['poReference']}. "
    if doc.get("manuallyVerified"):
        header_text += "This document was manually verified by a human reviewer. "

    chunks.append({
        "id": f"{doc_id}_header",
        "text": header_text,
        "metadata": {"documentId": doc_id, "vendor": vendor, "type": "header",
                      "docType": doc_type, "amount": doc.get("amount", 0)}
    })

    # 2. LINE_ITEM chunks
    for i, li in enumerate(doc.get("lineItems", [])):
        li_text = f"Line item from {vendor} {doc_type}: "
        li_text += f"{li.get('description', '')} — "
        li_text += f"quantity {li.get('quantity', 0)}, "
        li_text += f"unit price {cur} {li.get('unitPrice', 0)}, "
        li_text += f"total {cur} {li.get('total', 0)}."

        chunks.append({
            "id": f"{doc_id}_li_{i}",
            "text": li_text,
            "metadata": {"documentId": doc_id, "vendor": vendor, "type": "line_item",
                          "docType": doc_type, "itemDescription": li.get("description", ""),
                          "unitPrice": li.get("unitPrice", 0)}
        })

    # 3. CONTRACT_CLAUSE chunks (for contracts)
    if doc_type == "contract":
        for i, pt in enumerate(doc.get("pricingTerms", [])):
            clause_text = f"Contract pricing for {vendor}: "
            clause_text += f"{pt.get('item', '')} at {cur} {pt.get('rate', 0)} {pt.get('unit', 'per unit')}. "
            if doc.get("contractTerms", {}).get("effective_date"):
                clause_text += f"Effective from {doc['contractTerms']['effective_date']}. "
            if doc.get("contractTerms", {}).get("expiry_date"):
                clause_text += f"Expires {doc['contractTerms']['expiry_date']}. "
            clause_text += f"Payment terms: {doc.get('paymentTerms', 'not specified')}."

            chunks.append({
                "id": f"{doc_id}_clause_{i}",
                "text": clause_text,
                "metadata": {"documentId": doc_id, "vendor": vendor, "type": "contract_clause",
                              "docType": "contract", "item": pt.get("item", ""),
                              "rate": pt.get("rate", 0)}
            })

    # 4. CORRECTION chunks (from edit history)
    for i, edit in enumerate(doc.get("editHistory", [])):
        for field, change_str in edit.get("changes", {}).items():
            corr_text = f"Correction for {vendor} {doc_type}: "
            corr_text += f"Field '{field}' was corrected. {change_str}. "
            corr_text += f"Corrected at {edit.get('timestamp', '')}."

            chunks.append({
                "id": f"{doc_id}_corr_{i}_{field}",
                "text": corr_text,
                "metadata": {"documentId": doc_id, "vendor": vendor, "type": "correction",
                              "docType": doc_type, "field": field}
            })

    return chunks


def chunk_anomaly(anomaly: dict) -> dict:
    """Create a RAG chunk from an anomaly record."""
    text = f"Anomaly for {anomaly.get('vendor', 'Unknown')}: "
    text += f"Type: {anomaly.get('type', '')}. Severity: {anomaly.get('severity', '')}. "
    text += f"Description: {anomaly.get('description', '')}. "
    text += f"Amount at risk: {anomaly.get('currency', 'USD')} {anomaly.get('amount_at_risk', 0)}. "
    text += f"Invoice: {anomaly.get('invoiceNumber', '')}. "
    if anomaly.get("contract_clause"):
        text += f"Contract clause: {anomaly['contract_clause']}. "
    if anomaly.get("recommendation"):
        text += f"Recommendation: {anomaly['recommendation']}."

    return {
        "id": f"anom_{anomaly.get('id', '')}",
        "text": text,
        "metadata": {"documentId": anomaly.get("invoiceId", ""), "vendor": anomaly.get("vendor", ""),
                      "type": "anomaly", "anomalyType": anomaly.get("type", ""),
                      "severity": anomaly.get("severity", ""), "status": anomaly.get("status", "")}
    }


# ============================================================
# INGEST — Index documents into the vector store
# ============================================================

async def ingest_document(doc: dict):
    """Chunk a document and add all chunks to the vector store."""
    # Remove old chunks for this document
    store.delete_by_document(doc["id"])

    chunks = chunk_document(doc)
    if not chunks:
        return

    texts = [c["text"] for c in chunks]
    embeddings = await get_embeddings_batch(texts)

    for chunk, embedding in zip(chunks, embeddings):
        store.add(chunk["id"], chunk["text"], embedding, chunk["metadata"])

    store.save()


async def ingest_anomaly(anomaly: dict):
    """Add an anomaly to the vector store."""
    chunk = chunk_anomaly(anomaly)
    embedding = await get_embedding(chunk["text"])
    store.add(chunk["id"], chunk["text"], embedding, chunk["metadata"])
    store.save()


async def reindex_all(db: dict):
    """Full reindex of all documents and anomalies."""
    store.clear()
    all_docs = db.get("invoices", []) + db.get("purchase_orders", []) + db.get("contracts", [])

    for doc in all_docs:
        await ingest_document(doc)

    for anom in db.get("anomalies", []):
        await ingest_anomaly(anom)

    print(f"RAG reindex complete: {store.stats()}")


# ============================================================
# RETRIEVE — Query the vector store for relevant context
# ============================================================

async def retrieve_for_extraction(vendor_name: str, doc_type: str, top_k: int = 8) -> str:
    """Retrieve relevant context to augment extraction prompt.

    Returns context about:
    - Past corrections for this vendor (most important)
    - Contract clauses for this vendor
    - Typical line items and prices from this vendor
    """
    query = f"extraction correction pattern for {vendor_name} {doc_type}"
    query_vec = await get_embedding(query)

    # Prefer corrections and contract clauses for this vendor
    def vendor_filter(chunk):
        from difflib import SequenceMatcher
        v = chunk.get("metadata", {}).get("vendor", "")
        # Check vendor similarity
        if not v:
            return chunk.get("metadata", {}).get("type") == "correction"
        na = re.sub(r'\b(inc|llc|ltd|corp)\b\.?', '', vendor_name.lower()).strip()
        nb = re.sub(r'\b(inc|llc|ltd|corp)\b\.?', '', v.lower()).strip()
        return SequenceMatcher(None, na, nb).ratio() >= 0.6

    results = store.search(query_vec, top_k=top_k, filter_fn=vendor_filter)

    if not results:
        return ""

    context_parts = ["\n\nRAG CONTEXT (retrieved from document history):"]
    for sim, chunk in results:
        if sim < 0.1:  # Skip very low similarity
            continue
        ctype = chunk.get("metadata", {}).get("type", "")
        context_parts.append(f"[{ctype}] (relevance: {sim:.2f}) {chunk['text']}")

    if len(context_parts) == 1:
        return ""

    context_parts.append("\nUse this context to improve extraction accuracy. Corrections show what the AI previously got wrong.")
    return "\n".join(context_parts)


async def retrieve_for_anomaly_detection(invoice: dict, top_k: int = 10) -> str:
    """Retrieve relevant context to augment anomaly detection prompt.

    Returns context about:
    - Contract pricing clauses for this vendor
    - Past anomalies from this vendor (patterns)
    - Similar invoices (for duplicate/pattern detection)
    - Corrections (to know what was previously wrong)
    """
    vendor = invoice.get("vendor", "")
    items = ", ".join(li.get("description", "") for li in invoice.get("lineItems", [])[:5])
    query = f"anomaly audit {vendor} {items} pricing compliance"
    query_vec = await get_embedding(query)

    results = store.search(query_vec, top_k=top_k)

    if not results:
        return ""

    # Organize by type for clean prompt injection
    by_type = {"contract_clause": [], "anomaly": [], "correction": [], "line_item": [], "header": []}
    for sim, chunk in results:
        if sim < 0.05:
            continue
        ctype = chunk.get("metadata", {}).get("type", "")
        if ctype in by_type:
            by_type[ctype].append((sim, chunk))

    context_parts = ["\n\nRAG CONTEXT (retrieved from document history for better anomaly detection):"]

    if by_type["contract_clause"]:
        context_parts.append("\n--- Contract Pricing (retrieved) ---")
        for sim, chunk in by_type["contract_clause"][:3]:
            context_parts.append(f"  {chunk['text']}")

    if by_type["anomaly"]:
        context_parts.append("\n--- Past Anomalies (vendor patterns) ---")
        for sim, chunk in by_type["anomaly"][:3]:
            context_parts.append(f"  {chunk['text']}")

    if by_type["correction"]:
        context_parts.append("\n--- Past Corrections (known extraction issues) ---")
        for sim, chunk in by_type["correction"][:3]:
            context_parts.append(f"  {chunk['text']}")

    if len(context_parts) == 1:
        return ""

    context_parts.append("\nUse this retrieved context to catch anomalies the rule-based engine might miss.")
    return "\n".join(context_parts)


async def retrieve_vendor_intelligence(vendor_name: str, top_k: int = 10) -> dict:
    """Retrieve everything we know about a vendor.
    Used for vendor profile / spend intelligence features."""
    query = f"vendor profile {vendor_name} pricing terms invoices contract"
    query_vec = await get_embedding(query)

    def vendor_filter(chunk):
        from difflib import SequenceMatcher
        v = chunk.get("metadata", {}).get("vendor", "")
        if not v:
            return False
        na = re.sub(r'\b(inc|llc|ltd|corp)\b\.?', '', vendor_name.lower()).strip()
        nb = re.sub(r'\b(inc|llc|ltd|corp)\b\.?', '', v.lower()).strip()
        return SequenceMatcher(None, na, nb).ratio() >= 0.6

    results = store.search(query_vec, top_k=top_k, filter_fn=vendor_filter)

    intelligence = {
        "vendor": vendor_name,
        "contract_terms": [],
        "typical_items": [],
        "past_anomalies": [],
        "corrections": [],
        "total_chunks": len(results)
    }

    for sim, chunk in results:
        ctype = chunk.get("metadata", {}).get("type", "")
        if ctype == "contract_clause":
            intelligence["contract_terms"].append(chunk["text"])
        elif ctype == "line_item":
            intelligence["typical_items"].append(chunk["text"])
        elif ctype == "anomaly":
            intelligence["past_anomalies"].append(chunk["text"])
        elif ctype == "correction":
            intelligence["corrections"].append(chunk["text"])

    return intelligence


# ============================================================
# PUBLIC API — Integration points for server.py
# ============================================================

async def on_document_uploaded(doc: dict):
    """Call after a document is uploaded and extracted. Indexes it into RAG."""
    await ingest_document(doc)

async def on_anomaly_detected(anomaly: dict):
    """Call after an anomaly is detected. Indexes it into RAG."""
    await ingest_anomaly(anomaly)

async def on_document_edited(doc: dict):
    """Call after a document is manually edited. Re-indexes with correction data."""
    await ingest_document(doc)

async def get_extraction_context(vendor: str, doc_type: str) -> str:
    """Get RAG context to inject into extraction prompt."""
    return await retrieve_for_extraction(vendor, doc_type)

async def get_anomaly_context(invoice: dict) -> str:
    """Get RAG context to inject into anomaly detection prompt."""
    return await retrieve_for_anomaly_detection(invoice)

def get_rag_stats() -> dict:
    """Get RAG system statistics."""
    return store.stats()

async def reset_rag():
    """Clear the RAG store."""
    store.clear()
