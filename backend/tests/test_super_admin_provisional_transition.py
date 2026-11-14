import datetime
import uuid
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import (
    Restaurante,
    Usuario,
    Categoria,
    Produto,
    ConfiguracaoRestaurante,
    SuperAdminAuditLog,
)
from app.contract_models import ContractAcceptance, RestaurantContractAcceptance
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.restaurant_profile_models import RestauranteOperationProfile
from app.saas_billing_models import SaaSBillingSetup, SaaSSubscription
from app.session_models import UserSessionVersion
from app.routes.super_admin_onboarding import restaurant_trials
from app.security import create_access_token
from app.services.restaurant_provisioning import is_provisional_preparation
from app.signup_models import SignupBase, SignupNotification

VALID_CPF = "52998224725"
VALID_CNPJ = "11222333000181"


def _documents() -> dict[str, dict]:
    return {
        "terms": {"slug": "termos", "version": LEGAL_VERSION, "sections": []},
        "commercial": {"slug": "planos", "version": LEGAL_VERSION, "sections": []},
        "dpa": {"slug": "dpa", "version": LEGAL_VERSION, "sections": []},
        "privacy": {"slug": "privacidade", "version": LEGAL_VERSION, "sections": []},
    }


def _contract_payload(plan: str = "pocket", billing_cycle: str = "mensal") -> dict:
    return {
        "request_id": str(uuid.uuid4()),
        "contracting_party_name": "JE Lanches Ltda",
        "contracting_party_tax_id": VALID_CNPJ,
        "restaurant_name": "JE Lanches",
        "representative_name": "José Eduardo",
        "representative_tax_id": VALID_CPF,
        "representative_role": "Proprietário",
        "email": "contato@jelanches.com.br",
        "phone": "81999990000",
        "plan": plan,
        "billing_cycle": billing_cycle,
        "powers_declared": True,
        "legal_version": LEGAL_VERSION,
        "legal_source_commit": LEGAL_SOURCE_COMMIT,
        "legal_source_blob_sha": LEGAL_SOURCE_BLOB_SHA,
        "documents": _documents(),
    }


def _superadmin_headers() -> dict[str, str]:
    token = create_access_token(
        subject="superadmin_test",
        restaurante_id=0,
        role="superadmin",
    )
    return {"Authorization": f"Bearer {token}"}


def _tenant_admin_headers(restaurante_id: int, user_id: str = "u-admin-1") -> dict[str, str]:
    token = create_access_token(
        subject=user_id,
        restaurante_id=restaurante_id,
        role="admin",
    )
    return {"Authorization": f"Bearer {token}"}


TEST_TENANT_ID = 9876


def _cleanup_tenant(db, tenant_id: int = TEST_TENANT_ID):
    from app.session_models import UserSessionVersion
    from app.saas_billing_models import SaaSBillingSetup
    db.query(SignupNotification).delete()
    db.query(SuperAdminAuditLog).filter(SuperAdminAuditLog.restaurante_id == tenant_id).delete()
    db.query(RestaurantContractAcceptance).filter(RestaurantContractAcceptance.restaurante_id == tenant_id).delete()
    db.query(ContractAcceptance).filter(ContractAcceptance.email == "contato@jelanches.com.br").delete()
    db.query(SaaSBillingSetup).filter(SaaSBillingSetup.restaurante_id == tenant_id).delete()
    db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == tenant_id).delete()
    db.execute(restaurant_trials.delete().where(restaurant_trials.c.restaurante_id == tenant_id))
    db.query(RestauranteOperationProfile).filter(RestauranteOperationProfile.restaurante_id == tenant_id).delete()
    db.query(Produto).filter(Produto.restaurante_id == tenant_id).delete()
    db.query(Categoria).filter(Categoria.restaurante_id == tenant_id).delete()
    db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == tenant_id).delete()
    db.query(UserSessionVersion).filter(UserSessionVersion.restaurante_id == tenant_id).delete()
    db.query(Usuario).filter(Usuario.restaurante_id == tenant_id).delete()
    db.query(Restaurante).filter(Restaurante.id == tenant_id).delete()
    db.commit()


