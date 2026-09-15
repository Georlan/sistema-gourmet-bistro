import datetime

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.fiscal.compliance import baseline_by_key
from app.fiscal.jurisdiction import fiscal_policy_for
from app.fiscal.reference_watch import (
    OfficialReferenceProbe,
    acknowledge_reference_change,
    probe_local_rtc_calculator,
    probe_official_ncm,
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


def test_reference_change_is_detected_but_not_silently_accepted():
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
    assert result.changed is True
    assert result.status == "changed"
    assert state is not None
    assert state.status == "changed"
    assert state.acknowledged_at is None

    # Nova execução com o mesmo conteúdo não pode apagar silenciosamente o alerta.
    replay = record_probe(session, second)
    session.commit()
    assert replay.changed is False
    assert replay.status == "changed"

    acknowledge_reference_change(session, "rfb-ncm-json")
    session.commit()
    state = session.get(FiscalOfficialReferenceState, "rfb-ncm-json")
    assert state is not None
    assert state.status == "current"
    assert state.acknowledged_at is not None


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


def test_super_admin_fiscal_compliance_route_is_registered():
    paths = {route.path for route in fiscal_compliance_router.routes}
    assert "/fiscal/compliance" in paths
