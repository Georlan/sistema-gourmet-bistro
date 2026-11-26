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
    Mesa,
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
from app.services.restaurant_provisioning import QA_OPERATION_START
from app.services.support_diagnostics import build_tenant_self_diagnosis
from app.session_models import UserSessionVersion
from app.signup_models import SignupNotification
from app.support_models import CustomerSupportFeedback, SupportInvestigation

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
        db.query(SupportInvestigation).filter(SupportInvestigation.restaurante_id == tid).delete()
        db.query(CustomerSupportFeedback).filter(CustomerSupportFeedback.restaurante_id == tid).delete()
        db.query(PrintJob).filter(PrintJob.restaurante_id == tid).delete()
        db.query(PrintAgentToken).filter(PrintAgentToken.restaurante_id == tid).delete()
        db.query(RestaurantPaymentAccount).filter(RestaurantPaymentAccount.restaurante_id == tid).delete()
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == tid).delete()
        db.query(Mesa).filter(Mesa.restaurante_id == tid).delete()
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
                    horarios_funcionamento=[{"days": "Todos os dias", "hours": "24h"}],
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
        mp_disconnected = RestaurantPaymentAccount(
            id="mp-disc-a",
            restaurante_id=TENANT_A,
            provider="mercado_pago",
            provider_user_id="seller-disc-a",
            status="disconnected",
        )
        mp_disconnected.access_token = "demo"
        mp_disconnected.webhook_secret = "demo"
        db.add(mp_disconnected)

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


def test_diagnostics_eliminates_false_positives_for_pix_printing_dinein_and_schedule():
    with SessionLocal() as db:
        # 1) Pix listado sem conta MP OAuth + Pro sem agentes ativos (apenas jobs antigos)
        rest_a = db.query(Restaurante).filter(Restaurante.id == TENANT_A).one()
        rest_a.formas_pagamento_aceitas = ["dinheiro", "pix"]
        rest_a.horarios_funcionamento = [{"days": "Todos os dias", "hours": "10:00 - 23:00"}]
        db.add(Categoria(id="cat-fp-a", restaurante_id=TENANT_A, nome="Bebidas"))
        db.flush()
        db.add(
            Produto(
                id="prod-fp-a",
                restaurante_id=TENANT_A,
                categoria_id="cat-fp-a",
                nome="Agua",
                preco=5.0,
                ativo=True,
            )
        )
        db.add(
            PrintJob(
                id="job-orphan-a",
                restaurante_id=TENANT_A,
                document_type="producao",
                destination="COZINHA",
                source_type="pedido",
                source_id="p-old",
                payload_text="teste",
                status="failed",
                idempotency_key="idem-orphan-a",
                created_at=datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2),
            )
        )

        # 2) Loja apenas consumo local (sem cardápio online e sem horários) + mesa cadastrada
        rest_b = db.query(Restaurante).filter(Restaurante.id == TENANT_B).one()
        rest_b.horarios_funcionamento = None
        cfg_b = db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == TENANT_B).one()
        cfg_b.tipos_pedido_ativos = ["consumo_local"]
        cfg_b.delivery_ativo = False
        cfg_b.loja_fechada_manualmente = True
        cfg_b.pedidos_online_pausados = True
        db.add(Categoria(id="cat-fp-b", restaurante_id=TENANT_B, nome="Pratos"))
        db.flush()
        db.add(
            Produto(
                id="prod-fp-b",
                restaurante_id=TENANT_B,
                categoria_id="cat-fp-b",
                nome="PF",
                preco=20.0,
                ativo=True,
            )
        )
        db.add(Mesa(id=1, restaurante_id=TENANT_B))
        db.commit()

        # Fora do horário (03:00 Fortaleza = 06:00 UTC): não alerta CASH_SHIFT_CLOSED, nem Pix offline, nem impressão
        outside_hours = datetime.datetime(2026, 11, 25, 6, 0, tzinfo=datetime.timezone.utc)
        diag_outside = build_tenant_self_diagnosis(db, TENANT_A, user_role="admin", now=outside_hours)
        codes_outside = {item["code"] for item in diag_outside["issues"]}
        assert "MERCADO_PAGO_DISCONNECTED" not in codes_outside
        assert "PRINT_AGENT_OFFLINE" not in codes_outside
        assert "PRINT_JOBS_STUCK" not in codes_outside
        assert "CASH_SHIFT_CLOSED" not in codes_outside

        # Dentro do horário (14:00 Fortaleza = 17:00 UTC): caixa fechado realmente bloqueia retirada/online
        inside_hours = datetime.datetime(2026, 11, 25, 17, 0, tzinfo=datetime.timezone.utc)
        diag_inside = build_tenant_self_diagnosis(db, TENANT_A, user_role="admin", now=inside_hours)
        codes_inside = {item["code"] for item in diag_inside["issues"]}
        assert "CASH_SHIFT_CLOSED" in codes_inside

        # Consumo no local puro não emite alertas de cardápio online, horário ou turno fechado
        diag_dinein = build_tenant_self_diagnosis(db, TENANT_B, user_role="admin", now=inside_hours)
        assert diag_dinein["issues"] == []
        assert diag_dinein["summary_status"] == "ok"


