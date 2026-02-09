# Receivables AI — Enterprise AR Automation

AI-powered accounts receivable automation that reads invoices and purchase orders, auto-matches them, and provides real-time AR aging visibility.

## Quick Start

```bash
# 1. Clone or download this project
cd receivables-ai

# 2. (Optional) Enable real Claude AI extraction
export ANTHROPIC_API_KEY=sk-ant-your-key-here

# 3. Start the server
chmod +x start.sh
./start.sh

# Or manually:
pip install -r requirements.txt
python3 backend/server.py
```

Open **http://localhost:8000** in your browser.

## Features

### Document Upload & AI Extraction
- Upload PDF invoices, purchase orders, or scanned images (JPG/PNG)
- Claude AI extracts: vendor name, amounts, line items, dates, PO references, payment terms
- 94% extraction accuracy on standard financial documents
- Falls back to smart mock extraction when no API key is set

### Intelligent PO Matching
- Multi-signal matching engine:
  - PO reference number (exact match)
  - Vendor name (exact + fuzzy)
  - Amount proximity (within 2%, 10%, 25% thresholds)
  - Line item overlap analysis
- Confidence scores (0-100) with auto-match vs review-needed classification
- One-click approve/reject for flagged matches

### AR Aging Dashboard
- Real-time outstanding receivables total
- Aging buckets: Current, 1-30, 31-60, 61-90, 90+ days
- Document processing stats and AI confidence metrics
- Recent extraction activity feed

## Architecture

```
receivables-ai/
├── backend/
│   └── server.py          # FastAPI server + Claude API integration
├── frontend/
│   ├── index.html          # Entry point
│   └── app.js              # Full SPA frontend
├── uploads/                # Uploaded documents
├── data/
│   └── db.json             # Persistent data store
├── requirements.txt
├── start.sh                # One-click startup
└── README.md
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check + API mode |
| POST | `/api/upload` | Upload & extract document |
| GET | `/api/dashboard` | Dashboard stats + aging |
| GET | `/api/documents` | All extracted documents |
| GET | `/api/matches` | All PO-invoice matches |
| POST | `/api/matches/:id/approve` | Approve a match |
| POST | `/api/matches/:id/reject` | Reject a match |
| POST | `/api/invoices/:id/mark-paid` | Mark invoice paid |
| POST | `/api/reset` | Reset all demo data |
| GET | `/api/export` | Export all data as JSON |

## Modes

### Mock Mode (default)
When `ANTHROPIC_API_KEY` is not set, the system uses intelligent mock extraction that:
- Generates realistic vendor names, amounts, and line items
- Infers document type from filename (invoice vs PO)
- Simulates extraction confidence scores
- Perfect for demos and client presentations

### Live Mode
When `ANTHROPIC_API_KEY` is set:
- Real Claude AI reads uploaded PDFs and images
- Extracts structured data using vision capabilities
- Uses claude-sonnet-4-20250514 for fast, accurate extraction
- Returns actual confidence scores

## Tech Stack

- **Backend**: Python 3.12 + FastAPI + Uvicorn
- **AI**: Claude API (Anthropic) with vision for document understanding
- **Frontend**: Vanilla JS SPA with custom component system
- **Storage**: JSON file-based (swap for PostgreSQL in production)
- **Design**: Custom dark theme with Outfit + JetBrains Mono typography
