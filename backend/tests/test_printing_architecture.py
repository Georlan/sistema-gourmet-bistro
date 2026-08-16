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
CATEGORIA_ID = "cat-print-arch"

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_printing_architecture(monkeypatch):
    Base.metadata.create_all(bind=engine)
    fixed_now = datetime.datetime(2026, 8, 15, 21, 30, tzinfo=datetime.timezone(datetime.timedelta(hours=-3)))
    monkeypatch.setattr(printer_module, "get_operational_now", lambda: fixed_now)

    token = current_restaurante_id.set(TENANT_ID)
    db = SessionLocal()
    try:
        # Limpeza isolada dos dados usados por esta suíte.
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


def _launch(comanda_id: str, produto_id: str, cliente: str = "Consumo Geral") -> str:
    response = client.post(
        f"/comandas/{comanda_id}/lancamentos",
        headers=_headers(USER_ID),
        json={
            "garcom_id": USER_ID,
            "itens": [{
                "produto_id": produto_id,
                "observacao": "",
                "cliente_nome": cliente,
            }],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _jobs() -> list[PrintJob]:
    db = SessionLocal()
    try:
        return list(
            db.query(PrintJob)
            .filter(PrintJob.restaurante_id == TENANT_ID)
            .order_by(PrintJob.id.asc())
            .all()
        )
    finally:
        db.close()


def test_automatico_extrato_e_reimpressao_usam_o_mesmo_documento_de_mesa():
    comanda_id = _open_table_order()
    lancamento_id = _launch(comanda_id, PRODUTO_1, "A")

    jobs_after_launch = _jobs()
    assert len(jobs_after_launch) == 1
    automatic = jobs_after_launch[0]
    assert automatic.document_type == "mesa"
    assert automatic.destination == "FECHAMENTO"
    assert automatic.source_type == "lancamento"
    assert "CONSUMO NO LOCAL" in automatic.payload_text
    assert "CLIENTE: A" in automatic.payload_text
    assert "R$ 19,00" in automatic.payload_text

    extrato = client.post(
        f"/mesas/{MESA_ID}/imprimir-recibo",
        params={"apenas_valores": "false"},
        headers=_headers(USER_ID),
    )
    assert extrato.status_code == 200, extrato.text

    jobs_after_extract = _jobs()
    assert len(jobs_after_extract) == 2
    explicit = jobs_after_extract[-1]
    assert explicit.document_type == "mesa"
    assert explicit.destination == "FECHAMENTO"
    assert explicit.payload_text == automatic.payload_text

    reprint = client.post(
        f"/comandas/lancamentos/{lancamento_id}/reimprimir",
        headers=_headers(USER_ID),
    )
    assert reprint.status_code == 200, reprint.text

    jobs_after_reprint = _jobs()
    assert len(jobs_after_reprint) == 3
    reprinted = jobs_after_reprint[-1]
    assert reprinted.source_type == "reimpressao"
    assert reprinted.document_type == "mesa"
    assert reprinted.destination == "FECHAMENTO"
    assert reprinted.payload_text == automatic.payload_text


def test_segundo_lancamento_imprime_snapshot_completo_sem_duplicar_jobs():
    comanda_id = _open_table_order()
    _launch(comanda_id, PRODUTO_1)
    _launch(comanda_id, PRODUTO_2)

    jobs = _jobs()
    assert len(jobs) == 2
    second = jobs[-1]
    assert "1x HAMBÚRGUER ARQUITETURA" in second.payload_text
    assert "1x CHEESE ARQUITETURA" in second.payload_text
    assert "R$ 44,00" in second.payload_text
    assert jobs[0].idempotency_key != jobs[1].idempotency_key


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
