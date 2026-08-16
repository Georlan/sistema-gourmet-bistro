import datetime

import pytest
from fastapi.testclient import TestClient

import app.printer_service as printer_module
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
from app.security import create_access_token
from app.services.printing import enqueue_table_receipt


TENANT_ID = 1881
OTHER_TENANT_ID = 1882
MESA_ID = 1881
OTHER_MESA_ID = 1882
USER_ID = "usr-print-arch-1881"
CAIXA_ID = "caixa-print-arch-1881"
PRODUTO_1 = "prod-print-arch-1"
PRODUTO_2 = "prod-print-arch-2"
PRODUTO_SEM_IMPRESSAO_1 = "prod-print-arch-none-1"
PRODUTO_SEM_IMPRESSAO_2 = "prod-print-arch-none-2"
CATEGORIA_ID = "cat-print-arch"
CATEGORIA_SEM_IMPRESSAO_ID = "cat-print-arch-none"

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_printing_architecture(monkeypatch):
    Base.metadata.create_all(bind=engine)
    fixed_now = datetime.datetime(2026, 8, 15, 21, 30, tzinfo=datetime.timezone(datetime.timedelta(hours=-3)))
    monkeypatch.setattr(printer_module, "get_operational_now", lambda: fixed_now)

    token = current_restaurante_id.set(TENANT_ID)
    db = SessionLocal()
    try:
        db.query(PrintJob).filter(PrintJob.restaurante_id.in_([TENANT_ID, OTHER_TENANT_ID])).delete(synchronize_session=False)
        db.query(Item).filter(Item.restaurante_id.in_([TENANT_ID, OTHER_TENANT_ID])).delete(synchronize_session=False)
        db.query(Lancamento).filter(Lancamento.restaurante_id.in_([TENANT_ID, OTHER_TENANT_ID])).delete(synchronize_session=False)
        db.query(Comanda).filter(Comanda.restaurante_id.in_([TENANT_ID, OTHER_TENANT_ID])).delete(synchronize_session=False)
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id.in_([TENANT_ID, OTHER_TENANT_ID])).delete(synchronize_session=False)
        db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id.in_([TENANT_ID, OTHER_TENANT_ID])).delete(synchronize_session=False)
        db.query(Produto).filter(Produto.restaurante_id.in_([TENANT_ID, OTHER_TENANT_ID])).delete(synchronize_session=False)
        db.query(Categoria).filter(Categoria.restaurante_id.in_([TENANT_ID, OTHER_TENANT_ID])).delete(synchronize_session=False)
        db.query(Mesa).filter(Mesa.id.in_([MESA_ID, OTHER_MESA_ID])).delete(synchronize_session=False)
        db.query(Usuario).filter(Usuario.id.in_([USER_ID, CAIXA_ID, "usr-print-arch-1882"])).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id.in_([TENANT_ID, OTHER_TENANT_ID])).delete(synchronize_session=False)
        db.commit()

        db.add_all([
            Restaurante(id=TENANT_ID, nome="Bistrô Arquitetura", plano="bistro"),
            Restaurante(id=OTHER_TENANT_ID, nome="Outro Bistrô", plano="bistro"),
        ])
        db.flush()
        db.add_all([
            Usuario(
                id=USER_ID,
                restaurante_id=TENANT_ID,
                nome="Garçom Arquitetura",
                email="garcom-print-arch@teste.local",
                role="garcom",
                status="ativo",
            ),
            Usuario(
                id=CAIXA_ID,
                restaurante_id=TENANT_ID,
                nome="Caixa Arquitetura",
                email="caixa-print-arch@teste.local",
                role="caixa",
                status="ativo",
            ),
            Usuario(
                id="usr-print-arch-1882",
                restaurante_id=OTHER_TENANT_ID,
                nome="Outro Operador",
                email="outro-print-arch@teste.local",
                role="caixa",
                status="ativo",
            ),
        ])
        db.add_all([
            Mesa(id=MESA_ID, restaurante_id=TENANT_ID, capacidade=4, nome="Mesa Arquitetura"),
            Mesa(id=OTHER_MESA_ID, restaurante_id=OTHER_TENANT_ID, capacidade=4, nome="Mesa Outro Tenant"),
        ])
        db.add_all([
            Categoria(
                id=CATEGORIA_ID,
                restaurante_id=TENANT_ID,
                nome="Lanches",
                destino_impressao="COZINHA",
            ),
            Categoria(
                id=CATEGORIA_SEM_IMPRESSAO_ID,
                restaurante_id=TENANT_ID,
                nome="Bebidas sem via própria",
                destino_impressao="NENHUM",
            ),
            Produto(
                id=PRODUTO_1,
                restaurante_id=TENANT_ID,
                categoria_id=CATEGORIA_ID,
                nome="Hambúrguer Arquitetura",
                preco=19.0,
                ativo=True,
            ),
            Produto(
                id=PRODUTO_2,
                restaurante_id=TENANT_ID,
                categoria_id=CATEGORIA_ID,
                nome="Cheese Arquitetura",
                preco=25.0,
                ativo=True,
            ),
            Produto(
                id=PRODUTO_SEM_IMPRESSAO_1,
                restaurante_id=TENANT_ID,
                categoria_id=CATEGORIA_SEM_IMPRESSAO_ID,
                nome="Coca Cola Lata",
                preco=6.0,
                ativo=True,
            ),
            Produto(
                id=PRODUTO_SEM_IMPRESSAO_2,
                restaurante_id=TENANT_ID,
                categoria_id=CATEGORIA_SEM_IMPRESSAO_ID,
                nome="Água Mineral",
                preco=4.0,
                ativo=True,
            ),
        ])
        db.add(ConfiguracaoRestaurante(
            restaurante_id=TENANT_ID,
            taxa_servico_ativa=False,
            taxa_servico_padrao=10.0,
            perm_garcom_print=True,
            perm_garcom_editar=True,
            impressao_nome_restaurante="Bistrô Arquitetura",
            impressao_nome_posicao="cabecalho",
        ))
        db.add(CaixaTurno(
            restaurante_id=TENANT_ID,
            aberto_por_id=CAIXA_ID,
            saldo_inicial=0,
            status="aberto",
        ))
        db.commit()
        yield
    finally:
        db.close()
        current_restaurante_id.reset(token)


