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
from app.services.atendimentos import (
    AtendimentoError,
    ensure_atendimento_for_comanda,
    ensure_launch_identity,
    format_order_family_id,
    merge_tables,
    principal_command_for_comanda,
    reconcile_table_principal,
    sequence_to_letters,
    transfer_group_by_comanda,
    transfer_items_batch,
    unmerge_by_comanda,
)


TENANT = 1960
USER = "usr-atendimento-1960"
CATEGORY = "cat-atendimento-1960"
PRODUCT = "prod-atendimento-1960"


@pytest.fixture(autouse=True)
def setup_atendimento_identity():
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

        db.add(Restaurante(id=TENANT, nome="Restaurante Família", plano="bistro"))
        db.flush()
        db.add(
            Usuario(
                id=USER,
                restaurante_id=TENANT,
                nome="Georlan Teste",
                email="atendimento-1960@test.local",
                role="caixa",
                status="ativo",
            )
        )
        db.add_all(
            [Mesa(id=mesa, restaurante_id=TENANT, capacidade=4, nome=f"Mesa {mesa}") for mesa in range(1, 9)]
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
                nome="Produto Família",
                preco=10.0,
                ativo=True,
            )
        )
        db.commit()
        yield
    finally:
        db.close()
        current_restaurante_id.reset(token)


def _command(db, command_id: str, mesa: int, numero: int) -> Comanda:
    command = Comanda(
        id=command_id,
        restaurante_id=TENANT,
        mesa_id=mesa,
        garcom_id=USER,
        tipo="Consumo no Local",
        numero_pedido=numero,
        fechada=False,
        criado_em=datetime.datetime(2026, 8, 16, 1, numero % 50),
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
        timestamp=datetime.datetime(2026, 8, 16, 1, 30) + datetime.timedelta(seconds=len(launch_id)),
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
            preco_unit=10.0,
            observacao="",
            cliente_nome="Consumo Geral",
            status="preparando",
            pago=False,
        )
    )
    db.flush()
    return launch


def test_excel_letters_do_not_have_artificial_26_limit():
    assert sequence_to_letters(1) == "A"
    assert sequence_to_letters(26) == "Z"
    assert sequence_to_letters(27) == "AA"
    assert sequence_to_letters(28) == "AB"
    assert sequence_to_letters(52) == "AZ"
    assert sequence_to_letters(53) == "BA"
    labels = {format_order_family_id(46, sequence) for sequence in range(1, 1001)}
    assert len(labels) == 1000


def test_two_comandas_same_family_share_one_letter_sequence():
    db = SessionLocal()
    try:
        first = _command(db, "c-fam-46-a", 1, 46)
        second = _command(db, "c-fam-46-b", 1, 46)
        launch_a = _launch(db, first, "l-fam-46-a", "i-fam-46-a")
        launch_b = _launch(db, second, "l-fam-46-b", "i-fam-46-b")

        identity_a = ensure_launch_identity(db, launch_a)
        identity_b = ensure_launch_identity(db, launch_b)
        db.commit()

        assert identity_a.label == "46-A"
        assert identity_b.label == "46-B"
        assert identity_a.atendimento_id == identity_b.atendimento_id
        assert db.query(AtendimentoMesa).filter(AtendimentoMesa.restaurante_id == TENANT).count() == 1
    finally:
        db.close()