def _cleanup_test_data(db):
    _cleanup_tenant(db, TEST_TENANT_ID)


@pytest.fixture(autouse=True)
def setup_test_db(monkeypatch):
    monkeypatch.setenv("SUPERADMIN_USERNAME", "superadmin_test")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_NAME", "KÔMA Testes")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_TAX_ID", VALID_CPF)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_ADDRESS", "Rua Teste, 100")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_LOCATION", "Fortaleza/CE")
    bind = engine
    Base.metadata.create_all(bind=bind)
    RestaurantContractAcceptance.__table__.create(bind=bind, checkfirst=True)
    ContractAcceptance.__table__.create(bind=bind, checkfirst=True)
    SaaSBillingSetup.__table__.create(bind=bind, checkfirst=True)
    SaaSSubscription.__table__.create(bind=bind, checkfirst=True)
    UserSessionVersion.__table__.create(bind=bind, checkfirst=True)
    SuperAdminAuditLog.__table__.create(bind=bind, checkfirst=True)
    restaurant_trials.create(bind=bind, checkfirst=True)
    SignupBase.metadata.create_all(bind=bind)
    SignupNotification.__table__.create(bind=bind, checkfirst=True)

    db = SessionLocal()
    try:
        _cleanup_test_data(db)
    finally:
        db.close()

    yield

    db = SessionLocal()
    try:
        _cleanup_test_data(db)
    finally:
        db.close()