def _headers(user_id: str, role: str = "garcom", restaurante_id: int = TENANT_ID):
    token = create_access_token(
        subject=user_id,
        restaurante_id=restaurante_id,
        role=role,
    )
    return {"Authorization": f"Bearer {token}"}


def _open_table_order() -> str:
    response = client.post(
        "/comandas/",
        headers=_headers(USER_ID),
        json={
            "mesa_id": MESA_ID,
            "garcom_id": USER_ID,
            "tipo": "Consumo no Local",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _launch_items(
    comanda_id: str,
    produto_ids: list[str],
    cliente: str = "Consumo Geral",
) -> str:
    response = client.post(
        f"/comandas/{comanda_id}/lancamentos",
        headers=_headers(USER_ID),
        json={
            "garcom_id": USER_ID,
            "itens": [
                {
                    "produto_id": produto_id,
                    "observacao": "",
                    "cliente_nome": cliente,
                }
                for produto_id in produto_ids
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _launch(comanda_id: str, produto_id: str, cliente: str = "Consumo Geral") -> str:
    return _launch_items(comanda_id, [produto_id], cliente)


def _jobs() -> list[PrintJob]:
    db = SessionLocal()
    try:
        return list(
            db.query(PrintJob)
            .filter(PrintJob.restaurante_id == TENANT_ID)
            .order_by(PrintJob.created_at.asc(), PrintJob.id.asc())
            .all()
        )
    finally:
        db.close()


def test_lancamentos_automaticos_sao_parciais_e_extrato_e_mesa_inteira():
    comanda_id = _open_table_order()
    lancamento_1 = _launch(comanda_id, PRODUTO_1, "A")
    lancamento_2 = _launch(comanda_id, PRODUTO_2, "A")

    jobs = _jobs()
    assert len(jobs) == 2

    first, second = jobs
    assert first.document_type == "producao"
    assert first.destination == "COZINHA"
    assert first.source_type == "lancamento"
    assert first.source_id == lancamento_1
    assert "1x HAMBÚRGUER ARQUITETURA" in first.payload_text
    assert "1x CHEESE ARQUITETURA" not in first.payload_text
    assert "R$ 19,00" in first.payload_text
    assert "TOTAL DESTE PEDIDO:" in first.payload_text
    assert "TOTAL GERAL DA MESA:" not in first.payload_text

    assert second.document_type == "producao"
    assert second.destination == "COZINHA"
    assert second.source_type == "lancamento"
    assert second.source_id == lancamento_2
    assert "1x CHEESE ARQUITETURA" in second.payload_text
    assert "1x HAMBÚRGUER ARQUITETURA" not in second.payload_text
    assert "R$ 25,00" in second.payload_text
    assert "TOTAL DESTE PEDIDO:" in second.payload_text
    assert first.idempotency_key != second.idempotency_key

    extrato = client.post(
        f"/mesas/{MESA_ID}/imprimir-recibo",
        params={"apenas_valores": "false"},
        headers=_headers(USER_ID),
    )
    assert extrato.status_code == 200, extrato.text

    complete = _jobs()[-1]
    assert complete.document_type == "mesa"
    assert complete.destination == "FECHAMENTO"
    assert "1x HAMBÚRGUER ARQUITETURA" in complete.payload_text
    assert "1x CHEESE ARQUITETURA" in complete.payload_text
    assert "R$ 44,00" in complete.payload_text
    assert "TOTAL GERAL DA MESA:" in complete.payload_text
    assert "TOTAL DESTE PEDIDO:" not in complete.payload_text


def test_lote_misto_imprime_todos_os_itens_quando_um_item_habilita_a_via():
    comanda_id = _open_table_order()
    lancamento_id = _launch_items(
        comanda_id,
        [PRODUTO_1, PRODUTO_SEM_IMPRESSAO_1],
    )

    jobs = _jobs()
    assert len(jobs) == 1
    job = jobs[0]
    assert job.source_type == "lancamento"
    assert job.source_id == lancamento_id
    assert "1x HAMBÚRGUER ARQUITETURA" in job.payload_text
    assert "1x COCA COLA LATA" in job.payload_text
    assert "R$ 19,00" in job.payload_text
    assert "R$ 6,00" in job.payload_text
    assert "TOTAL DESTE PEDIDO:" in job.payload_text
    assert "R$ 25,00" in job.payload_text


def test_lote_so_com_itens_sem_impressao_nao_dispara_automatico_mas_pode_imprimir_manual():
    comanda_id = _open_table_order()
    lancamento_id = _launch_items(
        comanda_id,
        [PRODUTO_SEM_IMPRESSAO_1, PRODUTO_SEM_IMPRESSAO_2],
    )

    assert _jobs() == []

    response = client.post(
        f"/comandas/lancamentos/{lancamento_id}/reimprimir",
        headers=_headers(USER_ID),
    )
    assert response.status_code == 200, response.text

    jobs = _jobs()
    assert len(jobs) == 1
    manual = jobs[0]
    assert manual.source_type == "reimpressao"
    assert manual.source_id == lancamento_id
    assert "1x COCA COLA LATA" in manual.payload_text
    assert "1x ÁGUA MINERAL" in manual.payload_text
    assert "TOTAL DESTE PEDIDO:" in manual.payload_text
    assert "R$ 10,00" in manual.payload_text


def test_reimpressao_de_lote_repete_somente_a_instancia_original():
    comanda_id = _open_table_order()
    lancamento_1 = _launch(comanda_id, PRODUTO_1, "A")
    _launch(comanda_id, PRODUTO_2, "A")

    original_first = _jobs()[0]
    reprint = client.post(
        f"/comandas/lancamentos/{lancamento_1}/reimprimir",
        headers=_headers(USER_ID),
    )
    assert reprint.status_code == 200, reprint.text

    reprinted = _jobs()[-1]
    assert reprinted.source_type == "reimpressao"
    assert reprinted.source_id == lancamento_1
    assert reprinted.document_type == "producao"
    assert reprinted.destination == "COZINHA"
    assert "1x HAMBÚRGUER ARQUITETURA" in reprinted.payload_text
    assert "1x CHEESE ARQUITETURA" not in reprinted.payload_text
    assert reprinted.payload_text == original_first.payload_text


def test_idempotency_key_estavel_nao_cria_segunda_via_automatica():
    comanda_id = _open_table_order()
    _launch(comanda_id, PRODUTO_1)

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(TENANT_ID)
    try:
        first = enqueue_table_receipt(
            db,
            TENANT_ID,
            MESA_ID,
            source_type="teste",
            source_id=comanda_id,
            idempotency_key="mesa:teste:estavel",
        )
        second = enqueue_table_receipt(
            db,
            TENANT_ID,
            MESA_ID,
            source_type="teste",
            source_id=comanda_id,
            idempotency_key="mesa:teste:estavel",
        )
        db.commit()
        assert first is not None
        assert second is first or second.id == first.id
        assert db.query(PrintJob).filter(
            PrintJob.restaurante_id == TENANT_ID,
            PrintJob.idempotency_key == "mesa:teste:estavel",
        ).count() == 1
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()


def test_extrato_nao_acessa_mesa_de_outro_tenant():
    response = client.post(
        f"/mesas/{OTHER_MESA_ID}/imprimir-recibo",
        headers=_headers(USER_ID),
    )
    assert response.status_code == 404, response.text
    assert "Mesa não encontrada" in response.json()["detail"]


def test_comprovante_de_fechamento_sai_pela_printjob_e_nao_pelo_frontend():
    db = SessionLocal()
    tenant_token = current_restaurante_id.set(TENANT_ID)
    try:
        turno = db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == TENANT_ID,
            CaixaTurno.status == "aberto",
        ).one()
        turno.status = "fechado"
        turno.fechado_por_id = CAIXA_ID
        turno.fechado_em = datetime.datetime(2026, 8, 16, 0, 35, tzinfo=datetime.timezone.utc)
        turno.declarado_dinheiro = 0
        turno.declarado_cartao = 0
        turno.declarado_pix = 0
        turno.observacao = "Conferência sem divergência"
        turno_id = turno.id
        db.commit()
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()

    response = client.post(
        f"/impressao/caixa/turnos/{turno_id}/comprovante",
        headers=_headers(CAIXA_ID, role="caixa"),
    )
    assert response.status_code == 200, response.text

    db = SessionLocal()
    try:
        job = db.query(PrintJob).filter(
            PrintJob.restaurante_id == TENANT_ID,
            PrintJob.document_type == "fechamento_caixa",
            PrintJob.source_id == str(turno_id),
        ).one()
        assert job.destination == "FECHAMENTO"
        assert "COMPROVANTE DE FECHAMENTO DE CAIXA" in job.payload_text
        assert "CAIXA EXATO" in job.payload_text
        assert "Gerenciado por Kôma" in job.payload_text
        assert "Documento não fiscal" in job.payload_text
    finally:
        db.close()
