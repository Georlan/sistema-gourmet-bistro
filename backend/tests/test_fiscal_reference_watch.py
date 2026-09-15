import datetime

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.fiscal.compliance import baseline_by_key
from app.fiscal.jurisdiction import fiscal_policy_for
from app.fiscal.reference_watch import (
    FiscalReferenceWatchError,
    OfficialReferenceProbe,
    probe_local_rtc_calculator,
    probe_nfe_portal_notices,
    probe_nfe_technical_reports,
    probe_official_ncm,
    promote_observed_reference,
    record_probe,
    stale_reference_keys,
)
from app.fiscal.rtc_calculator import RtcCalculatorClient
from app.fiscal_reference_models import FiscalOfficialReferenceState
from app.routes.super_admin_fiscal_compliance import router as fiscal_compliance_router


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    FiscalOfficialReferenceState.__table__.create(engine)
    return Session(engine)


def test_official_ncm_probe_requires_complete_structured_payload():
    payload = [
        {"Codigo": f"{index:08d}", "Descricao": f"Item {index}"}
        for index in range(1200)
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert "portalunico.siscomex.gov.br" in request.url.host
        return httpx.Response(200, json=payload)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        probe = probe_official_ncm(client=client)

    assert probe.source_key == "rfb-ncm-json"
    assert probe.metadata["entry_count"] == 1200
    assert len(probe.content_sha256 or "") == 64


def test_nfe_technical_reports_probe_detects_future_effective_change():
    html = """
    <html><body>
      <div>Informe Técnico 2024.001 v.2.40 atualização NCM a partir de 01/10/2026.</div>
      <div>Informe Técnico 2023.002 v.2.10 atualização CFOP publicada em 04/09/2026.</div>
      <div>Informe Técnico 2025.001 v.1.20 tabela cClassTrib e CST.</div>
      <div>Informe Técnico 2025.002 v.1.05 tabela de alíquotas CBS.</div>
      <div>Informe Técnico 2024.004 v.1.10 meios de pagamento.</div>
      <script>Informe Técnico conteúdo volátil que deve ser ignorado</script>
    </body></html>
    """

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "www.nfe.fazenda.gov.br"
        return httpx.Response(200, text=html)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        probe = probe_nfe_technical_reports(client=client)

    assert probe.source_key == "nfe-informes-tecnicos"
    assert probe.metadata["entry_count"] == 5
    assert probe.metadata["future_effective_dates"] == ["01/10/2026"]
    recent = " ".join(probe.metadata["recent_entries"])
    assert "NCM" in recent
    assert "CFOP" in recent
    assert len(probe.content_sha256 or "") == 64


def test_nfe_technical_reports_probe_fails_closed_when_page_shape_is_incomplete():
    html = "<html><body><div>Informe Técnico 2024.001 v.2.40</div></body></html>"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=html)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(FiscalReferenceWatchError, match="poucos Informes Técnicos"):
            probe_nfe_technical_reports(client=client)


def test_nfe_portal_notices_probe_catches_fresh_ncm_and_cfop_publications():
    html = """
    <html><body>
      <div>04/09/2026 - Publicado Informe Técnico 2023.002 v.2.10 que divulga atualização na tabela de CFOP.</div>
      <div>03/09/2026 - Publicado Informe Técnico 2024.001 v.2.40 que divulga atualização na tabela de NCM a partir de 01/10/2026.</div>
      <div>25/08/2026 - Publicado Ato Conjunto RFB/CGIBS nº 2, de 2026.</div>
      <script>99/99/9999 - conteúdo volátil ignorado</script>
    </body></html>
    """

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "www.nfe.fazenda.gov.br"
        return httpx.Response(200, text=html)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        probe = probe_nfe_portal_notices(client=client)

    assert probe.source_key == "nfe-portal-notices"
    assert probe.metadata["entry_count"] == 3
    assert probe.metadata["future_effective_dates"] == ["01/10/2026"]
    recent = " ".join(probe.metadata["recent_entries"])
    assert "CFOP" in recent
    assert "NCM" in recent
    assert "Ato Conjunto" in recent


def test_nfe_portal_notices_probe_fails_closed_when_feed_shape_is_incomplete():
    html = "<html><body>04/09/2026 - Publicado Informe Técnico isolado.</body></html>"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=html)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(FiscalReferenceWatchError, match="poucos avisos datados"):
            probe_nfe_portal_notices(client=client)


