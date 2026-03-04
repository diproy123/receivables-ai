# AuditLens — Data Processing & Privacy Technical Reference

**Version:** 1.0 · **Date:** March 2026 · **Classification:** Customer-Facing

---

## 1. Data Categories Processed

| Category | Examples | Sensitivity |
|----------|----------|-------------|
| Invoice Data | Vendor names, invoice numbers, amounts, line items, tax details, payment terms | High |
| Purchase Orders | PO numbers, buyer info, item descriptions, pricing | High |
| Contracts | Terms, pricing, SLA, auto-renewal, liability caps | High |
| Goods Receipts | Delivery details, quantities, condition notes | Medium |
| Bank/Payment Info | Account numbers (in PDFs), SWIFT codes, routing numbers | Critical |
| Tax Identifiers | EIN, PAN, GSTIN, VAT numbers (in PDFs) | Critical |
| Personnel Data | Approver names, email addresses (in documents) | Medium |

## 2. Data Flow Architecture

### 2.1 Deterministic Core (No External Calls)
These modules process data **entirely locally** — no data leaves the deployment environment:

- **Anomaly Detection:** 19 rule-based detectors (duplicate, over-invoicing, missing PO, etc.)
- **PO Matching:** Multi-signal scoring engine (amount, vendor, date, line items)
- **3-Way Matching:** Invoice ↔ PO ↔ GRN reconciliation
- **Triage:** Agentic classification (Auto/Review/Blocked)
- **Contract Compliance:** Pricing drift, expiry warnings
- **Vendor Risk Scoring:** Deterministic risk computation

### 2.2 LLM-Dependent Features (Configurable Destination)
These features send data to an LLM provider. The destination is **fully configurable**:

| Feature | Data Sent | Destination Options |
|---------|-----------|-------------------|
| Document Extraction | Full PDF/image content + extraction prompt | Anthropic / Bedrock / Vertex / Self-hosted |
| AI Investigation Briefs | Invoice metadata + anomaly context | Same as above |
| Anomaly Explanations | Anomaly details + vendor history | Same as above |
| Vendor Communication Drafts | Case context + invoice data | Same as above |
| Smart Match Analysis | Invoice + PO data | Same as above |
| Payment Prioritization | Invoice amounts + due dates | Same as above |
| Policy Parsing | Policy text (no financial data) | Same as above |

### 2.3 Embedding Generation
| Provider | Destination | Data Sent |
|----------|-------------|-----------|
| Voyage (default) | api.voyageai.com | Vendor names, text snippets (~300 tokens) |
| Local TF-IDF | Local only | Nothing leaves network |
| sentence-transformers | Local only | Nothing leaves network |

Configure via `RAG_EMBEDDING_PROVIDER=local` or `=sentence_transformers`

### 2.4 Model Fine-Tuning
| Provider | Destination | Data Sent |
|----------|-------------|-----------|
| Together.ai (default) | Together.ai servers | Correction patterns: vendor names, field values |
| Local (recommended) | Local filesystem | Nothing leaves network |

Configure via `FINETUNE_PROVIDER=local`

## 3. Deployment Modes

### Standard (Demo / Non-Regulated SMBs)
```
LLM_PROVIDER=anthropic
RAG_EMBEDDING_PROVIDER=voyage
FINETUNE_PROVIDER=together
PII_REDACTION_ENABLED=false
```
Data egress: LLM prompts → Anthropic Cloud, embeddings → Voyage API, training data → Together.ai

### Enterprise Private Cloud (SOX / GDPR)
```
LLM_PROVIDER=bedrock  # or vertex
RAG_EMBEDDING_PROVIDER=local
FINETUNE_PROVIDER=local
PII_REDACTION_ENABLED=true
LLM_ZERO_DATA_RETENTION=true
```
Data egress: LLM prompts → Customer's AWS VPC (or GCP project). **Nothing leaves customer infrastructure.**

