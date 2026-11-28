from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("SECRET_KEY", "test-key")
os.environ.setdefault("ENCRYPTION_KEY", "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=")
os.environ.setdefault("SUPERADMIN_USERNAME", "superadmin-test")
os.environ.setdefault(
    "SUPERADMIN_PASSWORD_HASH",
    "$2b$12$testtesttesttesttestteOqK5Q4Q4Q4Q4Q4Q4Q4Q4Q4Q4Q4Q4Q4Q",
)

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import app.saas_billing_models  # noqa: E402, F401
from app.contract_models import ContractEvidenceBase  # noqa: E402
from app.database import Base, SessionLocal, engine, tenant_session_scope  # noqa: E402
from app.legal_config import (  # noqa: E402
    LEGAL_SOURCE_BLOB_SHA,
    LEGAL_SOURCE_COMMIT,
    LEGAL_VERSION,
)
from app.main import app  # noqa: E402
from app.models import Categoria, Produto, Restaurante, SuperAdminAuditLog, Usuario  # noqa: E402
from app.routes import universal_provisioning as universal_provisioning_routes  # noqa: E402
from app.security import create_access_token, superadmin_session_generation  # noqa: E402
from app.services.express_provisioning_parser import parse_express_provisioning_input  # noqa: E402
from app.services.restaurant_provisioning import (  # noqa: E402
    get_active_operational_qa_record,
    is_provisional_preparation,
)
from app.signup_models import SignupBase  # noqa: E402

Base.metadata.create_all(bind=engine)
ContractEvidenceBase.metadata.create_all(bind=engine)
SignupBase.metadata.create_all(bind=engine)
client = TestClient(app)


def _reset_public_rate_limiters():
    Base.metadata.create_all(bind=engine)
    ContractEvidenceBase.metadata.create_all(bind=engine)
    SignupBase.metadata.create_all(bind=engine)
    universal_provisioning_routes._public_preview_limiter.history.clear()
    universal_provisioning_routes._public_start_limiter.history.clear()
    universal_provisioning_routes._public_start_hourly_limiter.history.clear()


def _legal_documents() -> dict[str, dict]:
    return {
        "terms": {"slug": "termos", "version": LEGAL_VERSION, "sections": []},
        "commercial": {"slug": "planos", "version": LEGAL_VERSION, "sections": []},
        "dpa": {"slug": "dpa", "version": LEGAL_VERSION, "sections": []},
        "privacy": {"slug": "privacidade", "version": LEGAL_VERSION, "sections": []},
    }


def _superadmin_headers() -> dict[str, str]:
    token = create_access_token(
        subject=os.getenv("SUPERADMIN_USERNAME", "superadmin-test"),
        restaurante_id=0,
        role="superadmin",
        extra_claims={"sa_gen": superadmin_session_generation()},
    )
    return {"Authorization": f"Bearer {token}"}


def test_deterministic_express_parser_no_invention():
    text_sample = """
    Nome: Pizzaria Don Romano
    Segmento: Pizzaria
    Atendimento: Delivery, Retirada
    Horário: 18h às 23h
    Cardápio:
    Pizzas Tradicionais:
    Calabresa - R$ 49,90
    Marguerita - R$ 47,90
    Portuguesa - R$ 52,90
    Bebidas:
    Refrigerante Lata - R$ 7,50
    """
    parsed = parse_express_provisioning_input(
        structured_text=text_sample,
        require_admin_credentials=True,
    )
    fields = parsed["fields"]
    assert fields["name"] == "Pizzaria Don Romano"
    assert fields["slug"] == "pizzaria-don-romano"
    assert fields["operation_profile"] == "pizzaria"
    assert fields["segment_preset"] == "pizzaria"
    assert fields["order_types"] == ["delivery", "retirada"]
    assert fields["operating_hours"] == [{"days": "Todos os dias", "hours": "18:00 - 23:00"}]
    assert len(parsed["menu_items"]) == 4
    assert parsed["menu_items"][0]["category"] == "Pizzas Tradicionais"
    assert parsed["menu_items"][0]["price"] == 49.90
    assert parsed["menu_items"][3]["print_destination"] == "NENHUM"
    # Campos ausentes não são inventados
    assert fields["admin_name"] == ""
    assert fields["admin_email"] == ""
    assert parsed["missing_required_fields"] == ["admin_name", "admin_email"]


