"""Query/latency budgets and regression guards for public checkout and order status."""

from __future__ import annotations

from contextlib import contextmanager
import json
import statistics
import time
import uuid

from sqlalchemy import event

from app.database import SessionLocal, engine
from app.models import Produto
from tests.characterization.orders.fixtures import char_client, char_setup


@contextmanager
def count_sql():
    recorded = []

    def _record(_conn, _cursor, statement, _params, _ctx, _many):
        sql = statement.lstrip()
        op = sql.split(None, 1)[0].upper() if sql else ""
        recorded.append((op, sql))

    event.listen(engine, "after_cursor_execute", _record)
    try:
        yield recorded
    finally:
        event.remove(engine, "after_cursor_execute", _record)


def _seed_five_products(rid: int) -> list[str]:
    ids = []
    with SessionLocal(restaurante_id=rid) as db:
        base_prod = db.query(Produto).filter_by(restaurante_id=rid, id="prod-char-simples").first()
        cat_id = base_prod.categoria_id if base_prod else None
        for idx in range(5):
            pid = f"prod-b2-bench-{idx}-{uuid.uuid4().hex[:6]}"
            db.add(
                Produto(
                    id=pid,
                    restaurante_id=rid,
                    nome=f"Prato Bench {idx}",
                    preco=20.0 + idx,
                    categoria_id=cat_id,
                    ativo=True,
                )
            )
            ids.append(pid)
        db.commit()
    return ids


def test_checkout_and_status_stay_within_query_budget(char_client, char_setup):
    rid = char_setup["restaurant_id"]
    pids = _seed_five_products(rid)

    idem_key = f"b2-bench-{uuid.uuid4().hex[:12]}"
    t0 = time.perf_counter()
    with count_sql() as create_queries:
        resp = char_client.post(
            "/cardapio/pedidos",
            json={
                "restaurante_id": rid,
                "tipo_pedido": "retirada",
                "cliente_nome": "Cliente Bench",
                "cliente_telefone": "11999990001",
                "forma_pagamento": "na_entrega",
                "forma_pagamento_detalhe": "dinheiro",
                "idempotency_key": idem_key,
                "itens": [{"produto_id": pid, "quantidade": 1} for pid in pids],
            },
        )
    create_ms = (time.perf_counter() - t0) * 1000.0
    assert resp.status_code in (200, 201), resp.text
    comanda_id = resp.json()["comanda_id"]

    create_selects = sum(1 for op, _ in create_queries if op == "SELECT")
    assert create_selects <= 42, f"Checkout SELECT budget regressed: {create_selects}"
    print(
        "CHECKOUT_5_ITEMS="
        + json.dumps(
            {
                "selects": create_selects,
                "total_queries": len(create_queries),
                "ms": round(create_ms, 2),
            }
        )
    )

    # Idempotent replay must return the exact same comanda without creating duplicates.
    replay = char_client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": rid,
            "tipo_pedido": "retirada",
            "cliente_nome": "Cliente Bench",
            "cliente_telefone": "11999990001",
            "forma_pagamento": "na_entrega",
            "forma_pagamento_detalhe": "dinheiro",
            "idempotency_key": idem_key,
            "itens": [{"produto_id": pid, "quantidade": 1} for pid in pids],
        },
    )
    assert replay.status_code in (200, 201), replay.text
    assert replay.json()["comanda_id"] == comanda_id

    # Invalid key must still return 404.
    denied = char_client.get(
        f"/cardapio/pedidos/{comanda_id}/status",
        params={"key": "errada"},
    )
    assert denied.status_code == 404

    status_latencies = []
    status_selects = 0
    for _ in range(10):
        t0 = time.perf_counter()
        with count_sql() as st_queries:
            st = char_client.get(
                f"/cardapio/pedidos/{comanda_id}/status",
                params={"key": idem_key},
            )
        status_latencies.append((time.perf_counter() - t0) * 1000.0)
        assert st.status_code == 200, st.text
        body = st.json()
        assert len(body["itens"]) == 5
        assert body["total"] == 110.0
        status_selects = sum(1 for op, _ in st_queries if op == "SELECT")
        assert status_selects <= 6, f"Status SELECT budget regressed (N+1?): {status_selects}"

    p50 = statistics.median(status_latencies)
    p95 = sorted(status_latencies)[max(0, int(0.95 * len(status_latencies)) - 1)]
    print(
        "STATUS_5_ITEMS="
        + json.dumps(
            {
                "selects": status_selects,
                "p50_ms": round(p50, 2),
                "p95_ms": round(p95, 2),
            }
        )
    )


def test_concurrent_status_and_idempotent_checkout_50_requests(char_client, char_setup):
    from concurrent.futures import ThreadPoolExecutor

    rid = char_setup["restaurant_id"]
    idem_key = f"b2-conc-{uuid.uuid4().hex[:12]}"
    payload = {
        "restaurante_id": rid,
        "tipo_pedido": "retirada",
        "cliente_nome": "Cliente Concorrência",
        "cliente_telefone": "11999990002",
        "forma_pagamento": "na_entrega",
        "forma_pagamento_detalhe": "dinheiro",
        "idempotency_key": idem_key,
        "itens": [{"produto_id": "prod-char-simples", "quantidade": 1}],
    }

    with ThreadPoolExecutor(max_workers=10) as pool:
        create_responses = list(
            pool.map(lambda _: char_client.post("/cardapio/pedidos", json=payload), range(10))
        )

    assert all(r.status_code in (200, 201) for r in create_responses)
    comanda_ids = {r.json()["comanda_id"] for r in create_responses}
    assert len(comanda_ids) == 1, f"Idempotency created duplicates: {comanda_ids}"
    comanda_id = next(iter(comanda_ids))

    def _poll(_):
        t0 = time.perf_counter()
        r = char_client.get(f"/cardapio/pedidos/{comanda_id}/status", params={"key": idem_key})
        return r.status_code, (time.perf_counter() - t0) * 1000.0

    with ThreadPoolExecutor(max_workers=10) as pool:
        poll_results = list(pool.map(_poll, range(50)))

    assert all(code == 200 for code, _ in poll_results)
    latencies = sorted(ms for _, ms in poll_results)
    p50 = statistics.median(latencies)
    p95 = latencies[max(0, int(0.95 * len(latencies)) - 1)]
    print(
        "CONCURRENT_50_STATUS="
        + json.dumps({"requests": 50, "errors": 0, "p50_ms": round(p50, 2), "p95_ms": round(p95, 2)})
    )