def test_reference_change_keeps_previous_active_baseline_until_explicit_promotion():
    session = _session()
    first = OfficialReferenceProbe(
        source_key="rfb-ncm-json",
        source_url="https://example.invalid/ncm",
        source_version="v1",
        content_sha256="a" * 64,
        metadata={"entry_count": 10000},
    )
    result = record_probe(session, first)
    session.commit()
    assert result.status == "current"
    assert result.changed is False
    assert result.active_version == "v1"

    second = OfficialReferenceProbe(
        source_key="rfb-ncm-json",
        source_url=first.source_url,
        source_version="v2",
        content_sha256="b" * 64,
        metadata={"entry_count": 10002},
    )
    result = record_probe(session, second)
    session.commit()

    state = session.get(FiscalOfficialReferenceState, "rfb-ncm-json")
    assert state is not None
    assert result.changed is True
    assert result.status == "changed"
    assert state.observed_version == "v2"
    assert state.observed_sha256 == "b" * 64
    assert state.active_version == "v1"
    assert state.active_sha256 == "a" * 64

    replay = record_probe(session, second)
    session.commit()
    assert replay.changed is True
    assert replay.status == "changed"
    assert replay.active_version == "v1"

    promote_observed_reference(session, "rfb-ncm-json")
    session.commit()
    state = session.get(FiscalOfficialReferenceState, "rfb-ncm-json")
    assert state is not None
    assert state.status == "current"
    assert state.active_version == "v2"
    assert state.active_sha256 == "b" * 64
    assert state.promoted_at is not None


def test_reference_staleness_is_deterministic():
    now = datetime.datetime(2026, 9, 15, 18, 0, tzinfo=datetime.timezone.utc)
    state = FiscalOfficialReferenceState(
        source_key="rfb-ncm-json",
        source_url="https://example.invalid/ncm",
        status="current",
        checked_at=now - datetime.timedelta(days=3),
    )
    assert stale_reference_keys([state], now=now) == ("rfb-ncm-json",)


def test_local_rtc_version_probe_records_app_and_database_version():
    payload = {
        "versaoApp": "1.3.0-af611293",
        "versaoDb": "V0042",
        "descricaoVersaoDb": "Base oficial",
        "dataVersaoDb": "2026-09-15",
        "ambiente": "PRO",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/dados-abertos/versao")
        return httpx.Response(200, json=payload)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        probe = probe_local_rtc_calculator(
            base_url="http://rtc-calculator:8080/api/calculadora",
            client=client,
        )

    assert probe.source_key == "rfb-rtc-calculator-local"
    assert probe.source_version == "1.3.0-af611293|db:V0042"
    assert probe.metadata["ambiente"] == "PRO"


def test_rtc_adapter_uses_local_official_component_for_calculation():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dados-abertos/versao"):
            return httpx.Response(
                200,
                json={"versaoApp": "1.3.0", "versaoDb": "V0042", "ambiente": "PRO"},
            )
        if request.url.path.endswith("/regime-geral"):
            assert request.method == "POST"
            return httpx.Response(
                200,
                json={"tributos": {"cbs": {"valor": 1.23}}, "memoriaCalculo": []},
            )
        raise AssertionError(f"rota inesperada: {request.url}")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        rtc = RtcCalculatorClient(
            base_url="http://rtc-calculator:8080/api/calculadora",
            client=client,
        )
        version = rtc.get_version()
        result = rtc.calculate_general_regime({"itens": []})

    assert version.database_version == "V0042"
    assert result["tributos"]["cbs"]["valor"] == 1.23


def test_ceara_policy_is_bound_to_machine_readable_official_sources():
    policy = fiscal_policy_for("BR-CE")
    assert "rfb-ncm-json" in policy.compliance_keys
    assert "rfb-rtc-calculator-offline" in policy.compliance_keys
    assert baseline_by_key("rfb-ncm-json").official_host.endswith("gov.br")
    assert baseline_by_key("rfb-rtc-calculator-offline").official_host.endswith("gov.br")
    assert baseline_by_key("rfb-cbs-apuracao-api").adoption_status == "monitor"
    assert baseline_by_key("nfe-informes-tecnicos").adoption_status == "monitor"
    assert baseline_by_key("nfe-informes-tecnicos").official_host == "www.nfe.fazenda.gov.br"
    assert baseline_by_key("nfe-portal-notices").adoption_status == "monitor"
    assert baseline_by_key("nfe-portal-notices").official_host == "www.nfe.fazenda.gov.br"


def test_super_admin_fiscal_compliance_route_is_registered():
    paths = {route.path for route in fiscal_compliance_router.routes}
    assert "/fiscal/compliance" in paths
