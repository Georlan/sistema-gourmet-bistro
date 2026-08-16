import datetime

import pytest

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.models import Categoria, Comanda, Item, Lancamento, Mesa, Produto, Restaurante, Usuario
from app.operational_models import (
    AtendimentoComanda,
    AtendimentoMesa,
    LancamentoIdentidade,
    MovimentoAtendimento,
    NumeradorOperacional,
)
from app.services.atendimento_projection import build_table_family_view
from app.services.atendimentos import (
    AtendimentoError,
    ensure_atendimento_for_comanda,
    ensure_launch_identity,
    merge_tables,
    reopen_command_guarded,
    transfer_items_batch,
)


TENANT = 1961
USER = "usr-atendimento-edge-1961"
CATEGORY = "cat-atendimento-edge-1961"
PRODUCT = "prod-atendimento-edge-1961"


@pytest.fixture(autouse=True)
def setup_edge_cases():
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(TENANT)
    db = SessionLocal()
    try:
        db.query(MovimentoAtendimento).filter(MovimentoAtendimento.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(LancamentoIdentidade).filter(LancamentoIdentidade.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(AtendimentoComanda).filter(AtendimentoComanda.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(AtendimentoMesa).filter(AtendimentoMesa.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(NumeradorOperacional).filter(NumeradorOperacional.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Item).filter(Item.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Lancamento).filter(Lancamento.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Comanda).filter(Comanda.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Produto).filter(Produto.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Categoria).filter(Categoria.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Mesa).filter(Mesa.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Usuario).filter(Usuario.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == TENANT).delete(synchronize_session=False)
        db.commit()

        db.add(Restaurante(id=TENANT, nome="Restaurante Edge", plano="bistro"))
        db.flush()
        db.add(
            Usuario(
                id=USER,
                restaurante_id=TENANT,
                nome="Operador Edge",
                email="edge-1961@test.local",
                role="caixa",
                status="ativo",
            )
        )
        db.add_all(
            [Mesa(id=mesa, restaurante_id=TENANT, capacidade=4, nome=f"Mesa {mesa}") for mesa in range(1, 7)]
        )
        db.add(
            Categoria(
                id=CATEGORY,
                restaurante_id=TENANT,
                nome="Cozinha",
                destino_impressao="COZINHA",
            )
        )
        db.add(
            Produto(
                id=PRODUCT,
                restaurante_id=TENANT,
                categoria_id=CATEGORY,
                nome="Produto Edge",
                preco=12.0,
                ativo=True,
            )
        )
        db.commit()
        yield
    finally:
        db.close()
        current_restaurante_id.reset(token)


def _command(
    db,
    command_id: str,
    mesa: int,
    numero: int,
    *,
    created_at: datetime.datetime | None = None,
) -> Comanda:
    command = Comanda(
        id=command_id,
        restaurante_id=TENANT,
        mesa_id=mesa,
        garcom_id=USER,
        tipo="Consumo no Local",
        numero_pedido=numero,
        fechada=False,
        criado_em=created_at or datetime.datetime(2026, 8, 16, 2, 0),
    )
    db.add(command)
    db.flush()
    return command


def _launch(db, command: Comanda, launch_id: str, item_id: str) -> Lancamento:
    launch = Lancamento(
        id=launch_id,
        restaurante_id=TENANT,
        comanda_id=command.id,
        garcom_id=USER,
        timestamp=datetime.datetime(2026, 8, 16, 2, 5),
    )
    db.add(launch)
    db.flush()
    db.add(
        Item(
            id=item_id,
            restaurante_id=TENANT,
            comanda_id=command.id,
            lancamento_id=launch.id,
            produto_id=PRODUCT,
            preco_unit=12.0,
            observacao="",
            cliente_nome="Consumo Geral",
            status="preparando",
            pago=False,
        )
    )
    db.flush()
    return launch


def test_operational_month_does_not_roll_over_at_21h_ceara():
    db = SessionLocal()
    try:
        # 01/09 00:30 UTC = 31/08 21:30 no fuso operacional UTC-3.
        command = _command(
            db,
            "c-month-boundary",
            1,
            88,
            created_at=datetime.datetime(2026, 9, 1, 0, 30, tzinfo=datetime.timezone.utc),
        )
        account = ensure_atendimento_for_comanda(db, command, actor_id=USER)
        assert account.periodo_ref == "2026-08"
        assert account.numero_conta == 88
        db.commit()
    finally:
        db.close()


def test_reopen_is_blocked_if_original_table_was_reused():
    db = SessionLocal()
    try:
        old = _command(db, "c-reopen-old", 1, 46)
        _launch(db, old, "l-reopen-old", "i-reopen-old")
        old_account = ensure_atendimento_for_comanda(db, old, actor_id=USER)
        old.fechada = True
        old.fechado_em = datetime.datetime.now(datetime.timezone.utc)
        db.flush()

        current = _command(db, "c-reopen-current", 1, 47)
        _launch(db, current, "l-reopen-current", "i-reopen-current")
        ensure_atendimento_for_comanda(db, current, actor_id=USER)
        db.flush()

        with pytest.raises(AtendimentoError) as blocked:
            reopen_command_guarded(db, TENANT, old.id, actor_id=USER)
        assert blocked.value.status_code == 409
        assert old.fechada is True
        assert old_account.id != ensure_atendimento_for_comanda(db, current).id
        db.rollback()
    finally:
        db.close()


def test_unmerge_is_blocked_if_source_table_was_reused():
    from app.services.atendimentos import unmerge_by_comanda

    db = SessionLocal()
    try:
        source = _command(db, "c-unmerge-source", 3, 46)
        target = _command(db, "c-unmerge-target", 2, 47)
        _launch(db, source, "l-unmerge-source", "i-unmerge-source")
        _launch(db, target, "l-unmerge-target", "i-unmerge-target")
        ensure_atendimento_for_comanda(db, source, actor_id=USER)
        ensure_atendimento_for_comanda(db, target, actor_id=USER)
        merge_tables(db, TENANT, 3, 2, actor_id=USER)

        reused = _command(db, "c-unmerge-reused", 3, 60)
        _launch(db, reused, "l-unmerge-reused", "i-unmerge-reused")
        ensure_atendimento_for_comanda(db, reused, actor_id=USER)
        db.flush()

        with pytest.raises(AtendimentoError) as blocked:
            unmerge_by_comanda(db, TENANT, source.id, actor_id=USER)
        assert blocked.value.status_code == 409
        db.rollback()
    finally:
        db.close()


def test_transferred_item_is_projected_with_original_human_order_id():
    db = SessionLocal()
    try:
        source = _command(db, "c-projection-source", 1, 46)
        launch = _launch(db, source, "l-projection-46-a", "i-projection-46-a")
        identity = ensure_launch_identity(db, launch)
        assert identity.label == "46-A"

        moved = transfer_items_batch(
            db,
            TENANT,
            ["i-projection-46-a"],
            5,
            actor_id=USER,
        )
        assert moved[0].comanda.mesa_id == 5

        view = build_table_family_view(db, TENANT, 5)
        assert len(view) == 1
        assert view[0]["numero_conta"] != 46
        assert view[0]["lancamentos"] == [
            pytest.approx(view[0]["lancamentos"][0], nan_ok=True)
        ] if False else view[0]["lancamentos"]
        assert len(view[0]["lancamentos"]) == 1
        projected = view[0]["lancamentos"][0]
        assert projected["pedido_id"] == "46-A"
        assert projected["lancamento_id"] == launch.id
        assert projected["transferido"] is True
        assert projected["atendimento_origem_id"] == identity.atendimento_id
        db.commit()
    finally:
        db.close()
