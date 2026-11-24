#!/usr/bin/env python3
"""Benchmark reproduzível B11: Escala 1 / 10 / 100 restaurantes no KÔMA sobre PG17 real."""
from __future__ import annotations

import argparse
import asyncio
import datetime
import hashlib
import json
import os
import resource
import socket
import statistics
import sys
import threading
import time
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def _assert_local_postgres(url: str, label: str) -> None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").strip().lower()
    if parsed.scheme.split("+")[0] not in {"postgresql", "postgres"}:
        raise RuntimeError(f"{label} deve usar PostgreSQL (recebido {parsed.scheme!r}).")
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError(f"BLOQUEADO: {label} aponta para host não local ({host!r}).")


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = (len(ordered) - 1) * (p / 100.0)
    lo = int(idx)
    hi = min(lo + 1, len(ordered) - 1)
    frac = idx - lo
    return round(ordered[lo] + (ordered[hi] - ordered[lo]) * frac, 2)


def _summarize_latencies(latencies_ms: list[float], statuses: list[int]) -> dict[str, Any]:
    ok_2xx = sum(1 for code in statuses if 200 <= code < 300)
    s_304 = sum(1 for code in statuses if code == 304)
    s_4xx = sum(1 for code in statuses if 400 <= code < 500)
    s_5xx = sum(1 for code in statuses if code >= 500 or code == 0)
    return {
        "requests": len(statuses),
        "ok_2xx": ok_2xx,
        "not_modified_304": s_304,
        "err_4xx": s_4xx,
        "err_5xx": s_5xx,
        "p50_ms": _pct(latencies_ms, 50),
        "p95_ms": _pct(latencies_ms, 95),
        "p99_ms": _pct(latencies_ms, 99),
        "max_ms": round(max(latencies_ms), 2) if latencies_ms else 0.0,
        "mean_ms": round(statistics.mean(latencies_ms), 2) if latencies_ms else 0.0,
    }


class BenchSqlRecorder:
    def __init__(self, sim_rtt_ms: float = 0.0) -> None:
        self.sim_rtt_s = max(0.0, float(sim_rtt_ms) / 1000.0)
        self._lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        with self._lock:
            self.total_queries = 0
            self.select1_queries = 0
            self.set_local_queries = 0
            self.commit_queries = 0
            self.rollback_queries = 0
            self.pg_notify_queries = 0
            self.total_sql_ms = 0.0
            self.last_query_ts = time.perf_counter()

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "total_queries": self.total_queries,
                "select1_queries": self.select1_queries,
                "set_local_queries": self.set_local_queries,
                "commit_queries": self.commit_queries,
                "rollback_queries": self.rollback_queries,
                "pg_notify_queries": self.pg_notify_queries,
                "total_sql_ms": round(self.total_sql_ms, 2),
            }

    def attach(self, engine) -> None:
        from sqlalchemy import event

        @event.listens_for(engine, "before_cursor_execute")
        def _before(conn, cursor, statement, parameters, context, executemany):
            conn.info["_bench_q_start"] = time.perf_counter()
            sql_u = statement.strip().upper()
            if self.sim_rtt_s > 0 and not sql_u.startswith("SET LOCAL "):
                time.sleep(self.sim_rtt_s)

        @event.listens_for(engine, "after_cursor_execute")
        def _after(conn, cursor, statement, parameters, context, executemany):
            elapsed_ms = (time.perf_counter() - conn.info.pop("_bench_q_start", time.perf_counter())) * 1000.0
            sql_u = statement.strip().upper()
            with self._lock:
                self.total_queries += 1
                self.total_sql_ms += elapsed_ms
                if sql_u == "SELECT 1":
                    self.select1_queries += 1
                elif sql_u.startswith("SET LOCAL "):
                    self.set_local_queries += 1
                elif "PG_NOTIFY" in sql_u:
                    self.pg_notify_queries += 1

        @event.listens_for(engine, "commit")
        def _commit(conn):
            if self.sim_rtt_s > 0:
                time.sleep(self.sim_rtt_s)
            with self._lock:
                self.commit_queries += 1

        @event.listens_for(engine, "rollback")
        def _rollback(conn):
            with self._lock:
                self.rollback_queries += 1


