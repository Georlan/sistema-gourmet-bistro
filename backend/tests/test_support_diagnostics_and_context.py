import datetime
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    ConfiguracaoRestaurante,
    PrintAgentToken,
    PrintJob,
    Produto,
    RestaurantPaymentAccount,
    Restaurante,
    SuperAdminAuditLog,
    Usuario,
)
from app.saas_billing_models import SaaSSubscription
from app.security import create_access_token
from app.session_models import UserSessionVersion
from app.signup_models import SignupNotification
from app.support_models import CustomerSupportFeedback

TENANT_A = 9881
TENANT_B = 9882


def _auth_headers(tenant_id: int, role: str, user_id: str) -> dict[str, str]:
    token = create_access_token(
        subject=user_id,
        restaurante_id=tenant_id,
        role=role,
    )
    return {"Authorization": f"Bearer {token}"}


def _cleanup(db):
    for tid in (TENANT_A, TENANT_B):
        db.query(CustomerSupportFeedback).filter(CustomerSupportFeedback.restaurante_id == tid).delete()
        db.query(PrintJob).filter(PrintJob.restaurante_id == tid).delete()
        db.query(PrintAgentToken).filter(PrintAgentToken.restaurante_id == tid).delete()
        db.query(RestaurantPaymentAccount).filter(RestaurantPaymentAccount.restaurante_id == tid).delete()
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == tid).delete()
        db.query(Produto).filter(Produto.restaurante_id == tid).delete()
        db.query(Categoria).filter(Categoria.restaurante_id == tid).delete()
        db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == tid).delete()
        db.query(SuperAdminAuditLog).filter(SuperAdminAuditLog.restaurante_id == tid).delete()
        db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == tid).delete()
        db.query(UserSessionVersion).filter(UserSessionVersion.restaurante_id == tid).delete()
        db.query(Usuario).filter(Usuario.restaurante_id == tid).delete()
        db.query(Restaurante).filter(Restaurante.id == tid).delete()
    db.query(SignupNotification).filter(SignupNotification.id.like("SUP-%")).delete()
    db.commit()


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    CustomerSupportFeedback.__table__.create(bind=engine, checkfirst=True)
    SignupNotification.__table__.create(bind=engine, checkfirst=True)
    SaaSSubscription.__table__.create(bind=engine, checkfirst=True)
    SuperAdminAuditLog.__table__.create(bind=engine, checkfirst=True)

    with SessionLocal() as db:
        _cleanup(db)
        for tid, slug, plano in (
            (TENANT_A, "bistro-diag-a", "pro"),
            (TENANT_B, "bistro-diag-b", "pocket"),
        ):
            db.add(
                Restaurante(
                    id=tid,
                    nome=f"Loja {tid}",
                    slug=slug,
                    plano=plano,
                    saas_status="active",
                    horarios_funcionamento=[{"days": "Todos os dias", "hours": "10:00 - 23:00"}],
                    formas_pagamento_aceitas=["dinheiro", "pix"] if tid == TENANT_A else ["dinheiro"],
                )
            )
            db.add(
                ConfiguracaoRestaurante(
                    restaurante_id=tid,
                    tipos_pedido_ativos=["retirada"],
                    delivery_ativo=False,
                )
            )
            for role_name in ("admin", "gerente", "garcom", "cozinha", "motoboy", "caixa"):
                db.add(
                    Usuario(
                        id=f"u-{role_name}-{tid}",
                        restaurante_id=tid,
                        nome=f"{role_name.title()} {tid}",
                        email=f"{role_name}-{tid}@koma.test",
                        cargo=role_name,
                        status="ativo",
                        senha_hash="hash-not-used",
                    )
                )
        db.commit()

    yield

    with SessionLocal() as db:
        _cleanup(db)


