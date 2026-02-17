#!/bin/bash
# Receivables AI — Startup Script

echo ""
echo "============================================"
echo "  RECEIVABLES AI — Enterprise AR Automation"
echo "============================================"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required. Install it first."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
pip install -r requirements.txt --break-system-packages -q 2>/dev/null || pip install -r requirements.txt -q

# Check for API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo ""
    echo "⚠️  No ANTHROPIC_API_KEY found — running in MOCK MODE"
    echo "   Upload will use smart mock extraction (no real AI)"
    echo ""
    echo "   To enable real Claude AI extraction:"
    echo "   export ANTHROPIC_API_KEY=sk-ant-..."
    echo ""
else
    echo "✅ Claude API key detected — REAL EXTRACTION enabled"
fi

echo "🚀 Starting server at http://localhost:8000"
echo "   Press Ctrl+C to stop"
echo ""

cd "$(dirname "$0")"
python3 backend/server.py