def test_legacy_merge_materializes_two_families_without_collapsing_numbers():
    db = SessionLocal()
    try:
        destination = _command(db, "c-legacy-47", 2, 47)
        source = _command(db, "c-legacy-46", 2, 46)
        source.mesa_origem_id = 4
        launch47 = _launch(db, destination, "l-legacy-47-a", "i-legacy-47-a")
        launch46 = _launch(db, source, "l-legacy-46-a", "i-legacy-46-a")

        account47 = ensure_atendimento_for_comanda(db, destination)
        account46 = ensure_atendimento_for_comanda(db, source)
        assert account46.id != account47.id
        assert account47.numero_conta == 47
        assert account46.numero_conta == 46
        assert account47.principal_id is None
        assert account46.principal_id == account47.id
        assert ensure_launch_identity(db, launch47).label == "47-A"
        assert ensure_launch_identity(db, launch46).label == "46-A"

        # Mesmo que a UI entregue uma comanda da família incorporada, o próximo
        # clique em Confirmar deve ser direcionado para a família da mesa destino.
        principal_command = principal_command_for_comanda(db, TENANT, source.id, actor_id=USER)
        assert principal_command is not None
        assert principal_command.id == destination.id
        db.commit()
    finally:
        db.close()


def test_busy_table_flow_keeps_ids_stable_across_transfers_merge_and_unmerge():
    db = SessionLocal()
    try:
        family46_a = _command(db, "c-flow-46-a", 1, 46)
        family46_b = _command(db, "c-flow-46-b", 1, 46)
        launch46_a = _launch(db, family46_a, "l-flow-46-a", "i-flow-46-a")
        launch46_b = _launch(db, family46_b, "l-flow-46-b", "i-flow-46-b")
        id46_a = ensure_launch_identity(db, launch46_a)
        id46_b = ensure_launch_identity(db, launch46_b)

        # M1 -> M3 -> M4: a identidade humana não muda.
        transfer_group_by_comanda(db, TENANT, family46_a.id, 3, actor_id=USER)
        transfer_group_by_comanda(db, TENANT, family46_b.id, 4, actor_id=USER)
        assert family46_a.mesa_id == 4
        assert family46_b.mesa_id == 4
        assert ensure_launch_identity(db, launch46_a).label == id46_a.label == "46-A"
        assert ensure_launch_identity(db, launch46_b).label == id46_b.label == "46-B"

        family47 = _command(db, "c-flow-47", 2, 47)
        launch47_a = _launch(db, family47, "l-flow-47-a", "i-flow-47-a")
        id47_a = ensure_launch_identity(db, launch47_a)
        assert id47_a.label == "47-A"

        with pytest.raises(AtendimentoError) as blocked:
            transfer_group_by_comanda(db, TENANT, family46_a.id, 2, actor_id=USER)
        assert blocked.value.status_code == 409

        principal = merge_tables(db, TENANT, 4, 2, actor_id=USER)
        account46 = ensure_atendimento_for_comanda(db, family46_a)
        account47 = ensure_atendimento_for_comanda(db, family47)
        assert principal.id == account47.id
        assert account46.principal_id == account47.id
        assert family46_a.mesa_id == family46_b.mesa_id == family47.mesa_id == 2
        assert ensure_launch_identity(db, launch46_a).label == "46-A"

        launch47_b = _launch(db, family47, "l-flow-47-b", "i-flow-47-b")
        assert ensure_launch_identity(db, launch47_b).label == "47-B"

        # Grupo mesclado inteiro pode mudar fisicamente sem renumerar famílias.
        transfer_group_by_comanda(db, TENANT, family46_a.id, 8, actor_id=USER)
        assert family46_a.mesa_id == family46_b.mesa_id == family47.mesa_id == 8
        assert ensure_launch_identity(db, launch46_a).label == "46-A"
        assert ensure_launch_identity(db, launch47_b).label == "47-B"

        # Desmesclar #46 volta à origem da MESCLAGEM (M4), mesmo depois do grupo
        # ter sido transferido de M2 para M8.
        unmerge_by_comanda(db, TENANT, family46_a.id, actor_id=USER)
        assert family46_a.mesa_id == family46_b.mesa_id == 4
        assert family47.mesa_id == 8
        assert account46.principal_id is None

        moves46 = (
            db.query(MovimentoAtendimento)
            .filter(
                MovimentoAtendimento.restaurante_id == TENANT,
                MovimentoAtendimento.atendimento_id == account46.id,
            )
            .order_by(MovimentoAtendimento.id.asc())
            .all()
        )
        transfers = [(move.mesa_origem_id, move.mesa_destino_id) for move in moves46 if move.tipo == "transferencia"]
        assert (1, 3) in transfers
        assert (3, 4) in transfers
        assert (2, 8) in transfers
        assert any(move.tipo == "mesclagem" for move in moves46)
        assert any(move.tipo == "desmesclagem" for move in moves46)
        db.commit()
    finally:
        db.close()


