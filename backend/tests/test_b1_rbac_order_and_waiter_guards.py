"""Regressões B1: bloqueio de escalação de privilégio em waiter_permissions e rotas de pedidos/atendimentos."""

from __future__ import annotations

import uuid

import pytest

from app.database import SessionLocal
from app.models import (
    Comanda,
    ConfiguracaoRestaurante,
    Item,
    Lancamento,
    Mesa,
    Usuario,
)
from app.security import create_access_token, get_password_hash
from tests.characterization.orders.fixtures import char_client, char_setup


def _create_role_user_headers(rid: int, role: str) -> tuple[str, dict[str, str]]:
    uid = f"usr-b1-{role}-{uuid.uuid4().hex[:6]}"
    with SessionLocal(restaurante_id=rid) as db:
        db.add(
            Usuario(
                id=uid,
                restaurante_id=rid,
                nome=f"Operador {role}",
                usuario=f"{role}_{uid}",
                senha_hash=get_password_hash("123456"),
                role=role,
                cargo=role,
                status="ativo",
            )
        )
        db.commit()
    token = create_access_token(subject=uid, restaurante_id=rid, role=role)
    return uid, {"Authorization": f"Bearer {token}"}


def _seed_table_order(char_client, headers: dict[str, str], mesa_id: int = 1) -> tuple[str, list[str]]:
    res = char_client.post(
        "/comandas/venda-direta",
        json={
            "tipo": "Consumo no Local",
            "mesa_id": mesa_id,
            "itens": [
                {"produto_id": "prod-char-simples"},
                {"produto_id": "prod-char-simples"},
            ],
        },
        headers=headers,
    )
    assert res.status_code == 201, res.text
    data = res.json()
    return data["id"], [item["id"] for item in data["itens"]]


def _ensure_second_table(rid: int, mesa_id: int = 2) -> None:
    with SessionLocal(restaurante_id=rid) as db:
        existing = db.query(Mesa).filter(
            Mesa.restaurante_id == rid,
            Mesa.id == mesa_id,
        ).first()
        if existing is None:
            db.add(Mesa(id=mesa_id, restaurante_id=rid, nome=f"Mesa {mesa_id}"))
            db.commit()


@pytest.mark.parametrize("restricted_role", ["cozinha", "motoboy"])
def test_kitchen_and_courier_cannot_escalate_via_order_and_table_mutations(
    char_client,
    char_setup,
    restricted_role: str,
):
    """[B1-SEC] Cozinha e motoboy não podem contornar waiter_permissions nem operar rotas de salão/comandas."""
    rid = char_setup["restaurant_id"]
    admin_headers = char_setup["headers"]
    _ensure_second_table(rid, 2)

    comanda_id, item_ids = _seed_table_order(char_client, admin_headers, mesa_id=1)
    first_item_id = item_ids[0]
    role_uid, role_headers = _create_role_user_headers(rid, restricted_role)

    # Mesmo com todas as permissões configuráveis do garçom habilitadas,
    # cozinha e motoboy NUNCA devem herdar permissões de salão/caixa.
    with SessionLocal(restaurante_id=rid) as db:
        cfg = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == rid
        ).first()
        assert cfg is not None
        cfg.perm_garcom_delivery = True
        cfg.perm_garcom_editar = True
        cfg.perm_garcom_cancelar = True
        cfg.perm_garcom_fechar = True
        cfg.perm_garcom_transferir_mesa = True
        cfg.perm_garcom_transferir_item = True
        cfg.perm_garcom_print = True
        db.commit()

    forbidden_requests = [
        ("post", "/comandas/", {"tipo": "Consumo no Local", "mesa_id": 2, "garcom_id": role_uid}),
        ("post", "/comandas/", {"tipo": "Delivery", "garcom_id": role_uid}),
        ("put", f"/comandas/{comanda_id}/pedir-conta", None),
        ("put", f"/comandas/{comanda_id}/fechar", None),
        ("post", f"/comandas/{comanda_id}/dividir?novo_identificador=Split", [first_item_id]),
        ("put", f"/comandas/itens/{first_item_id}/cancelar", None),
        ("put", f"/comandas/itens/{first_item_id}", {"observacao": "sem sal", "quantidade_adicional": 2}),
        (
            "post",
            f"/comandas/{comanda_id}/lancamentos",
            {"garcom_id": role_uid, "itens": [{"produto_id": "prod-char-simples"}]},
        ),
        ("post", f"/comandas/{comanda_id}/associar-mesa/2", None),
        ("post", f"/comandas/{comanda_id}/transferir/2", None),
        ("post", "/comandas/mesclar?mesa_origem_id=1&mesa_destino_id=2", None),
        ("post", f"/comandas/desmesclar?comanda_id={comanda_id}", None),
        ("post", f"/comandas/itens/{first_item_id}/transferir/2", None),
        ("post", "/comandas/itens/transferir-lote/2", {"item_ids": [first_item_id]}),
        ("post", "/mesas/1/imprimir-recibo", None),
        ("post", f"/comandas/{comanda_id}/imprimir-recibo", None),
    ]

    for method, path, body in forbidden_requests:
        resp = char_client.request(method, path, json=body, headers=role_headers)
        assert resp.status_code == 403, (
            f"Cargo '{restricted_role}' não deveria acessar {method.upper()} {path}: "
            f"recebeu {resp.status_code} ({resp.text})"
        )

    # Integridade preservada no banco: comanda aberta, itens intactos e sem novos lançamentos
    with SessionLocal(restaurante_id=rid) as db:
        comanda = db.get(Comanda, comanda_id)
        assert comanda is not None
        assert comanda.fechada is False
        assert comanda.mesa_id == 1
        assert comanda.status_comanda is None
        items = db.query(Item).filter(Item.comanda_id == comanda_id).all()
        assert len(items) == 2
        assert all(item.status != "cancelado" for item in items)
        launches = db.query(Lancamento).filter(Lancamento.comanda_id == comanda_id).all()
        assert len(launches) == 1


