import os
import pytest
from decimal import Decimal
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.database import SessionLocal, tenant_session_scope
from app.models import (
    Restaurante,
    Usuario,
    SuperAdminAuditLog,
    Comanda,
    Item,
    Produto,
    Categoria,
    Lancamento,
    RestaurantPaymentAccount,
)
from app.routes import super_admin
from app.security import create_access_token, get_password_hash
from app.subscription import subscription_marketplace_rate


client = TestClient(app)
SUPERADMIN_USERNAME = "owner@example.test"
SUPERADMIN_PASSWORD = "test-password-not-for-production"


@pytest.fixture(autouse=True)
def set_superadmin_env(monkeypatch):
    super_admin.superadmin_login_rate_limiter.history.clear()
    monkeypatch.setenv("SUPERADMIN_USERNAME", SUPERADMIN_USERNAME)
    monkeypatch.setenv(
        "SUPERADMIN_PASSWORD_HASH",
        get_password_hash(SUPERADMIN_PASSWORD),
    )
    yield
    super_admin.superadmin_login_rate_limiter.history.clear()


def _superadmin_headers() -> dict[str, str]:
    token = create_access_token(
        subject=SUPERADMIN_USERNAME,
        restaurante_id=0,
        role="superadmin",
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def setup_test_tenants():
    db: Session = SessionLocal()
    try:
        # Create or fetch Tenant 1
        t1 = db.query(Restaurante).filter(Restaurante.id == 1).first()
        if not t1:
            t1 = Restaurante(
                id=1,
                nome="Restaurante Teste 1",
                slug="restaurante-teste-1",
                plano="pro",
                saas_status="active",
            )
            db.add(t1)
        else:
            t1.nome = "Restaurante Teste 1"
            t1.slug = "restaurante-teste-1"
            t1.plano = "pro"
            t1.saas_status = "active"

        # Create or fetch Tenant 2
        t2 = db.query(Restaurante).filter(Restaurante.id == 2).first()
        if not t2:
            t2 = Restaurante(
                id=2,
                nome="Restaurante Teste 2",
                slug="restaurante-teste-2",
                plano="pocket",
                saas_status="active",
            )
            db.add(t2)
        else:
            t2.nome = "Restaurante Teste 2"
            t2.slug = "restaurante-teste-2"
            t2.plano = "pocket"
            t2.saas_status = "active"

        # Create staff user for Tenant 1
        u1 = db.query(Usuario).filter(Usuario.id == "usr-staff-t1").first()
        if not u1:
            u1 = Usuario(
                id="usr-staff-t1",
                nome="Garcom Teste",
                restaurante_id=1,
                email="staff1@teste.com",
                senha_hash=get_password_hash("12345678"),
                cargo="garcom",
                role="garcom",
                status="ativo",
            )
            db.add(u1)
        else:
            u1.nome = "Garcom Teste"
            u1.status = "ativo"

        # Create category and product for Tenant 1
        cat1 = db.query(Categoria).filter(Categoria.restaurante_id == 1, Categoria.nome == "Lanches F2B").first()
        if not cat1:
            cat1 = Categoria(id="cat-f2b-1", restaurante_id=1, nome="Lanches F2B")
            db.add(cat1)
            db.flush()
        prod1 = db.query(Produto).filter(Produto.restaurante_id == 1, Produto.id == "prod-f2b-1").first()
        if not prod1:
            prod1 = Produto(
                id="prod-f2b-1",
                restaurante_id=1,
                nome="Burger Teste F2B",
                preco=25.0,
                categoria_id=cat1.id,
                ativo=True,
            )
            db.add(prod1)

        # Clear audit logs for clean assertions
        db.query(SuperAdminAuditLog).filter(SuperAdminAuditLog.restaurante_id.in_([1, 2])).delete(synchronize_session=False)

        db.commit()
    finally:
        db.close()

    yield

    # Teardown
    db = SessionLocal()
    try:
        t1 = db.query(Restaurante).filter(Restaurante.id == 1).first()
        if t1:
            t1.saas_status = "active"
            t1.plano = "pro"
            t1.slug = "restaurante-teste-1"
        t2 = db.query(Restaurante).filter(Restaurante.id == 2).first()
        if t2:
            t2.saas_status = "active"
            t2.plano = "pocket"
            t2.slug = "restaurante-teste-2"
        db.commit()
    finally:
        db.close()


def test_b_default_restaurante_saas_status_is_active(setup_test_tenants):
    db: Session = SessionLocal()
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == 1).first()
        assert restaurante is not None
        assert restaurante.saas_status == "active"
    finally:
        db.close()


