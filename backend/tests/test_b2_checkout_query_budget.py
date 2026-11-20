"""Regressões B2 residual: teto de queries SQL e preservação de invariantes em POST /cardapio/pedidos."""

from __future__ import annotations

from contextlib import contextmanager
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Cliente,
    Comanda,
    ConfiguracaoRestaurante,
    GrupoModificador,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
    SuperAdminAuditLog,
    Usuario,
)
from app.online_order_control_models import OnlineOrderControl
from app.order_chat_models import OrderConversation
from app.restaurant_profile_models import RestauranteOperationProfile
from app.services.clientes import _insert_guest_cliente_if_needed


@contextmanager
def capture_sql():
    statements: list[tuple[str, str]] = []

    def on_execute(_conn, _cursor, statement, _parameters, _context, _executemany):
        normalized = " ".join(statement.split())
        kind = normalized.split(" ", 1)[0].upper()
        statements.append((kind, normalized))

    event.listen(engine, "after_cursor_execute", on_execute)
    try:
        yield statements
    finally:
        event.remove(engine, "after_cursor_execute", on_execute)


def _selects_from(statements: list[tuple[str, str]], table: str) -> int:
    needle = f"FROM {table}"
    return sum(1 for kind, sql in statements if kind == "SELECT" and needle in sql)


def _seed_checkout_tenant(
    *,
    pedido_minimo: float = 0.0,
    pedido_minimo_retirada: bool = False,
    auto_accept: bool = False,
    auto_pause: bool = False,
    max_active_orders: int | None = None,
    provisional: bool = False,
) -> dict:
    Base.metadata.create_all(bind=engine)
    suffix = uuid.uuid4().hex[:8]
    rid = 810000 + int(uuid.uuid4().hex[:5], 16) % 150000
    user_id = f"u-b2-{suffix}"
    cat_id = f"cat-b2-{suffix}"
    grp_id = f"grp-b2-{suffix}"
    opt_id = f"opt-b2-{suffix}"
    product_ids = [f"prod-b2-{suffix}-{idx}" for idx in range(5)]

    with SessionLocal(restaurante_id=rid) as db:
        db.add(
            Restaurante(
                id=rid,
                nome=f"B2 Perf {suffix}",
                slug=f"b2-perf-{suffix}",
                plano="premium",
                saas_status="active",
            )
        )
        db.flush()
        db.add(
            ConfiguracaoRestaurante(
                restaurante_id=rid,
                pedido_minimo=pedido_minimo,
                pedido_minimo_retirada=pedido_minimo_retirada,
            )
        )
        db.add(RestauranteOperationProfile(restaurante_id=rid, profile_key="padrao"))
        db.add(
            Usuario(
                id=user_id,
                restaurante_id=rid,
                nome="Operador B2",
                cargo="admin",
                role="admin",
                status="ativo",
            )
        )
        db.add(
            CaixaTurno(
                restaurante_id=rid,
                aberto_por_id=user_id,
                status="aberto",
                saldo_inicial=0.0,
            )
        )
        db.add(Categoria(id=cat_id, restaurante_id=rid, nome="Lanches"))
        db.flush()
        db.add(
            GrupoModificador(
                id=grp_id,
                restaurante_id=rid,
                nome="Adicionais",
                min_selecoes=0,
                max_selecoes=2,
            )
        )
        db.flush()
        db.add(
            OpcaoModificador(
                id=opt_id,
                restaurante_id=rid,
                grupo_id=grp_id,
                nome="Queijo Extra",
                preco_adicional=3.0,
                ativo=True,
            )
        )
        for idx, pid in enumerate(product_ids):
            db.add(
                Produto(
                    id=pid,
                    restaurante_id=rid,
                    categoria_id=cat_id,
                    nome=f"Lanche {idx}",
                    preco=20.0 + idx,
                    ativo=True,
                )
            )
            db.flush()
            db.add(
                ProdutoGrupoModificador(
                    restaurante_id=rid,
                    produto_id=pid,
                    grupo_id=grp_id,
                    min_selecoes=0,
                    max_selecoes=2,
                )
            )
        if auto_accept or auto_pause or max_active_orders is not None:
            db.add(
                OnlineOrderControl(
                    restaurante_id=rid,
                    paused=False,
                    auto_accept=auto_accept,
                    auto_pause=auto_pause,
                    max_active_orders=max_active_orders,
                )
            )
        if provisional:
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=rid,
                    actor="superadmin-test",
                    action="SUPERADMIN_TENANT_ONBOARD",
                    reason="Preparação provisória de teste",
                    after_data={"trial_status": "pending_setup"},
                )
            )
        db.commit()

    return {
        "restaurante_id": rid,
        "product_ids": product_ids,
        "option_id": opt_id,
    }