### Air-Gapped / Sovereign (Defense / Government / Banking)
```
LLM_PROVIDER=openai  # points to local vLLM/Ollama
LLM_ENDPOINT=http://localhost:8000
RAG_EMBEDDING_PROVIDER=local
FINETUNE_PROVIDER=local
PII_REDACTION_ENABLED=true
```
Data egress: **Zero external network calls.** All processing happens on-premise.

## 4. Privacy Controls

### 4.1 PII Redaction (Pre-LLM)
When `PII_REDACTION_ENABLED=true`, the following are detected and masked before any LLM call:
- Bank account numbers, routing numbers, SWIFT/BIC codes, IBAN
- Tax IDs (US EIN, India PAN/GSTIN, UK/EU VAT)
- Social Security Numbers (US SSN)
- Credit card numbers (Luhn-validated)
- Email addresses, phone numbers

Redaction is **reversible** — tokens are replaced with placeholders (`[BANK_ACCT_1]`) and restored in the LLM response.

### 4.2 Zero Data Retention (ZDR)
When `LLM_ZERO_DATA_RETENTION=true`, the `anthropic-beta: zero-data-retention` header is sent on all Anthropic API calls. Anthropic does not retain prompt or completion data.
Note: Bedrock and Vertex AI have inherent ZDR — data never leaves the customer's cloud account.

### 4.3 Per-Vendor AI Controls
Each vendor can have independent settings:
- **extraction_enabled** — whether AI extraction is used (false = manual entry only)
- **intelligence_enabled** — whether AI analysis features (briefs, explanations, drafts) are active
- **include_in_training** — whether correction data for this vendor is used in fine-tuning

Configurable via API (`PUT /api/data-governance/vendor-controls/{vendor}`) or the Data Governance UI.

### 4.4 LLM Call Audit Log
Every external LLM call is logged with:
- Timestamp, provider, model, module, data type (text/document)
- Vendor name (truncated), document ID (not content)
- Response latency, PII redaction status, ZDR status, success/failure

Accessible via `/api/data-governance/audit-log` or the Data Governance dashboard.

## 5. Sub-Processors

| Service | Role | Data Access | Required? |
|---------|------|-------------|-----------|
| Anthropic API | LLM inference | Prompt + document content | Only if `LLM_PROVIDER=anthropic` |
| AWS Bedrock | LLM inference (VPC) | Prompt + document content | Only if `LLM_PROVIDER=bedrock` |
| Google Vertex AI | LLM inference (GCP) | Prompt + document content | Only if `LLM_PROVIDER=vertex` |
| Voyage AI | Embedding generation | Text snippets | Only if `RAG_EMBEDDING_PROVIDER=voyage` |
| Together.ai | Model fine-tuning | Correction patterns | Only if `FINETUNE_PROVIDER=together` |

In Enterprise Private Cloud and Air-Gapped modes, **zero sub-processors** have access to customer data.

## 6. Data Retention

- **Application database:** Customer-controlled (JSON or PostgreSQL)
- **LLM provider:** No retention (ZDR or VPC-isolated)
- **Audit log:** In-memory ring buffer (1000 entries) + persistent activity log
- **Training data:** Local filesystem only when `FINETUNE_PROVIDER=local`
- **Uploaded documents:** Stored in configured upload directory; customer controls retention

## 7. Compliance Mapping

| Requirement | How AuditLens Addresses It |
|-------------|--------------------------|
| SOX Section 404 | Deterministic anomaly detection (no LLM dependency), audit trail, role-based access |
| GDPR Art. 28 | Configurable data residency (EU Bedrock/Vertex regions), PII redaction, no cross-border transfer in private mode |
| SOC 2 Type II | Audit logging of all external calls, vendor access controls, encryption in transit |
| HIPAA (if applicable) | Air-gapped mode eliminates all external data transfer |
| Data Residency Laws | Region-specific Bedrock/Vertex deployment, on-premise option |