def _seed_benchmark_tenants(seed_db_url: str, tenant_count: int) -> dict[int, dict[str, Any]]:
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import NullPool

    from app.models import (
        CaixaTurno,
        Categoria,
        Comanda,
        ConfiguracaoRestaurante,
        Item,
        Lancamento,
        Mesa,
        Pagamento,
        PrintAgentToken,
        PrintJob,
        Produto,
        Restaurante,
        Usuario,
    )
    from app.security import create_access_token

    seed_engine = create_engine(seed_db_url, poolclass=NullPool, future=True)
    SeedSession = sessionmaker(bind=seed_engine, autoflush=False, autocommit=False)
    base_rid = 2001
    tenants: dict[int, dict[str, Any]] = {}
    now = datetime.datetime.now(datetime.timezone.utc)

    with seed_engine.begin() as conn:
        max_existing = conn.execute(text("SELECT COALESCE(MAX(id), 0) FROM restaurantes")).scalar() or 0
        if int(max_existing) >= base_rid:
            raise RuntimeError(
                f"Banco já contém restaurantes >= {base_rid}; restaure a partir do template antes de rodar."
            )

    with SeedSession() as sdb:
        for idx in range(tenant_count):
            rid = base_rid + idx
            uid = f"usr-{rid}"
            rest = Restaurante(
                id=rid,
                nome=f"Bench Bistro {rid}",
                slug=f"bench-{rid}",
                plano="pro",
                saas_status="active",
                billing_mode="subscription",
            )
            sdb.add(rest)
            sdb.flush()

            cfg = ConfiguracaoRestaurante(
                restaurante_id=rid,
                delivery_ativo=True,
                mapa_mesas_ativo=True,
                tipo_taxa_entrega="fixa",
                taxa_entrega_fixa=7.0,
            )
            sdb.add(cfg)

            usr = Usuario(
                id=uid,
                restaurante_id=rid,
                nome=f"Admin {rid}",
                email=f"admin{rid}@bench.local",
                senha_hash="bench-hash-unused",
                cargo="admin",
                status="ativo",
            )
            sdb.add(usr)
            sdb.flush()

            turno = CaixaTurno(
                restaurante_id=rid,
                aberto_por_id=uid,
                saldo_inicial=100.0,
                status="aberto",
            )
            sdb.add(turno)
            sdb.flush()

            cat_id = f"cat-{rid}"
            sdb.add(
                Categoria(
                    id=cat_id,
                    restaurante_id=rid,
                    nome="Principais",
                    destino_impressao="COZINHA",
                    ordem_exibicao=1,
                )
            )
            sdb.flush()

            prod_ids = []
            for p_idx in range(1, 7):
                pid = f"prod-{rid}-{p_idx}"
                prod_ids.append(pid)
                sdb.add(
                    Produto(
                        id=pid,
                        restaurante_id=rid,
                        nome=f"Prato {p_idx} ({rid})",
                        categoria_id=cat_id,
                        preco=30.0 + p_idx * 5.0,
                        descricao="Produto de benchmark",
                        ativo=True,
                        ordem_exibicao=p_idx,
                    )
                )
            sdb.flush()

            for m_num in range(1, 6):
                sdb.add(Mesa(id=m_num, restaurante_id=rid, capacidade=4, nome=f"Mesa {m_num}"))
            sdb.flush()

            kds_batches: list[list[str]] = []
            for o_idx in range(1, 3):
                cid = f"cmd-{rid}-open-{o_idx}"
                lid = f"lanc-{rid}-open-{o_idx}"
                sdb.add(
                    Comanda(
                        id=cid,
                        restaurante_id=rid,
                        mesa_id=o_idx,
                        garcom_id=uid,
                        tipo="Consumo no Local",
                        identificador=f"Mesa {o_idx}",
                        numero_pedido=o_idx,
                        fechada=False,
                        delivery_status="producao",
                        valor_pago=0.0,
                    )
                )
                sdb.flush()
                sdb.add(
                    Lancamento(
                        id=lid,
                        restaurante_id=rid,
                        comanda_id=cid,
                        garcom_id=uid,
                        origem="caixa",
                        status="producao",
                    )
                )
                sdb.flush()
                batch_items = []
                for it_idx in range(1, 3):
                    iid = f"item-{rid}-{o_idx}-{it_idx}"
                    batch_items.append(iid)
                    sdb.add(
                        Item(
                            id=iid,
                            restaurante_id=rid,
                            comanda_id=cid,
                            lancamento_id=lid,
                            produto_id=prod_ids[it_idx - 1],
                            preco_unit=35.0,
                            observacao="",
                            status="preparando",
                        )
                    )
                kds_batches.append(batch_items)

            closed_cid = f"cmd-{rid}-closed"
            closed_lid = f"lanc-{rid}-closed"
            sdb.add(
                Comanda(
                    id=closed_cid,
                    restaurante_id=rid,
                    mesa_id=5,
                    garcom_id=uid,
                    tipo="Retirada",
                    identificador="Cliente Hist",
                    numero_pedido=99,
                    fechada=True,
                    fechado_em=now - datetime.timedelta(hours=1),
                    delivery_status="finalizado",
                    valor_pago=70.0,
                )
            )
            sdb.flush()
            sdb.add(
                Lancamento(
                    id=closed_lid,
                    restaurante_id=rid,
                    comanda_id=closed_cid,
                    garcom_id=uid,
                    origem="caixa",
                    status="finalizado",
                )
            )
            sdb.flush()
            sdb.add(
                Item(
                    id=f"item-{rid}-closed-1",
                    restaurante_id=rid,
                    comanda_id=closed_cid,
                    lancamento_id=closed_lid,
                    produto_id=prod_ids[0],
                    preco_unit=70.0,
                    status="entregue",
                )
            )
            sdb.add(
                Pagamento(
                    id=f"pag-{rid}-closed-1",
                    restaurante_id=rid,
                    comanda_id=closed_cid,
                    turno_id=turno.id,
                    metodo="pix",
                    valor=70.0,
                    status="aprovado",
                )
            )

            raw_pat = f"pat-secret-{rid}-benchmark"
            pat_hash = hashlib.sha256(raw_pat.encode("utf-8")).hexdigest()
            agent_id = f"caixa-principal-{rid}"
            diag_payload = {
                "agent_version": "2.4.0",
                "adapter": "cups",
                "platform": "linux",
                "printers": [
                    {
                        "name": "BenchPrinter",
                        "is_default": True,
                        "available": True,
                        "present": True,
                        "configured": True,
                        "connection": "usb",
                        "status": "ready",
                    }
                ],
                "endpoints": [],
                "destinations": {"COZINHA": "BenchPrinter"},
                "default_printer": "BenchPrinter",
                "capabilities": ["connect_usb"],
            }
            sdb.add(
                PrintAgentToken(
                    id=f"pat-{rid}",
                    restaurante_id=rid,
                    agent_id=agent_id,
                    token_hash=pat_hash,
                    ativo=True,
                    is_primary=True,
                    last_seen_at=now,
                    printer_diagnostics=diag_payload,
                    diagnostics_updated_at=now,
                )
            )
            pending_pj_id = f"pj-{rid}-pending-1"
            sdb.add(
                PrintJob(
                    id=pending_pj_id,
                    restaurante_id=rid,
                    document_type="producao",
                    destination="COZINHA",
                    source_type="pedido",
                    source_id=f"lanc-{rid}-open-1",
                    payload_text="BENCH CUPOM\n1x Prato 1\n",
                    status="pending",
                    idempotency_key=f"pj-idem-pending-{rid}",
                )
            )
            done_pj_id = f"pj-{rid}-printed-1"
            sdb.add(
                PrintJob(
                    id=done_pj_id,
                    restaurante_id=rid,
                    document_type="producao",
                    destination="COZINHA",
                    source_type="pedido",
                    source_id=closed_lid,
                    payload_text="BENCH DONE\n",
                    status="printed",
                    agent_id=agent_id,
                    printed_at=now,
                    printer_name="BenchPrinter",
                    idempotency_key=f"pj-idem-done-{rid}",
                )
            )

            jwt_token = create_access_token(
                subject=uid,
                restaurante_id=rid,
                role="admin",
                token_version=1,
            )
            tenants[rid] = {
                "rid": rid,
                "uid": uid,
                "slug": f"bench-{rid}",
                "jwt": jwt_token,
                "agent_token": raw_pat,
                "agent_id": agent_id,
                "diag": diag_payload,
                "prod_ids": prod_ids,
                "kds_batches": kds_batches,
                "pending_pj_id": pending_pj_id,
                "done_pj_id": done_pj_id,
            }

        sdb.commit()
    seed_engine.dispose()
    return tenants


