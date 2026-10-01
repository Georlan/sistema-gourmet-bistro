from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    MetaData,
    Numeric,
    String,
    Table,
    create_engine,
    select,
)

from app.services.tenant_first_day_reset import (
    CONFIRMATION_PHRASE,
    apply_tenant_first_day_reset,
    build_tenant_first_day_plan,
)


def _schema():
    engine = create_engine("sqlite://")
    metadata = MetaData()

    Table(
        "restaurantes",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("nome", String, nullable=False),
    )
    Table(
        "categorias",
        metadata,
        Column("id", String, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("nome", String, nullable=False),
    )
    Table(
        "produtos",
        metadata,
        Column("id", String, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("categoria_id", String, ForeignKey("categorias.id"), nullable=False),
        Column("nome", String, nullable=False),
    )
    Table(
        "configuracoes_restaurante",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
    )
    Table(
        "print_agent_tokens",
        metadata,
        Column("id", String, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("pending_command", String),
        Column("command_requested_at", String),
    )
    Table(
        "clientes",
        metadata,
        Column("id", String, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("saldo_pontos", Integer, nullable=False, default=0),
        Column("saldo_cashback", Numeric(14, 2), nullable=False, default=0),
    )
    Table(
        "caixa_turnos",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("status", String, nullable=False),
    )
    Table(
        "caixa_movimentacoes",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("turno_id", Integer, ForeignKey("caixa_turnos.id"), nullable=False),
    )
    Table(
        "comandas",
        metadata,
        Column("id", String, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("numero_pedido", Integer, nullable=False),
    )
    Table(
        "lancamentos",
        metadata,
        Column("id", String, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("comanda_id", String, ForeignKey("comandas.id"), nullable=False),
    )
    Table(
        "itens",
        metadata,
        Column("id", String, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("comanda_id", String, ForeignKey("comandas.id"), nullable=False),
        Column("lancamento_id", String, ForeignKey("lancamentos.id"), nullable=False),
    )
    Table(
        "pagamentos",
        metadata,
        Column("id", String, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("comanda_id", String, ForeignKey("comandas.id"), nullable=False),
        Column("turno_id", Integer, ForeignKey("caixa_turnos.id"), nullable=False),
    )
    Table(
        "print_jobs",
        metadata,
        Column("id", String, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("source_id", String, nullable=False),
        Column("status", String, nullable=False),
    )
    Table(
        "integration_outbox",
        metadata,
        Column("id", String, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("aggregate_id", String, nullable=False),
    )
    Table(
        "numeradores_operacionais",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        Column("ultimo_numero", Integer, nullable=False),
    )
    Table(
        "fiscal_documents",
        metadata,
        Column("id", String, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
    )

    metadata.create_all(engine)
    return engine, metadata


def _seed(engine, metadata, *, open_cash=False, with_fiscal=False):
    t = metadata.tables
    with engine.begin() as conn:
        conn.execute(
            t["restaurantes"].insert(),
            [
                {"id": 6, "nome": "Quentinha Caseira"},
                {"id": 7, "nome": "Pizzaria"},
            ],
        )
        conn.execute(
            t["categorias"].insert(),
            [
                {"id": "cat6", "restaurante_id": 6, "nome": "Quentinhas"},
                {"id": "cat7", "restaurante_id": 7, "nome": "Pizzas"},
            ],
        )
        conn.execute(
            t["produtos"].insert(),
            [
                {
                    "id": "prod6",
                    "restaurante_id": 6,
                    "categoria_id": "cat6",
                    "nome": "Quentinha P",
                },
                {
                    "id": "prod7",
                    "restaurante_id": 7,
                    "categoria_id": "cat7",
                    "nome": "Pizza",
                },
            ],
        )
        conn.execute(
            t["configuracoes_restaurante"].insert(),
            [
                {"id": 1, "restaurante_id": 6},
                {"id": 2, "restaurante_id": 7},
            ],
        )
        conn.execute(
            t["print_agent_tokens"].insert(),
            [
                {
                    "id": "agent6",
                    "restaurante_id": 6,
                    "pending_command": "test-print",
                    "command_requested_at": "now",
                },
                {
                    "id": "agent7",
                    "restaurante_id": 7,
                    "pending_command": "keep",
                    "command_requested_at": "now",
                },
            ],
        )
        conn.execute(
            t["clientes"].insert(),
            [
                {
                    "id": "cli6",
                    "restaurante_id": 6,
                    "saldo_pontos": 10,
                    "saldo_cashback": 5,
                },
                {
                    "id": "cli7",
                    "restaurante_id": 7,
                    "saldo_pontos": 20,
                    "saldo_cashback": 7,
                },
            ],
        )
        conn.execute(
            t["caixa_turnos"].insert(),
            [
                {
                    "id": 61,
                    "restaurante_id": 6,
                    "status": "aberto" if open_cash else "fechado",
                },
                {"id": 71, "restaurante_id": 7, "status": "fechado"},
            ],
        )
        conn.execute(
            t["caixa_movimentacoes"].insert(),
            [
                {"id": 611, "restaurante_id": 6, "turno_id": 61},
                {"id": 711, "restaurante_id": 7, "turno_id": 71},
            ],
        )
        conn.execute(
            t["comandas"].insert(),
            [
                {"id": "cmd6", "restaurante_id": 6, "numero_pedido": 4},
                {"id": "cmd7", "restaurante_id": 7, "numero_pedido": 1},
            ],
        )
        conn.execute(
            t["lancamentos"].insert(),
            [
                {"id": "lan6", "restaurante_id": 6, "comanda_id": "cmd6"},
                {"id": "lan7", "restaurante_id": 7, "comanda_id": "cmd7"},
            ],
        )
        conn.execute(
            t["itens"].insert(),
            [
                {
                    "id": "item6",
                    "restaurante_id": 6,
                    "comanda_id": "cmd6",
                    "lancamento_id": "lan6",
                },
                {
                    "id": "item7",
                    "restaurante_id": 7,
                    "comanda_id": "cmd7",
                    "lancamento_id": "lan7",
                },
            ],
        )
        conn.execute(
            t["pagamentos"].insert(),
            [
                {
                    "id": "pay6",
                    "restaurante_id": 6,
                    "comanda_id": "cmd6",
                    "turno_id": 61,
                },
                {
                    "id": "pay7",
                    "restaurante_id": 7,
                    "comanda_id": "cmd7",
                    "turno_id": 71,
                },
            ],
        )
        conn.execute(
            t["print_jobs"].insert(),
            [
                {
                    "id": "print6",
                    "restaurante_id": 6,
                    "source_id": "cmd6",
                    "status": "failed",
                },
                {
                    "id": "print7",
                    "restaurante_id": 7,
                    "source_id": "cmd7",
                    "status": "pending",
                },
            ],
        )
        conn.execute(
            t["integration_outbox"].insert(),
            [
                {"id": "out6", "restaurante_id": 6, "aggregate_id": "cmd6"},
                {"id": "out7", "restaurante_id": 7, "aggregate_id": "cmd7"},
            ],
        )
        conn.execute(
            t["numeradores_operacionais"].insert(),
            [
                {"id": 1, "restaurante_id": 6, "ultimo_numero": 4},
                {"id": 2, "restaurante_id": 7, "ultimo_numero": 1},
            ],
        )
        if with_fiscal:
            conn.execute(
                t["fiscal_documents"].insert(),
                {"id": "fiscal6", "restaurante_id": 6},
            )


def test_reset_tenant_first_day_preserves_structure_and_other_tenants():
    engine, metadata = _schema()
    _seed(engine, metadata)

    result = apply_tenant_first_day_reset(
        engine,
        tenant_id=6,
        expected_name="Quentinha Caseira",
        confirmation=CONFIRMATION_PHRASE,
    )

    assert result["validation"]["orders_remaining"] == 0
    assert result["validation"]["print_jobs_remaining"] == 0
    assert result["validation"]["cash_shifts_remaining"] == 0
    assert result["validation"]["payments_remaining"] == 0
    assert result["validation"]["order_counters_remaining"] == 0
    assert result["validation"]["next_order_expected_after_app_restart"] == 1

    t = metadata.tables
    with engine.connect() as conn:
        assert conn.execute(
            select(t["produtos"].c.id).where(t["produtos"].c.restaurante_id == 6)
        ).all() == [("prod6",)]
        assert conn.execute(
            select(t["configuracoes_restaurante"].c.id).where(
                t["configuracoes_restaurante"].c.restaurante_id == 6
            )
        ).all() == [(1,)]

        assert conn.execute(
            select(t["comandas"].c.id).where(t["comandas"].c.restaurante_id == 6)
        ).all() == []
        assert conn.execute(
            select(t["print_jobs"].c.id).where(t["print_jobs"].c.restaurante_id == 6)
        ).all() == []
        assert conn.execute(
            select(t["caixa_turnos"].c.id).where(
                t["caixa_turnos"].c.restaurante_id == 6
            )
        ).all() == []

        assert conn.execute(
            select(t["comandas"].c.id).where(t["comandas"].c.restaurante_id == 7)
        ).all() == [("cmd7",)]
        assert conn.execute(
            select(t["print_jobs"].c.id).where(t["print_jobs"].c.restaurante_id == 7)
        ).all() == [("print7",)]

        agent6 = conn.execute(
            select(
                t["print_agent_tokens"].c.pending_command,
                t["print_agent_tokens"].c.command_requested_at,
            ).where(t["print_agent_tokens"].c.restaurante_id == 6)
        ).one()
        assert agent6 == (None, None)

        client6 = conn.execute(
            select(
                t["clientes"].c.saldo_pontos,
                t["clientes"].c.saldo_cashback,
            ).where(t["clientes"].c.restaurante_id == 6)
        ).one()
        assert int(client6[0]) == 0
        assert float(client6[1]) == 0.0


def test_reset_blocks_open_cash():
    engine, metadata = _schema()
    _seed(engine, metadata, open_cash=True)

    try:
        apply_tenant_first_day_reset(
            engine,
            tenant_id=6,
            expected_name="Quentinha Caseira",
            confirmation=CONFIRMATION_PHRASE,
        )
    except RuntimeError as exc:
        assert "caixa(s) aberto(s)" in str(exc)
    else:
        raise AssertionError("reset deveria bloquear caixa aberto")


def test_reset_blocks_fiscal_documents():
    engine, metadata = _schema()
    _seed(engine, metadata, with_fiscal=True)

    plan = None
    with engine.connect() as conn:
        plan = build_tenant_first_day_plan(
            conn,
            tenant_id=6,
            expected_name="Quentinha Caseira",
        )
    assert plan.fiscal_documents == 1

    try:
        apply_tenant_first_day_reset(
            engine,
            tenant_id=6,
            expected_name="Quentinha Caseira",
            confirmation=CONFIRMATION_PHRASE,
        )
    except RuntimeError as exc:
        assert "documentos fiscais" in str(exc)
    else:
        raise AssertionError("reset deveria bloquear documento fiscal")
