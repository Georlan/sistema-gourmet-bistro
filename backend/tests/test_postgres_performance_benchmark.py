"""Validação em PostgreSQL real dos índices, políticas RLS InitPlan e benchmark Bloco 1 + Bloco 2."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts.benchmark_postgres_block1_block2 import (
    ensure_benchmark_postgres_schema,
    run_full_postgres_benchmark,
)

URL = os.getenv("KOMA_SECURITY_TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL security database")


def test_hot_path_indexes_and_rls_initplan_exist_on_postgres():
    ensure_benchmark_postgres_schema(URL)
    engine = create_engine(URL)
    try:
        with engine.connect() as conn:
            expected_indexes = {
                "ix_comandas_tenant_cliente_fechada",
                "ix_comandas_tenant_fechada_fechado_em",
                "ix_lancamentos_tenant_comanda_status",
                "ix_itens_tenant_comanda_status",
                "ix_pagamentos_tenant_status_created",
                "ix_print_jobs_tenant_active_queue",
            }
            rows = conn.execute(
                text(
                    "SELECT indexname FROM pg_indexes "
                    "WHERE schemaname = 'public' AND indexname = ANY(:names)"
                ),
                {"names": list(expected_indexes)},
            ).scalars().all()
            assert set(rows) == expected_indexes

            # Verify tenant_isolation policies use (SELECT current_setting(...)) InitPlan form
            non_initplan = conn.execute(
                text(
                    "SELECT tablename, qual FROM pg_policies "
                    "WHERE schemaname = 'public' AND policyname = 'tenant_isolation' "
                    "AND qual NOT LIKE '%SELECT current_setting%'"
                )
            ).all()
            assert non_initplan == [], f"Políticas sem InitPlan: {non_initplan}"
    finally:
        engine.dispose()


def test_reproducible_postgres_benchmark_block1_and_block2():
    report = run_full_postgres_benchmark(URL)
    assert report["smart_pre_ping_disconnect_recovered"] is True

    b1 = report["block1_print_agent_idle_poll"]
    assert b1["after"]["wire_roundtrips_per_call"] < b1["before"]["wire_roundtrips_per_call"]
    assert b1["after"]["app_queries_per_call"] < b1["before"]["app_queries_per_call"]
    assert b1["wire_roundtrips_reduction_pct"] >= 60.0

    b2 = report["block2_bottlenecks"]
    assert (
        b2["financial_reports_dashboard_and_overview"]["after"]["app_queries_per_call"]
        < b2["financial_reports_dashboard_and_overview"]["before"]["app_queries_per_call"]
    )
    assert (
        b2["super_admin_list_10_tenants"]["after"]["app_queries_per_call"]
        < b2["super_admin_list_10_tenants"]["before"]["app_queries_per_call"]
    )
    assert (
        b2["loyalty_clients_list_250_customers"]["after"]["peak_Verify_alloc_kb"]
        < b2["loyalty_clients_list_250_customers"]["before"]["peak_Verify_alloc_kb"]
    )
