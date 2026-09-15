import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.fiscal_models import RestaurantFiscalProfile
from app.fiscal_reference_models import (
    FiscalOfficialReferenceSnapshot,
    FiscalOfficialReferenceState,
)
from app.services.fiscal_preflight import evaluate_fiscal_preflight


NOW = datetime.datetime(2026, 9, 15, 21, 0, tzinfo=datetime.timezone.utc)


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    FiscalOfficialReferenceSnapshot.__table__.create(engine)
    FiscalOfficialReferenceState.__table__.create(engine)
    return Session(engine)


def _profile() -> RestaurantFiscalProfile:
    return RestaurantFiscalProfile(
        restaurante_id=1,
        cnpj="11222333000181",
        inscricao_estadual="060000015",
        razao_social="Restaurante Teste Ltda",
        crt="1",
        cnae_principal="5611201",
        country_code="BR",
        uf="CE",
        document_model="65",
        environment="homologacao",
        series=1,
        provider="direct_sefaz",
        enabled=False,
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
        },
        certificate_secret_ref="dbenc://fiscal-credential/a1",
        certificate_fingerprint="abc123",
        certificate_expires_at=datetime.datetime(2027, 1, 1, tzinfo=datetime.timezone.utc),
        csc_id="1",
        csc_secret_ref="dbenc://fiscal-credential/csc",
    )


def _reference(db: Session, source_key: str, version: str) -> None:
    snapshot = FiscalOfficialReferenceSnapshot(
        id=f"{source_key}-snapshot",
        source_key=source_key,
        source_url=f"https://example.invalid/{source_key}",
        source_version=version,
        content_sha256="a" * 64,
        identity_sha256=(source_key.encode().hex() + "0" * 64)[:64],
        metadata_json={},
        payload_json={},
        effective_dates_json=[],
        observed_at=NOW,
    )
    db.add(snapshot)
    db.flush()
    db.add(
        FiscalOfficialReferenceState(
            source_key=source_key,
            source_url=snapshot.source_url,
            observed_version=version,
            observed_sha256=snapshot.content_sha256,
            active_version=version,
            active_sha256=snapshot.content_sha256,
            observed_snapshot_id=snapshot.id,
            active_snapshot_id=snapshot.id,
            status="current",
            checked_at=NOW,
            promoted_at=NOW,
        )
    )
    db.commit()


def test_activation_can_be_green_before_enabled_flag_is_set():
    db = _session()
    try:
        _reference(db, "rfb-ncm-json", "ncm-v1")
        _reference(db, "rfb-rtc-calculator-local", "1.3.0|db:V0042")

        result = evaluate_fiscal_preflight(db, _profile(), mode="activation", now=NOW)

        assert result.ready is True
        assert result.profile_ready is True
        assert result.references_ready is True
        assert "fiscal_issuance_disabled" not in {issue.code for issue in result.issues}
    finally:
        db.close()


def test_activation_fails_closed_without_rtc_reference():
    db = _session()
    try:
        _reference(db, "rfb-ncm-json", "ncm-v1")

        result = evaluate_fiscal_preflight(db, _profile(), mode="activation", now=NOW)

        assert result.ready is False
        assert any(
            issue.code == "official_reference_missing"
            and issue.source_key == "rfb-rtc-calculator-local"
            for issue in result.issues
        )
    finally:
        db.close()