def test_diagnostics_requires_management_role_and_detects_tenant_scoped_issues():
    client = TestClient(app)

    # Operadores não gerenciais falham fechados com 403
    for blocked_role in ("garcom", "motoboy", "cozinha", "caixa"):
        res_forbidden = client.get(
            "/api/support/diagnostics",
            headers=_auth_headers(TENANT_A, blocked_role, f"u-{blocked_role}-{TENANT_A}"),
        )
        assert res_forbidden.status_code == 403

    now = datetime.datetime.now(datetime.timezone.utc)
    with SessionLocal() as db:
        # Tenant A: sem produto, sem turno aberto, MP desconectado, agente impressão offline e fila presa
        db.add(
            PrintAgentToken(
                id="agent-stale-a",
                restaurante_id=TENANT_A,
                agent_id="caixa-1",
                token_hash="hash-a",
                ativo=True,
                last_seen_at=now - datetime.timedelta(minutes=25),
            )
        )
        db.add(
            PrintJob(
                id="job-stuck-a",
                restaurante_id=TENANT_A,
                document_type="producao",
                destination="COZINHA",
                source_type="pedido",
                source_id="p-1",
                payload_text="teste",
                status="pending",
                idempotency_key="idem-stuck-a",
                created_at=now - datetime.timedelta(minutes=30),
            )
        )

        # Tenant B saudável: produto ativo + turno aberto
        db.add(Categoria(id="cat-b", restaurante_id=TENANT_B, nome="Pratos"))
        db.flush()
        db.add(
            Produto(
                id="prod-b",
                restaurante_id=TENANT_B,
                categoria_id="cat-b",
                nome="Prato Feito",
                preco=25.0,
                ativo=True,
            )
        )
        db.add(
            CaixaTurno(
                restaurante_id=TENANT_B,
                aberto_por_id=f"u-admin-{TENANT_B}",
                status="aberto",
                saldo_inicial=100.0,
            )
        )
        db.commit()

    res_a = client.get(
        "/api/support/diagnostics",
        headers=_auth_headers(TENANT_A, "admin", f"u-admin-{TENANT_A}"),
    )
    assert res_a.status_code == 200, res_a.text
    diag_a = res_a.json()
    assert diag_a["summary_status"] == "attention"
    codes_a = {item["code"]: item for item in diag_a["issues"]}
    assert "NO_ACTIVE_PRODUCTS" in codes_a
    assert codes_a["NO_ACTIVE_PRODUCTS"]["go_id"] == "cardapio_produtos"
    assert "CASH_SHIFT_CLOSED" in codes_a
    assert codes_a["CASH_SHIFT_CLOSED"]["go_id"] == "caixa_turno_atual"
    assert "MERCADO_PAGO_DISCONNECTED" in codes_a
    assert codes_a["MERCADO_PAGO_DISCONNECTED"]["go_id"] == "online_pagamentos"
    assert "PRINT_AGENT_OFFLINE" in codes_a
    assert codes_a["PRINT_AGENT_OFFLINE"]["go_id"] == "config_impressao"
    assert "PRINT_JOBS_STUCK" in codes_a

    # Tenant B deve estar isolado e saudável
    res_b = client.get(
        "/api/support/diagnostics",
        headers=_auth_headers(TENANT_B, "gerente", f"u-gerente-{TENANT_B}"),
    )
    assert res_b.status_code == 200, res_b.text
    diag_b = res_b.json()
    assert diag_b["summary_status"] == "ok"
    assert diag_b["issues"] == []


def test_support_feedback_persists_context_sends_telegram_and_rejects_bad_context(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-test-token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "999111222")
    monkeypatch.delenv("KOMA_OWNER_EMAIL", raising=False)
    monkeypatch.delenv("KOMA_OWNER_WHATSAPP_PHONE", raising=False)

    from app.routes import customer_satisfaction

    monkeypatch.setattr(
        customer_satisfaction,
        "settings",
        SimpleNamespace(KOMA_OWNER_EMAIL=""),
    )

    enqueued = []
    from app.services import signup_notifications

    orig_enqueue = signup_notifications.enqueue

    def spy_enqueue(db, **kwargs):
        enqueued.append(kwargs)
        return orig_enqueue(db, **kwargs)

    monkeypatch.setattr(customer_satisfaction, "enqueue", spy_enqueue)

    client = TestClient(app)
    headers = _auth_headers(TENANT_A, "admin", f"u-admin-{TENANT_A}")

    # Query strings / campos extras no context falham fechados com 422
    bad_res = client.post(
        "/api/support/feedback",
        headers=headers,
        json={
            "kind": "problem",
            "message": "Erro ao salvar impressão da cozinha.",
            "page_path": "/",
            "context": {
                "surface": "caixa",
                "last_error_endpoint": "/api/print-jobs?token=secret",
            },
        },
    )
    assert bad_res.status_code == 422

    bad_extra = client.post(
        "/api/support/feedback",
        headers=headers,
        json={
            "kind": "problem",
            "message": "Erro com campo extra proibido.",
            "context": {"surface": "caixa", "unexpected_field": "x"},
        },
    )
    assert bad_extra.status_code == 422

    # Payload contextual válido
    ok_res = client.post(
        "/api/support/feedback",
        headers=headers,
        json={
            "kind": "problem",
            "message": "O computador da cozinha parou de imprimir os pedidos.",
            "page_path": "/?view=caixa&token=should-strip",
            "context": {
                "surface": "caixa",
                "navigation_id": "config_impressao",
                "frontend_version": "c01e5f9b3786",
                "last_support_code": "req-abc12345",
                "last_error_status": 502,
                "last_error_area": "printing",
                "last_error_endpoint": "/api/print-jobs",
                "detected_issue_codes": ["PRINT_AGENT_OFFLINE", "PRINT_JOBS_STUCK"],
            },
        },
    )
    assert ok_res.status_code == 201, ok_res.text
    feedback_id = ok_res.json()["id"]

    with SessionLocal() as db:
        saved = db.get(CustomerSupportFeedback, feedback_id)
        assert saved is not None
        assert saved.page_path == "/"
        assert saved.context_metadata is not None
        assert saved.context_metadata["navigation_id"] == "config_impressao"
        assert saved.context_metadata["last_support_code"] == "req-abc12345"
        assert saved.context_metadata["classification"] == {
            "area": "impressao",
            "priority": "high",
        }
        assert "should-strip" not in saved.message

    assert len(enqueued) == 1
    notif = enqueued[0]
    assert notif["telegram_chat"] == "999111222"
    assert "npm run ops:trace -- req-abc12345" in notif["message"]
    assert "DADO NÃO CONFIÁVEL" in notif["message"]
    assert "PRINT_AGENT_OFFLINE" in notif["message"]

    # Compatibilidade preservada para clientes sem campo context
    legacy_res = client.post(
        "/api/support/feedback",
        headers=headers,
        json={
            "kind": "question",
            "message": "Onde troco a senha do caixa?",
            "page_path": "/caixa",
        },
    )
    assert legacy_res.status_code == 201, legacy_res.text