async def _do_req(
    client,
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    json_body: Any = None,
) -> tuple[int, float, int]:
    t0 = time.perf_counter()
    try:
        resp = await client.request(method, url, headers=headers, json=json_body)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return resp.status_code, elapsed_ms, len(resp.content)
    except Exception:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return 0, elapsed_ms, 0


async def _measure_isolated_endpoints(client, base_url: str, tenant: dict[str, Any], sql_rec: BenchSqlRecorder, get_pool_snap) -> dict[str, Any]:
    rid = tenant["rid"]
    auth = {"Authorization": f"Bearer {tenant['jwt']}"}
    pat = {"X-Agent-Token": tenant["agent_token"]}
    results: dict[str, Any] = {}

    async def probe(name: str, method: str, path: str, *, headers=None, json_body=None) -> dict[str, Any]:
        before_sql = sql_rec.snapshot()
        before_pool = get_pool_snap()
        status_code, lat_ms, nbytes = await _do_req(client, method, f"{base_url}{path}", headers=headers, json_body=json_body)
        after_sql = sql_rec.snapshot()
        after_pool = get_pool_snap()
        return {
            "status": status_code,
            "latency_ms": round(lat_ms, 2),
            "bytes": nbytes,
            "sql_queries": after_sql["total_queries"] - before_sql["total_queries"],
            "select1_queries": after_sql["select1_queries"] - before_sql["select1_queries"],
            "commits": after_sql["commit_queries"] - before_sql["commit_queries"],
            "rollbacks": after_sql["rollback_queries"] - before_sql["rollback_queries"],
            "sql_ms": round(after_sql["total_sql_ms"] - before_sql["total_sql_ms"], 2),
            "pool_checkouts": after_pool["checkouts_total"] - before_pool["checkouts_total"],
        }

    results["public_menu_get"] = await probe(
        "public_menu_get", "GET", f"/api/cardapio-digital/public?restaurante_id={rid}"
    )
    results["caixa_detalhes_todos"] = await probe(
        "caixa_detalhes_todos", "GET", "/comandas/detalhes/todos", headers=auth
    )
    results["pdv_venda_direta"] = await probe(
        "pdv_venda_direta",
        "POST",
        "/cardapio/modificadores/venda-direta",
        headers=auth,
        json_body={
            "tipo": "Retirada",
            "identificador": "Cliente PDV",
            "delivery_telefone": "11988887777",
            "garcom_id": tenant["uid"],
            "idempotency_key": f"pdv-iso-{rid}-{uuid.uuid4().hex[:12]}",
            "itens": [{"produto_id": tenant["prod_ids"][0], "observacao": "", "modificador_ids": []}],
        },
    )
    results["kds_itens_prontos"] = await probe(
        "kds_itens_prontos",
        "PUT",
        "/comandas/kds/itens/prontos",
        headers=auth,
        json_body={"item_ids": tenant["kds_batches"][0]},
    )
    results["print_heartbeat_steady"] = await probe(
        "print_heartbeat_steady",
        "POST",
        "/api/print-agents/heartbeat",
        headers=pat,
        json_body={"diagnostics": tenant["diag"]},
    )
    results["print_claim_batch_with_job"] = await probe(
        "print_claim_batch_with_job",
        "POST",
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers=pat,
    )
    results["print_claim_batch_idle"] = await probe(
        "print_claim_batch_idle",
        "POST",
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers=pat,
    )
    results["print_complete_batch_noop"] = await probe(
        "print_complete_batch_noop",
        "POST",
        "/api/print-agents/jobs/complete-batch",
        headers=pat,
        json_body={"jobs": [{"job_id": tenant["done_pj_id"], "printer_name": "BenchPrinter"}]},
    )
    results["print_complete_batch_active"] = await probe(
        "print_complete_batch_active",
        "POST",
        "/api/print-agents/jobs/complete-batch",
        headers=pat,
        json_body={"jobs": [{"job_id": tenant["pending_pj_id"], "printer_name": "BenchPrinter"}]},
    )
    results["public_order_create"] = await probe(
        "public_order_create",
        "POST",
        "/cardapio/pedidos",
        json_body={
            "restaurante_id": rid,
            "itens": [{"produto_id": tenant["prod_ids"][0], "quantidade": 1, "observacao": ""}],
            "cliente_nome": "Cliente Bench",
            "cliente_telefone": "11999990000",
            "whatsapp_status_opt_in": False,
            "endereco_entrega": "Rua Teste, 100",
            "taxa_entrega": 7.0,
            "forma_pagamento": "na_entrega",
            "forma_pagamento_detalhe": "dinheiro",
            "tipo_pedido": "delivery",
            "idempotency_key": f"web-iso-{rid}-{uuid.uuid4().hex[:12]}",
        },
    )
    results["relatorios_produtos"] = await probe(
        "relatorios_produtos", "GET", "/relatorios/produtos", headers=auth
    )
    return results


