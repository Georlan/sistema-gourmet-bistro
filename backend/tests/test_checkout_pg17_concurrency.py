"""Real PostgreSQL 17 concurrency, SQL budget and overload validation for public checkout."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import statistics
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

PG17_URL = os.getenv("KOMA_CHECKOUT_PG17_URL", "")
pytestmark = pytest.mark.skipif(
    not PG17_URL,
    reason="Set KOMA_CHECKOUT_PG17_URL to run disposable PostgreSQL 17 concurrency benchmarks.",
)


@pytest.fixture()
def pg17_db(monkeypatch):
    pg_engine = create_engine(PG17_URL, pool_size=10, max_overflow=10)
    base_session = sessionmaker(bind=pg_engine, autocommit=False, autoflush=False)

    def _session_factory(*args, **kwargs):
        kwargs.pop("restaurante_id", None)
        return base_session(*args, **kwargs)

    monkeypatch.setattr(app_db, "engine", pg_engine)
    monkeypatch.setattr(app_db, "SessionLocal", _session_factory)
    try:
        yield pg_engine, _session_factory
    finally:
        pg_engine.dispose()


def _seed_two_tenants(session_factory):
    with session_factory() as db:
        db.execute(text("TRUNCATE restaurantes CASCADE"))
        db.commit()
        seeded = {}
        for idx, rid in enumerate((901, 902), start=1):
            db.add(Restaurante(id=rid, nome=f"Rest PG17 {idx}", slug=f"rest-pg17-{rid}-{uuid.uuid4().hex[:6]}"))
            db.flush()
            db.add(ConfiguracaoRestaurante(restaurante_id=rid))
            uid = f"u-{rid}-{uuid.uuid4().hex[:6]}"
            db.add(
                Usuario(
                    id=uid,
                    restaurante_id=rid,
                    nome=f"Garcom {idx}",
                    email=f"g{rid}-{uuid.uuid4().hex[:6]}@k.com",
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
                nome="Carne",
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
                nome="Queijo Extra",
                preco_adicional=4.0,
                ativo=True,
            )
            db.add(opt)
            db.flush()

            pids = []
            for p_idx in range(5):
                pid = f"p-{rid}-{p_idx}-{uuid.uuid4().hex[:6]}"
                db.add(
                    Produto(
                        id=pid,
                        restaurante_id=rid,
                        nome=f"Prato {p_idx}",
                        preco=25.0 + p_idx,
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

            seeded[rid] = {"pids": pids, "opt_id": opt.id, "insumo_id": insumo.id}
        db.commit()
        return seeded


def test_pg17_checkout_sql_budget_and_concurrency_stages(pg17_db):
    pg_engine, session_factory = pg17_db
    seeded = _seed_two_tenants(session_factory)
    client = TestClient(app)

    # 1. Single 5-item order with modifier SQL count
    queries = []

    def _rec(_conn, _cur, stmt, _params, _ctx, _many):
        s = " ".join(stmt.split())
        queries.append(s)

    r0_idem_key = f"pg17-single-{uuid.uuid4().hex[:8]}"
    event.listen(pg_engine, "after_cursor_execute", _rec)
    try:
        r0 = client.post(
            "/cardapio/pedidos",
            json={
                "restaurante_id": 901,
                "tipo_pedido": "retirada",
                "cliente_nome": "Cliente SQL",
                "cliente_telefone": "11977770001",
                "forma_pagamento": "na_entrega",
                "forma_pagamento_detalhe": "dinheiro",
                "idempotency_key": r0_idem_key,
                "itens": [
                    {
                        "produto_id": seeded[901]["pids"][0],
                        "quantidade": 1,
                        "modificador_ids": [seeded[901]["opt_id"]],
                    },
                    *[{"produto_id": pid, "quantidade": 1} for pid in seeded[901]["pids"][1:]],
                ],
            },
        )
    finally:
        event.remove(pg_engine, "after_cursor_execute", _rec)

    assert r0.status_code == 201, r0.text
    selects = sum(1 for q in queries if q.upper().startswith("SELECT"))
    assert selects <= 45, f"PG17 5-item+mod SELECTs regressed: {selects}"
    base_comanda_id = r0.json()["comanda_id"]
    base_key = r0_idem_key

    # 2. Idempotent concurrent retries (5 identical requests from same client)
    idem_key = f"pg17-idem-{uuid.uuid4().hex[:8]}"
    idem_payload = {
        "restaurante_id": 901,
        "tipo_pedido": "retirada",
        "cliente_nome": "Cliente Idem",
        "cliente_telefone": "11977770002",
        "forma_pagamento": "na_entrega",
        "forma_pagamento_detalhe": "dinheiro",
        "idempotency_key": idem_key,
        "itens": [{"produto_id": seeded[901]["pids"][0], "quantidade": 1}],
    }
    with ThreadPoolExecutor(max_workers=5) as pool:
        idem_resps = list(
            pool.map(
                lambda _: client.post(
                    "/cardapio/pedidos",
                    json=idem_payload,
                    headers={"X-Forwarded-For": "10.99.0.1"},
                ),
                range(5),
            )
        )
    assert all(r.status_code in (200, 201) for r in idem_resps), [r.status_code for r in idem_resps]
    assert len({r.json()["comanda_id"] for r in idem_resps}) == 1

    # 3. Concurrency stages: 1, 10, 25, 50 concurrent independent checkouts + status polling across 2 tenants
    stage_stats = {}
    orders_per_tenant = {901: [base_comanda_id, idem_resps[0].json()["comanda_id"]], 902: []}
    user_by_tenant = {}
    with session_factory() as db:
        for rid in (901, 902):
            user_by_tenant[rid] = db.query(Usuario).filter_by(restaurante_id=rid).first().id

    def _run_mixed(idx: int):
        rid = 901 if idx % 2 == 0 else 902
        ip = f"10.{(idx // 250) + 1}.{(idx % 250) + 1}.1"
        t0 = time.perf_counter()
        if idx % 5 == 0 and base_key:
            res = client.get(
                f"/cardapio/pedidos/{base_comanda_id}/status",
                params={"key": base_key},
                headers={"X-Forwarded-For": ip},
            )
            return "status", None, res.status_code, (time.perf_counter() - t0) * 1000.0
        res = client.post(
            "/cardapio/pedidos",
            json={
                "restaurante_id": rid,
                "tipo_pedido": "retirada",
                "cliente_nome": f"Cliente {idx}",
                "cliente_telefone": f"1196666{idx:04d}",
                "forma_pagamento": "na_entrega",
                "forma_pagamento_detalhe": "dinheiro",
                "idempotency_key": f"pg17-conc-{idx}-{uuid.uuid4().hex[:8]}",
                "itens": [{"produto_id": seeded[rid]["pids"][0], "quantidade": 1}],
            },
            headers={"X-Forwarded-For": ip},
        )
        cid = res.json().get("comanda_id") if res.status_code in (200, 201) else None
        return f"create_{rid}", cid, res.status_code, (time.perf_counter() - t0) * 1000.0

    for n in (1, 10, 25, 50):
        t_stage = time.perf_counter()
        results = []
        with ThreadPoolExecutor(max_workers=min(n, 20)) as pool:
            futs = [pool.submit(_run_mixed, i + n * 100) for i in range(n)]
            for fut in as_completed(futs):
                results.append(fut.result())
        elapsed_s = time.perf_counter() - t_stage
        latencies = sorted(r[3] for r in results)
        errors = sum(1 for r in results if r[2] not in (200, 201))
        for kind, cid, code, _ in results:
            if code in (200, 201) and kind.startswith("create_") and cid:
                rid_val = int(kind.split("_")[1])
                orders_per_tenant[rid_val].append(cid)
        p50 = statistics.median(latencies)
        p95 = latencies[min(len(latencies) - 1, int(0.95 * len(latencies)))]
        stage_stats[str(n)] = {
            "errors": errors,
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
            "rps": round(n / elapsed_s, 2),
        }
        assert errors == 0, f"Concurrency stage {n} had {errors} errors"

    # 4. Verify pending orders did not prematurely deduct stock, then accept concurrently & verify stock integrity
    with session_factory() as db:
        for rid in (901, 902):
            ins = db.query(Insumo).filter_by(restaurante_id=rid, id=seeded[rid]["insumo_id"]).first()
            assert ins is not None
            assert float(ins.estoque_atual) == 1000.0

    def _accept_one(rid: int, cid: str):
        with session_factory() as db:
            OrderApplicationService.accept_order(
                db,
                AcceptOrderCommand(
                    restaurant_id=rid,
                    order_id=cid,
                    operator_user_id=user_by_tenant[rid],
                ),
            )

    accept_tasks = [(rid, cid) for rid, cids in orders_per_tenant.items() for cid in cids]
    with ThreadPoolExecutor(max_workers=10) as pool:
        futs = [pool.submit(_accept_one, rid, cid) for rid, cid in accept_tasks]
        for fut in as_completed(futs):
            fut.result()

    with session_factory() as db:
        for rid in (901, 902):
            ins = db.query(Insumo).filter_by(restaurante_id=rid, id=seeded[rid]["insumo_id"]).first()
            expected_stock = 1000.0 - float(len(orders_per_tenant[rid]))
            assert ins is not None
            assert float(ins.estoque_atual) == expected_stock
        conns = db.execute(text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()")).scalar()

    # 5. Recovery after temporary pool connection dispose
    pg_engine.dispose()
    rec_resp = client.get(f"/cardapio/pedidos/{base_comanda_id}/status", params={"key": base_key})
    assert rec_resp.status_code == 200

    print(
        "PG17_BENCHMARK="
        + json.dumps(
            {
                "single_5items_mod_selects": selects,
                "single_5items_mod_total_sql": len(queries),
                "pg_connections": conns,
                "stages": stage_stats,
            }
        )
    )
