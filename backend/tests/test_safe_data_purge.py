from sqlalchemy import Column, ForeignKey, Integer, MetaData, String, Table, create_engine, select

from app.services.safe_data_purge import (
    CONFIRMATION_PHRASE,
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


def test_dry_run_is_non_mutating_and_reports_indirect_children():
    engine = _test_engine()
    with engine.connect() as connection:
        plan = build_purge_plan(connection)
        assert plan.delete_counts["usuarios"] == 2
        assert plan.delete_counts["comandas"] == 2
        assert plan.delete_counts["itens"] == 2
        assert plan.delete_counts["restaurant_signups"] == 1
        assert plan.delete_counts["restaurantes"] == 1
        assert plan.preserved_counts["produtos"] == 1
        users = Table("usuarios", MetaData(), autoload_with=connection)
        assert len(connection.execute(select(users)).all()) == 2


def test_apply_preserves_tenant_one_structure_and_clears_operational_data():
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

    metadata = MetaData()
    metadata.reflect(bind=engine)
    with engine.connect() as connection:
        assert connection.execute(select(metadata.tables["restaurantes"].c.id)).scalars().all() == [1]
        assert connection.execute(select(metadata.tables["categorias"].c.restaurante_id)).scalars().all() == [1]
        assert connection.execute(select(metadata.tables["produtos"].c.restaurante_id)).scalars().all() == [1]
        assert connection.execute(select(metadata.tables["usuarios"])).all() == []
        assert connection.execute(select(metadata.tables["comandas"])).all() == []
        assert connection.execute(select(metadata.tables["itens"])).all() == []
        assert connection.execute(select(metadata.tables["restaurant_signups"])).all() == []


def test_apply_requires_exact_dry_run_and_backup_reference():
    engine = _test_engine()
    with engine.connect() as connection:
        plan = build_purge_plan(connection)

    for kwargs, expected in (
        ({"confirmation": "wrong", "backup_reference": "snapshot"}, "confirmação"),
        ({"confirmation": CONFIRMATION_PHRASE, "backup_reference": ""}, "backup"),
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
            backup_reference="snapshot-test-002",
        )
    except RuntimeError as exc:
        # A fingerprint ainda coincide porque a tabela nova está vazia, mas a
        # classificação obrigatória é uma trava independente.
        assert "não classificadas" in str(exc)
    else:
        raise AssertionError("tabela nova não classificada deveria bloquear o purge")
