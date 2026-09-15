import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.fiscal_models import RestaurantFiscalProfile
from app.fiscal_reference_models import (
    FiscalOfficialReferenceSnapshot,
    FiscalOfficialReferenceState,
)
from app.routes import fiscal_onboarding
from app.services import fiscal_issuance
from app.services.fiscal_issuance import FiscalPreflightBlocked
from app.services.fiscal_preflight import (
    FiscalPreflightIssue,
    FiscalPreflightResult,
    FiscalReferenceCheck,
    evaluate_fiscal_preflight,
)


NOW = datetime.datetime(2026, 9, 15, 21, 0, tzinfo=datetime.timezone.utc)


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    FiscalOfficialReferenceSnapshot.__table__.create(engine)
    FiscalOfficialReferenceState.__table__.create(engine)
    return Session(engine)


def _ready_profile(*, enabled: bool = False) -> RestaurantFiscalProfile:
    return RestaurantFiscalProfile(
        restaurante_id=1,
        cnpj="11222333000181",
        inscricao_estadual="060000015",
        razao_social="Restaurante Teste Ltda",
        nome_fantasia="Restaurante Teste",
        crt="1",
        cnae_principal="5611201",
        country_code="BR",
        uf="CE",
        document_model="65",
        environment="homologacao",
        series=1,
        provider="direct_sefaz",
        enabled=enabled,
        municipio_codigo_ibge="2304400",
        endereco_fiscal={
            "cep": "60000000",
            "logradouro": "Rua Teste",
            "numero": "100",
            "bairro": "Centro",
            "municipio_nome": "Fortaleza",
            "municipio_codigo_ibge": "2304400",
            "uf": "CE",
            "municipio_source": "ibge-localidades",
            "municipio_verified_at": NOW.isoformat(),
        },
        certificate_secret_ref="secret://fiscal/a1/tenant-1",
        certificate_fingerprint="abc123",
        certificate_expires_at=datetime.datetime(2027, 1, 1, tzinfo=datetime.timezone.utc),
        csc_id="1",
        csc_secret_ref="secret://fiscal/csc/tenant-1",
    )


def _add_reference(
    db: Session,
    source_key: str,
    *,
    status: str = "current",
    checked_at: datetime.datetime = NOW,
    active_version: str = "v1",
    observed_version: str | None = None,
) -> FiscalOfficialReferenceState:
    observed_version = observed_version or active_version
    active = FiscalOfficialReferenceSnapshot(
        id=f"{source_key}-active",
        source_key=source_key,
        source_url=f"https://example.invalid/{source_key}",
        source_version=active_version,
        content_sha256=("a" * 63) + "1",
        identity_sha256=("b" * 63) + "1",
        metadata_json={},
        payload_json={},
        effective_dates_json=[],
        observed_at=NOW,
    )
    db.add(active)
    db.flush()

    observed = active
    if observed_version != active_version:
        observed = FiscalOfficialReferenceSnapshot(
            id=f"{source_key}-observed",
            source_key=source_key,
            source_url=f"https://example.invalid/{source_key}",
            source_version=observed_version,
            content_sha256=("c" * 63) + "2",
            identity_sha256=("d" * 63) + "2",
            metadata_json={},
            payload_json={},
            effective_dates_json=[],
            observed_at=NOW,
        )
        db.add(observed)
        db.flush()

    state = FiscalOfficialReferenceState(
        source_key=source_key,
        source_url=f"https://example.invalid/{source_key}",
        observed_version=observed_version,
        observed_sha256=observed.content_sha256,
        active_version=active_version,
        active_sha256=active.content_sha256,
        observed_snapshot_id=observed.id,
        active_snapshot_id=active.id,
        status=status,
        checked_at=checked_at,
        changed_at=NOW if status == "changed" else None,
        promoted_at=NOW,
    )
    db.add(state)
    db.commit()
    return state


def test_foundation_preflight_passes_with_current_versioned_ncm():
    db = _session()
    try:
        _add_reference(db, "rfb-ncm-json")
        result = evaluate_fiscal_preflight(db, _ready_profile(), mode="foundation", now=NOW)

        assert result.ready is True
        assert result.profile_ready is True
        assert result.references_ready is True
        assert result.issues == ()
        ncm = next(item for item in result.references if item.source_key == "rfb-ncm-json")
        assert ncm.active_snapshot_id == "rfb-ncm-json-active"
        # Fontes monitoradas ausentes alertam, mas não derrubam a operação atual.
        assert {warning.source_key for warning in result.warnings} >= {
            "nfe-informes-tecnicos",
            "nfe-portal-notices",
        }
    finally:
        db.close()


def test_foundation_preflight_blocks_changed_ncm_but_monitor_change_is_warning():
    db = _session()
    try:
        _add_reference(
            db,
            "rfb-ncm-json",
            status="changed",
            active_version="v1",
            observed_version="v2",
        )
        _add_reference(
            db,
            "nfe-informes-tecnicos",
            status="changed",
            active_version="catalog-v1",
            observed_version="catalog-v2",
        )

        result = evaluate_fiscal_preflight(db, _ready_profile(), mode="foundation", now=NOW)

        assert result.ready is False
        assert "official_reference_changed" in {issue.code for issue in result.issues}
        assert any(
            warning.code == "official_reference_changed"
            and warning.source_key == "nfe-informes-tecnicos"
            for warning in result.warnings
        )
    finally:
        db.close()


def test_foundation_preflight_blocks_stale_ncm():
    db = _session()
    try:
        _add_reference(
            db,
            "rfb-ncm-json",
            checked_at=NOW - datetime.timedelta(days=3),
        )
        result = evaluate_fiscal_preflight(db, _ready_profile(), mode="foundation", now=NOW)

        assert result.ready is False
        assert "official_reference_stale" in {issue.code for issue in result.issues}
    finally:
        db.close()


