"""Protect explicit HTTP owners without a frozen copy of the whole API schema."""
from collections import Counter
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys

from fastapi.routing import APIRoute, iter_route_contexts
import pytest

from app.main import app


def resolved_routes():
    return [route for route in iter_route_contexts(app.routes) if isinstance(route.original_route, APIRoute)]


def test_every_http_operation_has_exactly_one_owner():
    counts = Counter((method, route.path) for route in resolved_routes() for method in route.methods)
    assert counts
    assert {key: count for key, count in counts.items() if count > 1} == {}


@pytest.mark.parametrize("method,path,owner", [
    ("POST", "/mesas/{mesa_id}/imprimir-recibo", "atendimentos.imprimir_recibo_mesa_com_identidade"),
    ("POST", "/comandas/{comanda_id}/lancamentos", "atendimentos.lancar_itens_na_familia_principal"),
    ("POST", "/comandas/venda-direta", "atendimentos.venda_direta_respeitando_familia_principal"),
    ("POST", "/comandas/{comanda_id}/transferir/{nova_mesa_id}", "atendimentos.transferir_atendimento_compativel"),
    ("POST", "/comandas/mesclar", "atendimentos.mesclar_atendimentos_compativel"),
    ("POST", "/comandas/desmesclar", "atendimentos.desmesclar_atendimento_compativel"),
    ("POST", "/comandas/itens/{item_id}/transferir/{nova_mesa_id}", "atendimentos.transferir_item_compativel"),
    ("PUT", "/comandas/{comanda_id}/reabrir", "atendimentos.reabrir_comanda_compativel"),
    ("POST", "/comandas/lancamentos/{lancamento_id}/reimprimir", "atendimento_printing.reimprimir_lancamento_na_mesa_atual"),
    ("POST", "/impressao", "printing.imprimir_universal"),
    ("GET", "/caixa/config-cardapio", "cardapio_config_bridge.legacy_cardapio_config_bridge"),
    ("PUT", "/caixa/config-cardapio", "caixa.atualizar_configuracao_restaurante"),
    ("POST", "/caixa/config-cardapio", "caixa.atualizar_configuracao_restaurante"),
])
def test_formerly_shadowed_operations_keep_the_effective_handler(method, path, owner):
    module_name, function_name = owner.split(".")
    expected = getattr(importlib.import_module(f"app.routes.{module_name}"), function_name)
    matches = [route for route in resolved_routes() if route.path == path and method in route.methods]
    assert len(matches) == 1
    assert matches[0].endpoint is expected


def test_close_aliases_share_validation_permissions_and_handler():
    routes = [route for route in resolved_routes() if route.path in {"/caixa/fechamento", "/caixa/turno/fechar"}]
    assert len(routes) == 2
    assert routes[0].endpoint is routes[1].endpoint
    assert routes[0].body_field.field_info.annotation is routes[1].body_field.field_info.annotation
    assert [dep.call for dep in routes[0].dependant.dependencies] == [dep.call for dep in routes[1].dependant.dependencies]


def run_isolated(code, tmp_path):
    root = Path(__file__).resolve().parents[1]
    env = {
        **os.environ,
        "ENVIRONMENT": "test",
        "DATABASE_URL": f"sqlite:///{tmp_path / 'routes.db'}",
        "SUPABASE_URL": "https://mock-test-supabase.local",
        "SUPABASE_SERVICE_ROLE_KEY": "mock_test_service_role_key_12345",
        "SECRET_KEY": "koma-route-test-local-only",
        "ENCRYPTION_KEY": "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
        "PYTHONPATH": str(root),
    }
    result = subprocess.run([sys.executable, "-c", code], env=env, cwd=root,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


def isolated_owner_snapshot(first_module, tmp_path):
    result = run_isolated(f'''
import importlib, json
from sqlalchemy.engine import Engine
def forbid_connection(*args, **kwargs):
    raise AssertionError("Registering routes must not connect to a database")
Engine.connect = forbid_connection
importlib.import_module({first_module!r})
from app.main import app
from fastapi.routing import APIRoute, iter_route_contexts
print(json.dumps(sorted(
    (method, route.path, f"{{route.endpoint.__module__}}.{{route.endpoint.__name__}}")
    for route in iter_route_contexts(app.routes) if isinstance(route.original_route, APIRoute)
    for method in route.methods
)))
''', tmp_path)
    return json.loads(result)


@pytest.fixture(scope="module")
def pristine_owner_snapshot(tmp_path_factory):
    # Other suites add test-only endpoints to the shared in-process application.
    # Both sides must describe fresh production composition, not those fixtures.
    return isolated_owner_snapshot("app.main", tmp_path_factory.mktemp("route-owners"))


@pytest.mark.parametrize("first_module", [
    "app.routes.financial_cash_routes",
    "app.routes.financial_read_routes",
    "app.routes.auth",
])
def test_import_order_does_not_change_route_owners(first_module, tmp_path, pristine_owner_snapshot):
    assert isolated_owner_snapshot(first_module, tmp_path) == pristine_owner_snapshot


def test_refund_safety_and_number_allocator_do_not_need_main_monkeypatches(tmp_path):
    run_isolated('''
import sys
from unittest.mock import Mock, patch
from app.services import cash_reconciliation, refund_guard
assert "app.routes" not in sys.modules
db, payment = Mock(), Mock()
with patch.object(refund_guard, "remaining_refund_allocations_guarded", return_value=[{"bloqueado": True}]) as guard:
    assert cash_reconciliation.remaining_refund_allocations(db, 17, payment) == [{"bloqueado": True}]
    guard.assert_called_once_with(db, 17, payment)
from app.routes import orders, cardapio, financial_cash_routes
from app.services.order_numbers import gerar_novo_numero_pedido_atomico
from app.services.refund_ui import refundable_payment_payload_human
assert "app.main" not in sys.modules
assert orders.gerar_novo_numero_pedido is cardapio.gerar_novo_numero_pedido is gerar_novo_numero_pedido_atomico
assert financial_cash_routes.create_refund is refund_guard.create_refund_guarded
assert financial_cash_routes._refundable_payment_payload is refundable_payment_payload_human
''', tmp_path)