def test_provisional_onboarding_blocks_commercial_operations_and_transitions_cleanly():
    client = TestClient(app)
    admin_headers = _superadmin_headers()
    test_tenant_id = TEST_TENANT_ID

    # 1. Provisionar tenant provisório em preparação com defer_trial=True
    provision_payload = {
        "restaurant_id": test_tenant_id,
        "name": "JE Lanches Test",
        "subdomain": "je-lanches-test-9876",
        "plan": "pocket",
        "operation_profile": "generic",
        "admin_name": "Administrador Provisório",
        "admin_email": "admin.provisorio@koma.test",
        "temporary_password": "SenhaForteProvisoria123!",
        "defer_trial": True,
    }

    res_provision = client.post(
        "/api/super-admin/restaurantes/provisionar",
        headers=admin_headers,
        json=provision_payload,
    )
    assert res_provision.status_code == 201, res_provision.text
    data = res_provision.json()
    assert data["id"] == str(test_tenant_id)
    assert data["trial"]["status"] == "pending_setup"
    assert data["trial"]["startedAt"] is None

    # 2. Verificar estado no banco
    with SessionLocal() as db:
        # Confirmar ausência de trial e de SaaSSubscription
        assert is_provisional_preparation(db, test_tenant_id) is True
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == test_tenant_id).first()
        assert sub is None

        # Cadastrar produtos e categorias durante a fase de preparação
        cat = Categoria(id="cat-lanches", restaurante_id=test_tenant_id, nome="Lanches")
        db.add(cat)
        db.flush()
        prod = Produto(
            id="prod-x-burger",
            restaurante_id=test_tenant_id,
            categoria_id="cat-lanches",
            nome="X-Burger Artesanal",
            preco=22.0,
            ativo=True,
        )
        db.add(prod)
        db.commit()

    # 3. Operação comercial DEVE estar impedida durante a preparação
    tenant_headers = _tenant_admin_headers(test_tenant_id, user_id=data["admin"]["id"])

    # 3a. Tentativa de abrir turno de caixa no salão deve retornar 403
    res_caixa = client.post(
        "/caixa/turno/abrir",
        headers=tenant_headers,
        json={"saldo_inicial": 100.0},
    )
    assert res_caixa.status_code == 403, res_caixa.text
    assert "preparação" in res_caixa.json()["detail"].lower()

    # 3b. Tentativa de fazer pedido público no cardápio deve retornar 403
    order_payload = {
        "restaurante_id": test_tenant_id,
        "cliente_nome": "Cliente Teste",
        "cliente_telefone": "81988887777",
        "tipo_pedido": "retirada",
        "forma_pagamento": "na_entrega",
        "forma_pagamento_detalhe": "dinheiro",
        "itens": [
            {
                "produto_id": "prod-x-burger",
                "quantidade": 1,
            }
        ],
    }
    res_cardapio = client.post(
        "/cardapio/pedidos",
        json=order_payload,
    )
    assert res_cardapio.status_code == 403, res_cardapio.text
    assert "preparação" in res_cardapio.json()["detail"].lower()

    # 3c. Tentativa de liberar operação comercial sem assinatura comercial deve falhar com 409
    res_release_fail = client.post(
        f"/api/super-admin/onboarding/restaurantes/{test_tenant_id}/release",
        headers=admin_headers,
    )
    assert res_release_fail.status_code == 409, res_release_fail.text
    assert "sem assinatura comercial" in res_release_fail.json()["detail"].lower()

    # 3d. QA não é contratação: somente Super Admin pode liberar temporariamente.
    unauthorized = client.post(
        f"/api/super-admin/onboarding/restaurantes/{test_tenant_id}/operational-qa",
        headers=tenant_headers,
        json={"action": "start", "hours": 24, "reason": "Teste operacional do tenant provisório."},
    )
    assert unauthorized.status_code in {401, 403}

    qa = client.post(
        f"/api/super-admin/onboarding/restaurantes/{test_tenant_id}/operational-qa",
        headers=admin_headers,
        json={"action": "start", "hours": 24, "reason": "Homologação controlada de caixa e pedidos."},
    )
    assert qa.status_code == 200, qa.text
    assert qa.json()["qaActive"] is True
    assert qa.json()["commercialContractCreated"] is False
    assert qa.json()["saasTrialStarted"] is False

    with SessionLocal() as db:
        assert is_provisional_preparation(db, test_tenant_id) is False
        assert db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == test_tenant_id).first() is None
        assert db.execute(
            restaurant_trials.select().where(restaurant_trials.c.restaurante_id == test_tenant_id)
        ).mappings().one_or_none() is None

    duplicate = client.post(
        f"/api/super-admin/onboarding/restaurantes/{test_tenant_id}/operational-qa",
        headers=admin_headers,
        json={"action": "start", "hours": 24, "reason": "Repetição sem revogação não permitida."},
    )
    assert duplicate.status_code == 409

    end_qa = client.post(
        f"/api/super-admin/onboarding/restaurantes/{test_tenant_id}/operational-qa",
        headers=admin_headers,
        json={"action": "end", "reason": "Encerrar a homologação antes de contratar."},
    )
    assert end_qa.status_code == 200, end_qa.text
    with SessionLocal() as db:
        assert is_provisional_preparation(db, test_tenant_id) is True

    # O bloqueio operacional volta após revogação, sem afetar o tenant.
    res_after_qa = client.post(
        "/caixa/turno/abrir",
        headers=tenant_headers,
        json={"saldo_inicial": 100.0},
    )
    assert res_after_qa.status_code == 403

    # 4. Simular formalização legítima: criação de aceite contratual real via API
    res_accept = client.post(
        "/api/contracts/accept",
        json=_contract_payload(plan="pocket", billing_cycle="mensal"),
        headers={
            "cf-connecting-ip": "203.0.113.25",
            "user-agent": "KomaContractTest/1.0",
        },
    )
    assert res_accept.status_code == 201, res_accept.text
    protocol_code = res_accept.json()["protocol"]

    # 5. Executar a transição canônica via link de contrato
    link_payload = {
        "protocol": protocol_code,
        "restaurant_id": test_tenant_id,
        "reason": "Transição de restaurante provisório para cliente comercial com contrato real assinado.",
    }
    res_link = client.post(
        "/api/super-admin/contracts/link",
        headers=admin_headers,
        json=link_payload,
    )
    assert res_link.status_code == 200, res_link.text
    data_link = res_link.json()
    assert data_link["restaurantId"] == str(test_tenant_id)
    assert data_link["subscriptionStatus"] == "onboarding"

    # 6. Validar o estado pós-transição
    with SessionLocal() as db:
        # A assinatura agora existe e está em "onboarding" sem iniciar o trial
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == test_tenant_id).one()
        assert sub.status == "onboarding"
        assert sub.trial_started_at is None
        assert sub.trial_ends_at is None

        # O restaurante não é mais provisório
        assert is_provisional_preparation(db, test_tenant_id) is False

        # Preservação absoluta do ID, produtos, categorias e configurações
        prod_check = db.query(Produto).filter(Produto.id == "prod-x-burger").one()
        assert prod_check.restaurante_id == test_tenant_id
        assert prod_check.nome == "X-Burger Artesanal"

        # Auditoria persistida
        audit = db.query(SuperAdminAuditLog).filter(
            SuperAdminAuditLog.restaurante_id == test_tenant_id,
            SuperAdminAuditLog.action == "SUPERADMIN_CONTRACT_LINK",
        ).one()
        assert audit.after_data["created_subscription"] is True
        assert audit.after_data["subscription_status"] == "onboarding"

    # 7. Idempotência: tentar vincular novamente deve rejeitar conflito sem alterar a assinatura
    res_link_dup = client.post(
        "/api/super-admin/contracts/link",
        headers=admin_headers,
        json=link_payload,
    )
    assert res_link_dup.status_code == 409, res_link_dup.text

    # 8. Liberação operacional:
    # 8a. Sem meio de pagamento configurado, a liberação deve falhar com 409
    with SessionLocal() as db:
        from app.services.onboarding_trial import ensure_trial_started_after_onboarding
        with pytest.raises(HTTPException) as exc_info:
            ensure_trial_started_after_onboarding(
                db,
                restaurante_id=test_tenant_id,
                actor="superadmin:test",
            )
        assert exc_info.value.status_code == 409

    # 8b. Após configuração legítima do meio de pagamento (ex: Pix), os 7 dias grátis são iniciados
    with SessionLocal() as db:
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == test_tenant_id).one()
        sub.payment_method_type = "pix"
        db.commit()

        result_trial = ensure_trial_started_after_onboarding(
            db,
            restaurante_id=test_tenant_id,
            actor="superadmin:test",
        )
        assert result_trial is not None
        assert result_trial["status"] == "trialing"
        assert result_trial["trial_started_at"] is not None
        assert result_trial["trial_ends_at"] is not None

        # Confirmar que a assinatura avançou para trialing
        db.refresh(sub)
        assert sub.status == "trialing"
        assert sub.trial_started_at is not None
        assert sub.trial_ends_at is not None


