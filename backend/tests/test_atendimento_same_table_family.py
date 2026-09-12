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


TENANT = 1972
USER = "usr-atendimento-same-table-1972"
PRODUCT = "prod-atendimento-same-table-1972"
CATEGORY = "cat-atendimento-same-table-1972"
client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_same_table_family():
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

        db.add(Restaurante(id=TENANT, nome="Restaurante Same Table", plano="bistro"))
        db.flush()
        db.add(
            Usuario(
                id=USER,
                restaurante_id=TENANT,
                nome="Caixa Same Table",
                email="same-table-1972@test.local",
                role="caixa",
                status="ativo",
            )
        )
        db.add(Mesa(id=1, restaurante_id=TENANT, capacidade=4, nome="Mesa 1"))
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
                nome="Produto Same Table",
                preco=20.0,
                ativo=True,
            )
        )
        db.add(
            ConfiguracaoRestaurante(
                restaurante_id=TENANT,
                taxa_servico_ativa=False,
                perm_garcom_print=True,
                perm_garcom_editar=True,
                impressao_nome_restaurante="Restaurante Same Table",
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


def _families() -> list[dict]:
    response = client.get("/atendimentos/mesas/1", headers=_headers())
    assert response.status_code == 200, response.text
    return response.json()["familias"]


def test_direct_sale_on_occupied_table_keeps_base_number_and_advances_letter():
    opened = client.post(
        "/comandas/",
        headers=_headers(),
        json={"mesa_id": 1, "garcom_id": USER, "tipo": "Consumo no Local"},
    )
    assert opened.status_code == 201, opened.text
    first_command = opened.json()
    base = first_command["numero_pedido"]

    first_launch = client.post(
        f"/comandas/{first_command['id']}/lancamentos",
        headers=_headers(),
        json={
            "garcom_id": USER,
            "itens": [
                {
                    "produto_id": PRODUCT,
                    "observacao": "PRIMEIRO LOTE",
                    "cliente_nome": "Consumo Geral",
                }
            ],
        },
    )
    assert first_launch.status_code == 201, first_launch.text

    sale = client.post(
        "/comandas/venda-direta",
        headers=_headers(),
        json={
            "mesa_id": 1,
            "garcom_id": USER,
            "tipo": "Mesa",
            "identificador": None,
            "itens": [
                {
                    "produto_id": PRODUCT,
                    "observacao": "SEGUNDO LOTE",
                    "cliente_nome": "Consumo Geral",
                }
            ],
        },
    )
    assert sale.status_code == 201, sale.text
    second_command = sale.json()
    assert second_command["numero_pedido"] == base

    families = _families()
    assert len(families) == 1
    assert families[0]["numero_conta"] == base
    assert [entry["pedido_id"] for entry in families[0]["lancamentos"]] == [
        f"{base}-A",
        f"{base}-B",
    ]

    second_launch_id = next(
        entry["lancamento_id"]
        for entry in families[0]["lancamentos"]
        if entry["pedido_id"] == f"{base}-B"
    )
    db = SessionLocal()
    try:
        job = db.query(PrintJob).filter(
            PrintJob.restaurante_id == TENANT,
            PrintJob.source_id == second_launch_id,
        ).first()
        assert job is not None
        assert f"PEDIDO #{base}-B" in job.payload_text
        assert "SEGUNDO LOTE" in job.payload_text
    finally:
        db.close()
