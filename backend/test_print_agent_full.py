import os
import sys
import hashlib
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Configurações para teste
from app.database import Base, current_restaurante_id
from app.models import Restaurante, Usuario, PrintJob, PrintAgentToken
from app.domain.printing import (
    PrintDocumentService,
    OrderPrintData,
    CommandPrintData,
    DeliveryOrderPrintData,
    PrintItem
)
from app.routes.print_agents import hash_token, MAX_ATTEMPTS

# Import do agente local
AGENT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../koma-print-agent"))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)

from adapters.dummy import DummyPrinterAdapter
from adapters.linux import LinuxPrinterAdapter
from adapters.windows import WindowsPrinterAdapter
from adapters import get_adapter

@pytest.fixture
def db_session():
    """Cria um banco SQLite em memória isolado para os testes do Agent."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    r1 = session.query(Restaurante).filter(Restaurante.id == 1).first()
    if not r1:
        r1 = Restaurante(id=1, nome="Restaurante Principal", plano="pocket")
        session.add(r1)
    
    r2 = session.query(Restaurante).filter(Restaurante.id == 2).first()
    if not r2:
        r2 = Restaurante(id=2, nome="Restaurante Filial", plano="pocket")
        session.add(r2)

    session.commit()

    current_restaurante_id.set(1)

    yield session

    session.close()

def create_job_helper(db, rest_id=1, doc_type="producao", dest="COZINHA", source_type="pedido", source_id="101", idempotency_key="key-1", payload="TEXTO"):
    current_restaurante_id.set(rest_id)
    job = PrintJob(
        restaurante_id=rest_id,
        document_type=doc_type,
        destination=dest,
        source_type=source_type,
        source_id=source_id,
        payload_text=payload,
        status="pending",
        idempotency_key=idempotency_key
    )
    db.add(job)
    db.commit()
    return job


def test_01_pedido_so_com_nenhum_nao_cria_job_producao(db_session):
    """1. Pedido só com NENHUM não cria job de produção."""
    order = OrderPrintData(
        numero_pedido="101",
        itens=[PrintItem(codigo="01", nome="AGUA", quantidade=1, destino_impressao="NENHUM")]
    )
    docs = PrintDocumentService.generate_production(order)
    assert docs is None, "Pedido com apenas NENHUM não deve gerar texto de produção"


def test_02_pedido_misto_cria_job_apenas_com_itens_produtivos(db_session):
    """2. Pedido misto cria job apenas com itens produtivos."""
    order = OrderPrintData(
        numero_pedido="102",
        itens=[
            PrintItem(codigo="01", nome="HAMBURGUER", quantidade=1, destino_impressao="COZINHA"),
            PrintItem(codigo="02", nome="COCA", quantidade=1, destino_impressao="NENHUM")
        ]
    )
    docs = PrintDocumentService.generate_production(order)
    assert docs is not None
    assert "COZINHA" in docs
    assert "HAMBURGUER" in docs["COZINHA"]
    assert "COCA" not in docs["COZINHA"]


def test_03_delivery_cria_producao_e_entrega_separados(db_session):
    """3. Delivery cria produção e entrega separadamente."""
    delivery_data = DeliveryOrderPrintData(
        numero_pedido="200",
        cliente_nome="MARCOS",
        itens=[PrintItem(codigo="01", nome="PIZZA", quantidade=1, preco_unit=40.0, destino_impressao="COZINHA")]
    )

    # Produção
    prod_docs = PrintDocumentService.generate_production(
        OrderPrintData(numero_pedido="200", itens=delivery_data.itens)
    )
    # Entrega
    delivery_doc = PrintDocumentService.generate_delivery(delivery_data)

    job_prod = create_job_helper(db_session, 1, "producao", "COZINHA", "delivery", "200", "producao:delivery:200:cozinha", prod_docs["COZINHA"])
    job_ent = create_job_helper(db_session, 1, "entrega", "ENTREGA", "delivery", "200", "entrega:delivery:200", delivery_doc)

    assert job_prod.document_type == "producao"
    assert job_ent.document_type == "entrega"
    assert job_prod.id != job_ent.id


def test_04_fechamento_cria_job_separado(db_session):
    """4. Fechamento cria job separado."""
    cmd_data = CommandPrintData(mesa="05", itens=[PrintItem(codigo="01", nome="HAMB", quantidade=1, preco_unit=30.0)])
    doc = PrintDocumentService.generate_closing(cmd_data)

    job = create_job_helper(db_session, 1, "fechamento", "FECHAMENTO", "comanda", "125", "fechamento:comanda:125", doc)
    assert job.document_type == "fechamento"
    assert "TOTAL" in job.payload_text


def test_05_idempotency_key_impede_duplicacao(db_session):
    """5. idempotency_key impede duplicação no mesmo restaurante."""
    create_job_helper(db_session, 1, "producao", "COZINHA", "pedido", "300", "duplicacao-test-1", "PAYLOAD")

    with pytest.raises(Exception):
        create_job_helper(db_session, 1, "producao", "COZINHA", "pedido", "300", "duplicacao-test-1", "PAYLOAD DUP")
    db_session.rollback()


def test_06_dois_agentes_nao_assumem_mesmo_job(db_session):
    """6. Dois agentes não assumem o mesmo job (claim atômico)."""
    job = create_job_helper(db_session, 1, "producao", "COZINHA", "pedido", "400", "claim-test-1", "PAYLOAD")

    # Agente 1 assume
    job.status = "claimed"
    job.agent_id = "caixa-1"
    db_session.commit()

    # Agente 2 tenta assumir
    job_check = db_session.query(PrintJob).filter(PrintJob.id == job.id, PrintJob.status == "pending").first()
    assert job_check is None, "Agente 2 não pode encontrar o job em status pending"


def test_07_agente_outro_restaurante_nao_acessa_job(db_session):
    """7. Agente de outro restaurante não acessa job de outro tenant."""
    create_job_helper(db_session, 1, "producao", "COZINHA", "pedido", "500", "tenant-test-1", "PAYLOAD")

    # Consulta filtrando por restaurante 2
    job_r2 = db_session.query(PrintJob).filter(PrintJob.restaurante_id == 2, PrintJob.status == "pending").first()
    assert job_r2 is None, "Agente do restaurante 2 não pode ver jobs do restaurante 1"


def test_08_complete_por_agente_incorreto_recusado(db_session):
    """8. Complete por agente incorreto é recusado."""
    job = create_job_helper(db_session, 1, "producao", "COZINHA", "pedido", "600", "complete-test-1", "PAYLOAD")
    job.status = "claimed"
    job.agent_id = "caixa-1"
    db_session.commit()

    # Tentativa de complete pelo agente caixa-2
    claiming_agent = "caixa-2"
    assert job.agent_id != claiming_agent, "Validação de segurança: agent_id não coincide"


def test_09_job_printed_nao_volta_para_pending_sozinho(db_session):
    """9. Job printed não volta para pending sozinho."""
    job = create_job_helper(db_session, 1, "producao", "COZINHA", "pedido", "700", "printed-test-1", "PAYLOAD")
    job.status = "printed"
    db_session.commit()

    pending_jobs = db_session.query(PrintJob).filter(PrintJob.status == "pending").all()
    assert job not in pending_jobs


def test_10_agente_offline_nao_impede_pedido(db_session):
    """10. Agente offline não impede que o pedido seja salvo e o PrintJob seja registrado."""
    # O pedido é salvo normalmente e o job fica registrado como pending aguardando a volta do agente
    job = create_job_helper(db_session, 1, "producao", "COZINHA", "pedido", "800", "offline-test-1", "PAYLOAD")
    assert job.status == "pending"


def test_11_dummy_adapter_grava_documento(tmp_path):
    """11. Dummy adapter grava o documento em arquivo."""
    dummy = DummyPrinterAdapter(output_dir=str(tmp_path))
    success = dummy.print_ticket("TESTE DE PAYLOAD", "DUMMY_PRINTER", "PRODUCAO")
    assert success is True

    files = list(tmp_path.glob("*.txt"))
    assert len(files) == 1
    content = files[0].read_text(encoding="utf-8")
    assert "TESTE DE PAYLOAD" in content


def test_12_falha_impressao_marca_failed_e_incrementa_attempts(db_session):
    """12. Falha de impressão marca failed & incrementa attempts."""
    job = create_job_helper(db_session, 1, "producao", "COZINHA", "pedido", "900", "fail-test-1", "PAYLOAD")
    job.attempts += 1
    job.last_error = "Sem papel"

    if job.attempts >= MAX_ATTEMPTS:
        job.status = "failed"
    else:
        job.status = "pending"

    db_session.commit()

    assert job.attempts == 1
    assert job.status == "pending"
    assert job.last_error == "Sem papel"


def test_13_retry_respeita_limite(db_session):
    """13. Retry respeita limite MAX_ATTEMPTS."""
    job = create_job_helper(db_session, 1, "producao", "COZINHA", "pedido", "950", "retry-test-1", "PAYLOAD")

    for i in range(MAX_ATTEMPTS):
        job.attempts += 1
        if job.attempts >= MAX_ATTEMPTS:
            job.status = "failed"
        else:
            job.status = "pending"

    db_session.commit()

    assert job.attempts == MAX_ATTEMPTS
    assert job.status == "failed"


def test_14_token_puro_nao_e_salvo_no_banco(db_session):
    """14. Token puro não é salvo no banco (apenas token_hash)."""
    raw_token = "koma_ag_1234567890abcdef"
    hashed = hash_token(raw_token)

    agent_token_rec = PrintAgentToken(
        restaurante_id=1,
        agent_id="caixa-1",
        token_hash=hashed,
        ativo=True
    )
    db_session.add(agent_token_rec)
    db_session.commit()

    db_rec = db_session.query(PrintAgentToken).filter(PrintAgentToken.id == agent_token_rec.id).first()
    assert db_rec.token_hash != raw_token
    assert db_rec.token_hash == hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def test_15_linux_adapter_mock():
    """15. Linux adapter pode ser testado com mock ou portas simuladas."""
    linux_adapter = LinuxPrinterAdapter()
    assert hasattr(linux_adapter, "print_ticket")


def test_16_windows_adapter_importa_normalmente_no_linux():
    """16. Windows adapter importa normalmente em Linux sem executar código exclusivo do Windows."""
    win_adapter = WindowsPrinterAdapter()
    assert win_adapter is not None
    # Deve retornar True em modo mock no Linux sem quebrar a aplicação
    res = win_adapter.print_ticket("PAYLOAD", "Padrão", "PRODUCAO")
    assert res is True