async def _run_scale_stage(
    client,
    base_url: str,
    stage_name: str,
    active_tenants: list[dict[str, Any]],
    total_requests: int,
    concurrency: int,
    sql_rec: BenchSqlRecorder,
    get_pool_snap,
) -> dict[str, Any]:
    sem = asyncio.Semaphore(concurrency)
    before_sql = sql_rec.snapshot()
    before_pool = get_pool_snap()
    t0 = time.perf_counter()

    latencies: list[float] = []
    statuses: list[int] = []
    by_op: dict[str, tuple[list[float], list[int]]] = defaultdict(lambda: ([], []))

    async def worker(idx: int) -> None:
        t = active_tenants[idx % len(active_tenants)]
        auth = {"Authorization": f"Bearer {t['jwt']}"}
        pat = {"X-Agent-Token": t["agent_token"]}
        op_kind = idx % 6
        async with sem:
            if op_kind == 0:
                code, ms, _ = await _do_req(
                    client, "GET", f"{base_url}/api/cardapio-digital/public?restaurante_id={t['rid']}"
                )
                op_name = "public_menu"
            elif op_kind == 1:
                code, ms, _ = await _do_req(client, "GET", f"{base_url}/comandas/detalhes/todos", headers=auth)
                op_name = "caixa_todos"
            elif op_kind == 2:
                code, ms, _ = await _do_req(
                    client, "POST", f"{base_url}/api/print-agents/heartbeat", headers=pat, json_body={"diagnostics": t["diag"]}
                )
                op_name = "print_heartbeat"
            elif op_kind == 3:
                code, ms, _ = await _do_req(
                    client, "POST", f"{base_url}/api/print-agents/jobs/claim-batch?limit=10", headers=pat
                )
                op_name = "print_claim_idle"
            elif op_kind == 4:
                code, ms, _ = await _do_req(
                    client,
                    "POST",
                    f"{base_url}/cardapio/modificadores/venda-direta",
                    headers=auth,
                    json_body={
                        "tipo": "Retirada",
                        "identificador": f"Cliente {idx}",
                        "delivery_telefone": "11988887777",
                        "garcom_id": t["uid"],
                        "idempotency_key": f"pdv-{stage_name}-{idx}-{uuid.uuid4().hex[:8]}",
                        "itens": [{"produto_id": t["prod_ids"][0], "observacao": "", "modificador_ids": []}],
                    },
                )
                op_name = "pdv_venda_direta"
            else:
                code, ms, _ = await _do_req(client, "GET", f"{base_url}/relatorios/produtos", headers=auth)
                op_name = "relatorios_produtos"
            latencies.append(ms)
            statuses.append(code)
            l_arr, s_arr = by_op[op_name]
            l_arr.append(ms)
            s_arr.append(code)

    await asyncio.gather(*(worker(i) for i in range(total_requests)))
    duration_s = max(0.001, time.perf_counter() - t0)
    after_sql = sql_rec.snapshot()
    after_pool = get_pool_snap()
    return {
        "stage": stage_name,
        "tenants": len(active_tenants),
        "concurrency": concurrency,
        "duration_s": round(duration_s, 3),
        "rps": round(len(statuses) / duration_s, 2),
        "summary": _summarize_latencies(latencies, statuses),
        "by_op": {k: _summarize_latencies(v[0], v[1]) for k, v in sorted(by_op.items())},
        "sql_delta": {
            "total_queries": after_sql["total_queries"] - before_sql["total_queries"],
            "select1_queries": after_sql["select1_queries"] - before_sql["select1_queries"],
            "commits": after_sql["commit_queries"] - before_sql["commit_queries"],
            "rollbacks": after_sql["rollback_queries"] - before_sql["rollback_queries"],
            "sql_ms": round(after_sql["total_sql_ms"] - before_sql["total_sql_ms"], 2),
        },
        "pool_delta": {
            "checkouts": after_pool["checkouts_total"] - before_pool["checkouts_total"],
            "slow_waits": after_pool["slow_waits_total"] - before_pool["slow_waits_total"],
            "wait_timeouts": after_pool["wait_timeouts_total"] - before_pool["wait_timeouts_total"],
        },
    }


