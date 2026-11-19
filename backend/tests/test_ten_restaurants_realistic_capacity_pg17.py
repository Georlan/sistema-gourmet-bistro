"""Realistic 10-restaurant capacity & overload benchmark on PostgreSQL 17.

Reproduces production ORM pool budget (DB_POOL_SIZE=4, DB_MAX_OVERFLOW=0) plus
the shared PostgresListenMultiplexer (1 LISTEN connection) across 10 isolated
tenants, exercising public menu, order creation (with modifiers & stock),
status polling, operational accept transitions, chat/print realtime, and
transient connection recovery.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import random
import resource
import statistics
import threading
import time
import uuid

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

from app.application.orders.commands import AcceptOrderCommand
from app.application.orders.service import OrderApplicationService
import app.database as app_db
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    ConfiguracaoRestaurante,
    GrupoModificador,
    Insumo,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    ProdutoInsumo,
    Restaurante,
    Usuario,
)
from app.services.order_chat_hub import ORDER_CHAT_CHANNEL, OrderChatHub
from app.services.postgres_listen_multiplexer import (
    PostgresListenMultiplexer,
    normalize_postgres_dsn,
)
from app.services.print_delivery import PRINT_WAKEUP_CHANNEL

PG17_URL = os.getenv("KOMA_TEN_RESTAURANTS_PG17_URL", "")
pytestmark = pytest.mark.skipif(
    not PG17_URL,
    reason="Set KOMA_TEN_RESTAURANTS_PG17_URL to run the 10-restaurant PG17 capacity benchmark.",
)

TENANT_IDS = tuple(range(1001, 1011))


@pytest.fixture()
def realistic_pg17_env(monkeypatch):
    # Production ORM pool budget: DB_POOL_SIZE=4, DB_MAX_OVERFLOW=0
    pg_engine = create_engine(
        PG17_URL,
        pool_size=4,
        max_overflow=0,
        pool_timeout=30,
        pool_pre_ping=True,
    )
    base_session = sessionmaker(bind=pg_engine, autocommit=False, autoflush=False)

    def _session_factory(*args, **kwargs):
        kwargs.pop("restaurante_id", None)
        return base_session(*args, **kwargs)

    monkeypatch.setattr(app_db, "engine", pg_engine)
    monkeypatch.setattr(app_db, "SessionLocal", _session_factory)

    # Shared PostgreSQL LISTEN multiplexer (1 LISTEN connection)
    dsn = normalize_postgres_dsn(PG17_URL)
    mux = PostgresListenMultiplexer(
        dsn_provider=lambda: dsn,
        dialect_provider=lambda: "postgresql",
    )
    chat_hub = OrderChatHub(listen_to_postgres=True, multiplexer=mux)
    print_events: list[str] = []
    ops_events: list[str] = []
    mux.register_handler(PRINT_WAKEUP_CHANNEL, lambda p: print_events.append(p))
    mux.register_handler("koma_operational_realtime", lambda p: ops_events.append(p))
    mux.register_handler(ORDER_CHAT_CHANNEL, chat_hub._handle_notify)
    chat_hub._ensure_notify_worker()
    mux.start()
    assert mux.ready.wait(timeout=5.0)

    try:
        yield pg_engine, _session_factory, mux, chat_hub, print_events, ops_events
    finally:
        mux.stop(timeout=3.0)
        chat_hub.stop(timeout=2.0)
        pg_engine.dispose()


def _seed_ten_tenants(session_factory):
    with session_factory() as db:
        db.execute(text("TRUNCATE restaurantes CASCADE"))
        db.commit()
        seeded = {}
        for idx, rid in enumerate(TENANT_IDS, start=1):
            slug = f"rest-10r-{rid}"
            db.add(Restaurante(id=rid, nome=f"Restaurante {idx}", slug=slug))
            db.flush()
            db.add(ConfiguracaoRestaurante(restaurante_id=rid))
            uid = f"u-{rid}-{uuid.uuid4().hex[:6]}"
            db.add(
                Usuario(
                    id=uid,
                    restaurante_id=rid,
                    nome=f"Operador {idx}",
                    email=f"op{rid}-{uuid.uuid4().hex[:6]}@k.com",
                    senha_hash="x",
                    role="admin",
                    cargo="admin",
                    status="ativo",
                )
            )
            db.flush()
            db.add(CaixaTurno(restaurante_id=rid, aberto_por_id=uid, saldo_inicial=0.0, status="aberto"))
            cat = Categoria(id=f"c-{rid}-{uuid.uuid4().hex[:6]}", restaurante_id=rid, nome="Pratos")
            db.add(cat)
            db.flush()

            insumo = Insumo(
                id=f"ins-{rid}-{uuid.uuid4().hex[:6]}",
                restaurante_id=rid,
                nome=f"Proteina {idx}",
                unidade_medida="un",
                estoque_atual=1000.0,
            )
            db.add(insumo)
            db.flush()

            grp = GrupoModificador(
                id=f"grp-{rid}-{uuid.uuid4().hex[:6]}",
                restaurante_id=rid,
                nome="Adicionais",
                min_selecoes=0,
                max_selecoes=2,
            )
            db.add(grp)
            db.flush()
            opt = OpcaoModificador(
                id=f"opt-{rid}-{uuid.uuid4().hex[:6]}",
                restaurante_id=rid,
                grupo_id=grp.id,
                nome="Extra",
                preco_adicional=5.0,
                ativo=True,
            )
            db.add(opt)
            db.flush()

            pids = []
            for p_idx in range(3):
                pid = f"p-{rid}-{p_idx}-{uuid.uuid4().hex[:6]}"
                db.add(
                    Produto(
                        id=pid,
                        restaurante_id=rid,
                        nome=f"Prato {p_idx}",
                        preco=22.0 + p_idx,
                        categoria_id=cat.id,
                        ativo=True,
                    )
                )
                db.flush()
                if p_idx == 0:
                    db.add(ProdutoGrupoModificador(restaurante_id=rid, produto_id=pid, grupo_id=grp.id))
                    db.add(
                        ProdutoInsumo(
                            restaurante_id=rid,
                            produto_id=pid,
                            insumo_id=insumo.id,
                            quantidade=1.0,
                        )
                    )
                pids.append(pid)

            seeded[rid] = {
                "slug": slug,
                "user_id": uid,
                "pids": pids,
                "opt_id": opt.id,
                "insumo_id": insumo.id,
            }
        db.commit()
        return seeded


def test_ten_restaurants_realistic_pool_capacity_pg17(realistic_pg17_env):
    pg_engine, session_factory, mux, chat_hub, print_events, ops_events = realistic_pg17_env
    seeded = _seed_ten_tenants(session_factory)
    client = TestClient(app)

    # Instrument pool wait time & active checked-out connections
    pool_lock = threading.Lock()
    pool_wait_ms: list[float] = []
    active_checked_out = 0
    peak_checked_out = 0

    orig_do_get = pg_engine.pool._do_get

    def _timed_do_get():
        t0 = time.perf_counter()
        conn = orig_do_get()
        wait = (time.perf_counter() - t0) * 1000.0
        with pool_lock:
            pool_wait_ms.append(wait)
        return conn

    pg_engine.pool._do_get = _timed_do_get  # type: ignore[method-assign]

    @event.listens_for(pg_engine.pool, "checkout")
    def _on_checkout(dbapi_conn, conn_record, conn_proxy):
        nonlocal active_checked_out, peak_checked_out
        with pool_lock:
            active_checked_out += 1
            if active_checked_out > peak_checked_out:
                peak_checked_out = active_checked_out

    @event.listens_for(pg_engine.pool, "checkin")
    def _on_checkin(dbapi_conn, conn_record):
        nonlocal active_checked_out
        with pool_lock:
            active_checked_out = max(0, active_checked_out - 1)

    # Warm-up + create 1 baseline order per tenant so status polling has valid targets
    baseline_orders: dict[int, tuple[str, str]] = {}
    orders_to_accept: dict[int, list[str]] = {rid: [] for rid in TENANT_IDS}
    for rid in TENANT_IDS:
        idem = f"base-10r-{rid}-{uuid.uuid4().hex[:6]}"
        resp = client.post(
            "/cardapio/pedidos",
            json={
                "restaurante_id": rid,
                "tipo_pedido": "retirada",
                "cliente_nome": f"Base {rid}",
                "cliente_telefone": f"1195555{rid:04d}",
                "forma_pagamento": "na_entrega",
                "forma_pagamento_detalhe": "dinheiro",
                "idempotency_key": idem,
                "itens": [
                    {
                        "produto_id": seeded[rid]["pids"][0],
                        "quantidade": 1,
                        "modificador_ids": [seeded[rid]["opt_id"]],
                    },
                    {"produto_id": seeded[rid]["pids"][1], "quantidade": 1},
                ],
            },
            headers={"X-Forwarded-For": f"10.10.{rid - 1000}.1"},
        )
        assert resp.status_code == 201, resp.text
        cid = resp.json()["comanda_id"]
        baseline_orders[rid] = (cid, idem)
        orders_to_accept[rid].append(cid)

    # Verify cross-tenant isolation on status endpoint
    cross = client.get(
        f"/cardapio/pedidos/{baseline_orders[1001][0]}/status",
        params={"key": baseline_orders[1002][1]},
    )
    assert cross.status_code == 404

    # Measure SQL count for 1 public menu GET and 1 POST /cardapio/pedidos
    menu_sql = []
    order_sql = []

    def _rec_menu(_c, _cur, stmt, _p, _ctx, _m):
        menu_sql.append(stmt.lstrip().split(None, 1)[0].upper())

    def _rec_order(_c, _cur, stmt, _p, _ctx, _m):
        order_sql.append(stmt.lstrip().split(None, 1)[0].upper())

    event.listen(pg_engine, "after_cursor_execute", _rec_menu)
    rm = client.get("/api/cardapio-digital/public", params={"restaurante_id": 1001})
    event.remove(pg_engine, "after_cursor_execute", _rec_menu)
    assert rm.status_code == 200, rm.text

    event.listen(pg_engine, "after_cursor_execute", _rec_order)
    t_tx0 = time.perf_counter()
    ro = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": 1001,
            "tipo_pedido": "retirada",
            "cliente_nome": "SQL Probe",
            "cliente_telefone": "11944440001",
            "forma_pagamento": "na_entrega",
            "forma_pagamento_detalhe": "dinheiro",
            "idempotency_key": f"sql-probe-{uuid.uuid4().hex[:8]}",
            "itens": [
                {
                    "produto_id": seeded[1001]["pids"][0],
                    "quantidade": 1,
                    "modificador_ids": [seeded[1001]["opt_id"]],
                },
                {"produto_id": seeded[1001]["pids"][1], "quantidade": 1},
            ],
        },
        headers={"X-Forwarded-For": "10.10.99.1"},
    )
    single_order_tx_ms = (time.perf_counter() - t_tx0) * 1000.0
    event.remove(pg_engine, "after_cursor_execute", _rec_order)
    assert ro.status_code == 201, ro.text
    orders_to_accept[1001].append(ro.json()["comanda_id"])

    # Progressive mixed workload across 10 restaurants (decorrelated from tenant index):
    # Pre-seed 1 pending order per tenant in pending_accept_pool so concurrent `accept`
    # runs across all tenants without falling back to status.
    rng = random.Random(20261117)
    stage_results = {}
    cpu_start = time.process_time()
    accept_lock = threading.Lock()
    pending_accept_pool: list[tuple[int, str]] = []
    for rid in TENANT_IDS:
        pre_idem = f"pre-accept-{rid}-{uuid.uuid4().hex[:6]}"
        pre_resp = client.post(
            "/cardapio/pedidos",
            json={
                "restaurante_id": rid,
                "tipo_pedido": "retirada",
                "cliente_nome": f"PreAccept {rid}",
                "cliente_telefone": f"1195544{rid:04d}",
                "forma_pagamento": "na_entrega",
                "forma_pagamento_detalhe": "dinheiro",
                "idempotency_key": pre_idem,
                "itens": [
                    {
                        "produto_id": seeded[rid]["pids"][0],
                        "quantidade": 1,
                        "modificador_ids": [seeded[rid]["opt_id"]],
                    },
                    {"produto_id": seeded[rid]["pids"][1], "quantidade": 1},
                ],
            },
            headers={"X-Forwarded-For": f"10.11.{rid - 1000}.1"},
        )
        assert pre_resp.status_code == 201, pre_resp.text
        pre_cid = pre_resp.json()["comanda_id"]
        orders_to_accept[rid].append(pre_cid)
        pending_accept_pool.append((rid, pre_cid))

    # Idempotent retry check under concurrency (5 identical replays -> 1 comanda)
    idem_probe_key = f"idem-10r-{uuid.uuid4().hex[:8]}"
    idem_probe_payload = {
        "restaurante_id": 1005,
        "tipo_pedido": "retirada",
        "cliente_nome": "Idem Probe",
        "cliente_telefone": "11944449999",
        "forma_pagamento": "na_entrega",
        "forma_pagamento_detalhe": "dinheiro",
        "idempotency_key": idem_probe_key,
        "itens": [{"produto_id": seeded[1005]["pids"][0], "quantidade": 1}],
    }
    with ThreadPoolExecutor(max_workers=5) as idem_pool:
        idem_resps = list(
            idem_pool.map(
                lambda _: client.post(
                    "/cardapio/pedidos",
                    json=idem_probe_payload,
                    headers={"X-Forwarded-For": "10.99.5.1"},
                ),
                range(5),
            )
        )
    assert all(r.status_code in (200, 201) for r in idem_resps)
    assert len({r.json()["comanda_id"] for r in idem_resps}) == 1
    orders_to_accept[1005].append(idem_resps[0].json()["comanda_id"])

    def _build_stage_schedule(count: int) -> list[tuple[int, str]]:
        # 30% menu, 40% create, 20% status, 10% accept — shuffled across all 10 tenants
        op_weights = ["menu"] * 3 + ["create"] * 4 + ["status"] * 2 + ["accept"] * 1
        schedule = []
        for idx in range(count):
            rid = TENANT_IDS[(idx + rng.randrange(len(TENANT_IDS))) % len(TENANT_IDS)]
            op_type = op_weights[idx % len(op_weights)]
            schedule.append((rid, op_type))
        rng.shuffle(schedule)
        return schedule

    def _run_op(op_idx: int, rid: int, op_type: str):
        ip = f"10.{(op_idx // 250) + 20}.{(op_idx % 250) + 1}.{(rid % 200) + 1}"
        t0 = time.perf_counter()
        if op_type == "menu":
            res = client.get("/api/cardapio-digital/public", params={"restaurante_id": rid}, headers={"X-Forwarded-For": ip})
            return op_type, rid, None, res.status_code, (time.perf_counter() - t0) * 1000.0
        if op_type == "create":
            res = client.post(
                "/cardapio/pedidos",
                json={
                    "restaurante_id": rid,
                    "tipo_pedido": "retirada",
                    "cliente_nome": f"Cliente {op_idx}",
                    "cliente_telefone": f"119{(op_idx % 90000000) + 10000000}",
                    "forma_pagamento": "na_entrega",
                    "forma_pagamento_detalhe": "dinheiro",
                    "idempotency_key": f"10r-{rid}-{op_idx}-{uuid.uuid4().hex[:6]}",
                    "itens": [
                        {
                            "produto_id": seeded[rid]["pids"][0],
                            "quantidade": 1,
                            "modificador_ids": [seeded[rid]["opt_id"]],
                        },
                        {"produto_id": seeded[rid]["pids"][1], "quantidade": 1},
                    ],
                },
                headers={"X-Forwarded-For": ip},
            )
            cid = res.json().get("comanda_id") if res.status_code in (200, 201) else None
            return op_type, rid, cid, res.status_code, (time.perf_counter() - t0) * 1000.0
        if op_type == "status":
            cid, key = baseline_orders[rid]
            res = client.get(
                f"/cardapio/pedidos/{cid}/status",
                params={"key": key},
                headers={"X-Forwarded-For": ip},
            )
            return op_type, rid, None, res.status_code, (time.perf_counter() - t0) * 1000.0
        with accept_lock:
            target = pending_accept_pool.pop(0) if pending_accept_pool else None
        if target is None:
            cid, key = baseline_orders[rid]
            res = client.get(f"/cardapio/pedidos/{cid}/status", params={"key": key}, headers={"X-Forwarded-For": ip})
            return "status", rid, None, res.status_code, (time.perf_counter() - t0) * 1000.0
        t_rid, t_cid = target
        with session_factory() as db:
            OrderApplicationService.accept_order(
                db,
                AcceptOrderCommand(
                    restaurant_id=t_rid,
                    order_id=t_cid,
                    operator_user_id=seeded[t_rid]["user_id"],
                ),
            )
            db.execute(
                text("SELECT pg_notify('koma_print_jobs', :p), pg_notify('koma_order_chat', :c)"),
                {
                    "p": str(t_rid),
                    "c": json.dumps({"restaurante_id": t_rid, "conversation_id": f"conv-{t_cid}", "kind": "refresh"}),
                },
            )
            db.commit()
        return op_type, t_rid, None, 200, (time.perf_counter() - t0) * 1000.0

    # For each concurrency level N in (1, 10, 25, 50), launch N concurrent clients
    for n in (1, 10, 25, 50):
        schedule = _build_stage_schedule(n)
        t_stage = time.perf_counter()
        results = []
        with ThreadPoolExecutor(max_workers=n) as pool:
            futs = [pool.submit(_run_op, n * 1000 + i, rid, op_type) for i, (rid, op_type) in enumerate(schedule)]
            for fut in as_completed(futs):
                results.append(fut.result())
        elapsed_s = time.perf_counter() - t_stage

        by_type: dict[str, list[float]] = {}
        errors = 0
        for op_type, rid, cid, code, lat_ms in results:
            by_type.setdefault(op_type, []).append(lat_ms)
            if code not in (200, 201):
                errors += 1
            elif op_type == "create" and cid:
                orders_to_accept[rid].append(cid)
                with accept_lock:
                    pending_accept_pool.append((rid, cid))

        all_lats = sorted(r[4] for r in results)
        type_summary = {}
        for k, vals in by_type.items():
            svals = sorted(vals)
            type_summary[k] = {
                "count": len(svals),
                "p50_ms": round(statistics.median(svals), 2),
                "p95_ms": round(svals[min(len(svals) - 1, int(0.95 * len(svals)))], 2),
            }

        stage_results[str(n)] = {
            "errors": errors,
            "p50_ms": round(statistics.median(all_lats), 2),
            "p95_ms": round(all_lats[min(len(all_lats) - 1, int(0.95 * len(all_lats)))], 2),
            "rps": round(n / elapsed_s, 2),
            "by_type": type_summary,
        }
        assert errors == 0, f"Stage {n} had {errors} errors: {results}"

    cpu_elapsed_s = time.process_time() - cpu_start
    rss_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0

    # Verify stock integrity across all 10 tenants after accepting all remaining orders
    with session_factory() as db:
        for rid in TENANT_IDS:
            for cid in orders_to_accept[rid]:
                # accept_order is idempotent/ignores if already accepted, or check remaining
                pass
        # Accept any unaccepted orders still in pending_accept_pool
        for t_rid, t_cid in pending_accept_pool:
            OrderApplicationService.accept_order(
                db,
                AcceptOrderCommand(
                    restaurant_id=t_rid,
                    order_id=t_cid,
                    operator_user_id=seeded[t_rid]["user_id"],
                ),
            )
        # Also accept baseline + probe orders (if not already accepted)
        for rid in TENANT_IDS:
            for cid in orders_to_accept[rid]:
                if (rid, cid) not in pending_accept_pool:
                    try:
                        OrderApplicationService.accept_order(
                            db,
                            AcceptOrderCommand(
                                restaurant_id=rid,
                                order_id=cid,
                                operator_user_id=seeded[rid]["user_id"],
                            ),
                        )
                    except Exception:
                        db.rollback()

    with session_factory() as db:
        for rid in TENANT_IDS:
            ins = db.query(Insumo).filter_by(restaurante_id=rid, id=seeded[rid]["insumo_id"]).first()
            expected = 1000.0 - float(len(orders_to_accept[rid]))
            assert ins is not None
            assert float(ins.estoque_atual) == expected, f"Tenant {rid} stock={ins.estoque_atual} expected={expected}"
        pg_conns = db.execute(text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()")).scalar()

    # Verify LISTEN channels & bounded chat queue remained healthy
    time.sleep(0.05)
    assert len(print_events) > 0, "Expected print wakeup events via shared LISTEN multiplexer"
    with chat_hub._queue_cond:
        chat_q_len = len(chat_hub._notify_queue)
    assert chat_q_len <= chat_hub._max_notify_queue_size

    # Verify recovery after transient engine.dispose()
    pg_engine.dispose()
    rec = client.get("/api/cardapio-digital/public", params={"restaurante_id": 1001})
    assert rec.status_code == 200

    sorted_waits = sorted(pool_wait_ms) if pool_wait_ms else [0.0]
    print(
        "TEN_RESTAURANTS_BENCH="
        + json.dumps(
            {
                "tenants": len(TENANT_IDS),
                "orm_pool": {"pool_size": 4, "max_overflow": 0},
                "peak_orm_checked_out": peak_checked_out,
                "pool_wait_p50_ms": round(statistics.median(sorted_waits), 2),
                "pool_wait_p95_ms": round(sorted_waits[min(len(sorted_waits) - 1, int(0.95 * len(sorted_waits)))], 2),
                "pool_wait_max_ms": round(max(sorted_waits), 2),
                "pg_stat_activity_conns": pg_conns,
                "print_events_received": len(print_events),
                "ops_events_received": len(ops_events),
                "menu_sql_count": len(menu_sql),
                "order_sql_total": len(order_sql),
                "order_sql_selects": sum(1 for op in order_sql if op == "SELECT"),
                "single_order_tx_ms": round(single_order_tx_ms, 2),
                "cpu_s": round(cpu_elapsed_s, 3),
                "max_rss_mb": round(rss_mb, 2),
                "chat_queue_len": chat_q_len,
                "stages": stage_results,
            }
        )
    )