def test_diagnostics_surfaces_active_operational_qa():
    with SessionLocal() as db:
        db.add(Categoria(id="cat-qa-diag", restaurante_id=TENANT_A, nome="Lanches"))
        db.flush()
        db.add(
            Produto(
                id="prod-qa-diag",
                restaurante_id=TENANT_A,
                categoria_id="cat-qa-diag",
                nome="Burger",
                preco=30.0,
                ativo=True,
            )
        )
        db.add(
            SuperAdminAuditLog(
                restaurante_id=TENANT_A,
                actor="sa-1",
                action="SUPERADMIN_TENANT_ONBOARD",
                reason="Provisionamento inicial",
                after_data={"trial_status": "pending_setup"},
            )
        )
        expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=4)
        db.add(
            SuperAdminAuditLog(
                restaurante_id=TENANT_A,
                actor="sa-1",
                action=QA_OPERATION_START,
                reason="Janela QA para validação",
                after_data={
                    "mode": "operational_qa",
                    "expires_at": expires_at.isoformat(),
                    "hours": 4,
                    "token_hash": "demo-hash",
                },
            )
        )
        db.commit()

        diag = build_tenant_self_diagnosis(db, TENANT_A, user_role="admin")
        codes = {item["code"] for item in diag["issues"]}
        assert "OPERATIONAL_QA_ACTIVE" in codes
        assert "PROVISIONAL_PREPARATION" not in codes
        assert diag["operational_qa_active"] is True
        assert isinstance(diag["operational_qa_expires_at"], str)


