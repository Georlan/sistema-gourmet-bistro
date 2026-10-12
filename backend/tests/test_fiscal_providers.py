import json

import pytest

from app.fiscal.providers import (
    FiscalProviderContext, FiscalProviderReadiness, FiscalProviderRegistry,
    FiscalProviderRequest, FiscalProviderResult,
)

OPS = frozenset({"submit", "query", "cancel", "invalidate"})


def request(tenant=8, environment="homologacao", **overrides):
    data = dict(context=FiscalProviderContext(tenant, environment, "65"), document_id="document-test",
                operation_key="sale-test-1", series=1, number=1, sale_json='{"total":"12.50"}',
                calculation_json='{"total":"12.50"}', rule_set_version="test-rules-v1")
    data.update(overrides)
    return FiscalProviderRequest(**data)


class Adapter:
    calls = 0

    def readiness(self, context):
        return FiscalProviderReadiness(context.restaurante_id == 8 and context.environment == "homologacao", True, OPS)

    def query(self, payload):
        return FiscalProviderResult(payload.context, payload.document_id, payload.operation_key, "unknown")

    def cancel(self, payload, justification):
        return FiscalProviderResult(payload.context, payload.document_id, payload.operation_key, "cancelled", event_protocol="test-event")

    def invalidate(self, context, **kwargs):
        return "test-event"

    def submit(self, payload):
        self.calls += 1
        return FiscalProviderResult(payload.context, payload.document_id, payload.operation_key, "authorized",
                                   access_key="test-access-key", authorization_protocol="test-protocol",
                                   authorized_xml_storage_ref="storage://local-test/xml")


def test_uninstalled_provider_is_not_ready_and_never_submits():
    registry = FiscalProviderRegistry()
    assert not registry.readiness("direct_sefaz", request().context).ready
    with pytest.raises(ValueError, match="homologada"):
        registry.submit("direct_sefaz", request())


@pytest.mark.parametrize("tenant,environment", [(6, "homologacao"), (8, "producao")])
def test_homologation_is_scoped_to_restaurant_and_environment(tenant, environment):
    registry, adapter = FiscalProviderRegistry(), Adapter()
    registry.register("api-test", adapter)
    with pytest.raises(ValueError, match="homologada"):
        registry.submit("api-test", request(tenant, environment))
    assert adapter.calls == 0


def test_adapter_contract_is_the_same_for_own_or_third_party_provider():
    for name in ("direct_sefaz", "third_party_test"):
        registry = FiscalProviderRegistry()
        registry.register(name, Adapter())
        outcome = registry.submit(name, request())
        assert outcome.status == "authorized"
        assert outcome.operation_key == "sale-test-1"


@pytest.mark.parametrize("operations", [frozenset(), frozenset({"submit"}), OPS - {"query"}])
def test_submission_without_recovery_and_event_capabilities_is_blocked(operations):
    assert not FiscalProviderReadiness(True, True, operations).ready


@pytest.mark.parametrize("configured,homologated", [(False, True), (True, False)])
def test_credentials_alone_or_homologation_alone_is_not_enough(configured, homologated):
    assert not FiscalProviderReadiness(configured, homologated, OPS).ready


def test_transport_failure_is_unknown_and_is_never_automatically_retried():
    class TimeoutAdapter(Adapter):
        def submit(self, payload):
            self.calls += 1
            raise TimeoutError("external sensitive response must not escape")
    registry, adapter = FiscalProviderRegistry(), TimeoutAdapter()
    registry.register("api-test", adapter)
    result = registry.submit("api-test", request())
    assert result.status == "unknown"
    assert result.rejection_code is None
    assert adapter.calls == 1
    assert "sensitive" not in repr(result)


@pytest.mark.parametrize("field,value", [("context", FiscalProviderContext(99, "homologacao", "65")),
                                         ("document_id", "other"), ("operation_key", "other")])
def test_external_response_cannot_be_attached_to_another_sale(field, value):
    class WrongResponseAdapter(Adapter):
        def submit(self, payload):
            data = dict(context=payload.context, document_id=payload.document_id,
                        operation_key=payload.operation_key, status="unknown")
            data[field] = value
            return FiscalProviderResult(**data)
    registry = FiscalProviderRegistry()
    registry.register("api-test", WrongResponseAdapter())
    with pytest.raises(ValueError, match="outro documento"):
        registry.submit("api-test", request())


