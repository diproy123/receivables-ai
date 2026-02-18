"""
AuditLens — Pydantic Schemas
Request/response validation for all API endpoints.
Replaces raw `await request.json()` with typed, validated models.
"""

from pydantic import BaseModel, Field, EmailStr, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime


# ============================================================
# AUTH
# ============================================================
class RegisterRequest(BaseModel):
    email: str = Field(..., min_length=3)
    password: str = Field(..., min_length=6)
    name: str = Field(..., min_length=1)
    role: str = Field(default="analyst")

    @field_validator("email")
    @classmethod
    def validate_email(cls, v):
        if "@" not in v:
            raise ValueError("Valid email required")
        return v.strip().lower()

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        return v.strip()


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v):
        return v.strip().lower()


class AuthResponse(BaseModel):
    success: bool = True
    token: str
    user: Dict[str, Any]


class RoleUpdateRequest(BaseModel):
    role: str


# ============================================================
# DOCUMENTS
# ============================================================
class LineItemSchema(BaseModel):
    description: str = "?"
    englishDescription: Optional[str] = None
    quantity: float = 0
    unitPrice: float = 0
    total: float = 0


class TaxDetailSchema(BaseModel):
    type: str = "Tax"
    rate: float = 0
    amount: float = 0


class DocumentResponse(BaseModel):
    id: str
    type: str
    documentName: Optional[str] = None
    vendor: Optional[str] = None
    amount: float = 0
    status: str = "pending"
    confidence: float = 0
    currency: str = "USD"

    model_config = {"from_attributes": True}


# ============================================================
# ANOMALIES
# ============================================================
class AnomalyResponse(BaseModel):
    id: str
    invoiceId: Optional[str] = None
    invoiceNumber: Optional[str] = None
    vendor: Optional[str] = None
    type: str
    severity: str
    description: Optional[str] = None
    amount_at_risk: float = 0
    status: str = "open"
    detectedAt: Optional[str] = None

    model_config = {"from_attributes": True}


class AnomalyResolveRequest(BaseModel):
    notes: str = ""


# ============================================================
# CASES
# ============================================================
class CaseCreateRequest(BaseModel):
    type: str = "anomaly_review"
    title: str
    description: str = ""
    priority: str = "medium"
    invoice_id: Optional[str] = None
    anomaly_ids: List[str] = Field(default_factory=list)
    vendor: Optional[str] = None
    amount_at_risk: float = 0


class CaseTransitionRequest(BaseModel):
    new_status: str
    notes: str = ""


class CaseAssignRequest(BaseModel):
    assignee: str


class CaseNoteRequest(BaseModel):
    text: str
    author: str = "system"


# ============================================================
# MATCHING
# ============================================================
class MatchResponse(BaseModel):
    id: str
    invoiceId: str
    poId: str
    matchScore: float = 0
    status: Optional[str] = None
    matchType: str = "two_way"

    model_config = {"from_attributes": True}


# ============================================================
# POLICY
# ============================================================
class PolicyUpdateRequest(BaseModel):
    matching_mode: Optional[str] = None
    amount_tolerance_pct: Optional[float] = None
    price_tolerance_pct: Optional[float] = None
    over_invoice_tolerance_pct: Optional[float] = None
    duplicate_window_days: Optional[int] = None
    high_severity_threshold_pct: Optional[float] = None
    medium_severity_threshold_pct: Optional[float] = None
    flag_round_number_invoices: Optional[bool] = None
    round_number_threshold: Optional[float] = None
    flag_weekend_invoices: Optional[bool] = None
    max_invoice_age_days: Optional[int] = None
    tax_rate_tolerance_pct: Optional[float] = None
    early_payment_discount_flag: Optional[bool] = None
    auto_approve_min_confidence: Optional[float] = None
    auto_approve_max_risk: Optional[float] = None
    block_duplicate_invoices: Optional[bool] = None
    require_po_for_auto_approve: Optional[bool] = None
    short_shipment_threshold_pct: Optional[float] = None
    sla_critical_hours: Optional[int] = None
    sla_high_hours: Optional[int] = None
    sla_medium_hours: Optional[int] = None
    sla_low_hours: Optional[int] = None


class PolicyPresetRequest(BaseModel):
    preset: str


# ============================================================
# VENDOR
# ============================================================
class VendorRiskResponse(BaseModel):
    vendor: str
    score: float
    level: str
    trend: str = "stable"
    invoiceCount: int = 0
    totalSpend: float = 0

    model_config = {"from_attributes": True}


# ============================================================
# TRIAGE
# ============================================================
class TriageOverrideRequest(BaseModel):
    lane: str
    reason: str = ""


# ============================================================
# CUSTOM MODEL / FINE-TUNING
# ============================================================
class FineTuneRequest(BaseModel):
    vendor: Optional[str] = None
    min_corrections: int = 5


# ============================================================
# GENERAL
# ============================================================
class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    database: str
    llm: str
    rag: str


class ErrorResponse(BaseModel):
    detail: str