def _checkout_payload(ctx: dict, *, phone: str = "11988887777", items_count: int = 5) -> dict:
    return {
        "restaurante_id": ctx["restaurante_id"],
        "tipo_pedido": "retirada",
        "cliente_nome": "Cliente Performance",
        "cliente_telefone": phone,
        "forma_pagamento": "na_entrega",
        "forma_pagamento_detalhe": "dinheiro",
        "itens": [
            {
                "produto_id": pid,
                "quantidade": 1,
                "modificador_ids": [ctx["option_id"]],
            }
            for pid in ctx["product_ids"][:items_count]
        ],
    }


def test_public_checkout_eliminates_redundant_selects():
    ctx = _seed_checkout_tenant()
    client = TestClient(app)

    # 1º pedido (cliente guest novo, cold)
    with capture_sql() as first_queries:
        res1 = client.post(
            "/cardapio/pedidos",
            json=_checkout_payload(ctx, phone="11977776661"),
            headers={"X-Idempotency-Key": str(uuid.uuid4())},
        )
    assert res1.status_code == 201, res1.text
    body1 = res1.json()
    assert body1["comanda_id"]
    assert body1["tracking_token"]
    assert body1["cliente_id"]
    assert body1["total"] == (20 + 21 + 22 + 23 + 24) + (5 * 3)

    first_selects = [sql for kind, sql in first_queries if kind == "SELECT"]
    # Antes: configuracoes_restaurante=2, super_admin_audit_logs=2, online_order_controls=3,
    # comandas=3, order_conversations=1, clientes=2 (total 32 SELECTs).
    assert _selects_from(first_queries, "configuracoes_restaurante") == 1
    assert _selects_from(first_queries, "super_admin_audit_logs") == 1
    assert _selects_from(first_queries, "online_order_controls") == 2
    assert _selects_from(first_queries, "order_conversations") == 0
    assert _selects_from(first_queries, "clientes") == 1
    assert _selects_from(first_queries, "comandas") <= 3  # idempotency checks + max(numero_pedido) cold
    assert len(first_selects) <= 26

    # 2º pedido (cliente recorrente, warm)
    with capture_sql() as warm_queries:
        res2 = client.post(
            "/cardapio/pedidos",
            json=_checkout_payload(ctx, phone="11977776661"),
            headers={"X-Idempotency-Key": str(uuid.uuid4())},
        )
    assert res2.status_code == 201, res2.text
    body2 = res2.json()
    assert body2["comanda_id"] != body1["comanda_id"]
    assert body2["cliente_id"] == body1["cliente_id"]
    assert body2["tracking_token"]

    warm_selects = [sql for kind, sql in warm_queries if kind == "SELECT"]
    assert _selects_from(warm_queries, "configuracoes_restaurante") == 1
    assert _selects_from(warm_queries, "super_admin_audit_logs") == 1
    assert _selects_from(warm_queries, "online_order_controls") == 2
    assert _selects_from(warm_queries, "order_conversations") == 0
    assert _selects_from(warm_queries, "clientes") == 1
    assert _selects_from(warm_queries, "comandas") == 2
    assert len(warm_selects) <= 24


def test_public_checkout_preserves_minimum_order_with_plain_config_snapshot():
    ctx = _seed_checkout_tenant(pedido_minimo=50.0, pedido_minimo_retirada=True)
    client = TestClient(app)

    # 1 item = R$ 23,00 (< R$ 50,00) deve ser rejeitado mesmo após commit do rate limiter
    too_small = client.post(
        "/cardapio/pedidos",
        json=_checkout_payload(ctx, phone="11977776662", items_count=1),
        headers={"X-Idempotency-Key": str(uuid.uuid4())},
    )
    assert too_small.status_code == 400, too_small.text

    # 3 itens = R$ 72,00 (>= R$ 50,00) deve passar
    valid = client.post(
        "/cardapio/pedidos",
        json=_checkout_payload(ctx, phone="11977776662", items_count=3),
        headers={"X-Idempotency-Key": str(uuid.uuid4())},
    )
    assert valid.status_code == 201, valid.text


