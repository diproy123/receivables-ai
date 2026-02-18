"""
AuditLens — Smoke Tests
Basic tests to verify Phase 1 infrastructure works.
"""

import pytest
from backend.models import Base, User, Document, Anomaly, Match, Case
from backend.models.database import engine, SessionLocal, init_db


class TestModels:
    """Verify SQLAlchemy models create tables and basic CRUD works."""

    def setup_method(self):
        """Create fresh tables for each test."""
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        self.session = SessionLocal()

    def teardown_method(self):
        self.session.close()

    def test_create_user(self):
        user = User(id="test-001", email="test@example.com", name="Test User",
                     role="analyst", password_hash="$2b$12$fakehash")
        self.session.add(user)
        self.session.commit()
        result = self.session.get(User, "test-001")
        assert result is not None
        assert result.email == "test@example.com"
        assert result.role == "analyst"

    def test_create_document(self):
        doc = Document(
            id="doc-001", type="invoice", document_name="test.pdf",
            document_number="INV-001", vendor="Acme Corp",
            vendor_normalized="acme corp", amount=1500.00,
            subtotal=1400.00, currency="USD", status="unpaid",
            line_items=[{"description": "Widget", "quantity": 10, "unitPrice": 140, "total": 1400}],
        )
        self.session.add(doc)
        self.session.commit()
        result = self.session.get(Document, "doc-001")
        assert result is not None
        assert result.amount == 1500.00
        assert len(result.line_items) == 1
        d = result.to_dict()
        assert d["invoiceNumber"] == "INV-001"
        assert d["vendor"] == "Acme Corp"

    def test_create_anomaly(self):
        # Need a document first for FK
        doc = Document(id="doc-002", type="invoice", amount=100, status="unpaid",
                       vendor="Test", vendor_normalized="test")
        self.session.add(doc)
        self.session.commit()

        anom = Anomaly(
            id="anom-001", invoice_id="doc-002", vendor="Test",
            type="PRICE_OVERCHARGE", severity="high",
            description="Unit price exceeds PO by 25%",
            amount_at_risk=250.00, status="open",
        )
        self.session.add(anom)
        self.session.commit()
        result = self.session.get(Anomaly, "anom-001")
        assert result.severity == "high"
        assert result.amount_at_risk == 250.00

    def test_document_from_dict(self):
        """Test the from_dict factory method."""
        d = {
            "id": "dict-001", "type": "purchase_order",
            "documentName": "po.pdf", "vendor": "Widgets Inc",
            "vendorNormalized": "widgets inc", "amount": 5000,
            "subtotal": 5000, "poNumber": "PO-2026-001",
            "status": "open", "lineItems": [],
            "taxDetails": [], "confidenceFactors": {},
            "currency": "USD",
        }
        doc = Document.from_dict(d)
        self.session.add(doc)
        self.session.commit()
        result = self.session.get(Document, "dict-001")
        assert result.document_number == "PO-2026-001"
        assert result.type == "purchase_order"

    def test_document_to_dict_roundtrip(self):
        """Ensure to_dict produces the legacy format."""
        doc = Document(
            id="rt-001", type="invoice", document_number="INV-RT",
            vendor="Test", vendor_normalized="test", amount=100,
            subtotal=90, total_tax=10, currency="INR",
            status="unpaid", po_reference="PO-001",
            line_items=[{"description": "Item", "quantity": 1, "unitPrice": 90, "total": 90}],
            tax_details=[{"type": "GST", "rate": 11.11, "amount": 10}],
        )
        d = doc.to_dict()
        assert d["invoiceNumber"] == "INV-RT"
        assert d["poReference"] == "PO-001"
        assert d["currency"] == "INR"
        assert len(d["lineItems"]) == 1
        assert len(d["taxDetails"]) == 1


class TestSchemas:
    """Verify Pydantic schemas validate correctly."""

    def test_register_request_valid(self):
        from backend.schemas import RegisterRequest
        req = RegisterRequest(email="test@example.com", password="secret123", name="Dip")
        assert req.email == "test@example.com"
        assert req.name == "Dip"

    def test_register_request_invalid_email(self):
        from backend.schemas import RegisterRequest
        with pytest.raises(Exception):
            RegisterRequest(email="notanemail", password="secret123", name="Test")

    def test_register_request_short_password(self):
        from backend.schemas import RegisterRequest
        with pytest.raises(Exception):
            RegisterRequest(email="test@test.com", password="123", name="Test")

    def test_login_request(self):
        from backend.schemas import LoginRequest
        req = LoginRequest(email="  Test@Example.com  ", password="pass")
        assert req.email == "test@example.com"

    def test_policy_update_partial(self):
        from backend.schemas import PolicyUpdateRequest
        req = PolicyUpdateRequest(amount_tolerance_pct=3.5)
        assert req.amount_tolerance_pct == 3.5
        assert req.price_tolerance_pct is None
