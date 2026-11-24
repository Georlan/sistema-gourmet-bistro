import datetime
import uuid

import pytest
from fastapi.testclient import TestClient

from app.application.printing.intent import PrintAction, PrintIntent, PrintSourceType, PrintTrigger
from app.application.printing.service import PrintingApplicationService
from app.contract_models import ContractAcceptance, ContractInvite, RestaurantContractAcceptance
from app.database import Base, SessionLocal, engine
from app.fiscal_models import FiscalDocument, FiscalEvent, FiscalSequence
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Cliente,
    Comanda,
    ConfigFidelizacao,
    ConfiguracaoRestaurante,
    Cupom,
    HistoricoFidelidade,
    Insumo,
    IntegrationOutbox,
    Item,
    Lancamento,
    MovimentacaoEstoque,
    Pagamento,
    PrintJob,
    Produto,
    ProdutoInsumo,
    Restaurante,
    SuperAdminAuditLog,
    Usuario,
)
from app.order_chat_models import OrderConversation, OrderConversationEvent, OrderMessage
from app.restaurant_profile_models import RestauranteOperationProfile
from app.routes.super_admin_onboarding import restaurant_trials
from app.saas_billing_models import SaaSBillingSetup, SaaSSubscription
from app.security import create_access_token
from app.services.cash_reconciliation import cash_shift_totals
from app.services.financial_read import count_period_sales, load_period_totals
from app.services.fiscal_documents import FiscalDocumentPersistenceError, create_numbered_fiscal_document
from app.services.restaurant_provisioning import (
    is_provisional_preparation,
    is_superadmin_operational_qa_active,
    validate_operational_qa_token,
)
from app.session_models import UserSessionVersion
from app.signup_models import SignupBase, SignupNotification

TENANT_QA = 9885
TENANT_INCOMPLETE = 9886
VALID_CPF = "52998224725"
VALID_CNPJ = "11222333000181"


def _superadmin_headers() -> dict[str, str]:
    token = create_access_token(
        subject="superadmin_qa_test",
        restaurante_id=0,
        role="superadmin",
    )
    return {"Authorization": f"Bearer {token}"}


def _tenant_admin_headers(tenant_id: int, user_id: str) -> dict[str, str]:
    token = create_access_token(
        subject=user_id,
        restaurante_id=tenant_id,
        role="admin",
    )
    return {"Authorization": f"Bearer {token}"}


def _documents() -> dict[str, dict]:
    return {
        "terms": {"slug": "termos", "version": LEGAL_VERSION, "sections": []},
        "commercial": {"slug": "planos", "version": LEGAL_VERSION, "sections": []},
        "dpa": {"slug": "dpa", "version": LEGAL_VERSION, "sections": []},
        "privacy": {"slug": "privacidade", "version": LEGAL_VERSION, "sections": []},
    }