def test_support_assistant_separates_unrelated_alerts_respects_role_and_escalates_possible_bug(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-test-token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "999111222")
    monkeypatch.delenv("KOMA_OWNER_EMAIL", raising=False)
    monkeypatch.delenv("KOMA_OWNER_WHATSAPP_PHONE", raising=False)

    from app.routes import customer_satisfaction

    monkeypatch.setattr(customer_satisfaction, "settings", SimpleNamespace(KOMA_OWNER_EMAIL=""))
    enqueued = []
    from app.services import signup_notifications

    orig_enqueue = signup_notifications.enqueue

    def spy_enqueue(db, **kwargs):
        enqueued.append(kwargs)
        return orig_enqueue(db, **kwargs)

    monkeypatch.setattr(customer_satisfaction, "enqueue", spy_enqueue)

    now = datetime.datetime.now(datetime.timezone.utc)
    with SessionLocal() as db:
        # Tenant A: produto ativo e entrega ok, MAS agente de impressão offline, pagamento com falha e caixa fechado
        cfg_a = db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == TENANT_A).one()
        cfg_a.tipos_pedido_ativos = ["delivery", "retirada"]
        cfg_a.delivery_ativo = True
        cfg_a.tipo_taxa_entrega = "fixa"
        cfg_a.taxa_entrega_fixa = 7.0
        db.add(Categoria(id="cat-asst-a", restaurante_id=TENANT_A, nome="Pizzas"))
        db.flush()
        db.add(
            Produto(
                id="prod-asst-a",
                restaurante_id=TENANT_A,
                categoria_id="cat-asst-a",
                nome="Calabresa",
                preco=45.0,
                ativo=True,
            )
        )
        db.add(
            PrintAgentToken(
                id="agent-asst-a",
                restaurante_id=TENANT_A,
                agent_id="balcao-1",
                token_hash="hash-asst-a",
                ativo=True,
                last_seen_at=now - datetime.timedelta(minutes=30),
            )
        )
        mp_err = RestaurantPaymentAccount(
            id="mp-err-a",
            restaurante_id=TENANT_A,
            provider="mercado_pago",
            provider_user_id="seller-err-a",
            status="error",
        )
        mp_err.access_token = "demo"
        mp_err.webhook_secret = "demo"
        db.add(mp_err)

        # Tenant B saudável para validar isolamento de alertas do Tenant A
        db.add(Categoria(id="cat-asst-b", restaurante_id=TENANT_B, nome="Pratos"))
        db.flush()
        db.add(
            Produto(
                id="prod-asst-b",
                restaurante_id=TENANT_B,
                categoria_id="cat-asst-b",
                nome="Prato Dia",
                preco=28.0,
                ativo=True,
            )
        )
        db.add(
            CaixaTurno(
                restaurante_id=TENANT_B,
                aberto_por_id=f"u-gerente-{TENANT_B}",
                status="aberto",
                saldo_inicial=50.0,
            )
        )
        db.commit()

    client = TestClient(app)

    # 1) Dúvida/problema de entrega com entrega ok NÃO culpa impressão nem Mercado Pago
    rest_a_ok = client.post(
        "/api/support/assist",
        headers=_auth_headers(TENANT_A, "admin", f"u-admin-{TENANT_A}"),
        json={
            "topic": "entrega",
            "kind": "problem",
            "message": "A taxa por bairro não salva ao editar a entrega.",
        },
    )
    assert rest_a_ok.status_code == 200, rest_a_ok.text
    body = rest_a_ok.json()
    assert body["interpreted_domain"] == "entrega"
    assert body["evidence_status"] == "possible_bug_no_config_blocker"
    assert body["suspected_bug"] is True
    assert "DELIVERY_CONFIG_INCOMPLETE" not in [c["code"] for c in body["related_checks"]]
    assert "PRINT_AGENT_OFFLINE" not in [c["code"] for c in body["related_checks"]]
    assert "MERCADO_PAGO_ERROR" not in [c["code"] for c in body["related_checks"]]
    assert body["unrelated_observations_count"] >= 2

    # 2) Quando há support_code/erro técnico, evidencia falha de API
    err_res = client.post(
        "/api/support/assist",
        headers=_auth_headers(TENANT_A, "admin", f"u-admin-{TENANT_A}"),
        json={
            "message": "Deu erro ao salvar configurações.",
            "context": {
                "surface": "caixa",
                "last_support_code": "req-err9981",
                "last_error_status": 500,
                "last_error_area": "delivery",
            },
        },
    )
    assert err_res.status_code == 200, err_res.text
    assert err_res.json()["evidence_status"] == "api_error_detected"
    assert err_res.json()["suspected_bug"] is True

    # 3) Garçom nunca recebe alertas administrativos (TENANT_SUSPENDED / MERCADO_PAGO_ERROR) nem go_id gerencial
    waiter_res = client.post(
        "/api/support/assist",
        headers=_auth_headers(TENANT_A, "garcom", f"u-garcom-{TENANT_A}"),
        json={
            "topic": "pagamentos",
            "message": "Quero conferir o pagamento da loja.",
        },
    )
    assert waiter_res.status_code == 200, waiter_res.text
    waiter_body = waiter_res.json()
    assert waiter_body["related_checks"] == []
    assert all(step.get("go_id") is None for step in waiter_body["guided_steps"])

    # 4) Tenant B isolado continua sem contaminação do Tenant A
    res_b = client.post(
        "/api/support/assist",
        headers=_auth_headers(TENANT_B, "gerente", f"u-gerente-{TENANT_B}"),
        json={"topic": "entrega", "message": "Configurando taxa de entrega."},
    )
    assert res_b.status_code == 200, res_b.text
    assert res_b.json()["unrelated_observations_count"] == 0

    # 5) Encaminhamento com suspected_bug gera [POSSÍVEL BUG] + prioridade high + ops:triage
    escalate_res = client.post(
        "/api/support/feedback",
        headers=_auth_headers(TENANT_A, "admin", f"u-admin-{TENANT_A}"),
        json={
            "kind": "problem",
            "message": "Taxa de entrega não salva ao clicar em salvar.",
            "page_path": "/",
            "context": {
                "surface": "caixa",
                "interpreted_domain": "entrega",
                "suspected_bug": True,
                "evidence_status": "possible_bug_no_config_blocker",
            },
        },
    )
    assert escalate_res.status_code == 201, escalate_res.text
    assert len(enqueued) == 1
    assert enqueued[0]["subject"].startswith("[POSSÍVEL BUG] ")
    assert f"npm run ops:triage -- --tenant {TENANT_A}" in enqueued[0]["message"]
    assert "suspeita_bug=sim" in enqueued[0]["message"]