async def _run_kds_concurrent_burst(client, base_url: str, tenants_subset: list[dict[str, Any]], sql_rec: BenchSqlRecorder, get_pool_snap) -> dict[str, Any]:
    before_sql = sql_rec.snapshot()
    before_pool = get_pool_snap()
    t0 = time.perf_counter()
    targets = [(t, t["kds_batches"][1]) for t in tenants_subset]
    responses = await asyncio.gather(
        *(
            _do_req(
                client,
                "PUT",
                f"{base_url}/comandas/kds/itens/prontos",
                headers={"Authorization": f"Bearer {t['jwt']}"},
                json_body={"item_ids": batch},
            )
            for t, batch in targets
        )
    )
    duration_s = round(time.perf_counter() - t0, 3)
    statuses = [r[0] for r in responses]
    latencies = [r[1] for r in responses]
    after_sql = sql_rec.snapshot()
    after_pool = get_pool_snap()
    return {
        "concurrent_calls": len(targets),
        "duration_s": duration_s,
        "summary": _summarize_latencies(latencies, statuses),
        "sql_delta": {
            "total_queries": after_sql["total_queries"] - before_sql["total_queries"],
            "commits": after_sql["commit_queries"] - before_sql["commit_queries"],
            "rollbacks": after_sql["rollback_queries"] - before_sql["rollback_queries"],
        },
        "pool_delta": {
            "checkouts": after_pool["checkouts_total"] - before_pool["checkouts_total"],
            "slow_waits": after_pool["slow_waits_total"] - before_pool["slow_waits_total"],
            "wait_timeouts": after_pool["wait_timeouts_total"] - before_pool["wait_timeouts_total"],
        },
    }