def _cleanup(db):
    for tid in (TENANT_QA, TENANT_INCOMPLETE):
        db.query(FiscalEvent).filter(FiscalEvent.restaurante_id == tid).delete()
        db.query(FiscalDocument).filter(FiscalDocument.restaurante_id == tid).delete()
        db.query(FiscalSequence).filter(FiscalSequence.restaurante_id == tid).delete()
        db.query(OrderConversationEvent).filter(OrderConversationEvent.restaurante_id == tid).delete()
        db.query(OrderMessage).filter(OrderMessage.restaurante_id == tid).delete()
        db.query(OrderConversation).filter(OrderConversation.restaurante_id == tid).delete()
        db.query(PrintJob).filter(PrintJob.restaurante_id == tid).delete()
        db.query(IntegrationOutbox).filter(IntegrationOutbox.restaurante_id == tid).delete()
        db.query(HistoricoFidelidade).filter(HistoricoFidelidade.restaurante_id == tid).delete()
        db.query(Pagamento).filter(Pagamento.restaurante_id == tid).delete()
        db.query(MovimentacaoEstoque).filter(MovimentacaoEstoque.restaurante_id == tid).delete()
        db.query(Item).filter(Item.restaurante_id == tid).delete()
        db.query(Lancamento).filter(Lancamento.restaurante_id == tid).delete()
        db.query(Comanda).filter(Comanda.restaurante_id == tid).delete()
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == tid).delete()
        db.query(ProdutoInsumo).filter(ProdutoInsumo.restaurante_id == tid).delete()
        db.query(Insumo).filter(Insumo.restaurante_id == tid).delete()
        db.query(Cupom).filter(Cupom.restaurante_id == tid).delete()
        db.query(ConfigFidelizacao).filter(ConfigFidelizacao.restaurante_id == tid).delete()
        db.query(Cliente).filter(Cliente.restaurante_id == tid).delete()
        db.query(Produto).filter(Produto.restaurante_id == tid).delete()
        db.query(Categoria).filter(Categoria.restaurante_id == tid).delete()
        db.query(SuperAdminAuditLog).filter(SuperAdminAuditLog.restaurante_id == tid).delete()
        db.query(ContractInvite).filter(ContractInvite.restaurante_id == tid).delete()
        db.query(RestaurantContractAcceptance).filter(RestaurantContractAcceptance.restaurante_id == tid).delete()
        db.query(SaaSBillingSetup).filter(SaaSBillingSetup.restaurante_id == tid).delete()
        db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == tid).delete()
        db.execute(restaurant_trials.delete().where(restaurant_trials.c.restaurante_id == tid))
        db.query(RestauranteOperationProfile).filter(RestauranteOperationProfile.restaurante_id == tid).delete()
        db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == tid).delete()
        db.query(UserSessionVersion).filter(UserSessionVersion.restaurante_id == tid).delete()
        db.query(Usuario).filter(Usuario.restaurante_id == tid).delete()
        db.query(Restaurante).filter(Restaurante.id == tid).delete()
    db.query(ContractAcceptance).filter(ContractAcceptance.email.like("qa-%@koma.test")).delete()
    db.query(SignupNotification).delete()
    db.commit()


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    monkeypatch.setenv("SUPERADMIN_USERNAME", "superadmin_qa_test")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_NAME", "KÔMA Testes")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_TAX_ID", VALID_CPF)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_ADDRESS", "Rua Teste, 100")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_LOCATION", "Fortaleza/CE")

    Base.metadata.create_all(bind=engine)
    for tbl in (
        ContractAcceptance.__table__,
        RestaurantContractAcceptance.__table__,
        ContractInvite.__table__,
        SaaSBillingSetup.__table__,
        SaaSSubscription.__table__,
        UserSessionVersion.__table__,
        SuperAdminAuditLog.__table__,
        restaurant_trials,
        FiscalDocument.__table__,
        FiscalEvent.__table__,
        FiscalSequence.__table__,
    ):
        tbl.create(bind=engine, checkfirst=True)
    SignupBase.metadata.create_all(bind=engine)
    SignupNotification.__table__.create(bind=engine, checkfirst=True)

    with SessionLocal() as db:
        _cleanup(db)
    yield
    with SessionLocal() as db:
        _cleanup(db)


