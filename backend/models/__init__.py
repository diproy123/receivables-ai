"""
AuditLens — SQLAlchemy ORM Models
Replaces the JSON-file database with proper relational models.

All JSON fields (line_items, tax_details, etc.) use JSONB for Postgres
and JSON for SQLite, enabling both production and local-dev flexibility.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Float, Boolean, Text, Integer, DateTime, ForeignKey,
    Index, Enum as SAEnum,
)
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import JSON


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


# Use JSONB on Postgres, JSON elsewhere
JsonType = JSON().with_variant(JSONB, "postgresql")


def utcnow():
    return datetime.now(timezone.utc)


# ============================================================
# USERS
# ============================================================
class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="analyst")
    password_hash = Column(String(255), nullable=False)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    def to_dict(self):
        return {
            "id": self.id, "email": self.email, "name": self.name,
            "role": self.role, "password_hash": self.password_hash,
            "active": self.active, "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


# ============================================================
# DOCUMENTS (invoices, POs, contracts, credit/debit notes, GRNs)
# ============================================================
class Document(Base):
    """Unified document table for all financial document types."""
    __tablename__ = "documents"

    id = Column(String(36), primary_key=True)
    type = Column(String(50), nullable=False, index=True)  # invoice, purchase_order, contract, credit_note, debit_note, goods_receipt
    document_name = Column(String(500))
    document_number = Column(String(100), index=True)  # invoiceNumber, poNumber, contractNumber, grnNumber, etc.

    # Vendor
    vendor = Column(String(500), index=True)
    vendor_normalized = Column(String(500), index=True)
    vendor_english = Column(String(500))

    # Financial
    amount = Column(Float, default=0)
    subtotal = Column(Float, default=0)
    total_tax = Column(Float, default=0)
    currency = Column(String(10), default="USD")

    # Status
    status = Column(String(50), default="pending", index=True)

    # Dates
    issue_date = Column(String(50))
    due_date = Column(String(50))
    delivery_date = Column(String(50))
    received_date = Column(String(50))

    # References
    po_reference = Column(String(100), index=True)
    original_invoice_ref = Column(String(100))

    # Confidence
    confidence = Column(Float, default=0)
    extraction_source = Column(String(50))

    # Structured data (JSONB)
    line_items = Column(JsonType, default=list)
    tax_details = Column(JsonType, default=list)
    confidence_factors = Column(JsonType, default=dict)
    ensemble_data = Column(JsonType)
    field_confidence = Column(JsonType)

    # Contract-specific
    pricing_terms = Column(JsonType, default=list)
    contract_terms = Column(JsonType, default=dict)
    parties = Column(JsonType, default=list)

    # GRN-specific
    received_by = Column(String(255))
    condition_notes = Column(Text)

    # Metadata
    payment_terms = Column(String(255))
    notes = Column(Text)
    early_payment_discount = Column(String(255))
    locale = Column(String(20), default="en_US")
    document_language = Column(String(10), default="en")
    uploaded_file = Column(String(500))
    uploaded_by = Column(String(255))
    uploaded_by_email = Column(String(255))
    extracted_at = Column(DateTime(timezone=True), default=utcnow)

    # Triage
    triage_lane = Column(String(50))
    triage_confidence = Column(Float)
    triage_reasons = Column(JsonType)
    triage_decided_at = Column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_doc_vendor_type", "vendor_normalized", "type"),
        Index("ix_doc_status_type", "status", "type"),
    )

    def to_dict(self):
        """Convert to the legacy dict format expected by existing business logic."""
        base = {
            "id": self.id, "type": self.type, "documentName": self.document_name,
            "vendor": self.vendor, "vendorNormalized": self.vendor_normalized,
            "vendorEnglish": self.vendor_english,
            "amount": self.amount, "subtotal": self.subtotal,
            "taxDetails": self.tax_details or [], "totalTax": self.total_tax,
            "issueDate": self.issue_date, "status": self.status,
            "lineItems": self.line_items or [],
            "confidence": self.confidence, "confidenceFactors": self.confidence_factors or {},
            "extractionSource": self.extraction_source,
            "extractedAt": self.extracted_at.isoformat() if self.extracted_at else None,
            "currency": self.currency, "locale": self.locale,
            "documentLanguage": self.document_language,
            "paymentTerms": self.payment_terms, "notes": self.notes,
            "earlyPaymentDiscount": self.early_payment_discount,
            "uploadedFile": self.uploaded_file,
            "uploadedBy": self.uploaded_by, "uploadedByEmail": self.uploaded_by_email,
        }
        if self.ensemble_data:
            base["ensembleData"] = self.ensemble_data
        if self.field_confidence:
            base["fieldConfidence"] = self.field_confidence

        # Type-specific fields
        if self.type == "invoice":
            base.update({"invoiceNumber": self.document_number,
                         "poReference": self.po_reference, "dueDate": self.due_date})
        elif self.type == "purchase_order":
            base.update({"poNumber": self.document_number, "deliveryDate": self.delivery_date})
        elif self.type == "contract":
            base.update({"contractNumber": self.document_number,
                         "pricingTerms": self.pricing_terms or [],
                         "contractTerms": self.contract_terms or {},
                         "parties": self.parties or []})
        elif self.type in ("credit_note", "debit_note"):
            base.update({"documentNumber": self.document_number,
                         "originalInvoiceRef": self.original_invoice_ref})
        elif self.type == "goods_receipt":
            base.update({"grnNumber": self.document_number,
                         "poReference": self.po_reference,
                         "receivedDate": self.received_date,
                         "receivedBy": self.received_by,
                         "conditionNotes": self.condition_notes})

        # Triage
        if self.triage_lane:
            base["triageLane"] = self.triage_lane
            base["triageConfidence"] = self.triage_confidence
            base["triageReasons"] = self.triage_reasons

        return base

    @classmethod
    def from_dict(cls, d: dict) -> "Document":
        """Create a Document from legacy dict format."""
        doc_number = (d.get("invoiceNumber") or d.get("poNumber") or
                      d.get("contractNumber") or d.get("documentNumber") or
                      d.get("grnNumber"))
        return cls(
            id=d["id"], type=d["type"], document_name=d.get("documentName"),
            document_number=doc_number,
            vendor=d.get("vendor"), vendor_normalized=d.get("vendorNormalized"),
            vendor_english=d.get("vendorEnglish"),
            amount=d.get("amount", 0), subtotal=d.get("subtotal", 0),
            total_tax=d.get("totalTax", 0), currency=d.get("currency", "USD"),
            status=d.get("status", "pending"),
            issue_date=d.get("issueDate"), due_date=d.get("dueDate"),
            delivery_date=d.get("deliveryDate"), received_date=d.get("receivedDate"),
            po_reference=d.get("poReference"),
            original_invoice_ref=d.get("originalInvoiceRef"),
            confidence=d.get("confidence", 0),
            extraction_source=d.get("extractionSource"),
            line_items=d.get("lineItems", []),
            tax_details=d.get("taxDetails", []),
            confidence_factors=d.get("confidenceFactors", {}),
            ensemble_data=d.get("ensembleData"),
            field_confidence=d.get("fieldConfidence"),
            pricing_terms=d.get("pricingTerms"),
            contract_terms=d.get("contractTerms"),
            parties=d.get("parties"),
            received_by=d.get("receivedBy"),
            condition_notes=d.get("conditionNotes"),
            payment_terms=d.get("paymentTerms"),
            notes=d.get("notes"),
            early_payment_discount=d.get("earlyPaymentDiscount"),
            locale=d.get("locale", "en_US"),
            document_language=d.get("documentLanguage", "en"),
            uploaded_file=d.get("uploadedFile"),
            uploaded_by=d.get("uploadedBy"),
            uploaded_by_email=d.get("uploadedByEmail"),
            triage_lane=d.get("triageLane"),
            triage_confidence=d.get("triageConfidence"),
            triage_reasons=d.get("triageReasons"),
        )


# ============================================================
# ANOMALIES
# ============================================================
class Anomaly(Base):
    __tablename__ = "anomalies"

    id = Column(String(36), primary_key=True)
    invoice_id = Column(String(36), ForeignKey("documents.id"), index=True)
    invoice_number = Column(String(100))
    vendor = Column(String(500), index=True)
    currency = Column(String(10), default="USD")
    type = Column(String(100), nullable=False, index=True)
    severity = Column(String(20), nullable=False)
    description = Column(Text)
    amount_at_risk = Column(Float, default=0)
    contract_clause = Column(Text)
    recommendation = Column(Text)
    status = Column(String(50), default="open", index=True)
    detected_at = Column(DateTime(timezone=True), default=utcnow)
    resolved_at = Column(DateTime(timezone=True))
    resolved_by = Column(String(255))

    # AI-generated fields
    ai_explanation = Column(Text)
    ai_confidence = Column(Float)

    def to_dict(self):
        return {
            "id": self.id, "invoiceId": self.invoice_id,
            "invoiceNumber": self.invoice_number, "vendor": self.vendor,
            "currency": self.currency, "type": self.type,
            "severity": self.severity, "description": self.description,
            "amount_at_risk": self.amount_at_risk,
            "contract_clause": self.contract_clause,
            "recommendation": self.recommendation,
            "status": self.status,
            "detectedAt": self.detected_at.isoformat() if self.detected_at else None,
            "resolvedAt": self.resolved_at.isoformat() if self.resolved_at else None,
            "resolvedBy": self.resolved_by,
            "aiExplanation": self.ai_explanation,
            "aiConfidence": self.ai_confidence,
        }


# ============================================================
# MATCHES
# ============================================================
class Match(Base):
    __tablename__ = "matches"

    id = Column(String(36), primary_key=True)
    invoice_id = Column(String(36), ForeignKey("documents.id"), index=True)
    invoice_number = Column(String(100))
    invoice_amount = Column(Float, default=0)
    invoice_subtotal = Column(Float, default=0)
    vendor = Column(String(500))
    po_id = Column(String(36), ForeignKey("documents.id"), index=True)
    po_number = Column(String(100))
    po_amount = Column(Float, default=0)
    match_score = Column(Float, default=0)
    signals = Column(JsonType, default=list)
    amount_difference = Column(Float, default=0)
    status = Column(String(50))
    po_already_invoiced = Column(Float, default=0)
    po_remaining = Column(Float, default=0)
    po_invoice_count = Column(Integer, default=0)
    over_invoiced = Column(Boolean, default=False)
    matched_at = Column(DateTime(timezone=True), default=utcnow)

    # Three-way matching (GRN)
    match_type = Column(String(20), default="two_way")
    grn_status = Column(String(50))
    grn_ids = Column(JsonType, default=list)
    grn_numbers = Column(JsonType, default=list)
    total_received = Column(Float, default=0)
    grn_line_items = Column(JsonType, default=list)
    received_date = Column(String(50))

    def to_dict(self):
        d = {
            "id": self.id, "invoiceId": self.invoice_id,
            "invoiceNumber": self.invoice_number,
            "invoiceAmount": self.invoice_amount,
            "invoiceSubtotal": self.invoice_subtotal,
            "vendor": self.vendor,
            "poId": self.po_id, "poNumber": self.po_number, "poAmount": self.po_amount,
            "matchScore": self.match_score, "signals": self.signals or [],
            "amountDifference": self.amount_difference, "status": self.status,
            "poAlreadyInvoiced": self.po_already_invoiced,
            "poRemaining": self.po_remaining,
            "poInvoiceCount": self.po_invoice_count,
            "overInvoiced": self.over_invoiced,
            "matchedAt": self.matched_at.isoformat() if self.matched_at else None,
            "matchType": self.match_type, "grnStatus": self.grn_status,
            "grnIds": self.grn_ids or [], "grnNumbers": self.grn_numbers or [],
            "totalReceived": self.total_received,
            "grnLineItems": self.grn_line_items or [],
            "receivedDate": self.received_date,
        }
        return d


# ============================================================
# CASES
# ============================================================
class Case(Base):
    __tablename__ = "cases"

    id = Column(String(36), primary_key=True)
    type = Column(String(50), nullable=False, index=True)
    title = Column(String(500))
    description = Column(Text)
    status = Column(String(50), default="open", index=True)
    priority = Column(String(20), default="medium")
    invoice_id = Column(String(36), ForeignKey("documents.id"), index=True)
    anomaly_ids = Column(JsonType, default=list)
    vendor = Column(String(500), index=True)
    amount_at_risk = Column(Float, default=0)
    currency = Column(String(10), default="USD")
    created_at = Column(DateTime(timezone=True), default=utcnow)
    created_by = Column(String(255))
    assigned_to = Column(String(255))
    assigned_at = Column(DateTime(timezone=True))
    resolved_at = Column(DateTime(timezone=True))
    resolved_by = Column(String(255))
    resolution_notes = Column(Text)

    # SLA
    sla = Column(JsonType, default=dict)

    # Notes and history
    case_notes = Column(JsonType, default=list)
    history = Column(JsonType, default=list)
    status_history = Column(JsonType, default=list)

    # Resolution / closure / escalation
    resolution = Column(Text)
    closed_at = Column(DateTime(timezone=True))
    closed_by = Column(String(255))
    escalated_to = Column(String(255))
    escalated_at = Column(DateTime(timezone=True))
    escalation_reason = Column(Text)

    # AI investigation brief
    investigation_brief = Column(Text)
    investigation_brief_generated_at = Column(DateTime(timezone=True))

    def to_dict(self):
        return {
            "id": self.id, "type": self.type, "title": self.title,
            "description": self.description, "status": self.status,
            "priority": self.priority, "invoiceId": self.invoice_id,
            "anomalyIds": self.anomaly_ids or [], "vendor": self.vendor,
            "amountAtRisk": self.amount_at_risk, "currency": self.currency,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "createdBy": self.created_by, "assignedTo": self.assigned_to,
            "assignedAt": self.assigned_at.isoformat() if self.assigned_at else None,
            "resolvedAt": self.resolved_at.isoformat() if self.resolved_at else None,
            "resolvedBy": self.resolved_by, "resolutionNotes": self.resolution_notes,
            "resolution": self.resolution,
            "closedAt": self.closed_at.isoformat() if self.closed_at else None,
            "closedBy": self.closed_by,
            "escalatedTo": self.escalated_to,
            "escalatedAt": self.escalated_at.isoformat() if self.escalated_at else None,
            "escalationReason": self.escalation_reason,
            "sla": self.sla or {},
            "notes": self.case_notes or [],
            "statusHistory": self.status_history or [],
            "investigationBrief": self.investigation_brief,
        }


# ============================================================
# ACTIVITY LOG
# ============================================================
class ActivityLog(Base):
    __tablename__ = "activity_log"

    id = Column(String(36), primary_key=True)
    action = Column(String(100), nullable=False, index=True)
    document_id = Column(String(36), index=True)
    document_type = Column(String(50))
    document_number = Column(String(100))
    vendor = Column(String(500))
    amount = Column(Float)
    currency = Column(String(10))
    confidence = Column(Float)
    count = Column(Integer)
    total_risk = Column(Float)
    details = Column(JsonType)
    timestamp = Column(DateTime(timezone=True), default=utcnow, index=True)
    performed_by = Column(String(255))
    performed_by_email = Column(String(255))

    def to_dict(self):
        d = {
            "id": self.id, "action": self.action,
            "documentId": self.document_id, "documentType": self.document_type,
            "documentNumber": self.document_number, "vendor": self.vendor,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "performedBy": self.performed_by, "performedByEmail": self.performed_by_email,
        }
        if self.amount is not None:
            d["amount"] = self.amount
        if self.currency:
            d["currency"] = self.currency
        if self.confidence is not None:
            d["confidence"] = self.confidence
        if self.count is not None:
            d["count"] = self.count
        if self.total_risk is not None:
            d["totalRisk"] = self.total_risk
        if self.details:
            d.update(self.details)
        return d


# ============================================================
# CORRECTION PATTERNS (for extraction learning)
# ============================================================
class CorrectionPattern(Base):
    __tablename__ = "correction_patterns"

    id = Column(String(36), primary_key=True)
    vendor = Column(String(500), index=True)
    field = Column(String(100))
    original_value = Column(Text)
    corrected_value = Column(Text)
    document_type = Column(String(50))
    correction_count = Column(Integer, default=1)
    last_corrected = Column(DateTime(timezone=True), default=utcnow)
    details = Column(JsonType)

    def to_dict(self):
        d = {
            "id": self.id, "vendor": self.vendor,
            "vendorNormalized": self.details.get("vendorNormalized", "") if self.details else "",
            "documentType": self.document_type,
            "field": self.field,
            "extracted_value": self.original_value,
            "corrected_value": self.corrected_value,
            "timestamp": self.last_corrected.isoformat() if self.last_corrected else None,
            "correctionCount": self.correction_count,
        }
        if self.details:
            # Merge any extra fields stored in details
            for k, v in self.details.items():
                if k not in d:
                    d[k] = v
        return d


# ============================================================
# VENDOR PROFILES
# ============================================================
class VendorProfile(Base):
    __tablename__ = "vendor_profiles"

    id = Column(String(36), primary_key=True)
    vendor = Column(String(500), nullable=False, index=True)
    vendor_normalized = Column(String(500), index=True)
    risk_score = Column(Float, default=50)
    risk_level = Column(String(20), default="medium")
    risk_trend = Column(String(20), default="stable")
    factors = Column(JsonType, default=dict)
    invoice_count = Column(Integer, default=0)
    total_spend = Column(Float, default=0)
    open_anomalies = Column(Integer, default=0)
    total_anomalies = Column(Integer, default=0)
    last_updated = Column(DateTime(timezone=True), default=utcnow)

    def to_dict(self):
        return {
            "vendor": self.vendor, "vendorNormalized": self.vendor_normalized,
            "riskScore": self.risk_score, "riskLevel": self.risk_level,
            "riskTrend": self.risk_trend, "factors": self.factors or {},
            "invoiceCount": self.invoice_count, "totalSpend": self.total_spend,
            "openAnomalies": self.open_anomalies, "totalAnomalies": self.total_anomalies,
            "lastUpdated": self.last_updated.isoformat() if self.last_updated else None,
        }


# ============================================================
# KEY-VALUE METADATA (policy_state, custom_model_config, etc.)
# For dict/list data that doesn't fit a relational model.
# ============================================================
class KVMeta(Base):
    __tablename__ = "kv_meta"

    key = Column(String(100), primary_key=True)
    value = Column(JsonType)