def test_api_receipt_is_not_authorization_without_fiscal_evidence():
    with pytest.raises(ValueError, match="XML autorizado"):
        FiscalProviderResult(request().context, "doc", "operation", "authorized", authorization_protocol="api-receipt")


def test_generic_provider_error_is_not_a_fiscal_rejection():
    with pytest.raises(ValueError, match="código fiscal"):
        FiscalProviderResult(request().context, "doc", "operation", "rejected")


def test_fingerprint_freezes_scope_number_amount_and_tax_version():
    original = request()
    assert original.fingerprint == request(sale_json=json.dumps({"total": "12.50"}, indent=2)).fingerprint
    for changed in (request(tenant=9), request(environment="producao"), request(number=2),
                    request(sale_json='{"total":"13.00"}'), request(rule_set_version="test-rules-v2")):
        assert original.fingerprint != changed.fingerprint
    with pytest.raises(Exception):
        original.number = 2


def test_readiness_error_fails_closed_without_exposing_response():
    class Broken(Adapter):
        def readiness(self, context):
            raise RuntimeError("secret not to expose")
    registry = FiscalProviderRegistry()
    registry.register("api-test", Broken())
    assert not registry.readiness("api-test", request().context).ready


def test_snapshots_and_storage_refs_do_not_appear_in_debug_representation():
    assert "12.50" not in repr(request())
    with pytest.raises(ValueError, match="objeto"):
        request(calculation_json="[]")


def test_reconciliation_queries_without_repeating_submission():
    class QueryAdapter(Adapter):
        queries = 0
        def query(self, payload):
            self.queries += 1
            return FiscalProviderResult(payload.context, payload.document_id, payload.operation_key, "unknown")
    registry, adapter = FiscalProviderRegistry(), QueryAdapter()
    registry.register("api-test", adapter)
    assert registry.query("api-test", request()).status == "unknown"
    assert adapter.calls == 0
    assert adapter.queries == 1


def test_cancellation_requires_fiscal_event_protocol():
    with pytest.raises(ValueError, match="protocolo do evento"):
        FiscalProviderResult(request().context, "doc", "operation", "cancelled")
    assert FiscalProviderResult(request().context, "doc", "operation", "cancelled", event_protocol="test-event").status == "cancelled"


def test_request_is_built_from_frozen_document_and_not_live_profile():
    from app.fiscal_models import FiscalDocument
    from app.services.fiscal_provider_request import request_from_document
    snapshot = {"items": [{"product_id": "coffee", "total": "12.50"}]}
    document = FiscalDocument(id="document-test", restaurante_id=8, environment="homologacao", model="65",
                              series=2, number=10, status="ready", idempotency_key="sale-test-1",
                              sale_snapshot=snapshot, calculation_snapshot={"total": "12.50"}, rule_set_version="test-v1")
    built = request_from_document(document, restaurante_id=8)
    fingerprint = built.fingerprint
    snapshot["items"][0]["total"] = "99.00"
    assert built.fingerprint == fingerprint
    assert built.series == 2 and built.number == 10
    with pytest.raises(ValueError, match="não pertence"):
        request_from_document(document, restaurante_id=6)
    document.calculation_snapshot = None
    with pytest.raises(ValueError, match="congelados"):
        request_from_document(document, restaurante_id=8)


@pytest.mark.parametrize("status", ["unknown", "submitting", "reconciling", "authorized", "cancelled", "rejected"])
def test_unknown_or_finished_documents_cannot_be_submitted_again(status):
    registry, adapter = FiscalProviderRegistry(), Adapter()
    registry.register("api-test", adapter)
    with pytest.raises(ValueError, match="conciliação"):
        registry.submit("api-test", request(source_status=status))
    assert adapter.calls == 0


def test_adapter_with_only_submission_cannot_be_registered():
    with pytest.raises(ValueError, match="contrato completo"):
        FiscalProviderRegistry().register("incomplete", object())


@pytest.mark.parametrize("snapshot", ['{"amount":NaN}', '{"amount":Infinity}', '{broken-json'])
def test_non_finite_or_invalid_snapshots_never_reach_transport(snapshot):
    with pytest.raises(ValueError, match="finito"):
        request(calculation_json=snapshot)


def test_textual_false_cannot_accidentally_enable_provider():
    with pytest.raises(ValueError, match="booleana"):
        FiscalProviderReadiness("false", True, OPS)


@pytest.mark.parametrize("number", [True, 1.5, 0, -1])
def test_provider_number_must_be_a_positive_integer(number):
    with pytest.raises(ValueError):
        request(number=number)