def test_issuance_requires_current_rtc_snapshot_and_enabled_profile():
    db = _session()
    try:
        _add_reference(db, "rfb-ncm-json")
        result = evaluate_fiscal_preflight(
            db,
            _ready_profile(enabled=False),
            mode="issuance",
            now=NOW,
        )

        codes = {issue.code for issue in result.issues}
        assert result.ready is False
        assert "official_reference_missing" in codes
        assert "fiscal_issuance_disabled" in codes
    finally:
        db.close()


def test_issuance_passes_when_profile_and_blocking_sources_are_current():
    db = _session()
    try:
        _add_reference(db, "rfb-ncm-json")
        _add_reference(db, "rfb-rtc-calculator-local", active_version="1.3.0|db:V0042")

        result = evaluate_fiscal_preflight(
            db,
            _ready_profile(enabled=True),
            mode="issuance",
            now=NOW,
        )

        assert result.ready is True
        assert result.references_ready is True
        active = {
            check.source_key: check.active_snapshot_id
            for check in result.references
            if check.active_snapshot_id
        }
        assert active["rfb-ncm-json"] == "rfb-ncm-json-active"
        assert active["rfb-rtc-calculator-local"] == "rfb-rtc-calculator-local-active"
    finally:
        db.close()


def test_preflighted_document_never_calls_numbering_when_gate_blocks(monkeypatch):
    profile = _ready_profile(enabled=True)

    class Query:
        def filter(self, *_args):
            return self

        def with_for_update(self):
            return self

        def one_or_none(self):
            return profile

    class Db:
        rolled_back = False

        def query(self, _model):
            return Query()

        def rollback(self):
            self.rolled_back = True

    blocked = FiscalPreflightResult(
        ready=False,
        mode="issuance",
        jurisdiction_key="BR-CE",
        profile_ready=True,
        references_ready=False,
        issues=(
            FiscalPreflightIssue(
                code="official_reference_stale",
                message="NCM stale",
                severity="blocking",
                source_key="rfb-ncm-json",
            ),
        ),
        warnings=(),
        references=(),
        compliance_baseline=(),
    )
    monkeypatch.setattr(fiscal_issuance, "evaluate_fiscal_preflight", lambda *_a, **_k: blocked)

    called = False

    def should_not_create(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("numeração não pode ser chamada")

    monkeypatch.setattr(fiscal_issuance, "create_numbered_fiscal_document", should_not_create)
    db = Db()

    try:
        fiscal_issuance.create_preflighted_fiscal_document(
            db,
            restaurante_id=1,
            idempotency_key="sale-1",
            sale_snapshot={"saleId": "1"},
            total_amount="10.00",
        )
        raise AssertionError("preflight deveria bloquear")
    except FiscalPreflightBlocked:
        pass

    assert called is False
    assert db.rolled_back is True


def test_preflighted_document_embeds_active_reference_lineage(monkeypatch):
    profile = _ready_profile(enabled=True)

    class Query:
        def filter(self, *_args):
            return self

        def with_for_update(self):
            return self

        def one_or_none(self):
            return profile

    class Db:
        def query(self, _model):
            return Query()

    ready = FiscalPreflightResult(
        ready=True,
        mode="issuance",
        jurisdiction_key="BR-CE",
        profile_ready=True,
        references_ready=True,
        issues=(),
        warnings=(),
        references=(
            FiscalReferenceCheck(
                source_key="rfb-ncm-json",
                title="NCM",
                blocking=True,
                status="current",
                stale=False,
                checked_at=NOW,
                observed_snapshot_id="ncm-s1",
                active_snapshot_id="ncm-s1",
                observed_version="v1",
                active_version="v1",
                last_error=None,
            ),
            FiscalReferenceCheck(
                source_key="rfb-rtc-calculator-local",
                title="RTC",
                blocking=True,
                status="current",
                stale=False,
                checked_at=NOW,
                observed_snapshot_id="rtc-s1",
                active_snapshot_id="rtc-s1",
                observed_version="1.3.0|db:V0042",
                active_version="1.3.0|db:V0042",
                last_error=None,
            ),
        ),
        compliance_baseline=(
            {
                "key": "moc-nfe-nfce",
                "title": "MOC",
                "version": "7.0",
                "adoptionStatus": "baseline",
                "verifiedOn": "2026-09-15",
                "sourceUrl": "https://example.invalid/moc",
            },
        ),
    )
    monkeypatch.setattr(fiscal_issuance, "evaluate_fiscal_preflight", lambda *_a, **_k: ready)

    captured = {}

    def capture_create(_db, **kwargs):
        captured.update(kwargs)
        return "created"

    monkeypatch.setattr(fiscal_issuance, "create_numbered_fiscal_document", capture_create)

    result = fiscal_issuance.create_preflighted_fiscal_document(
        Db(),
        restaurante_id=1,
        idempotency_key="sale-1",
        sale_snapshot={"saleId": "1"},
        total_amount="10.00",
    )

    assert result == "created"
    lineage = captured["sale_snapshot"]["fiscalPreflight"]
    assert lineage["activeReferences"] == {
        "rfb-ncm-json": "ncm-s1",
        "rfb-rtc-calculator-local": "rtc-s1",
    }
    assert lineage["complianceBaseline"][0]["version"] == "7.0"
    assert captured["environment"] == "homologacao"
    assert captured["model"] == "65"
    assert captured["series"] == 1


def test_fiscal_preflight_route_is_registered_for_manual_validation():
    paths = {route.path for route in fiscal_onboarding.router.routes}
    assert "/api/onboarding/fiscal/preflight" in paths
