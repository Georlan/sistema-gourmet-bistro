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


def _launch(comanda_id: str, cliente: str = "Consumo Geral") -> dict:
    response = client.post(
        f"/comandas/{comanda_id}/lancamentos",
        headers=_headers(),
        json={
            "garcom_id": USER,
            "itens": [
                {
                    "produto_id": PRODUCT,
                    "observacao": "",
                    "cliente_nome": cliente,
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _families(mesa: int) -> list[dict]:
    response = client.get(f"/atendimentos/mesas/{mesa}", headers=_headers())
    assert response.status_code == 200, response.text
    return response.json()["familias"]


def test_busy_http_day_preserves_family_ids_and_atomic_table_semantics():
    # 18:00 — a mesma ocupação possui duas comandas (Consumo Geral + Cliente B),
    # mas UMA família humana e uma sequência única de pedidos.
    geral = _open(1)
    cliente_b = _open(1, "Cliente B")
    assert geral["numero_pedido"] == cliente_b["numero_pedido"]
    base46 = geral["numero_pedido"]

    first = _launch(geral["id"])
    second = _launch(cliente_b["id"], "Cliente B")
    table1 = _families(1)
    assert len(table1) == 1
    assert [launch["pedido_id"] for launch in table1[0]["lancamentos"]] == [
        f"{base46}-A",
        f"{base46}-B",
    ]

    # O fechamento é resolvido pela rota HTTP real; isso prova que o handler
    # novo está à frente do legado, porque somente ele injeta o ator da impressão.
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

    # 18:30 — M1 -> M2. Uma única chamada move TODAS as comandas da família.
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

    # Retry legado sobre a segunda comanda é idempotente, não uma segunda mutação.
    retry = client.post(
        f"/comandas/{cliente_b['id']}/transferir/2",
        headers=_headers(),
    )
    assert retry.status_code == 200, retry.text

    # 18:45 — M3 abre uma família independente.
    destino = _open(3)
    target_base = destino["numero_pedido"]
    _launch(destino["id"])

    # Transferência para mesa ocupada é proibida: exige a semântica explícita de Mesclar.
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

    # 19:00 — mesmo enviando a confirmação pela antiga comanda da família origem,
    # o NOVO pedido entra na família principal da mesa destino.
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

    db = SessionLocal()
    try:
        automatic = db.query(PrintJob).filter(
            PrintJob.restaurante_id == TENANT,
            PrintJob.source_id == new_after_merge["id"],
        ).first()
        assert automatic is not None
        assert f"PEDIDO: #{target_base}-B" in automatic.payload_text

        # Escolhe um item histórico da família incorporada para uma transferência parcial.
        first_item = db.query(Item).filter(
            Item.restaurante_id == TENANT,
            Item.lancamento_id == first["id"],
        ).first()
        assert first_item is not None
        first_item_id = first_item.id
    finally:
        db.close()

    # 19:20 — transferência parcial é uma única mutação HTTP em lote.
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

    # O lançamento técnico nunca foi renumerado/mutado.
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
