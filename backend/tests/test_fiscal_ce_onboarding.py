import datetime

import pytest

from app.contract_validation import is_valid_cnpj as is_valid_contract_cnpj, tax_id_kind
from app.fiscal.compliance import baseline_by_key
from app.fiscal.ibge import IbgeMunicipality, parse_ibge_municipality
from app.fiscal.identifiers import (
    FiscalIdentifierError,
    normalize_cnpj,
    uf_from_ibge_municipality_code,
)
from app.fiscal.jurisdiction import (
    FiscalJurisdictionError,
    fiscal_policy_for,
    resolve_fiscal_jurisdiction,
)
from app.fiscal_models import RestaurantFiscalProfile
from app.routes import fiscal_onboarding
from app.services.fiscal_onboarding import (
    evaluate_restaurant_fiscal_readiness,
    sync_restaurant_fiscal_profile_status,
)


def _ready_profile() -> RestaurantFiscalProfile:
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
            "municipio_verified_at": "2026-09-15T12:00:00+00:00",
        },
        certificate_secret_ref="secret://fiscal/a1/tenant-1",
        certificate_fingerprint="abc123",
        certificate_expires_at=datetime.datetime(2027, 1, 1, tzinfo=datetime.timezone.utc),
        csc_id="1",
        csc_secret_ref="secret://fiscal/csc/tenant-1",
    )


def test_cnpj_validation_is_deterministic_and_does_not_use_ai():
    assert normalize_cnpj("11.222.333/0001-81") == "11222333000181"
    assert normalize_cnpj("00.000.000/E08G-12") == "00000000E08G12"
    assert is_valid_contract_cnpj("00.000.000/E08G-12") is True
    assert tax_id_kind("00.000.000/E08G-12") == "cnpj"
    with pytest.raises(FiscalIdentifierError):
        normalize_cnpj("11.222.333/0001-82")
    with pytest.raises(FiscalIdentifierError):
        normalize_cnpj("00.000.000/E08G-13")
    with pytest.raises(FiscalIdentifierError):
        normalize_cnpj("00.000.000/0000-00")


def test_ibge_municipality_code_derives_ceara_without_manual_uf_choice():
    assert uf_from_ibge_municipality_code("2304400") == "CE"
    resolution = resolve_fiscal_jurisdiction("2304400")
    assert resolution.jurisdiction_key == "BR-CE"
    assert resolution.supported is True
    assert resolution.document_model == "65"
    policy = fiscal_policy_for("BR-CE")
    assert policy.payment_linkage_required is True
    assert "nt-2026-004" in policy.compliance_keys
    assert "ibge-localidades" in policy.compliance_keys


def test_declared_uf_mismatch_is_blocked():
    with pytest.raises(FiscalJurisdictionError, match="diverge"):
        resolve_fiscal_jurisdiction("2304400", declared_uf="SP")


def test_other_state_is_resolved_but_not_falsely_enabled():
    resolution = resolve_fiscal_jurisdiction("3550308", declared_uf="SP")
    assert resolution.jurisdiction_key == "BR-SP"
    assert resolution.supported is False


def test_ibge_payload_parser_uses_official_municipality_and_uf():
    municipality = parse_ibge_municipality(
        {
            "id": 2304400,
            "nome": "Fortaleza",
            "regiao-imediata": {
                "regiao-intermediaria": {
                    "UF": {"id": 23, "sigla": "CE", "nome": "Ceará"}
                }
            },
        }
    )
    assert municipality == IbgeMunicipality(code="2304400", name="Fortaleza", uf="CE")


def test_ready_ceara_profile_passes_without_tax_rate_guessing():
    result = evaluate_restaurant_fiscal_readiness(
        _ready_profile(),
        now=datetime.datetime(2026, 9, 15, tzinfo=datetime.timezone.utc),
    )
    assert result.ready is True
    assert result.status == "ready"
    assert result.jurisdiction_key == "BR-CE"
    assert result.issues == ()


def test_alphanumeric_cnpj_profile_is_accepted_by_fiscal_readiness():
    profile = _ready_profile()
    profile.cnpj = "00000000E08G12"
    result = evaluate_restaurant_fiscal_readiness(
        profile,
        now=datetime.datetime(2026, 9, 15, tzinfo=datetime.timezone.utc),
    )
    assert result.ready is True


def test_address_without_official_ibge_verification_is_not_ready():
    profile = _ready_profile()
    profile.endereco_fiscal = {
        **profile.endereco_fiscal,
        "municipio_source": "manual",
    }
    result = evaluate_restaurant_fiscal_readiness(profile)
    assert result.ready is False
    assert "municipality_source_unverified" in {issue.code for issue in result.issues}


def test_expired_certificate_blocks_and_disables_profile():
    profile = _ready_profile()
    profile.enabled = True
    profile.certificate_expires_at = datetime.datetime(2025, 1, 1, tzinfo=datetime.timezone.utc)
    result = sync_restaurant_fiscal_profile_status(
        profile,
        now=datetime.datetime(2026, 9, 15, tzinfo=datetime.timezone.utc),
    )
    assert result.ready is False
    assert result.status == "blocked"
    assert profile.enabled is False
    assert "expired_certificate" in {issue.code for issue in result.issues}


def test_missing_certificate_keeps_profile_in_draft_not_enabled():
    profile = _ready_profile()
    profile.certificate_secret_ref = None
    profile.certificate_fingerprint = None
    result = sync_restaurant_fiscal_profile_status(profile)
    assert result.ready is False
    assert result.status == "draft"
    assert profile.enabled is False


def test_official_identity_and_location_sources_are_registered():
    ibge = baseline_by_key("ibge-localidades")
    assert ibge.jurisdiction == "BR"
    assert ibge.official_host.endswith("ibge.gov.br")
    rfb = baseline_by_key("rfb-cnpj-alfanumerico")
    assert rfb.jurisdiction == "BR"
    assert rfb.official_host == "www.gov.br"
    nt = baseline_by_key("nt-2026-004")
    assert nt.version.startswith("1.01")
    assert nt.adoption_status == "baseline"


def test_fiscal_onboarding_routes_are_registered_for_admin_flow():
    paths = {route.path for route in fiscal_onboarding.router.routes}
    assert "/api/onboarding/fiscal/municipalities" in paths
    assert "/api/onboarding/fiscal/profile" in paths
    assert "/api/onboarding/fiscal/readiness" in paths