def test_public_checkout_auto_accept_reuses_capacity_gate_control_without_extra_query():
    ctx = _seed_checkout_tenant(
        auto_accept=True,
        auto_pause=True,
        max_active_orders=5,
    )
    client = TestClient(app)

    with capture_sql() as queries:
        res = client.post(
            "/cardapio/pedidos",
            json=_checkout_payload(ctx, phone="11977776663", items_count=2),
            headers={"X-Idempotency-Key": str(uuid.uuid4())},
        )
    assert res.status_code == 201, res.text
    comanda_id = res.json()["comanda_id"]

    # 1 (policy) + 1 (capacity snapshot) + 1 (capacity FOR UPDATE) = 3;
    # auto_accept reutiliza o control carregado em vez de emitir uma 4ª query.
    assert _selects_from(queries, "online_order_controls") == 3

    with SessionLocal(restaurante_id=ctx["restaurante_id"]) as db:
        comanda = db.get(Comanda, comanda_id)
        assert comanda is not None
        assert comanda.delivery_status == "aceito"


def test_public_checkout_blocks_provisional_tenant_and_cleans_session_cache():
    ctx = _seed_checkout_tenant(provisional=True)
    client = TestClient(app)

    res = client.post(
        "/cardapio/pedidos",
        json=_checkout_payload(ctx, phone="11977776664", items_count=1),
        headers={"X-Idempotency-Key": str(uuid.uuid4())},
    )
    assert res.status_code == 403, res.text


def test_public_checkout_idempotent_replay_preserves_single_order_and_conversation():
    ctx = _seed_checkout_tenant()
    client = TestClient(app)
    idem_key = str(uuid.uuid4())
    payload = _checkout_payload(ctx, phone="11977776665", items_count=2)

    first = client.post("/cardapio/pedidos", json=payload, headers={"X-Idempotency-Key": idem_key})
    replay = client.post("/cardapio/pedidos", json=payload, headers={"X-Idempotency-Key": idem_key})

    assert first.status_code == 201, first.text
    assert replay.status_code == 201, replay.text
    assert replay.json()["comanda_id"] == first.json()["comanda_id"]

    with SessionLocal(restaurante_id=ctx["restaurante_id"]) as db:
        conversations = (
            db.query(OrderConversation)
            .filter(
                OrderConversation.restaurante_id == ctx["restaurante_id"],
                OrderConversation.pedido_id == first.json()["comanda_id"],
            )
            .all()
        )
        assert len(conversations) == 1


def test_guest_client_upsert_conflict_fallback_recovers_existing_customer():
    """Simula conflito concorrente em ON CONFLICT DO NOTHING RETURNING id."""
    ctx = _seed_checkout_tenant()
    rid = ctx["restaurante_id"]
    phone = "11977776669"

    with SessionLocal(restaurante_id=rid) as db:
        # Cria um primeiro cliente guest normalmente
        first_comanda = Comanda(
            id=f"cmd-c1-{uuid.uuid4().hex[:6]}",
            restaurante_id=rid,
            garcom_id="u-dummy",
            numero_pedido=1,
            tipo="Retirada",
            identificador="Maria Original",
            delivery_telefone=phone,
        )
        cid1, nome1 = _insert_guest_cliente_if_needed(db.connection(), first_comanda)
        assert cid1 is not None
        assert nome1 == "Maria Original"
        db.commit()

        # Simula corrida onde o SELECT inicial não enxergou a linha, mas o
        # INSERT ON CONFLICT DO NOTHING bate na constraint única e retorna None.
        original_execute = db.connection().execute
        call_count = {"select": 0}

        class _RacingConnectionProxy:
            def __init__(self, conn):
                self._conn = conn
                self.dialect = conn.dialect

            def execute(self, statement, *args, **kwargs):
                sql = str(statement)
                if sql.lstrip().upper().startswith("SELECT") and call_count["select"] == 0:
                    call_count["select"] += 1

                    class _EmptyResult:
                        def first(self):
                            return None

                    return _EmptyResult()
                return original_execute(statement, *args, **kwargs)

        racing_comanda = Comanda(
            id=f"cmd-c2-{uuid.uuid4().hex[:6]}",
            restaurante_id=rid,
            garcom_id="u-dummy",
            numero_pedido=2,
            tipo="Retirada",
            identificador="Maria Concorrente",
            delivery_telefone=phone,
        )
        cid2, nome2 = _insert_guest_cliente_if_needed(_RacingConnectionProxy(db.connection()), racing_comanda)
        assert cid2 == cid1
        assert nome2 == "Maria Original"
        assert db.query(Cliente).filter(Cliente.restaurante_id == rid).count() == 1
