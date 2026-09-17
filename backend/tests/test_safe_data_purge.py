from sqlalchemy import Column, ForeignKey, Integer, MetaData, String, Table, create_engine, select

from app.services.safe_data_purge import (
    CONFIRMATION_PHRASE,
    WAIVE_BACKUP_PHRASE,
    apply_purge,
    build_purge_plan,
)


def _test_engine():
    engine = create_engine("sqlite://")
    metadata = MetaData()
    Table("restaurantes", metadata, Column("id", Integer, primary_key=True), Column("nome", String))
    Table(
        "categorias",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("restaurante_id", ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False),
    )
    Table(
        "produtos",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("restaurante_id", ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False),
        Column("categoria_id", ForeignKey("categorias.id")),
    )
    Table(
        "configuracoes_restaurante",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("restaurante_id", ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False),
    )
    Table(
        "restaurante_capabilities",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("restaurante_id", ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False),
    )
    Table(
        "saas_subscriptions",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("restaurante_id", ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False),
    )
    Table(
        "usuarios",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("restaurante_id", ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False),
        Column("email", String),
    )
    Table(
        "comandas",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("restaurante_id", ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False),
    )
    Table(
        "itens",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("comanda_id", ForeignKey("comandas.id", ondelete="CASCADE"), nullable=False),
    )
    Table("restaurant_signups", metadata, Column("id", Integer, primary_key=True), Column("payload", String))
    metadata.create_all(engine)

    with engine.begin() as connection:
        for restaurant_id in (1, 2):
            connection.execute(
                metadata.tables["restaurantes"].insert(),
                {"id": restaurant_id, "nome": f"R{restaurant_id}"},
            )
            connection.execute(
                metadata.tables["categorias"].insert(),
                {"id": restaurant_id, "restaurante_id": restaurant_id},
            )
            connection.execute(
                metadata.tables["produtos"].insert(),
                {"id": restaurant_id, "restaurante_id": restaurant_id, "categoria_id": restaurant_id},
            )
            connection.execute(
                metadata.tables["configuracoes_restaurante"].insert(),
                {"id": restaurant_id, "restaurante_id": restaurant_id},
            )
            connection.execute(
                metadata.tables["restaurante_capabilities"].insert(),
                {"id": restaurant_id, "restaurante_id": restaurant_id},
            )
            connection.execute(
                metadata.tables["saas_subscriptions"].insert(),
                {"id": restaurant_id, "restaurante_id": restaurant_id},
            )
            connection.execute(
                metadata.tables["usuarios"].insert(),
                {"id": restaurant_id, "restaurante_id": restaurant_id, "email": "reuse@example.com"},
            )
            connection.execute(
                metadata.tables["comandas"].insert(),
                {"id": restaurant_id, "restaurante_id": restaurant_id},
            )
            connection.execute(
                metadata.tables["itens"].insert(),
                {"id": restaurant_id, "comanda_id": restaurant_id},
            )
        connection.execute(metadata.tables["restaurant_signups"].insert(), {"id": 1, "payload": "old@email"})
    return engine


def test_dry_run_is_non_mutating_and_reports_full_cleanup():
    engine = _test_engine()
    with engine.connect() as connection:
        plan = build_purge_plan(connection)
        assert plan.delete_counts["usuarios"] == 2
        assert plan.delete_counts["comandas"] == 2
        assert plan.delete_counts["itens"] == 2
        assert plan.delete_counts["categorias"] == 2
        assert plan.delete_counts["produtos"] == 2
        assert plan.delete_counts["configuracoes_restaurante"] == 2
        assert plan.delete_counts["restaurant_signups"] == 1
        assert plan.delete_counts["restaurantes"] == 1
        assert plan.preserved_counts["restaurantes"] == 1
        assert plan.preserved_counts["restaurante_capabilities"] == 1
        assert plan.preserved_counts["saas_subscriptions"] == 1
        users = Table("usuarios", MetaData(), autoload_with=connection)
        assert len(connection.execute(select(users)).all()) == 2


