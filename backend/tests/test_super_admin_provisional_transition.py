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
from app.saas_billing_models import SaaSSubscription
from app.routes.super_admin_onboarding import restaurant_trials
from app.security import create_access_token
from app.services.restaurant_provisioning import is_provisional_preparation
from app.signup_models import SignupNotification

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


def _cleanup_test_data(db):
    from app.session_models import UserSessionVersion
    db.query(SignupNotification).delete()
    db.query(SuperAdminAuditLog).filter(SuperAdminAuditLog.restaurante_id == TEST_TENANT_ID).delete()
    db.query(RestaurantContractAcceptance).filter(RestaurantContractAcceptance.restaurante_id == TEST_TENANT_ID).delete()
    db.query(ContractAcceptance).filter(ContractAcceptance.email == "contato@jelanches.com.br").delete()
    db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == TEST_TENANT_ID).delete()
    db.execute(restaurant_trials.delete().where(restaurant_trials.c.restaurante_id == TEST_TENANT_ID))
    db.query(RestauranteOperationProfile).filter(RestauranteOperationProfile.restaurante_id == TEST_TENANT_ID).delete()
    db.query(Produto).filter(Produto.restaurante_id == TEST_TENANT_ID).delete()
    db.query(Categoria).filter(Categoria.restaurante_id == TEST_TENANT_ID).delete()
    db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == TEST_TENANT_ID).delete()
    db.query(UserSessionVersion).filter(UserSessionVersion.restaurante_id == TEST_TENANT_ID).delete()
    db.query(Usuario).filter(Usuario.restaurante_id == TEST_TENANT_ID).delete()
    db.query(Restaurante).filter(Restaurante.id == TEST_TENANT_ID).delete()
    db.commit()


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
    SaaSSubscription.__table__.create(bind=bind, checkfirst=True)
    SuperAdminAuditLog.__table__.create(bind=bind, checkfirst=True)
    restaurant_trials.create(bind=bind, checkfirst=True)
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
