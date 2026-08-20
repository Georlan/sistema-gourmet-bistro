import datetime

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    ConfiguracaoRestaurante,
    Item,
    Lancamento,
    Mesa,
    PrintJob,
    Produto,
    Restaurante,
    Usuario,
)
from app.operational_models import (
    AtendimentoComanda,
    AtendimentoMesa,
    LancamentoIdentidade,
    MovimentoAtendimento,
    NumeradorOperacional,
)
from app.security import create_access_token


TENANT = 1970
USER = "usr-atendimento-http-1970"
PRODUCT = "prod-atendimento-http-1970"
CATEGORY = "cat-atendimento-http-1970"

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_http_flow():
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(TENANT)
    db = SessionLocal()
    try:
        db.query(PrintJob).filter(PrintJob.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(MovimentoAtendimento).filter(MovimentoAtendimento.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(LancamentoIdentidade).filter(LancamentoIdentidade.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(AtendimentoComanda).filter(AtendimentoComanda.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(AtendimentoMesa).filter(AtendimentoMesa.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(NumeradorOperacional).filter(NumeradorOperacional.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Item).filter(Item.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Lancamento).filter(Lancamento.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Comanda).filter(Comanda.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Produto).filter(Produto.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Categoria).filter(Categoria.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Mesa).filter(Mesa.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Usuario).filter(Usuario.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == TENANT).delete(synchronize_session=False)
        db.commit()

        db.add(Restaurante(id=TENANT, nome="Restaurante HTTP", plano="bistro"))
        db.flush()
        db.add(
            Usuario(
                id=USER,
                restaurante_id=TENANT,
                nome="Operador HTTP",
                email="operador-http-1970@test.local",
                role="caixa",
                status="ativo",
            )
        )
        db.add_all(
            [Mesa(id=mesa, restaurante_id=TENANT, capacidade=4, nome=f"Mesa {mesa}") for mesa in range(1, 6)]
        )
        db.add(
            Categoria(
                id=CATEGORY,
                restaurante_id=TENANT,
                nome="Cozinha HTTP",
                destino_impressao="COZINHA",
            )
        )
        db.add(
            Produto(
                id=PRODUCT,
                restaurante_id=TENANT,
                categoria_id=CATEGORY,
                nome="Produto HTTP",
                preco=15.0,
                ativo=True,
            )
        )
        db.add(
            ConfiguracaoRestaurante(
                restaurante_id=TENANT,
                taxa_servico_ativa=False,
                perm_garcom_print=True,
                perm_garcom_editar=True,
                perm_garcom_transferir_mesa=True,
                perm_garcom_transferir_item=True,
                impressao_nome_restaurante="Restaurante HTTP",
            )
        )
        db.add(
            CaixaTurno(
                restaurante_id=TENANT,
                aberto_por_id=USER,
                saldo_inicial=0,
                status="aberto",
            )
        )
        db.commit()
        yield
    finally:
        db.close()
        current_restaurante_id.reset(token)


def _headers():
    token = create_access_token(subject=USER, restaurante_id=TENANT, role="caixa")
    return {"Authorization": f"Bearer {token}"}


def _open(mesa: int, identificador: str | None = None) -> dict:
    response = client.post(
        "/comandas/",
        headers=_headers(),
        json={
            "mesa_id": mesa,
            "garcom_id": USER,
            "tipo": "Consumo no Local",
            "identificador": identificador,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _launch_items(
    comanda_id: str,
    observations: list[str],
    cliente: str = "Consumo Geral",
    idempotency_key: str | None = None,
) -> dict:
    response = client.post(
        f"/comandas/{comanda_id}/lancamentos",
        headers=_headers(),
        json={
            "garcom_id": USER,
            "idempotency_key": idempotency_key,
            "itens": [
                {
                    "produto_id": PRODUCT,
                    "observacao": observation,
                    "cliente_nome": cliente,
                }
                for observation in observations
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_launch_retry_is_idempotent_and_rejects_payload_reuse():
    command = _open(1)
    key = "field-test-launch-retry-1970"

    first = _launch_items(command["id"], ["Sem cebola"], idempotency_key=key)
    replay = _launch_items(command["id"], ["Sem cebola"], idempotency_key=key)

    assert replay["id"] == first["id"]
    db = SessionLocal()
    try:
        launches = db.query(Lancamento).filter(
            Lancamento.restaurante_id == TENANT,
            Lancamento.idempotency_key == key,
        ).all()
        assert len(launches) == 1
        assert len(launches[0].itens) == 1

        print_jobs = db.query(PrintJob).filter(
            PrintJob.restaurante_id == TENANT,
            PrintJob.source_id == first["id"],
        ).all()
        assert len(print_jobs) == 1
    finally:
        db.close()

    conflict = client.post(
        f"/comandas/{command['id']}/lancamentos",
        headers=_headers(),
        json={
            "garcom_id": USER,
            "idempotency_key": key,
            "itens": [
                {
                    "produto_id": PRODUCT,
                    "observacao": "Com cebola",
                    "cliente_nome": "Consumo Geral",
                }
            ],
        },
    )
    assert conflict.status_code == 409, conflict.text


def test_compressed_five_hour_shift_keeps_retries_single():
    """Simula um lançamento a cada cinco minutos e uma resposta perdida."""
    command = _open(1)
    launch_ids: list[str] = []

    for cycle in range(60):
        key = f"field-shift-1970-{cycle:03d}"
        observation = f"Ciclo operacional {cycle:03d}"
        first = _launch_items(command["id"], [observation], idempotency_key=key)
        replay = _launch_items(command["id"], [observation], idempotency_key=key)
        assert replay["id"] == first["id"]
        launch_ids.append(first["id"])

    db = SessionLocal()
    try:
        launches = db.query(Lancamento).filter(
            Lancamento.restaurante_id == TENANT,
            Lancamento.idempotency_key.like("field-shift-1970-%"),
        ).all()
        items = db.query(Item).filter(
            Item.restaurante_id == TENANT,
            Item.lancamento_id.in_(launch_ids),
        ).all()
        print_jobs = db.query(PrintJob).filter(
            PrintJob.restaurante_id == TENANT,
            PrintJob.source_id.in_(launch_ids),
        ).all()

        assert len(launches) == 60
        assert len(items) == 60
        assert len(print_jobs) == 60
    finally:
        db.close()


def _launch(comanda_id: str, cliente: str = "Consumo Geral") -> dict:
    return _launch_items(comanda_id, [""], cliente)


def _families(mesa: int) -> list[dict]:
    response = client.get(f"/atendimentos/mesas/{mesa}", headers=_headers())
    assert response.status_code == 200, response.text
    return response.json()["familias"]


def _latest_job_for_source(source_id: str) -> PrintJob:
    db = SessionLocal()
    try:
        job = (
            db.query(PrintJob)
            .filter(
                PrintJob.restaurante_id == TENANT,
                PrintJob.source_id == source_id,
            )
            .order_by(PrintJob.created_at.desc(), PrintJob.id.desc())
            .first()
        )
        assert job is not None
        db.expunge(job)
        return job
    finally:
        db.close()


def test_busy_http_day_preserves_family_ids_and_atomic_table_semantics():
    # 18:00 — duas comandas da mesma ocupação compartilham UMA família humana.
    geral = _open(1)
    cliente_b = _open(1, "Cliente B")
    assert geral["numero_pedido"] == cliente_b["numero_pedido"]
    base46 = geral["numero_pedido"]

    first = _launch(geral["id"])
    _launch(cliente_b["id"], "Cliente B")
    table1 = _families(1)
    assert len(table1) == 1
    assert [launch["pedido_id"] for launch in table1[0]["lancamentos"]] == [
        f"{base46}-A",
        f"{base46}-B",
    ]

    # A rota HTTP real de fechamento precisa conhecer o operador que imprimiu.
    closing = client.post(
        "/mesas/1/imprimir-recibo",
        params={"apenas_valores": "true"},
        headers=_headers(),
    )
    assert closing.status_code == 200, closing.text
    db = SessionLocal()
    try:
        closing_job = (
            db.query(PrintJob)
            .filter(
                PrintJob.restaurante_id == TENANT,
                PrintJob.document_type == "fechamento",
            )
            .order_by(PrintJob.created_at.desc(), PrintJob.id.desc())
            .first()
        )
        assert closing_job is not None
        assert f"CONTA: #{base46}" in closing_job.payload_text
        assert "IMPRESSO POR: OPERADOR HTTP" in closing_job.payload_text
    finally:
        db.close()

    # M1 -> M2: uma única chamada move TODAS as comandas da família.
    transferred = client.post(
        f"/comandas/{geral['id']}/transferir/2",
        headers=_headers(),
    )
    assert transferred.status_code == 200, transferred.text
    db = SessionLocal()
    try:
        rows = db.query(Comanda).filter(
            Comanda.restaurante_id == TENANT,
            Comanda.id.in_([geral["id"], cliente_b["id"]]),
        ).all()
        assert {row.mesa_id for row in rows} == {2}
    finally:
        db.close()

    # Retry legado sobre a segunda comanda não causa uma segunda mutação.
    retry = client.post(
        f"/comandas/{cliente_b['id']}/transferir/2",
        headers=_headers(),
    )
    assert retry.status_code == 200, retry.text

    # M3 abre uma família independente.
    destino = _open(3)
    target_base = destino["numero_pedido"]
    _launch(destino["id"])

    # Destino ocupado exige Mesclar, nunca uma transferência implícita.
    blocked = client.post(
        f"/comandas/{geral['id']}/transferir/3",
        headers=_headers(),
    )
    assert blocked.status_code == 409, blocked.text

    merged = client.post(
        "/comandas/mesclar",
        params={"mesa_origem_id": 2, "mesa_destino_id": 3},
        headers=_headers(),
    )
    assert merged.status_code == 200, merged.text
    families_after_merge = _families(3)
    assert {family["numero_conta"] for family in families_after_merge} == {base46, target_base}
    principal = next(family for family in families_after_merge if family["principal"])
    assert principal["numero_conta"] == target_base

    # Mesmo confirmando pela antiga Comanda #46, o novo pedido entra na família
    # principal da mesa destino.
    new_after_merge = _launch(geral["id"])
    families_after_new = _families(3)
    target_family = next(
        family for family in families_after_new if family["numero_conta"] == target_base
    )
    assert [row["pedido_id"] for row in target_family["lancamentos"]] == [
        f"{target_base}-A",
        f"{target_base}-B",
    ]
    source_family = next(
        family for family in families_after_new if family["numero_conta"] == base46
    )
    assert [row["pedido_id"] for row in source_family["lancamentos"]] == [
        f"{base46}-A",
        f"{base46}-B",
    ]

    automatic = _latest_job_for_source(new_after_merge["id"])
    assert f"PEDIDO: #{target_base}-B" in automatic.payload_text

    # Transfere um item histórico da família incorporada para uma mesa vazia.
    db = SessionLocal()
    try:
        first_item = db.query(Item).filter(
            Item.restaurante_id == TENANT,
            Item.lancamento_id == first["id"],
        ).first()
        assert first_item is not None
        first_item_id = first_item.id
    finally:
        db.close()

    moved = client.post(
        "/comandas/itens/transferir-lote/4",
        headers=_headers(),
        json={"item_ids": [first_item_id]},
    )
    assert moved.status_code == 200, moved.text
    table4 = _families(4)
    assert len(table4) == 1
    projected = table4[0]["lancamentos"]
    assert len(projected) == 1
    assert projected[0]["pedido_id"] == f"{base46}-A"
    assert projected[0]["transferido"] is True

    db = SessionLocal()
    try:
        moved_item = db.query(Item).filter(
            Item.restaurante_id == TENANT,
            Item.id == first_item_id,
        ).one()
        assert moved_item.lancamento_id == first["id"]
        assert moved_item.comanda.mesa_id == 4
    finally:
        db.close()

    # Cria um único Pedido com dois itens e depois divide fisicamente esse mesmo
    # lançamento entre M3 e M5. As duas vias devem manter o MESMO ID humano, mas
    # cada botão reimprime apenas o fragmento da mesa onde o card está aberto.
    split_launch = _launch_items(
        destino["id"],
        ["FICA NA MESA 3", "VAI PARA MESA 5"],
    )
    families_before_split = _families(3)
    target_family = next(
        family for family in families_before_split if family["numero_conta"] == target_base
    )
    split_label = next(
        row["pedido_id"]
        for row in target_family["lancamentos"]
        if row["lancamento_id"] == split_launch["id"]
    )
    assert split_label == f"{target_base}-C"

    db = SessionLocal()
    try:
        split_items = db.query(Item).filter(
            Item.restaurante_id == TENANT,
            Item.lancamento_id == split_launch["id"],
        ).order_by(Item.id.asc()).all()
        assert len(split_items) == 2
        item_to_move = next(
            item for item in split_items if item.observacao == "VAI PARA MESA 5"
        )
        item_to_move_id = item_to_move.id
    finally:
        db.close()

    move_split = client.post(
        "/comandas/itens/transferir-lote/5",
        headers=_headers(),
        json={"item_ids": [item_to_move_id]},
    )
    assert move_split.status_code == 200, move_split.text

    ambiguous = client.post(
        f"/comandas/lancamentos/{split_launch['id']}/reimprimir",
        headers=_headers(),
    )
    assert ambiguous.status_code == 409, ambiguous.text

    reprint_m3 = client.post(
        f"/comandas/lancamentos/{split_launch['id']}/reimprimir",
        params={"mesa_id": 3},
        headers=_headers(),
    )
    assert reprint_m3.status_code == 200, reprint_m3.text
    payload_m3 = _latest_job_for_source(split_launch["id"]).payload_text
    assert f"PEDIDO: #{split_label}" in payload_m3
    assert "MESA: 3" in payload_m3
    assert "FICA NA MESA 3" in payload_m3
    assert "VAI PARA MESA 5" not in payload_m3

    reprint_m5 = client.post(
        f"/comandas/lancamentos/{split_launch['id']}/reimprimir",
        params={"mesa_id": 5},
        headers=_headers(),
    )
    assert reprint_m5.status_code == 200, reprint_m5.text
    payload_m5 = _latest_job_for_source(split_launch["id"]).payload_text
    assert f"PEDIDO: #{split_label}" in payload_m5
    assert "MESA: 5" in payload_m5
    assert "VAI PARA MESA 5" in payload_m5
    assert "FICA NA MESA 3" not in payload_m5
