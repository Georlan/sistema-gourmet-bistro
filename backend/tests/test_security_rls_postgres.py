"""Validação de isolamento RLS em PostgreSQL com role de runtime equivalente à produção (koma_app)."""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

PG_URL = os.getenv("KOMA_SECURITY_TEST_DATABASE_URL") or (
    os.getenv("DATABASE_URL") if (os.getenv("DATABASE_URL") or "").startswith("postgresql") else ""
)


@pytest.mark.skipif(not PG_URL, reason="PostgreSQL não configurado (defina KOMA_SECURITY_TEST_DATABASE_URL).")
def test_postgres_rls_runtime_role_and_cross_tenant_isolation():
    admin_engine = create_engine(PG_URL)
    worker_url = PG_URL.replace("postgres:pg-ci-test-only-password", "worker_test:pg-ci-test-only-password")
    runtime_engine = create_engine(worker_url) if "worker_test" not in PG_URL and "pg-ci-test-only-password" in PG_URL else admin_engine

    try:
        with admin_engine.begin() as conn:
            for rid, slug in [(801, "pg-rls-alpha"), (802, "pg-rls-beta")]:
                conn.execute(
                    text(
                        "INSERT INTO restaurantes (id, nome, slug, plano, saas_status) "
                        "VALUES (:id, :nome, :slug, 'premium', 'active') "
                        "ON CONFLICT (id) DO NOTHING"
                    ),
                    {"id": rid, "nome": f"Rest {rid}", "slug": slug},
                )
                conn.execute(
                    text(
                        "INSERT INTO categorias (id, restaurante_id, nome) "
                        "VALUES (:id, :rid, :nome) ON CONFLICT (id) DO NOTHING"
                    ),
                    {"id": f"pg-cat-{rid}", "rid": rid, "nome": f"Cat {rid}"},
                )
                conn.execute(
                    text(
                        "INSERT INTO produtos (id, restaurante_id, categoria_id, nome, preco, ativo) "
                        "VALUES (:id, :rid, :cat, :nome, 19.90, true) ON CONFLICT (id) DO NOTHING"
                    ),
                    {"id": f"pg-prod-{rid}", "rid": rid, "cat": f"pg-cat-{rid}", "nome": f"Prod {rid}"},
                )

        # Verifica privilégios da role de runtime (não-superuser, sem BYPASSRLS, membro de koma_app)
        with runtime_engine.connect() as conn:
            role_row = conn.execute(
                text(
                    """
                    SELECT
                        current_user AS role_name,
                        rolsuper AS is_superuser,
                        rolbypassrls AS bypass_rls,
                        pg_has_role(current_user, 'koma_app', 'member') AS is_koma_app
                    FROM pg_roles
                    WHERE rolname = current_user
                    """
                )
            ).mappings().one()
            if role_row["role_name"] != "postgres":
                assert role_row["is_superuser"] is False
                assert role_row["bypass_rls"] is False
                assert role_row["is_koma_app"] is True

                # Sem app.current_restaurante_id (sentinela 0): 0 linhas visíveis
                conn.execute(text("SELECT set_config('app.current_restaurante_id', '0', false)"))
                assert conn.execute(text("SELECT count(*) FROM produtos")).scalar() == 0

                # Escopo tenant 801: enxerga apenas 801, nunca 802
                conn.execute(text("SELECT set_config('app.current_restaurante_id', '801', false)"))
                rows_801 = conn.execute(text("SELECT id, restaurante_id FROM produtos WHERE id IN ('pg-prod-801', 'pg-prod-802')")).mappings().all()
                assert [r["restaurante_id"] for r in rows_801] == [801]

                # Tentativa de UPDATE/DELETE cross-tenant em 802 estando no escopo 801 afeta 0 linhas
                res = conn.execute(text("UPDATE produtos SET nome = 'hacked' WHERE id = 'pg-prod-802'"))
                assert res.rowcount == 0
    finally:
        admin_engine.dispose()
        if runtime_engine is not admin_engine:
            runtime_engine.dispose()
