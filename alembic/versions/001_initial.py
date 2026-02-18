"""Initial schema — all AuditLens tables

Revision ID: 001_initial
Revises: None
Create Date: 2026-02-18
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Detect dialect for JSON type
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB if is_pg else sa.JSON

    op.create_table("users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(50), nullable=False, server_default="analyst"),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("active", sa.Boolean, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table("documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("document_name", sa.String(500)),
        sa.Column("document_number", sa.String(100)),
        sa.Column("vendor", sa.String(500)),
        sa.Column("vendor_normalized", sa.String(500)),
        sa.Column("vendor_english", sa.String(500)),
        sa.Column("amount", sa.Float, server_default="0"),
        sa.Column("subtotal", sa.Float, server_default="0"),
        sa.Column("total_tax", sa.Float, server_default="0"),
        sa.Column("currency", sa.String(10), server_default="USD"),
        sa.Column("status", sa.String(50), server_default="pending"),
        sa.Column("issue_date", sa.String(50)),
        sa.Column("due_date", sa.String(50)),
        sa.Column("delivery_date", sa.String(50)),
        sa.Column("received_date", sa.String(50)),
        sa.Column("po_reference", sa.String(100)),
        sa.Column("original_invoice_ref", sa.String(100)),
        sa.Column("confidence", sa.Float, server_default="0"),
        sa.Column("extraction_source", sa.String(50)),
        sa.Column("line_items", json_type),
        sa.Column("tax_details", json_type),
        sa.Column("confidence_factors", json_type),
        sa.Column("ensemble_data", json_type),
        sa.Column("field_confidence", json_type),
        sa.Column("pricing_terms", json_type),
        sa.Column("contract_terms", json_type),
        sa.Column("parties", json_type),
        sa.Column("received_by", sa.String(255)),
        sa.Column("condition_notes", sa.Text),
        sa.Column("payment_terms", sa.String(255)),
        sa.Column("notes", sa.Text),
        sa.Column("early_payment_discount", sa.String(255)),
        sa.Column("locale", sa.String(20), server_default="en_US"),
        sa.Column("document_language", sa.String(10), server_default="en"),
        sa.Column("uploaded_file", sa.String(500)),
        sa.Column("uploaded_by", sa.String(255)),
        sa.Column("uploaded_by_email", sa.String(255)),
        sa.Column("extracted_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("triage_lane", sa.String(50)),
        sa.Column("triage_confidence", sa.Float),
        sa.Column("triage_reasons", json_type),
        sa.Column("triage_decided_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_documents_type", "documents", ["type"])
    op.create_index("ix_documents_document_number", "documents", ["document_number"])
    op.create_index("ix_documents_vendor", "documents", ["vendor"])
    op.create_index("ix_documents_vendor_normalized", "documents", ["vendor_normalized"])
    op.create_index("ix_documents_status", "documents", ["status"])
    op.create_index("ix_documents_po_reference", "documents", ["po_reference"])
    op.create_index("ix_doc_vendor_type", "documents", ["vendor_normalized", "type"])
    op.create_index("ix_doc_status_type", "documents", ["status", "type"])

    op.create_table("anomalies",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("invoice_id", sa.String(36), sa.ForeignKey("documents.id")),
        sa.Column("invoice_number", sa.String(100)),
        sa.Column("vendor", sa.String(500)),
        sa.Column("currency", sa.String(10), server_default="USD"),
        sa.Column("type", sa.String(100), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("amount_at_risk", sa.Float, server_default="0"),
        sa.Column("contract_clause", sa.Text),
        sa.Column("recommendation", sa.Text),
        sa.Column("status", sa.String(50), server_default="open"),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_by", sa.String(255)),
        sa.Column("ai_explanation", sa.Text),
        sa.Column("ai_confidence", sa.Float),
    )
    op.create_index("ix_anomalies_invoice_id", "anomalies", ["invoice_id"])
    op.create_index("ix_anomalies_type", "anomalies", ["type"])
    op.create_index("ix_anomalies_status", "anomalies", ["status"])
    op.create_index("ix_anomalies_vendor", "anomalies", ["vendor"])

    op.create_table("matches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("invoice_id", sa.String(36), sa.ForeignKey("documents.id")),
        sa.Column("invoice_number", sa.String(100)),
        sa.Column("invoice_amount", sa.Float, server_default="0"),
        sa.Column("invoice_subtotal", sa.Float, server_default="0"),
        sa.Column("vendor", sa.String(500)),
        sa.Column("po_id", sa.String(36), sa.ForeignKey("documents.id")),
        sa.Column("po_number", sa.String(100)),
        sa.Column("po_amount", sa.Float, server_default="0"),
        sa.Column("match_score", sa.Float, server_default="0"),
        sa.Column("signals", json_type),
        sa.Column("amount_difference", sa.Float, server_default="0"),
        sa.Column("status", sa.String(50)),
        sa.Column("po_already_invoiced", sa.Float, server_default="0"),
        sa.Column("po_remaining", sa.Float, server_default="0"),
        sa.Column("po_invoice_count", sa.Integer, server_default="0"),
        sa.Column("over_invoiced", sa.Boolean, server_default=sa.text("false")),
        sa.Column("matched_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("match_type", sa.String(20), server_default="two_way"),
        sa.Column("grn_status", sa.String(50)),
        sa.Column("grn_ids", json_type),
        sa.Column("grn_numbers", json_type),
        sa.Column("total_received", sa.Float, server_default="0"),
        sa.Column("grn_line_items", json_type),
        sa.Column("received_date", sa.String(50)),
    )
    op.create_index("ix_matches_invoice_id", "matches", ["invoice_id"])
    op.create_index("ix_matches_po_id", "matches", ["po_id"])

    op.create_table("cases",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(500)),
        sa.Column("description", sa.Text),
        sa.Column("status", sa.String(50), server_default="open"),
        sa.Column("priority", sa.String(20), server_default="medium"),
        sa.Column("invoice_id", sa.String(36), sa.ForeignKey("documents.id")),
        sa.Column("anomaly_ids", json_type),
        sa.Column("vendor", sa.String(500)),
        sa.Column("amount_at_risk", sa.Float, server_default="0"),
        sa.Column("currency", sa.String(10), server_default="USD"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_by", sa.String(255)),
        sa.Column("assigned_to", sa.String(255)),
        sa.Column("assigned_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_by", sa.String(255)),
        sa.Column("resolution_notes", sa.Text),
        sa.Column("sla", json_type),
        sa.Column("case_notes", json_type),
        sa.Column("history", json_type),
        sa.Column("status_history", json_type),
        sa.Column("resolution", sa.Text),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("closed_by", sa.String(255)),
        sa.Column("escalated_to", sa.String(255)),
        sa.Column("escalated_at", sa.DateTime(timezone=True)),
        sa.Column("escalation_reason", sa.Text),
        sa.Column("investigation_brief", sa.Text),
        sa.Column("investigation_brief_generated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_cases_type", "cases", ["type"])
    op.create_index("ix_cases_status", "cases", ["status"])
    op.create_index("ix_cases_invoice_id", "cases", ["invoice_id"])
    op.create_index("ix_cases_vendor", "cases", ["vendor"])

    op.create_table("activity_log",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("document_id", sa.String(36)),
        sa.Column("document_type", sa.String(50)),
        sa.Column("document_number", sa.String(100)),
        sa.Column("vendor", sa.String(500)),
        sa.Column("amount", sa.Float),
        sa.Column("currency", sa.String(10)),
        sa.Column("confidence", sa.Float),
        sa.Column("count", sa.Integer),
        sa.Column("total_risk", sa.Float),
        sa.Column("details", json_type),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("performed_by", sa.String(255)),
        sa.Column("performed_by_email", sa.String(255)),
    )
    op.create_index("ix_activity_log_action", "activity_log", ["action"])
    op.create_index("ix_activity_log_document_id", "activity_log", ["document_id"])
    op.create_index("ix_activity_log_timestamp", "activity_log", ["timestamp"])

    op.create_table("correction_patterns",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("vendor", sa.String(500)),
        sa.Column("field", sa.String(100)),
        sa.Column("original_value", sa.Text),
        sa.Column("corrected_value", sa.Text),
        sa.Column("document_type", sa.String(50)),
        sa.Column("correction_count", sa.Integer, server_default="1"),
        sa.Column("last_corrected", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("details", json_type),
    )
    op.create_index("ix_correction_patterns_vendor", "correction_patterns", ["vendor"])

    op.create_table("vendor_profiles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("vendor", sa.String(500), nullable=False),
        sa.Column("vendor_normalized", sa.String(500)),
        sa.Column("risk_score", sa.Float, server_default="50"),
        sa.Column("risk_level", sa.String(20), server_default="medium"),
        sa.Column("risk_trend", sa.String(20), server_default="stable"),
        sa.Column("factors", json_type),
        sa.Column("invoice_count", sa.Integer, server_default="0"),
        sa.Column("total_spend", sa.Float, server_default="0"),
        sa.Column("open_anomalies", sa.Integer, server_default="0"),
        sa.Column("total_anomalies", sa.Integer, server_default="0"),
        sa.Column("last_updated", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_vendor_profiles_vendor", "vendor_profiles", ["vendor"])
    op.create_index("ix_vendor_profiles_vendor_normalized", "vendor_profiles", ["vendor_normalized"])

    op.create_table("kv_meta",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", json_type),
    )


def downgrade() -> None:
    op.drop_table("kv_meta")
    op.drop_table("vendor_profiles")
    op.drop_table("correction_patterns")
    op.drop_table("activity_log")
    op.drop_table("cases")
    op.drop_table("matches")
    op.drop_table("anomalies")
    op.drop_table("documents")
    op.drop_table("users")