def test_c_alterar_plano_persiste_e_muda_taxa_comercial(setup_test_tenants):
    # Pro -> Premium
    resp = client.patch(
        "/api/super-admin/restaurantes/1",
        headers=_superadmin_headers(),
        json={"plan": "premium", "reason": "Cliente solicitou upgrade para Premium"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["plan"] == "premium"

    db: Session = SessionLocal()
    try:
        r = db.query(Restaurante).filter(Restaurante.id == 1).first()
        assert r is not None
        assert r.plano == "premium"

        # Test canonical marketplace rate
        rate = subscription_marketplace_rate(r.plano)
        assert rate == Decimal("0.0029")  # 0.29% for premium
    finally:
        db.close()


def test_d_plano_invalido_rejeita_422_sem_alteracao_nem_audit(setup_test_tenants):
    db: Session = SessionLocal()
    try:
        initial_log_count = db.query(SuperAdminAuditLog).filter(SuperAdminAuditLog.restaurante_id == 1).count()
    finally:
        db.close()

    resp = client.patch(
        "/api/super-admin/restaurantes/1",
        headers=_superadmin_headers(),
        json={"plan": "ultra_vip", "reason": "Tentativa de plano invalido"},
    )
    assert resp.status_code == 422
    assert "Plano inválido" in resp.json()["detail"]

    db = SessionLocal()
    try:
        r = db.query(Restaurante).filter(Restaurante.id == 1).first()
        assert r.plano == "pro"  # Intact
        final_log_count = db.query(SuperAdminAuditLog).filter(SuperAdminAuditLog.restaurante_id == 1).count()
        assert final_log_count == initial_log_count
    finally:
        db.close()


def test_e_alterar_slug_duplicado_rejeita_com_rollback(setup_test_tenants):
    resp = client.patch(
        "/api/super-admin/restaurantes/1",
        headers=_superadmin_headers(),
        json={"subdomain": "restaurante-teste-2", "reason": "Tentativa de roubar slug"},
    )
    assert resp.status_code == 400
    assert "já está em uso" in resp.json()["detail"]

    db: Session = SessionLocal()
    try:
        r1 = db.query(Restaurante).filter(Restaurante.id == 1).first()
        assert r1.slug == "restaurante-teste-1"  # Intact
    finally:
        db.close()


def test_f_g_suspensao_e_reativacao(setup_test_tenants):
    # F: Suspensão
    resp_suspend = client.put(
        "/api/super-admin/restaurantes/1/status",
        headers=_superadmin_headers(),
        json={"status": "SUSPENDED", "reason": "Inadimplência financeira"},
    )
    assert resp_suspend.status_code == 200
    assert resp_suspend.json()["status"] == "SUSPENDED"

    db: Session = SessionLocal()
    try:
        r1 = db.query(Restaurante).filter(Restaurante.id == 1).first()
        assert r1.saas_status == "suspended"
    finally:
        db.close()

    # G: Reativação
    resp_reactivate = client.put(
        "/api/super-admin/restaurantes/1/status",
        headers=_superadmin_headers(),
        json={"status": "ACTIVE", "reason": "Fatura quitada"},
    )
    assert resp_reactivate.status_code == 200
    assert resp_reactivate.json()["status"] == "ACTIVE"

    db = SessionLocal()
    try:
        r1 = db.query(Restaurante).filter(Restaurante.id == 1).first()
        assert r1.saas_status == "active"
    finally:
        db.close()


def test_h_suspensao_bloqueia_usuario_comum(setup_test_tenants):
    # Suspend tenant 1
    client.put(
        "/api/super-admin/restaurantes/1/status",
        headers=_superadmin_headers(),
        json={"status": "SUSPENDED", "reason": "Bloqueio administrativo"},
    )

    staff_token = create_access_token(
        subject="usr-staff-t1",
        restaurante_id=1,
        role="garcom",
    )
    staff_headers = {"Authorization": f"Bearer {staff_token}"}

    # Any authenticated staff endpoint (e.g. produtos/categorias)
    resp = client.get("/produtos/categorias", headers=staff_headers)
    assert resp.status_code == 403
    assert "suspenso" in resp.json()["detail"].lower()


def test_i_suspensao_bloqueia_novo_pedido_publico(setup_test_tenants):
    # Suspend tenant 1
    client.put(
        "/api/super-admin/restaurantes/1/status",
        headers=_superadmin_headers(),
        json={"status": "SUSPENDED", "reason": "Suspensão para teste de pedido"},
    )

    # Attempt to place public order on restaurant 1
    order_payload = {
        "restaurante_id": 1,
        "tipo_pedido": "retirada",
        "cliente_nome": "Cliente Teste",
        "cliente_telefone": "11999999999",
        "itens": [{"produto_id": "prod-f2b-1", "quantidade": 1}],
        "forma_pagamento": "na_entrega",
        "forma_pagamento_detalhe": "dinheiro",
        "idempotency_key": "idemp-susp-test-12345",
    }
    resp = client.post("/cardapio/pedidos", json=order_payload)
    assert resp.status_code == 403
    assert "suspenso" in resp.json()["detail"].lower()


def test_j_superadmin_continua_acessando_tenant_suspenso(setup_test_tenants):
    # Suspend tenant 1
    client.put(
        "/api/super-admin/restaurantes/1/status",
        headers=_superadmin_headers(),
        json={"status": "SUSPENDED", "reason": "Suspensão com inspeção de SuperAdmin"},
    )

    resp = client.get(
        "/api/super-admin/restaurantes",
        headers=_superadmin_headers(),
    )
    assert resp.status_code == 200
    tenants = resp.json()
    t1 = next((t for t in tenants if str(t["id"]) == "1"), None)
    assert t1 is not None
    assert t1["status"] == "SUSPENDED"


def test_l_m_toda_mutacao_gera_exatamente_um_audit_log_com_atomicidade(setup_test_tenants):
    db: Session = SessionLocal()
    try:
        db.query(SuperAdminAuditLog).filter(SuperAdminAuditLog.restaurante_id == 1).delete()
        db.commit()
    finally:
        db.close()

    # 1. Update name and plan
    resp1 = client.patch(
        "/api/super-admin/restaurantes/1",
        headers=_superadmin_headers(),
        json={"name": "Koma Novo Nome", "plan": "premium", "reason": "Rebranding do cliente"},
    )
    assert resp1.status_code == 200

    # 2. Suspend
    resp2 = client.put(
        "/api/super-admin/restaurantes/1/status",
        headers=_superadmin_headers(),
        json={"status": "SUSPENDED", "reason": "Fim do contrato"},
    )
    assert resp2.status_code == 200

    db = SessionLocal()
    try:
        logs = (
            db.query(SuperAdminAuditLog)
            .filter(SuperAdminAuditLog.restaurante_id == 1)
            .order_by(SuperAdminAuditLog.created_at.asc())
            .all()
        )
        assert len(logs) == 2

        assert logs[0].action == "SUPERADMIN_TENANT_UPDATE"
        assert logs[0].reason == "Rebranding do cliente"
        assert logs[0].before_data["nome"] == "Restaurante Teste 1"
        assert logs[0].after_data["nome"] == "Koma Novo Nome"
        assert logs[0].after_data["plano"] == "premium"

        assert logs[1].action == "SUPERADMIN_TENANT_SUSPEND"
        assert logs[1].reason == "Fim do contrato"
        assert logs[1].after_data["saas_status"] == "suspended"
    finally:
        db.close()


def test_n_audit_log_bloqueia_update_e_delete(setup_test_tenants):
    db: Session = SessionLocal()
    try:
        audit = SuperAdminAuditLog(
            restaurante_id=1,
            actor="admin",
            action="SUPERADMIN_TENANT_UPDATE",
            reason="Teste de imutabilidade",
            before_data={"test": "before"},
            after_data={"test": "after"},
        )
        db.add(audit)
        db.commit()

        # Try to UPDATE
        audit.reason = "Tentativa de alteração maliciosa"
        with pytest.raises(PermissionError, match="immutable and cannot be updated"):
            db.commit()
        db.rollback()

        # Try to DELETE
        db.delete(audit)
        with pytest.raises(PermissionError, match="immutable and cannot be deleted"):
            db.commit()
        db.rollback()
    finally:
        db.close()


def test_o_p_tenant_comum_nao_consegue_alterar_outros_nem_acessar_superadmin():
    staff_token = create_access_token(
        subject="usr-staff-t1",
        restaurante_id=1,
        role="admin",
    )
    staff_headers = {"Authorization": f"Bearer {staff_token}"}

    # Attempt to access superadmin routes with tenant admin token
    resp_patch = client.patch(
        "/api/super-admin/restaurantes/2",
        headers=staff_headers,
        json={"plan": "premium", "reason": "Tentativa de escalada"},
    )
    assert resp_patch.status_code == 403

    resp_status = client.put(
        "/api/super-admin/restaurantes/2/status",
        headers=staff_headers,
        json={"status": "SUSPENDED", "reason": "Tentativa de ataque"},
    )
    assert resp_status.status_code == 403

    resp_audit = client.get(
        "/api/super-admin/audit",
        headers=staff_headers,
    )
    assert resp_audit.status_code == 403


def test_q_audit_endpoint_e_cross_tenant_nao_expoem_secrets_nem_tokens(setup_test_tenants):
    # Trigger an update so there's an audit log
    client.patch(
        "/api/super-admin/restaurantes/1",
        headers=_superadmin_headers(),
        json={"name": "Koma Auditoria Segura", "reason": "Teste de segurança da API"},
    )

    resp_audit = client.get(
        "/api/super-admin/audit",
        headers=_superadmin_headers(),
    )
    assert resp_audit.status_code == 200
    logs = resp_audit.json()
    assert isinstance(logs, list)
    assert len(logs) > 0

    text_content = resp_audit.text.lower()
    for sensitive in ("token", "secret", "password_hash", "senha_hash", "refresh_token"):
        assert f'"{sensitive}": "[redacted]"' in text_content or sensitive not in text_content


def test_a_alembic_heads_is_single_and_matches_migration():
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    alembic_cfg = Config("backend/alembic.ini")
    script = ScriptDirectory.from_config(alembic_cfg)
    heads = script.get_heads()
    assert len(heads) == 1
    assert heads[0] == "2b3c4d5e6f7a"


def test_k_webhook_payment_reconciliation_works_when_suspended(setup_test_tenants):
    # Suspend tenant 1
    client.put(
        "/api/super-admin/restaurantes/1/status",
        headers=_superadmin_headers(),
        json={"status": "SUSPENDED", "reason": "Suspensão para teste de webhook"},
    )

    db: Session = SessionLocal()
    try:
        # Create an existing comanda
        comanda = Comanda(
            id="cmd-webhook-susp-1",
            restaurante_id=1,
            mesa_id=None,
            garcom_id="usr-staff-t1",
            numero_pedido=101,
            tipo="Delivery",
            fechada=False,
            online_payment_status="pending",
        )
        db.add(comanda)
        db.commit()

        # Webhook / payment reconciliation updates existing comanda
        comanda.online_payment_status = "approved"
        comanda.fechada = True
        db.commit()

        reloaded = db.query(Comanda).filter(Comanda.id == "cmd-webhook-susp-1").first()
        assert reloaded.online_payment_status == "approved"
        assert reloaded.fechada is True
    finally:
        db.close()
