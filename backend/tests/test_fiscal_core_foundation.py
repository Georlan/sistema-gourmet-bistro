import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import TenantScopeError, TenantSession
from app.fiscal.compliance import (
    OFFICIAL_FISCAL_BASELINE,
    assert_official_baseline,
    baseline_by_key,
)
from app.fiscal_models import (
    FiscalDocument,
    FiscalSequence,
    ProductFiscalProfile,
    RestaurantFiscalProfile,
)
from app.services.fiscal_state import (
    InvalidFiscalTransition,
    next_fiscal_statuses,
    validate_fiscal_transition,
)


def _constraint_names(model) -> set[str]:
    return {
        constraint.name
        for constraint in model.__table__.constraints
        if constraint.name is not None
    }


def test_compliance_baseline_uses_only_official_sources_and_unique_keys():
    assert_official_baseline()
    keys = [source.key for source in OFFICIAL_FISCAL_BASELINE]
    assert len(keys) == len(set(keys))
    assert baseline_by_key("moc-nfe-nfce").version == "7.0"
    assert baseline_by_key("ce-in-87-2025").jurisdiction == "CE"
    assert baseline_by_key("nt-2026-002").adoption_status == "monitor"


def test_fiscal_document_has_tenant_idempotency_and_number_uniqueness():
    constraints = _constraint_names(FiscalDocument)
    assert "uq_fiscal_document_tenant_idempotency" in constraints
    assert "uq_fiscal_document_number" in constraints
    assert "uq_fiscal_document_access_key" in constraints


def test_fiscal_sequence_is_scoped_by_tenant_environment_model_and_series():
    constraints = _constraint_names(FiscalSequence)
    assert "uq_fiscal_sequence_scope" in constraints


def test_fiscal_profile_stores_secret_references_not_raw_certificate_material():
    columns = set(RestaurantFiscalProfile.__table__.columns.keys())
    assert "certificate_secret_ref" in columns
    assert "csc_secret_ref" in columns
    assert "certificate_pfx" not in columns
    assert "certificate_private_key" not in columns
    assert "csc_secret" not in columns


def test_product_fiscal_profile_is_versioned_and_can_start_as_draft():
    profile = ProductFiscalProfile(
        restaurante_id=1,
        produto_id="produto-1",
        revision=3,
        status="draft",
    )
    assert profile.revision == 3
    assert profile.status == "draft"
    assert "uq_product_fiscal_profile_revision" in _constraint_names(ProductFiscalProfile)


def test_cross_tenant_fiscal_write_fails_before_sql():
    engine = create_engine("sqlite:///:memory:")
    SessionForTest = sessionmaker(bind=engine, class_=TenantSession)

    with SessionForTest(restaurante_id=1) as db:
        db.add(RestaurantFiscalProfile(restaurante_id=2))
        with pytest.raises(TenantScopeError, match="cross-tenant"):
            db.flush()


def test_fiscal_state_machine_preserves_unknown_and_reconciliation_path():
    assert validate_fiscal_transition("submitting", "unknown").to_status == "unknown"
    assert validate_fiscal_transition("unknown", "reconciling").to_status == "reconciling"
    assert "authorized" in next_fiscal_statuses("reconciling")


def test_fiscal_state_machine_rejects_shortcuts_and_redundant_transitions():
    with pytest.raises(InvalidFiscalTransition):
        validate_fiscal_transition("draft", "authorized")
    with pytest.raises(InvalidFiscalTransition):
        validate_fiscal_transition("authorized", "authorized")
    with pytest.raises(InvalidFiscalTransition):
        validate_fiscal_transition("cancelled", "submitting")
