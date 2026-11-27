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

from app.database import Base, SessionLocal, engine, tenant_session_scope  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Categoria, Produto, Restaurante, SuperAdminAuditLog, Usuario  # noqa: E402
from app.security import create_access_token, superadmin_session_generation  # noqa: E402
from app.services.express_provisioning_parser import parse_express_provisioning_input  # noqa: E402
from app.services.restaurant_provisioning import (  # noqa: E402
    get_active_operational_qa_record,
    is_provisional_preparation,
)

Base.metadata.create_all(bind=engine)
client = TestClient(app)


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