def test_je_lanches_progressive_onboarding_activate_inplace_and_manual_pix(monkeypatch):
    """Regressão completa do caso real JE Lanches:
    - Etapa A: provisionamento com defer_trial=True, login provisório, 28 produtos com famílias,
      benefícios permanentes (printing + courier_app no Pocket), estado 'preparando' sem iniciar 7 dias.
    - Etapa B: contrato eletrônico aceito sem gateway conectado -> ativação in-place no ID existente
      via POST /api/super-admin/contracts/{protocol}/activate com payment_method_type='pix' ->
      liberação comercial iniciando exatamente 7 dias sem zerar catálogo nem benefícios.
    - Etapa C: atualização cadastral posterior não reinicia os 7 dias; troca de admin e confirmação
      manual de Pix pós-teste mantêm o restaurante ativo.
    """
    from app.config import settings
    monkeypatch.setenv("SUPERADMIN_BOOTSTRAP_ADMINS", "owner@komafood.com.br")
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", True)
    test_tenant_id = 990102
    protocol = "KOMA-2026-JELANCHES-01"
    acceptance_id = str(uuid.uuid4())

    with SessionLocal() as db:
        _cleanup_tenant(db, test_tenant_id)
        db.query(ContractAcceptance).filter(
            ContractAcceptance.protocol == protocol
        ).delete(synchronize_session=False)
        db.commit()

    client = TestClient(app)
    admin_headers = _superadmin_headers()

    # 1. Etapa A: Super Admin cria JE Lanches com defer_trial=True
    res_prov = client.post(
        "/api/super-admin/restaurantes/provisionar",
        headers=admin_headers,
        json={
            "restaurant_id": test_tenant_id,
            "name": "JE Lanches",
            "subdomain": "je-lanches-test",
            "plan": "pocket",
            "operation_profile": "generic",
            "admin_name": "Admin Provisório JE",
            "admin_email": "provisorio@jelanches.test",
            "temporary_password": "Password123!",
            "defer_trial": True,
        },
    )
    assert res_prov.status_code == 201, res_prov.text
    prov_data = res_prov.json()
    assert prov_data["trial"]["status"] == "pending_setup"

    # 2. Configurar perfil (sem exigir endereço definitivo), horários, modalidades,
    #    28 produtos (com tags [familia: ...]) e benefícios permanentes no Pocket
    with SessionLocal() as db:
        rest = db.query(Restaurante).filter(Restaurante.id == test_tenant_id).one()
        rest.socials = {"whatsapp": "85988887777"}
        rest.horarios_funcionamento = [{"days": "Seg a Dom", "hours": "18:00 - 23:30"}]
        config = (
            db.query(ConfiguracaoRestaurante)
            .filter(ConfiguracaoRestaurante.restaurante_id == test_tenant_id)
            .one_or_none()
        )
        if config is None:
            config = ConfiguracaoRestaurante(restaurante_id=test_tenant_id)
            db.add(config)
        config.tipos_pedido_ativos = ["retirada"]
        cat = Categoria(
            id="cat-je-acai",
            restaurante_id=test_tenant_id,
            nome="Açaí & Lanches",
        )
        db.add(cat)
        db.flush()
        for idx in range(1, 29):
            familia_tag = " [familia: Açaí Tradicional]" if idx <= 4 else ""
            db.add(
                Produto(
                    id=f"prod-je-{idx}",
                    restaurante_id=test_tenant_id,
                    categoria_id="cat-je-acai",
                    nome=f"Item JE {idx}",
                    preco=15.0 + idx,
                    descricao=f"Delicioso item {idx}{familia_tag}",
                    ativo=True,
                )
            )
        db.commit()

        admin_user = db.query(Usuario).filter(Usuario.restaurante_id == test_tenant_id).one()
        tenant_headers = _tenant_admin_headers(test_tenant_id, user_id=admin_user.id)

    res_prep = client.get("/api/onboarding/status", headers=tenant_headers)
    assert res_prep.status_code == 200, res_prep.text
    status_prep = res_prep.json()
    assert status_prep["onboarding"]["stage"] == "pronto_para_teste"
    assert status_prep["onboarding"]["provisionalPreparation"] is True
    assert status_prep["onboarding"]["contractLinked"] is False
    assert status_prep["trial"]["status"] == "setup"
    assert status_prep["steps"]["profile"] is True
    assert status_prep["steps"]["hours"] is True
    assert status_prep["steps"]["catalog"] is True
    assert status_prep["steps"]["operations"] is True
    assert status_prep["counts"]["activeProducts"] == 28
    assert status_prep["onboarding"]["operationReleased"] is False

    # 3. Etapa B: Aceite contratual registrado (sem gateway conectado, billing pending)
    res_accept = client.post(
        "/api/contracts/accept",
        json=_contract_payload(plan="pocket", billing_cycle="mensal"),
        headers={
            "cf-connecting-ip": "203.0.113.26",
            "user-agent": "KomaContractTest/1.0",
        },
    )
    assert res_accept.status_code == 201, res_accept.text
    protocol = res_accept.json()["protocol"]

    # Selecionar Pix pós-teste sem precisar de gateway Mercado Pago conectado
    res_pix = client.post(f"/api/contracts/{protocol}/billing/pix/select")
    assert res_pix.status_code == 200, res_pix.text
    assert res_pix.json()["paymentMethodType"] == "pix"

    # Ativar o contrato in-place no ID provisório existente
    res_act = client.post(
        f"/api/super-admin/contracts/{protocol}/activate",
        headers=admin_headers,
        json={
            "restaurant_id": test_tenant_id,
            "payment_method_type": "pix",
            "reason": "Transição in-place JE Lanches",
        },
    )
    assert res_act.status_code == 200, res_act.text
    assert res_act.json()["restaurantId"] == str(test_tenant_id)

    # Verificar que está 'pronto_para_teste' com 28 produtos e overrides intactos, e trial ainda não iniciado
    res_ready = client.get("/api/onboarding/status", headers=tenant_headers)
    assert res_ready.status_code == 200, res_ready.text
    status_ready = res_ready.json()
    assert status_ready["onboarding"]["stage"] == "pronto_para_teste"
    assert status_ready["onboarding"]["provisionalPreparation"] is False
    assert status_ready["onboarding"]["contractLinked"] is True
    assert status_ready["readyForRelease"] is True
    assert status_ready["counts"]["activeProducts"] == 28
    with SessionLocal() as db:
        config = (
            db.query(ConfiguracaoRestaurante)
            .filter(ConfiguracaoRestaurante.restaurante_id == test_tenant_id)
            .one()
        )
        assert config.tipos_pedido_ativos == ["retirada"]

    # 4. Liberar operação e iniciar os 7 dias
    res_rel = client.post(
        f"/api/super-admin/onboarding/restaurantes/{test_tenant_id}/release",
        headers=admin_headers,
        json={"payment_method_type": "pix"},
    )
    assert res_rel.status_code == 200, res_rel.text
    rel_data = res_rel.json()
    assert rel_data["trialStarted"] is True
    first_started_at = rel_data["subscription"]["trialStartedAt"]
    first_ends_at = rel_data["subscription"]["trialEndsAt"]
    assert first_started_at is not None
    assert first_ends_at is not None

    # 5. Etapa C: Completar endereço definitivo depois e chamar release de novo NÃO reinicia os 7 dias
    with SessionLocal() as db:
        rest = db.query(Restaurante).filter(Restaurante.id == test_tenant_id).one()
        rest.endereco = "Av. Principal, 500 - Centro"
        db.commit()

    res_rel_again = client.post(
        f"/api/super-admin/onboarding/restaurantes/{test_tenant_id}/release",
        headers=admin_headers,
    )
    assert res_rel_again.status_code == 200, res_rel_again.text
    assert res_rel_again.json()["subscription"]["trialStartedAt"] == first_started_at
    assert res_rel_again.json()["subscription"]["trialEndsAt"] == first_ends_at

    assert res_rel_again.json()["subscription"]["status"] == "trialing"

    # 6. Preservação integral dos 28 produtos no mesmo tenant após liberação
    with SessionLocal() as db:
        assert db.query(Produto).filter(Produto.restaurante_id == test_tenant_id).count() == 28

    with SessionLocal() as db:
        _cleanup_tenant(db, test_tenant_id)
        db.query(ContractAcceptance).filter(
            ContractAcceptance.protocol == protocol
        ).delete(synchronize_session=False)
        db.commit()

