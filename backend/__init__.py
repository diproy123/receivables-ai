"""
AuditLens — Modular Backend Package (v2.7.0)

Architecture:
  backend/
  ├── config/      — Constants, feature flags, authority matrix
  ├── db/          — Database abstraction, file storage
  ├── auth/        — JWT, RBAC, user management
  ├── extraction/  — Ensemble AI pipeline: Sonnet + Haiku + math validation
  ├── vendor/      — Vendor normalization, similarity, risk scoring
  ├── policy/      — AP policy state, presets, runtime configuration
  ├── anomalies/   — 16 rule-based anomaly detectors + GRN checks
  ├── matching/    — PO matching (two-way) + GRN matching (three-way)
  ├── documents/   — Record transformation, confidence scoring
  ├── triage/      — Agentic invoice triage engine
  ├── rag_engine.py — RAG retrieval engine
  └── server.py    — FastAPI routing layer

Each module is self-contained with clear imports and no circular dependencies.
"""