async def _measure_idle_window(duration_s: float, sql_rec: BenchSqlRecorder, get_pool_snap) -> dict[str, Any]:
    before_sql = sql_rec.snapshot()
    before_pool = get_pool_snap()
    await asyncio.sleep(duration_s)
    after_sql = sql_rec.snapshot()
    after_pool = get_pool_snap()
    return {
        "window_s": duration_s,
        "sql_queries": after_sql["total_queries"] - before_sql["total_queries"],
        "commits": after_sql["commit_queries"] - before_sql["commit_queries"],
        "rollbacks": after_sql["rollback_queries"] - before_sql["rollback_queries"],
        "pool_checkouts": after_pool["checkouts_total"] - before_pool["checkouts_total"],
    }


async def _async_main(args: argparse.Namespace) -> dict[str, Any]:
    import httpx
    import uvicorn

    repo_backend = Path(args.repo_backend).resolve()
    sys.path.insert(0, str(repo_backend))

    os.environ["ENVIRONMENT"] = "test"
    os.environ["SECRET_KEY"] = "b11-local-bench-ephemeral-secret-key-not-prod"
    os.environ["ENCRYPTION_KEY"] = "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA="
    os.environ["DATABASE_URL"] = args.db_url
    os.environ["CREATE_SCHEMA_ON_STARTUP"] = "false"
    os.environ["RUN_MIGRATIONS_ON_STARTUP"] = "false"
    os.environ["DB_POOL_SIZE"] = str(args.pool_size)
    os.environ["DB_MAX_OVERFLOW"] = str(args.max_overflow)
    os.environ["DB_POOL_TIMEOUT"] = str(args.pool_timeout)

    from app import database as app_db
    from app.database_diagnostics import get_pool_metrics_snapshot
    from app.main import app

    get_pool_snap = lambda: get_pool_metrics_snapshot(app_db.engine)

    tenants_map = _seed_benchmark_tenants(args.seed_db_url, 100)
    tenant_list = [tenants_map[rid] for rid in sorted(tenants_map)]

    sql_rec = BenchSqlRecorder(sim_rtt_ms=args.sim_rtt_ms)
    sql_rec.attach(app_db.engine)

    port = _find_free_port()
    base_url = f"http://127.0.0.1:{port}"
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            workers=1,
            log_level="warning",
            access_log=False,
        )
    )
    server_task = asyncio.create_task(server.serve())
    try:
        async with httpx.AsyncClient(timeout=35.0) as client:
            for _ in range(100):
                try:
                    r = await client.get(f"{base_url}/health")
                    if r.status_code == 200:
                        break
                except Exception:
                    await asyncio.sleep(0.05)
            else:
                raise RuntimeError("Uvicorn benchmark server não respondeu /health.")

            idle_window = await _measure_idle_window(4.0, sql_rec, get_pool_snap)
            isolated = await _measure_isolated_endpoints(client, base_url, tenant_list[0], sql_rec, get_pool_snap)
            kds_burst = await _run_kds_concurrent_burst(client, base_url, tenant_list[1:17], sql_rec, get_pool_snap)

            stage_a = await _run_scale_stage(
                client, base_url, "stage_a_1_tenant", tenant_list[:1], 24, 8, sql_rec, get_pool_snap
            )
            stage_b = await _run_scale_stage(
                client, base_url, "stage_b_10_tenants", tenant_list[:10], 60, 24, sql_rec, get_pool_snap
            )
            stage_c = await _run_scale_stage(
                client, base_url, "stage_c_100_tenants", tenant_list[:100], 180, 50, sql_rec, get_pool_snap
            )
            health_resp = (await client.get(f"{base_url}/health")).json()
    finally:
        server.should_exit = True
        await asyncio.wait_for(server_task, timeout=10.0)

    rss_mb = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 2)
    return {
        "label": args.label,
        "sim_rtt_ms": args.sim_rtt_ms,
        "pool_config": {"pool_size": args.pool_size, "max_overflow": args.max_overflow, "timeout": args.pool_timeout},
        "peak_rss_mb": rss_mb,
        "idle_window": idle_window,
        "isolated_endpoints": isolated,
        "kds_concurrent_burst_16": kds_burst,
        "stages": {
            "stage_a": stage_a,
            "stage_b": stage_b,
            "stage_c": stage_c,
        },
        "final_health_db_pool": health_resp.get("db_pool"),
        "final_health_websocket": health_resp.get("websocket"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark B11 1/10/100 restaurantes PG17")
    parser.add_argument("--repo-backend", required=True)
    parser.add_argument("--db-url", required=True)
    parser.add_argument("--seed-db-url", required=True)
    parser.add_argument("--label", default="after")
    parser.add_argument("--sim-rtt-ms", type=float, default=0.0)
    parser.add_argument("--pool-size", type=int, default=4)
    parser.add_argument("--max-overflow", type=int, default=0)
    parser.add_argument("--pool-timeout", type=int, default=15)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    _assert_local_postgres(args.db_url, "--db-url")
    _assert_local_postgres(args.seed_db_url, "--seed-db-url")

    report = asyncio.run(_async_main(args))
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