def test_courier_cannot_read_restaurant_orders_and_customer_pii(char_client, char_setup):
    """[B1-SEC] Motoboy não pode ler listagens operacionais de comandas/entregas/mesas fora do painel do entregador."""
    rid = char_setup["restaurant_id"]
    admin_headers = char_setup["headers"]
    comanda_id, _ = _seed_table_order(char_client, admin_headers, mesa_id=1)
    _, motoboy_headers = _create_role_user_headers(rid, "motoboy")

    forbidden_reads = [
        "/comandas/",
        "/comandas/detalhes/todos",
        f"/comandas/{comanda_id}",
        "/comandas/delivery/ativos",
        "/comandas/delivery/pendentes",
        "/comandas/delivery/retiradas/concluidas-recentes",
        "/comandas/delivery/entregas/concluidas-recentes",
        "/atendimentos/mesas/1",
    ]
    for path in forbidden_reads:
        resp = char_client.get(path, headers=motoboy_headers)
        assert resp.status_code == 403, f"Motoboy leu {path} com status {resp.status_code}"


def test_attendant_keeps_quick_order_but_cannot_execute_salon_or_cancel_mutations(char_client, char_setup):
    """[B1-SEC] Atendente mantém pedido rápido (venda-direta pickup/delivery), mas não cancela/fecha/transfere/abre mesa."""
    rid = char_setup["restaurant_id"]
    admin_headers = char_setup["headers"]
    _ensure_second_table(rid, 2)
    comanda_id, item_ids = _seed_table_order(char_client, admin_headers, mesa_id=1)
    first_item_id = item_ids[0]
    attendant_uid, attendant_headers = _create_role_user_headers(rid, "atendente")

    # 1. Permissão legítima preservada: pedido rápido de retirada via venda-direta
    quick_res = char_client.post(
        "/comandas/venda-direta",
        json={
            "tipo": "Retirada",
            "identificador": "Balcao Atendente",
            "delivery_telefone": "81999992222",
            "itens": [{"produto_id": "prod-char-simples"}],
        },
        headers=attendant_headers,
    )
    assert quick_res.status_code == 201, quick_res.text

    # 2. Mutações de salão/cancelamento/fechamento/transferência continuam proibidas
    forbidden_for_attendant = [
        ("post", "/comandas/", {"tipo": "Consumo no Local", "mesa_id": 2, "garcom_id": attendant_uid}),
        ("put", f"/comandas/{comanda_id}/pedir-conta", None),
        ("put", f"/comandas/{comanda_id}/fechar", None),
        ("post", f"/comandas/{comanda_id}/dividir?novo_identificador=Split", [first_item_id]),
        ("put", f"/comandas/itens/{first_item_id}/cancelar", None),
        ("put", f"/comandas/itens/{first_item_id}", {"observacao": "alterada"}),
        (
            "post",
            f"/comandas/{comanda_id}/lancamentos",
            {"garcom_id": attendant_uid, "itens": [{"produto_id": "prod-char-simples"}]},
        ),
        ("post", f"/comandas/{comanda_id}/transferir/2", None),
        ("post", "/comandas/mesclar?mesa_origem_id=1&mesa_destino_id=2", None),
        ("post", f"/comandas/itens/{first_item_id}/transferir/2", None),
    ]
    for method, path, body in forbidden_for_attendant:
        resp = char_client.request(method, path, json=body, headers=attendant_headers)
        assert resp.status_code == 403, (
            f"Atendente não deveria acessar {method.upper()} {path}: "
            f"recebeu {resp.status_code} ({resp.text})"
        )