def test_qa_token_isolates_public_traffic_shields_side_effects_and_transitions_cleanly():
    client = TestClient(app)
    sa_headers = _superadmin_headers()

    res_prov = client.post(
        "/api/super-admin/restaurantes/provisionar",
        headers=sa_headers,
        json={
            "restaurant_id": TENANT_QA,
            "name": "Bistro Homologacao QA",
            "subdomain": "bistro-qa-9885",
            "plan": "premium",
            "operation_profile": "generic",
            "admin_name": "Dono QA",
            "admin_email": "dono.qa@koma.test",
            "temporary_password": "SenhaForteQA123!",
            "defer_trial": True,
        },
    )
    assert res_prov.status_code == 201, res_prov.text
    admin_id = res_prov.json()["admin"]["id"]
    admin_headers = _tenant_admin_headers(TENANT_QA, admin_id)

    # Configura os 4 itens essenciais + ficha técnica + cupom + fidelidade + turno aberto
    with SessionLocal() as db:
        rest = db.query(Restaurante).filter(Restaurante.id == TENANT_QA).one()
        rest.socials = {"whatsapp": "85988887777"}
        rest.horarios_funcionamento = [{"days": "Todos os dias", "hours": "00:00 - 23:59"}]
        rest.formas_pagamento_aceitas = ["dinheiro", "pix"]
        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == TENANT_QA
        ).one()
        config.tipos_pedido_ativos = ["retirada"]
        config.delivery_ativo = False
        config.impressao_habilitada = True

        cat = Categoria(id="cat-qa-1", restaurante_id=TENANT_QA, nome="Lanches QA")
        db.add(cat)
        db.flush()
        prod = Produto(
            id="prod-qa-1",
            restaurante_id=TENANT_QA,
            categoria_id="cat-qa-1",
            nome="Burger QA",
            preco=30.0,
            ativo=True,
        )
        db.add(prod)
        insumo = Insumo(
            id="ins-qa-1",
            restaurante_id=TENANT_QA,
            nome="Carne QA",
            estoque_atual=50.0,
            unidade_medida="un",
        )
        db.add(insumo)
        db.flush()
        db.add(
            ProdutoInsumo(
                restaurante_id=TENANT_QA,
                produto_id="prod-qa-1",
                insumo_id="ins-qa-1",
                quantidade=2.0,
            )
        )
        db.add(
            Cupom(
                id="cupom-qa-1",
                restaurante_id=TENANT_QA,
                codigo="QA10",
                tipo_desconto="fixo",
                valor_desconto=5.0,
                usos_atuais=0,
                ativo=True,
            )
        )
        db.add(
            ConfigFidelizacao(
                restaurante_id=TENANT_QA,
                ativo=True,
                tipo_recompensa="CASHBACK",
                taxa_conversao=10.0,
            )
        )
        db.commit()

    # Inicia QA operacional — deve retornar qaAccessToken uma vez e salvar somente hash no audit log
    res_qa = client.post(
        f"/api/super-admin/onboarding/restaurantes/{TENANT_QA}/operational-qa",
        headers=sa_headers,
        json={"action": "start", "hours": 12, "reason": "Validar cardápio, pedidos, caixa e impressão."},
    )
    assert res_qa.status_code == 200, res_qa.text
    qa_data = res_qa.json()
    qa_token = qa_data["qaAccessToken"]
    assert qa_token.startswith(f"{TENANT_QA}.")
    assert f"qa_token={qa_token}" in qa_data["qaMenuPath"]

    with SessionLocal() as db:
        audit = db.query(SuperAdminAuditLog).filter(
            SuperAdminAuditLog.restaurante_id == TENANT_QA,
            SuperAdminAuditLog.action == "SUPERADMIN_QA_OPERATION_START",
        ).one()
        assert "qa_token_hash" in audit.after_data
        assert qa_token not in str(audit.after_data)
        assert validate_operational_qa_token(db, TENANT_QA, qa_token) is True
        assert validate_operational_qa_token(db, TENANT_QA, f"9999.{qa_token.split('.', 1)[1]}") is False

    # Operador autenticado consegue abrir turno do caixa em QA
    res_open_shift = client.post(
        "/caixa/turno/abrir",
        headers=admin_headers,
        json={"saldo_inicial": 100.0},
    )
    assert res_open_shift.status_code == 201, res_open_shift.text

    # Mesmo com turno aberto, visitante anônimo SEM qa_token segue BLOQUEADO no cardápio e pedido públicos
    anon_menu = client.get(f"/api/cardapio-digital/public?restaurante_id={TENANT_QA}")
    assert anon_menu.status_code == 200, anon_menu.text
    anon_json = anon_menu.json()
    assert anon_json["restaurante"]["aceitando_pedidos"] is False
    assert anon_json["restaurante"]["origem_disponibilidade"] == "provisional_preparation"
    assert anon_json["modo_homologacao_qa"] is False

    base_order = {
        "restaurante_id": TENANT_QA,
        "cliente_nome": "Testador QA",
        "cliente_telefone": "85988887777",
        "tipo_pedido": "retirada",
        "forma_pagamento": "na_entrega",
        "forma_pagamento_detalhe": "dinheiro",
        "cupom_codigo": "QA10",
        "itens": [{"produto_id": "prod-qa-1", "quantidade": 1}],
    }
    res_anon_order = client.post("/cardapio/pedidos", json=base_order)
    assert res_anon_order.status_code == 403
    assert "preparação" in res_anon_order.json()["detail"].lower()

    res_wrong_token = client.post(
        "/cardapio/pedidos",
        json=base_order,
        headers={"X-Koma-QA-Token": f"9999.{qa_token.split('.', 1)[1]}"},
    )
    assert res_wrong_token.status_code == 403

    # Com X-Koma-QA-Token válido: cardápio libera com private no-store + banner QA
    qa_menu = client.get(
        f"/api/cardapio-digital/public?restaurante_id={TENANT_QA}",
        headers={"X-Koma-QA-Token": qa_token},
    )
    assert qa_menu.status_code == 200, qa_menu.text
    assert qa_menu.json()["restaurante"]["aceitando_pedidos"] is True
    assert qa_menu.json()["modo_homologacao_qa"] is True
    assert "no-store" in qa_menu.headers.get("cache-control", "")

    # Pagamento online real é bloqueado no modo QA com 409
    res_online_qa = client.post(
        "/cardapio/pedidos",
        headers={"X-Koma-QA-Token": qa_token, "X-Idempotency-Key": "qa-online-blocked-1"},
        json={
            **base_order,
            "forma_pagamento": "online",
            "forma_pagamento_detalhe": "pix",
            "cliente_email": "qa@example.com",
        },
    )
    assert res_online_qa.status_code == 409, res_online_qa.text

    # Pedido na entrega/retirada com X-Koma-QA-Token válido cria Comanda.onboarding_test=True
    res_qa_order = client.post(
        "/cardapio/pedidos",
        headers={"X-Koma-QA-Token": qa_token, "X-Idempotency-Key": "qa-offline-order-1"},
        json=base_order,
    )
    assert res_qa_order.status_code in {200, 201}, res_qa_order.text
    comanda_id = res_qa_order.json()["comanda_id"]

    # Simula pagamento no Caixa sobre a comanda QA para testar blindagem financeira, fidelidade, impressão e fiscal
    with SessionLocal() as db:
        qa_cmd = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        assert qa_cmd.onboarding_test is True
        assert qa_cmd.cliente_id is None
        assert db.query(Cliente).filter(Cliente.restaurante_id == TENANT_QA).count() == 0
        assert db.query(IntegrationOutbox).filter(IntegrationOutbox.restaurante_id == TENANT_QA).count() == 0
        assert db.query(Insumo).filter(Insumo.id == "ins-qa-1").one().estoque_atual == 50.0
        assert db.query(MovimentacaoEstoque).filter(MovimentacaoEstoque.restaurante_id == TENANT_QA).count() == 0
        assert db.query(Cupom).filter(Cupom.id == "cupom-qa-1").one().usos_atuais == 0

        turno = db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == TENANT_QA, CaixaTurno.status == "aberto").one()
        db.add(
            Pagamento(
                id="pag-qa-1",
                restaurante_id=TENANT_QA,
                comanda_id=qa_cmd.id,
                turno_id=turno.id,
                valor=30.0,
                metodo="dinheiro",
                status="aprovado",
            )
        )
        qa_cmd.valor_pago = 30.0
        qa_cmd.fechada = True
        db.commit()

        from app.routes.caixa import _registrar_fidelidade_quitacao
        assert _registrar_fidelidade_quitacao(db, qa_cmd) is False
        assert db.query(HistoricoFidelidade).filter(HistoricoFidelidade.restaurante_id == TENANT_QA).count() == 0

        today = datetime.date.today().isoformat()
        totals = load_period_totals(db, TENANT_QA, today, today)
        assert float(totals.vendas_brutas) == 0.0
        shift_totals = cash_shift_totals(db, TENANT_QA, turno)
        assert float(shift_totals.vendas_brutas) == 0.0
        assert shift_totals.total_pedidos_pagos == 0

        # Impressão recebe selo claro de teste/homologação
        jobs = PrintingApplicationService.request_print(
            db,
            PrintIntent(
                restaurant_id=TENANT_QA,
                source_type=PrintSourceType.ORDER,
                source_id=qa_cmd.id,
                action=PrintAction.PRINT,
                trigger=PrintTrigger.MANUAL,
            ),
        )
        assert len(jobs) >= 1
        assert "*** TESTE HOMOLOGACAO (SEM VALOR) ***" in jobs[0].payload_text

        # Fiscal bloqueia emissão de documento em comanda de teste antes de reservar sequência
        with pytest.raises(FiscalDocumentPersistenceError, match="homologação"):
            create_numbered_fiscal_document(
                db,
                restaurante_id=TENANT_QA,
                idempotency_key="fiscal-qa-block-1",
                sale_snapshot={"total": 30.0},
                total_amount=30.0,
                comanda_id=qa_cmd.id,
            )
        assert db.query(FiscalSequence).filter(FiscalSequence.restaurante_id == TENANT_QA).count() == 0

    # Convite contratual com Pix pós-teste + auto_release_on_accept=True
    res_invite = client.post(
        "/api/super-admin/contracts/invite",
        headers=sa_headers,
        json={
            "restaurant_id": TENANT_QA,
            "billing_cycle": "mensal",
            "payment_method_type": "pix",
            "auto_release_on_accept": True,
            "reason": "Formalização após QA operacional validado.",
        },
    )
    assert res_invite.status_code == 201, res_invite.text
    invite_token = res_invite.json()["token"]

    res_accept = client.post(
        "/api/contracts/invite/accept",
        json={
            "request_id": str(uuid.uuid4()),
            "token": invite_token,
            "contracting_party_name": "Bistro Homologacao QA Ltda",
            "contracting_party_tax_id": VALID_CNPJ,
            "restaurant_name": "Bistro Homologacao QA",
            "representative_name": "Dono QA",
            "representative_tax_id": VALID_CPF,
            "representative_role": "Sócio",
            "email": "qa-aceite@koma.test",
            "phone": "85988887777",
            "powers_declared": True,
            "legal_version": LEGAL_VERSION,
            "legal_source_commit": LEGAL_SOURCE_COMMIT,
            "legal_source_blob_sha": LEGAL_SOURCE_BLOB_SHA,
            "documents": _documents(),
        },
        headers={"cf-connecting-ip": "203.0.113.99", "user-agent": "KomaQATest/1.0"},
    )
    assert res_accept.status_code == 201, res_accept.text
    accepted = res_accept.json()
    assert accepted["qaEnded"] is True
    assert accepted["autoReleased"] is True
    assert accepted["trialStarted"] is True
    assert accepted["subscriptionStatus"] == "trialing"

    with SessionLocal() as db:
        assert is_superadmin_operational_qa_active(db, TENANT_QA) is False
        assert is_provisional_preparation(db, TENANT_QA) is False
        assert db.query(Produto).filter(Produto.id == "prod-qa-1").one().nome == "Burger QA"
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == TENANT_QA).one()
        assert sub.status == "trialing"
        assert sub.payment_method_type == "pix"

    # Sem regressão no onboarding após aceite
    res_status = client.get("/api/onboarding/status", headers=admin_headers)
    assert res_status.status_code == 200, res_status.text
    assert res_status.json()["onboarding"]["releaseState"] == "released"
    assert res_status.json()["readiness"]["trialStarted"] is True