def test_public_autonomous_start_provisions_preparation_tenant_without_superadmin():
    _reset_public_rate_limiters()
    suffix = uuid.uuid4().hex[:8]
    email = f"dono-{suffix}@exemplo.test"
    idem_key = f"pub-{suffix}"

    res = client.post(
        "/api/provisioning/public/start",
        headers={"Idempotency-Key": idem_key},
        json={
            "name": f"Hamburgueria Autônoma {suffix}",
            "operation_profile": "generic",
            "segment_preset": "hamburgueria",
            "admin_name": "Maria Clara",
            "admin_email": email,
            "admin_password": "SenhaForte123!",
            "phone": "85988887777",
            "order_types": ["delivery", "retirada"],
            "operating_hours": [{"days": "Todos os dias", "hours": "18:00 - 23:00"}],
            "apply_segment_preset": True,
            "menu_text": "Hambúrgueres:\nSmash Clássico - R$ 29,90\nBebidas:\nSuco Natural - R$ 10,00",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    tenant_id = int(body["id"])
    assert body["origin"] == "public_self_service"
    assert body["preparationMode"] is True
    assert body["trial"]["status"] == "pending_setup"
    assert body["trial"]["startedAt"] is None
    assert body["commercialTermsStatus"] == "not_contracted"
    assert body["access_token"]
    assert body["user"]["restaurante_id"] == tenant_id
    assert body["user"]["role"] == "admin"
    assert body["bootstrap"]["categoriesCreated"] >= 5
    assert body["bootstrap"]["productsCreated"] == 2

    # Replay idempotente não duplica tenant
    replay = client.post(
        "/api/provisioning/public/start",
        headers={"Idempotency-Key": idem_key},
        json={
            "name": f"Hamburgueria Autônoma {suffix}",
            "admin_name": "Maria Clara",
            "admin_email": email,
            "admin_password": "SenhaForte123!",
        },
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["id"] == str(tenant_id)
    assert replay.json()["idempotentReplay"] is True

    # Verifica isolamento, modo preparação e bloqueio de canal público comercial
    db = SessionLocal()
    try:
        assert is_provisional_preparation(db, tenant_id, allow_qa=True) is True
        assert is_provisional_preparation(db, tenant_id, allow_qa=False) is True
        with tenant_session_scope(db, tenant_id):
            rest = db.query(Restaurante).filter(Restaurante.id == tenant_id).one()
            assert rest.horarios_funcionamento == [{"days": "Todos os dias", "hours": "18:00 - 23:00"}]
            cats = db.query(Categoria).filter(Categoria.restaurante_id == tenant_id).all()
            prods = db.query(Produto).filter(Produto.restaurante_id == tenant_id).all()
            assert len(cats) >= 5
            assert {p.nome for p in prods} == {"Smash Clássico", "Suco Natural"}
            audit = (
                db.query(SuperAdminAuditLog)
                .filter(SuperAdminAuditLog.restaurante_id == tenant_id)
                .one()
            )
            assert audit.action == "UNIVERSAL_TENANT_PROVISION"
            assert "SenhaForte" not in str(audit.after_data)
    finally:
        db.close()

    # Admin autônomo consegue consultar /api/onboarding/status com o token retornado
    onboarding_res = client.get(
        "/api/onboarding/status",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert onboarding_res.status_code == 200, onboarding_res.text
    status_data = onboarding_res.json()
    assert status_data["onboarding"]["provisionalPreparation"] is True
    assert status_data["steps"]["hours"] is True
    assert status_data["steps"]["catalog"] is True
    assert status_data["steps"]["operations"] is True

    # Canal público comercial permanece bloqueado enquanto estiver em preparação
    blocked_order = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": tenant_id,
            "cliente_nome": "Cliente Bloqueado",
            "cliente_telefone": "85999990000",
            "tipo_pedido": "retirada",
            "forma_pagamento": "na_entrega",
            "forma_pagamento_detalhe": "dinheiro",
            "itens": [{"produto_id": "qualquer", "quantidade": 1}],
        },
    )
    assert blocked_order.status_code == 403, blocked_order.text
    assert "preparação" in blocked_order.json()["detail"].lower()


def test_express_provisioning_scoped_token_dry_run_idempotency_and_qa_lab(monkeypatch):
    monkeypatch.setenv("KOMA_PROVISIONING_API_TOKEN", "scoped-express-secret-token")

    # Sem autenticação -> 401
    unauth = client.post("/api/provisioning/express", json={"name": "Sem Auth"})
    assert unauth.status_code == 401

    # Token errado -> 401/403 (fail-closed)
    wrong = client.post(
        "/api/provisioning/express",
        headers={"Authorization": "Bearer wrong-token"},
        json={"name": "Token Errado"},
    )
    assert wrong.status_code in (401, 403)

    suffix = uuid.uuid4().hex[:8]
    structured = f"""
Nome: Pizzaria Expresso {suffix}
Segmento: Pizzaria
Responsável: Lucas Almeida
Email: lucas-{suffix}@express.test
WhatsApp: 85991234567
Atendimento: Delivery, Retirada
Horário: 18h às 23h
Cardápio:
Pizzas Tradicionais:
Calabresa - R$ 49,90
Marguerita - R$ 47,90
""".strip()

    # Dry-run não cria tenant
    db = SessionLocal()
    before_count = db.query(Restaurante).count()
    db.close()

    dry = client.post(
        "/api/provisioning/express",
        headers={
            "Authorization": "Bearer scoped-express-secret-token",
            "X-Provisioning-Actor": "test-cli",
        },
        json={"structured_text": structured, "dry_run": True},
    )
    assert dry.status_code == 200, dry.text
    dry_data = dry.json()
    assert dry_data["dryRun"] is True
    assert dry_data["readyToProvision"] is True
    assert dry_data["bootstrap"]["productsCount"] == 2
    assert dry_data["missingFields"] == []

    db = SessionLocal()
    assert db.query(Restaurante).count() == before_count
    db.close()

    # Execução real com qa_lab=True + idempotência
    idem = f"express-{suffix}"
    created = client.post(
        "/api/provisioning/express",
        headers={
            "Authorization": "Bearer scoped-express-secret-token",
            "X-Provisioning-Actor": "test-cli",
            "Idempotency-Key": idem,
        },
        json={"structured_text": structured, "qa_lab": True, "apply_segment_preset": True},
    )
    assert created.status_code == 201, created.text
    created_data = created.json()
    tid = int(created_data["id"])
    assert created_data["origin"] == "express_api"
    assert created_data["qaLab"] is True
    assert created_data["qa"]["active"] is True
    assert created_data["qa"]["qaMenuPath"].startswith(f"/c/{created_data['subdomain']}?qa_token=")
    assert created_data["activation"]["mode"] == "invite_pending"
    assert created_data["activation"]["token"]
    assert created_data["bootstrap"]["productsCreated"] == 2

    # Replay idempotente retorna o mesmo tenant
    replay = client.post(
        "/api/provisioning/express",
        headers={
            "Authorization": "Bearer scoped-express-secret-token",
            "Idempotency-Key": idem,
        },
        json={"structured_text": structured, "qa_lab": True},
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["id"] == str(tid)
    assert replay.json()["idempotentReplay"] is True

    db = SessionLocal()
    try:
        with tenant_session_scope(db, tid):
            admin_user = db.query(Usuario).filter(Usuario.restaurante_id == tid, Usuario.cargo == "admin").one()
            assert admin_user.status == "pendente_ativacao"
            qa_rec = get_active_operational_qa_record(db, tid)
            assert qa_rec is not None
    finally:
        db.close()


def test_public_start_blocks_cross_tenant_email_collision_and_rate_limits():
    _reset_public_rate_limiters()
    suffix = uuid.uuid4().hex[:8]
    email = f"colisao-{suffix}@exemplo.test"

    first = client.post(
        "/api/provisioning/public/start",
        headers={"X-Idempotency-Key": f"col-1-{suffix}"},
        json={
            "name": f"Restaurante Um {suffix}",
            "admin_name": "Dono Um",
            "admin_email": email,
            "admin_password": "SenhaForte123!",
        },
    )
    assert first.status_code == 201, first.text

    # Segundo tenant com o mesmo e-mail (e chave diferente) deve falhar 409 sem criar conta duplicada
    second = client.post(
        "/api/provisioning/public/start",
        headers={"X-Idempotency-Key": f"col-2-{suffix}"},
        json={
            "name": f"Restaurante Dois {suffix}",
            "admin_name": "Dono Dois",
            "admin_email": email,
            "admin_password": "OutraSenha123!",
        },
    )
    assert second.status_code == 409, second.text
    assert "e-mail" in second.json()["detail"].lower()

    # Garante que rota pública rejeita/ignora tentativa de selecionar ID ou ativar qa_lab
    escalation = client.post(
        "/api/provisioning/public/start",
        json={
            "name": f"Tentativa Escala {suffix}",
            "admin_name": "Invasor",
            "admin_email": f"escala-{suffix}@exemplo.test",
            "admin_password": "SenhaForte123!",
            "qa_lab": True,
            "restaurant_id": 999,
        },
    )
    assert escalation.status_code == 422

    # Dispara mais criações para confirmar rate limit por minuto (3/min)
    for idx in range(2):
        _ = client.post(
            "/api/provisioning/public/start",
            json={
                "name": f"Loja Limite {idx} {suffix}",
                "admin_name": "Tester",
                "admin_email": f"lim-{idx}-{suffix}@exemplo.test",
                "admin_password": "SenhaForte123!",
            },
        )
    blocked_rate = client.post(
        "/api/provisioning/public/start",
        json={
            "name": f"Loja Quatro {suffix}",
            "admin_name": "Tester",
            "admin_email": f"lim-4-{suffix}@exemplo.test",
            "admin_password": "SenhaForte123!",
        },
    )
    assert blocked_rate.status_code == 429, blocked_rate.text
    _reset_public_rate_limiters()


def test_self_accept_links_contract_to_prepared_tenant_preserves_menu_and_unlocks_orders(monkeypatch):
    _reset_public_rate_limiters()
    from app.config import settings

    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", False)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_NAME", "Prestador Teste KOMA")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_TAX_ID", "52998224725")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_ADDRESS", "Rua Teste, 100")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_LOCATION", "Limoeiro do Norte/CE")

    suffix = uuid.uuid4().hex[:8]
    email = f"jornada-{suffix}@exemplo.test"
    started = client.post(
        "/api/provisioning/public/start",
        headers={"X-Idempotency-Key": f"self-{suffix}"},
        json={
            "name": f"Pizzaria Completa {suffix}",
            "operation_profile": "pizzaria",
            "segment_preset": "pizzaria",
            "admin_name": "Roberto Dono",
            "admin_email": email,
            "admin_password": "SenhaCompleta123!",
            "phone": "85988887777",
            "order_types": ["retirada", "delivery"],
            "operating_hours": [{"days": "Todos os dias", "hours": "00:00 - 23:59"}],
            "apply_segment_preset": True,
            "menu_text": "Pizzas Tradicionais:\nCalabresa - R$ 49,90",
        },
    )
    assert started.status_code == 201, started.text
    started_data = started.json()
    tenant_id = int(started_data["id"])
    admin_token = started_data["access_token"]
    slug = started_data["subdomain"]

    # Mesmo ainda incompleto no campo 'profile' ou antes de contratar, o pedido público é bloqueado (403)
    blocked = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": tenant_id,
            "cliente_nome": "Cliente Teste",
            "cliente_telefone": "85999991111",
            "tipo_pedido": "retirada",
            "forma_pagamento": "na_entrega",
            "forma_pagamento_detalhe": "dinheiro",
            "itens": [{"produto_id": "qualquer", "quantidade": 1}],
        },
    )
    assert blocked.status_code == 403

    # Conclui aceite contratual vinculado ao MESMO tenant via /api/contracts/self-accept
    accept_res = client.post(
        "/api/contracts/self-accept",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "request_id": str(uuid.uuid4()),
            "contracting_party_name": "Roberto Dono",
            "contracting_party_tax_id": "52998224725",
            "restaurant_name": f"Pizzaria Completa {suffix}",
            "representative_name": "Roberto Dono",
            "representative_tax_id": "52998224725",
            "representative_role": "Titular",
            "email": email,
            "phone": "85988887777",
            "plan": "pro",
            "billing_cycle": "mensal",
            "payment_method_type": "pix",
            "powers_declared": True,
            "legal_version": LEGAL_VERSION,
            "legal_source_commit": LEGAL_SOURCE_COMMIT,
            "legal_source_blob_sha": LEGAL_SOURCE_BLOB_SHA,
            "documents": _legal_documents(),
        },
    )
    assert accept_res.status_code == 201, accept_res.text
    accept_data = accept_res.json()
    assert accept_data["restaurantId"] == str(tenant_id)
    assert accept_data["slug"] == slug
    assert accept_data["trialStarted"] is True
    assert accept_data["status"] == "ready"

    # Segundo aceite no mesmo tenant deve ser bloqueado com 409
    duplicate_accept = client.post(
        "/api/contracts/self-accept",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "request_id": str(uuid.uuid4()),
            "contracting_party_name": "Roberto Dono",
            "contracting_party_tax_id": "52998224725",
            "restaurant_name": f"Pizzaria Completa {suffix}",
            "representative_name": "Roberto Dono",
            "representative_tax_id": "52998224725",
            "representative_role": "Titular",
            "email": email,
            "phone": "85988887777",
            "plan": "pro",
            "billing_cycle": "mensal",
            "payment_method_type": "pix",
            "powers_declared": True,
            "legal_version": LEGAL_VERSION,
            "legal_source_commit": LEGAL_SOURCE_COMMIT,
            "legal_source_blob_sha": LEGAL_SOURCE_BLOB_SHA,
            "documents": _legal_documents(),
        },
    )
    assert duplicate_accept.status_code == 409

    # Confirma prefill de operador no onboarding/status e formas de pagamento padrão no cardápio
    onboarding_res = client.get(
        "/api/onboarding/status",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert onboarding_res.status_code == 200, onboarding_res.text
    assert onboarding_res.json()["operator"] == {
        "name": "Roberto Dono",
        "email": email,
        "phone": "85988887777",
    }

    # Confirma preservação integral de produtos e liberação para o primeiro pedido
    db = SessionLocal()
    try:
        assert is_provisional_preparation(db, tenant_id, allow_qa=True) is False
        rest_row = db.query(Restaurante).filter(Restaurante.id == tenant_id).one()
        assert rest_row.formas_pagamento_aceitas == ["Pix", "Dinheiro"]
        with tenant_session_scope(db, tenant_id):
            prods = db.query(Produto).filter(Produto.restaurante_id == tenant_id).all()
            assert len(prods) == 1
            product_id = prods[0].id
    finally:
        db.close()

    # Abre o turno de caixa como o próprio administrador e envia o primeiro pedido público
    open_shift = client.post(
        "/caixa/turno/abrir",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"saldo_inicial": 0},
    )
    if open_shift.status_code == 422:
        open_shift = client.post(
            "/caixa/turno/abrir",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"valor_abertura": 0},
        )
    assert open_shift.status_code in (200, 201), open_shift.text

    first_order = client.post(
        "/cardapio/pedidos",
        headers={"X-Idempotency-Key": f"first-order-{suffix}"},
        json={
            "restaurante_id": tenant_id,
            "cliente_nome": "Primeiro Cliente",
            "cliente_telefone": "85999991111",
            "tipo_pedido": "retirada",
            "forma_pagamento": "na_entrega",
            "forma_pagamento_detalhe": "dinheiro",
            "itens": [{"produto_id": product_id, "quantidade": 1}],
        },
    )
    assert first_order.status_code in (200, 201), first_order.text
    _reset_public_rate_limiters()