def test_waiter_keeps_configurable_salon_access_and_cashier_keeps_full_access(char_client, char_setup):
    """[B1-SEC] Garçom continua respeitando flags configuráveis e Caixa mantém operação completa."""
    rid = char_setup["restaurant_id"]
    admin_headers = char_setup["headers"]
    comanda_id, item_ids = _seed_table_order(char_client, admin_headers, mesa_id=1)
    _, waiter_headers = _create_role_user_headers(rid, "garcom")
    _, cashier_headers = _create_role_user_headers(rid, "caixa")

    # Garçom pode pedir conta na mesa
    bill_res = char_client.put(f"/comandas/{comanda_id}/pedir-conta", headers=waiter_headers)
    assert bill_res.status_code == 200, bill_res.text

    # Garçom respeita perm_garcom_cancelar=False -> 403 com mensagem do garçom
    with SessionLocal(restaurante_id=rid) as db:
        cfg = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == rid
        ).first()
        cfg.perm_garcom_cancelar = False
        db.commit()

    denied_cancel = char_client.put(f"/comandas/itens/{item_ids[0]}/cancelar", headers=waiter_headers)
    assert denied_cancel.status_code == 403
    assert "garçom" in denied_cancel.json()["detail"].lower()

    # Caixa continua podendo cancelar normalmente mesmo com perm_garcom_cancelar=False
    cashier_cancel = char_client.put(f"/comandas/itens/{item_ids[0]}/cancelar", headers=cashier_headers)
    assert cashier_cancel.status_code == 200, cashier_cancel.text


def test_waiter_permission_enabled_enforces_role_allowlist_and_tenant_scope(char_setup):
    """[B1-SEC] waiter_permission_enabled usa allowlist por cargo e respeita status ativo e tenant."""
    from types import SimpleNamespace
    from app.database import current_restaurante_id
    from app.waiter_permissions import WAITER_PERMISSION_MESSAGES, waiter_permission_enabled

    rid = char_setup["restaurant_id"]
    token = current_restaurante_id.set(rid)
    try:
        with SessionLocal(restaurante_id=rid) as db:
            cfg = db.query(ConfiguracaoRestaurante).filter(
                ConfiguracaoRestaurante.restaurante_id == rid
            ).first()
            for perm in WAITER_PERMISSION_MESSAGES:
                setattr(cfg, perm, True)
            db.commit()

            for denied_role in ("cozinha", "motoboy", "cargo_desconhecido"):
                user = SimpleNamespace(
                    id=f"u-{denied_role}",
                    restaurante_id=rid,
                    role=denied_role,
                    cargo=denied_role,
                    status="ativo",
                )
                for perm in WAITER_PERMISSION_MESSAGES:
                    assert waiter_permission_enabled(db, user, perm) is False, (denied_role, perm)

            attendant = SimpleNamespace(
                id="u-att", restaurante_id=rid, role="atendente", cargo="atendente", status="ativo"
            )
            assert waiter_permission_enabled(db, attendant, "perm_garcom_delivery") is True
            for restricted_perm in (
                "perm_garcom_cancelar",
                "perm_garcom_editar",
                "perm_garcom_fechar",
                "perm_garcom_transferir_mesa",
                "perm_garcom_transferir_item",
            ):
                assert waiter_permission_enabled(db, attendant, restricted_perm) is False

            # Cross-tenant admin nunca pode passar na checagem do tenant atual
            foreign_admin = SimpleNamespace(
                id="u-other-admin",
                restaurante_id=rid + 999,
                role="admin",
                cargo="admin",
                status="ativo",
            )
            assert waiter_permission_enabled(db, foreign_admin, "perm_garcom_cancelar") is False

            # Usuário inativo nunca pode passar
            inactive_admin = SimpleNamespace(
                id="u-inactive",
                restaurante_id=rid,
                role="admin",
                cargo="admin",
                status="inativo",
            )
            assert waiter_permission_enabled(db, inactive_admin, "perm_garcom_cancelar") is False
    finally:
        current_restaurante_id.reset(token)