def test_contract_invite_with_incomplete_essentials_never_starts_trial_prematurely():
    client = TestClient(app)
    sa_headers = _superadmin_headers()

    res_prov = client.post(
        "/api/super-admin/restaurantes/provisionar",
        headers=sa_headers,
        json={
            "restaurant_id": TENANT_INCOMPLETE,
            "name": "Bistro Incompleto",
            "subdomain": "bistro-incompleto-9886",
            "plan": "pocket",
            "operation_profile": "generic",
            "admin_name": "Dono Incompleto",
            "admin_email": "dono.inc@koma.test",
            "temporary_password": "SenhaForteInc123!",
            "defer_trial": True,
        },
    )
    assert res_prov.status_code == 201, res_prov.text

    res_invite = client.post(
        "/api/super-admin/contracts/invite",
        headers=sa_headers,
        json={
            "restaurant_id": TENANT_INCOMPLETE,
            "billing_cycle": "mensal",
            "payment_method_type": "pix",
            "auto_release_on_accept": True,
            "reason": "Teste de aceite com implantação incompleta.",
        },
    )
    assert res_invite.status_code == 201, res_invite.text
    token = res_invite.json()["token"]

    res_accept = client.post(
        "/api/contracts/invite/accept",
        json={
            "request_id": str(uuid.uuid4()),
            "token": token,
            "contracting_party_name": "Bistro Incompleto Ltda",
            "contracting_party_tax_id": VALID_CNPJ,
            "restaurant_name": "Bistro Incompleto",
            "representative_name": "Dono Incompleto",
            "representative_tax_id": VALID_CPF,
            "representative_role": "Sócio",
            "email": "qa-inc@koma.test",
            "phone": "85977776666",
            "powers_declared": True,
            "legal_version": LEGAL_VERSION,
            "legal_source_commit": LEGAL_SOURCE_COMMIT,
            "legal_source_blob_sha": LEGAL_SOURCE_BLOB_SHA,
            "documents": _documents(),
        },
        headers={"cf-connecting-ip": "203.0.113.100", "user-agent": "KomaQATest/1.0"},
    )
    assert res_accept.status_code == 201, res_accept.text
    accepted = res_accept.json()
    assert accepted["autoReleased"] is False
    assert accepted["trialStarted"] is False
    assert accepted["subscriptionStatus"] == "onboarding"
    assert accepted["releasePendingReason"] == "configuration_incomplete"
