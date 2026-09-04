import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.financial_models import PagamentoAlocacao
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    ConfiguracaoRestaurante,
    Item,
    Lancamento,
    Mesa,
    Pagamento,
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


TENANT = 1971
USER = "usr-atendimento-caixa-1971"
PRODUCT = "prod-atendimento-caixa-1971"
CATEGORY = "cat-atendimento-caixa-1971"
client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_cashier_merge():
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
        db.query(PagamentoAlocacao).filter(PagamentoAlocacao.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Pagamento).filter(Pagamento.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Comanda).filter(Comanda.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Produto).filter(Produto.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Categoria).filter(Categoria.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Mesa).filter(Mesa.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Usuario).filter(Usuario.restaurante_id == TENANT).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == TENANT).delete(synchronize_session=False)
        db.commit()

        db.add(Restaurante(id=TENANT, nome="Restaurante Caixa Merge", plano="bistro"))
        db.flush()
        db.add(
            Usuario(
                id=USER,
                restaurante_id=TENANT,
                nome="Caixa Merge",
                email="caixa-merge-1971@test.local",
                role="caixa",
                status="ativo",
            )
        )
        db.add_all(
            [Mesa(id=mesa, restaurante_id=TENANT, capacidade=4, nome=f"Mesa {mesa}") for mesa in (1, 2)]
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
                nome="Produto Caixa Merge",
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
                perm_garcom_transferir_mesa=True,
                perm_garcom_transferir_item=True,
                impressao_nome_restaurante="Restaurante Caixa Merge",
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


def _open_and_launch(mesa: int) -> tuple[dict, dict]:
    opened = client.post(
        "/comandas/",
        headers=_headers(),
        json={"mesa_id": mesa, "garcom_id": USER, "tipo": "Consumo no Local"},
    )
    assert opened.status_code == 201, opened.text
    command = opened.json()
    launched = client.post(
        f"/comandas/{command['id']}/lancamentos",
        headers=_headers(),
        json={
            "garcom_id": USER,
            "itens": [{"produto_id": PRODUCT, "observacao": "", "cliente_nome": "Consumo Geral"}],
        },
    )
    assert launched.status_code == 201, launched.text
    return command, launched.json()


def _families(mesa: int) -> list[dict]:
    response = client.get(f"/atendimentos/mesas/{mesa}", headers=_headers())
    assert response.status_code == 200, response.text
    return response.json()["familias"]


def test_cashier_direct_sale_after_merge_uses_destination_family_and_next_letter():
    source, _ = _open_and_launch(1)
    destination, _ = _open_and_launch(2)
    source_base = source["numero_pedido"]
    destination_base = destination["numero_pedido"]
    assert source_base != destination_base

    merged = client.post(
        "/comandas/mesclar",
        params={"mesa_origem_id": 1, "mesa_destino_id": 2},
        headers=_headers(),
    )
    assert merged.status_code == 200, merged.text

    sale = client.post(
        "/comandas/venda-direta",
        headers=_headers(),
        json={
            "mesa_id": 2,
            "garcom_id": USER,
            "tipo": "Mesa",
            "identificador": None,
            "itens": [
                {
                    "produto_id": PRODUCT,
                    "observacao": "CAIXA APÓS MESCLAGEM",
                    "cliente_nome": "Consumo Geral",
                }
            ],
        },
    )
    assert sale.status_code == 201, sale.text
    created = sale.json()
    assert created["numero_pedido"] == destination_base
    assert created["mesa_id"] == 2

    families = _families(2)
    assert {family["numero_conta"] for family in families} == {source_base, destination_base}
    source_family = next(family for family in families if family["numero_conta"] == source_base)
    destination_family = next(family for family in families if family["numero_conta"] == destination_base)
    assert [entry["pedido_id"] for entry in source_family["lancamentos"]] == [f"{source_base}-A"]
    assert [entry["pedido_id"] for entry in destination_family["lancamentos"]] == [
        f"{destination_base}-A",
        f"{destination_base}-B",
    ]

    latest_launch_id = next(
        entry["lancamento_id"]
        for entry in destination_family["lancamentos"]
        if entry["pedido_id"] == f"{destination_base}-B"
    )
    db = SessionLocal()
    try:
        job = db.query(PrintJob).filter(
            PrintJob.restaurante_id == TENANT,
            PrintJob.source_id == latest_launch_id,
        ).first()
        assert job is not None
        assert f"PEDIDO #{destination_base}-B" in job.payload_text
        assert "CAIXA APÓS MESCLAGEM" in job.payload_text
    finally:
        db.close()


def test_merge_then_payment_preserves_accounts_reconciles_and_does_not_reprint():
    source, _ = _open_and_launch(1)
    destination, _ = _open_and_launch(2)
    source_base = source["numero_pedido"]
    destination_base = destination["numero_pedido"]
    assert source_base != destination_base

    db = SessionLocal()
    try:
        print_jobs_before = db.query(PrintJob).filter(
            PrintJob.restaurante_id == TENANT
        ).count()
        assert print_jobs_before == 2
    finally:
        db.close()

    merged = client.post(
        "/comandas/mesclar",
        params={"mesa_origem_id": 1, "mesa_destino_id": 2},
        headers=_headers(),
    )
    assert merged.status_code == 200, merged.text

    families = _families(2)
    assert {family["numero_conta"] for family in families} == {
        source_base,
        destination_base,
    }

    payment_payload = {
        "valor": 40.0,
        "metodo": "pix",
        "incluir_taxa_servico": False,
        "idempotency_key": "merge-stage-cross-payment-1971",
    }
    paid = client.post(
        "/caixa/mesas/2/pagar",
        headers=_headers(),
        json=payment_payload,
    )
    assert paid.status_code == 201, paid.text
    payment = paid.json()
    assert payment["valor"] == 40.0
    assert payment["status"] == "aprovado"

    # Retry após a quitação da mesa precisa retornar o mesmo evento financeiro,
    # não criar uma segunda receita nem novas alocações.
    repeated = client.post(
        "/caixa/mesas/2/pagar",
        headers=_headers(),
        json=payment_payload,
    )
    assert repeated.status_code == 201, repeated.text
    assert repeated.json()["id"] == payment["id"]

    db = SessionLocal()
    try:
        payment_rows = db.query(Pagamento).filter(
            Pagamento.restaurante_id == TENANT,
            Pagamento.id == payment["id"],
        ).all()
        assert len(payment_rows) == 1

        allocations = db.query(PagamentoAlocacao).filter(
            PagamentoAlocacao.restaurante_id == TENANT,
            PagamentoAlocacao.pagamento_id == payment["id"],
        ).all()
        assert len(allocations) == 2
        assert sum(float(row.valor) for row in allocations) == 40.0
        assert sorted(float(row.valor) for row in allocations) == [20.0, 20.0]

        expected_accounts = db.query(AtendimentoMesa).filter(
            AtendimentoMesa.restaurante_id == TENANT,
            AtendimentoMesa.numero_conta.in_([source_base, destination_base]),
        ).all()
        assert len(expected_accounts) == 2
        assert {row.atendimento_id for row in allocations} == {
            account.id for account in expected_accounts
        }

        commands = db.query(Comanda).filter(
            Comanda.restaurante_id == TENANT,
            Comanda.id.in_([source["id"], destination["id"]]),
        ).all()
        assert len(commands) == 2
        assert all(command.mesa_id == 2 for command in commands)
        assert all(command.fechada is True for command in commands)

        # Mesclar e pagar não são eventos de produção. As duas vias automáticas
        # originais continuam sendo as únicas vias de cozinha geradas.
        assert db.query(PrintJob).filter(
            PrintJob.restaurante_id == TENANT
        ).count() == print_jobs_before
    finally:
        db.close()

    summary = client.get("/caixa/turno-atual/resumo", headers=_headers())
    assert summary.status_code == 200, summary.text
    summary_data = summary.json()
    assert summary_data["total_vendas"] == 40.0
    assert summary_data["total_pix"] == 40.0
    assert summary_data["total_dinheiro"] == 0.0
    assert summary_data["total_cartao"] == 0.0
    assert summary_data["total_pedidos_pagos"] == 1

    # A camada ORM da Etapa 2 também deve isolar os modelos financeiros criados
    # na Etapa 3. Um tenant diferente não enxerga pagamento nem alocações.
    other_tenant = TENANT + 1
    context_token = current_restaurante_id.set(other_tenant)
    other_db = SessionLocal(restaurante_id=other_tenant)
    try:
        assert other_db.query(Pagamento).filter(
            Pagamento.id == payment["id"]
        ).count() == 0
        assert other_db.query(PagamentoAlocacao).filter(
            PagamentoAlocacao.pagamento_id == payment["id"]
        ).count() == 0
    finally:
        other_db.close()
        current_restaurante_id.reset(context_token)