def test_surviving_family_is_promoted_if_destination_family_closes():
    db = SessionLocal()
    try:
        source = _command(db, "c-promote-46", 4, 46)
        destination = _command(db, "c-promote-47", 2, 47)
        launch46_a = _launch(db, source, "l-promote-46-a", "i-promote-46-a")
        _launch(db, destination, "l-promote-47-a", "i-promote-47-a")
        ensure_launch_identity(db, launch46_a)
        ensure_atendimento_for_comanda(db, destination)
        merge_tables(db, TENANT, 4, 2, actor_id=USER)

        account46 = ensure_atendimento_for_comanda(db, source)
        account47 = ensure_atendimento_for_comanda(db, destination)
        assert account46.principal_id == account47.id

        destination.fechada = True
        destination.fechado_em = datetime.datetime.now(datetime.timezone.utc)
        db.flush()
        new_root = reconcile_table_principal(db, TENANT, 2, actor_id=USER)
        assert new_root is not None
        assert new_root.id == account46.id
        assert account46.principal_id is None
        assert account47.status == "fechado"

        launch46_b = _launch(db, source, "l-promote-46-b", "i-promote-46-b")
        assert ensure_launch_identity(db, launch46_b).label == "46-B"
        assert principal_command_for_comanda(db, TENANT, source.id, actor_id=USER).id == source.id
        assert db.query(MovimentoAtendimento).filter(
            MovimentoAtendimento.restaurante_id == TENANT,
            MovimentoAtendimento.atendimento_id == account46.id,
            MovimentoAtendimento.tipo == "promocao_principal",
        ).count() == 1
        db.commit()
    finally:
        db.close()


def test_batch_item_transfer_preserves_original_order_identity_and_is_atomic_on_validation():
    db = SessionLocal()
    try:
        command = _command(db, "c-item-46", 1, 46)
        launch = _launch(db, command, "l-item-46-a", "i-item-46-a")
        second_item = Item(
            id="i-item-46-b",
            restaurante_id=TENANT,
            comanda_id=command.id,
            lancamento_id=launch.id,
            produto_id=PRODUCT,
            preco_unit=10.0,
            observacao="",
            cliente_nome="Consumo Geral",
            status="preparando",
            pago=False,
        )
        db.add(second_item)
        db.flush()
        original = ensure_launch_identity(db, launch)

        moved = transfer_items_batch(
            db,
            TENANT,
            ["i-item-46-a", "i-item-46-b"],
            5,
            actor_id=USER,
        )
        db.flush()
        assert {item.comanda.mesa_id for item in moved} == {5}
        assert all(item.lancamento_id == launch.id for item in moved)
        assert ensure_launch_identity(db, launch).label == original.label == "46-A"

        command2 = _command(db, "c-item-60", 6, 60)
        launch2 = _launch(db, command2, "l-item-60-a", "i-item-60-a")
        ensure_launch_identity(db, launch2)
        before = db.query(Item).filter(Item.id == "i-item-60-a").one().comanda_id
        with pytest.raises(AtendimentoError):
            transfer_items_batch(
                db,
                TENANT,
                ["i-item-60-a", "item-inexistente"],
                7,
                actor_id=USER,
            )
        after = db.query(Item).filter(Item.id == "i-item-60-a").one().comanda_id
        assert after == before
        db.rollback()
    finally:
        db.close()