def test_apply_keeps_only_minimal_tenant_one_shell():
    engine = _test_engine()
    with engine.connect() as connection:
        plan = build_purge_plan(connection)

    result = apply_purge(
        engine,
        expected_fingerprint=plan.fingerprint,
        expected_database=plan.database,
        confirmation=CONFIRMATION_PHRASE,
        backup_waiver=WAIVE_BACKUP_PHRASE,
    )
    assert result["validation"] == "passed"
    assert result["backup_waived"] is True

    metadata = MetaData()
    metadata.reflect(bind=engine)
    with engine.connect() as connection:
        assert connection.execute(select(metadata.tables["restaurantes"].c.id)).scalars().all() == [1]
        assert connection.execute(select(metadata.tables["restaurante_capabilities"].c.restaurante_id)).scalars().all() == [1]
        assert connection.execute(select(metadata.tables["saas_subscriptions"].c.restaurante_id)).scalars().all() == [1]
        assert connection.execute(select(metadata.tables["categorias"])).all() == []
        assert connection.execute(select(metadata.tables["produtos"])).all() == []
        assert connection.execute(select(metadata.tables["configuracoes_restaurante"])).all() == []
        assert connection.execute(select(metadata.tables["usuarios"])).all() == []
        assert connection.execute(select(metadata.tables["comandas"])).all() == []
        assert connection.execute(select(metadata.tables["itens"])).all() == []
        assert connection.execute(select(metadata.tables["restaurant_signups"])).all() == []


def test_apply_requires_exact_dry_run_and_backup_or_waiver():
    engine = _test_engine()
    with engine.connect() as connection:
        plan = build_purge_plan(connection)

    for kwargs, expected in (
        ({"confirmation": "wrong", "backup_reference": "snapshot"}, "confirmação"),
        ({"confirmation": CONFIRMATION_PHRASE}, "backup"),
        ({"confirmation": CONFIRMATION_PHRASE, "backup_waiver": "wrong"}, "renúncia"),
    ):
        try:
            apply_purge(
                engine,
                expected_fingerprint=plan.fingerprint,
                expected_database=plan.database,
                **kwargs,
            )
        except RuntimeError as exc:
            assert expected in str(exc).lower()
        else:
            raise AssertionError("purge destrutivo deveria ter sido bloqueado")


def test_apply_still_accepts_real_backup_reference():
    engine = _test_engine()
    with engine.connect() as connection:
        plan = build_purge_plan(connection)

    result = apply_purge(
        engine,
        expected_fingerprint=plan.fingerprint,
        expected_database=plan.database,
        confirmation=CONFIRMATION_PHRASE,
        backup_reference="snapshot-test-001",
    )
    assert result["validation"] == "passed"
    assert result["backup_waived"] is False


def test_apply_blocks_new_unclassified_table():
    engine = _test_engine()
    with engine.connect() as connection:
        plan = build_purge_plan(connection)

    metadata = MetaData()
    Table("unexpected_persistent_data", metadata, Column("id", Integer, primary_key=True))
    metadata.create_all(engine)

    try:
        apply_purge(
            engine,
            expected_fingerprint=plan.fingerprint,
            expected_database=plan.database,
            confirmation=CONFIRMATION_PHRASE,
            backup_waiver=WAIVE_BACKUP_PHRASE,
        )
    except RuntimeError as exc:
        assert "não classificadas" in str(exc)
    else:
        raise AssertionError("tabela nova não classificada deveria bloquear o purge")


def test_purge_cli_loads_without_web_secrets():
    import os
    import subprocess
    import sys
    from pathlib import Path

    backend_root = Path(__file__).resolve().parents[1]
    cli_path = backend_root / "tools" / "purge_homologation_data.py"

    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("SECRET_KEY", "ENCRYPTION_KEY")
    }
    result = subprocess.run(
        [sys.executable, str(cli_path), "--help"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "CLI segura para limpar dados históricos" in result.stdout
