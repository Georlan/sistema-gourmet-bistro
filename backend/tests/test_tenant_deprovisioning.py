from __future__ import annotations

import hashlib
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

import app.contract_models  # noqa: E402, F401
import app.fiscal_models  # noqa: E402, F401
import app.order_chat_models  # noqa: E402, F401
import app.saas_billing_models  # noqa: E402, F401
import app.session_models  # noqa: E402, F401
import app.signup_models  # noqa: E402, F401
from app.contract_models import ContractEvidenceBase  # noqa: E402
from app.database import Base, SessionLocal, engine, tenant_session_scope  # noqa: E402
from app.fiscal_models import FiscalDocument  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    CaixaTurno,
    Categoria,
    Comanda,
    ConfiguracaoRestaurante,
    GrupoModificador,
    IntegrationOutbox,
    Item,
    Lancamento,
    Mesa,
    OpcaoModificador,
    PrintAgentToken,
    PrintJob,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
    SuperAdminAuditLog,
    Usuario,
)
from app.order_chat_models import StaffPushSubscription  # noqa: E402
from app.saas_billing_models import SaaSCommercialGrant, SaaSSubscription  # noqa: E402
from app.security import create_access_token, get_password_hash  # noqa: E402
from app.signup_models import SignupBase  # noqa: E402

Base.metadata.create_all(bind=engine)
ContractEvidenceBase.metadata.create_all(bind=engine)
SignupBase.metadata.create_all(bind=engine)

client = TestClient(app)


def _provisioning_headers() -> dict[str, str]:
    token = create_access_token(
        subject=os.getenv("SUPERADMIN_USERNAME", "superadmin-test"),
        restaurante_id=0,
        role="superadmin",
    )
    return {"Authorization": f"Bearer {token}"}


def _seed_tenant_shell(tenant_id: int, *, name: str, slug: str) -> None:
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            existing = db.query(Restaurante).filter(Restaurante.id == tenant_id).one_or_none()
            if existing is None:
                db.add(
                    Restaurante(
                        id=tenant_id,
                        nome=name,
                        slug=slug,
                        plano="pro",
                        saas_status="active",
                        formas_pagamento_aceitas=["Pix", "Dinheiro"],
                    )
                )
                db.add(ConfiguracaoRestaurante(restaurante_id=tenant_id, impressao_nome_restaurante=name))
                db.commit()
    finally:
        db.close()


def _seed_rich_qa_tenant_10() -> tuple[str, str]:
    """Cria tenant ID 10 com grafo completo de dependências para homologar desligamento."""
    tenant_id = 10
    slug = "pizzaria-laboratorio-qa-10"
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            existing = db.query(Restaurante).filter(Restaurante.id == tenant_id).one_or_none()
            if existing is None:
                db.add(
                    Restaurante(
                        id=tenant_id,
                        nome="Pizzaria Laboratório KÔMA QA",
                        slug=slug,
                        plano="pro",
                        saas_status="active",
                        logo_url="10/logo/test-logo.webp",
                        formas_pagamento_aceitas=["Pix", "Dinheiro"],
                    )
                )
            db.flush()
            db.add(ConfiguracaoRestaurante(restaurante_id=tenant_id, impressao_nome_restaurante="Lab QA 10"))
            db.flush()

            user_id = str(uuid.uuid4())
            db.add(
                Usuario(
                    id=user_id,
                    restaurante_id=tenant_id,
                    nome="Operador QA 10",
                    email="qa10-offboard@exemplo.test",
                    cargo="admin",
                    status="ativo",
                    senha_hash=get_password_hash("SenhaQa10!123"),
                )
            )
            cat_id = f"cat-qa10-{uuid.uuid4().hex[:6]}"
            db.add(Categoria(id=cat_id, restaurante_id=tenant_id, nome="Pizzas", ordem_exibicao=1))
            db.flush()
            prod_id = f"prod-qa10-{uuid.uuid4().hex[:6]}"
            db.add(
                Produto(
                    id=prod_id,
                    restaurante_id=tenant_id,
                    categoria_id=cat_id,
                    nome="Calabresa QA",
                    preco=49.90,
                    ativo=True,
                )
            )
            grp_id = f"grp-qa10-{uuid.uuid4().hex[:6]}"
            db.add(
                GrupoModificador(
                    id=grp_id,
                    restaurante_id=tenant_id,
                    nome="Borda",
                    tipo="opcional",
                    min_selecoes=0,
                    max_selecoes=1,
                )
            )
            db.flush()
            db.add(
                OpcaoModificador(
                    id=f"opt-qa10-{uuid.uuid4().hex[:6]}",
                    restaurante_id=tenant_id,
                    grupo_id=grp_id,
                    nome="Catupiry",
                    preco_adicional=8.0,
                )
            )
            db.add(ProdutoGrupoModificador(restaurante_id=tenant_id, produto_id=prod_id, grupo_id=grp_id))
            db.add(Mesa(id=1, restaurante_id=tenant_id, nome="Mesa 01", capacidade=4))
            db.add(CaixaTurno(restaurante_id=tenant_id, aberto_por_id=user_id, saldo_inicial=50.0, status="aberto"))

            comanda_id = f"cmd-qa10-{uuid.uuid4().hex[:6]}"
            db.add(
                Comanda(
                    id=comanda_id,
                    restaurante_id=tenant_id,
                    garcom_id=user_id,
                    tipo="Retirada",
                    numero_pedido=1,
                    delivery_status="aceito",
                    onboarding_test=True,
                )
            )
            db.flush()
            lanc_id = f"lanc-qa10-{uuid.uuid4().hex[:6]}"
            db.add(
                Lancamento(
                    id=lanc_id,
                    restaurante_id=tenant_id,
                    comanda_id=comanda_id,
                    garcom_id=user_id,
                )
            )
            db.flush()
            db.add(
                Item(
                    id=f"item-qa10-{uuid.uuid4().hex[:6]}",
                    restaurante_id=tenant_id,
                    comanda_id=comanda_id,
                    lancamento_id=lanc_id,
                    produto_id=prod_id,
                    preco_unit=49.90,
                )
            )
            db.add(
                PrintAgentToken(
                    restaurante_id=tenant_id,
                    agent_id="android-qa-10",
                    token_hash=hashlib.sha256(b"token-qa-10").hexdigest(),
                    ativo=True,
                    is_primary=True,
                )
            )
            db.add(
                PrintJob(
                    restaurante_id=tenant_id,
                    document_type="producao",
                    destination="COZINHA",
                    source_type="pedido",
                    source_id=lanc_id,
                    payload_text="PEDIDO QA 10",
                    status="pending",
                    idempotency_key=f"pj-qa10-{uuid.uuid4().hex[:6]}",
                )
            )
            db.add(
                IntegrationOutbox(
                    restaurante_id=tenant_id,
                    event_id=f"evt-qa10-{uuid.uuid4().hex[:8]}",
                    event_name="koma.order.created",
                    aggregate_id=comanda_id,
                    payload={"tenant": 10},
                    status="pending",
                )
            )
            db.add(
                StaffPushSubscription(
                    restaurante_id=tenant_id,
                    usuario_id=user_id,
                    endpoint_hash=hashlib.sha256(b"push-staff-10").hexdigest(),
                    endpoint_ciphertext="cipher-endpoint",
                    p256dh_ciphertext="cipher-p256dh",
                    auth_ciphertext="cipher-auth",
                    enabled=True,
                )
            )
            db.commit()
    finally:
        db.close()

    user_jwt = create_access_token(
        subject=user_id,
        restaurante_id=tenant_id,
        role="admin",
        token_version=1,
    )
    return user_jwt, slug


def test_deprovision_requires_auth():
    res = client.post("/api/provisioning/tenants/10/deprovision", json={"dry_run": True})
    assert res.status_code == 401


def test_deprovision_blocks_protected_founders_paid_and_fiscal_tenants():
    headers = _provisioning_headers()
    _seed_tenant_shell(1, name="Modelo Protegido", slug="modelo-protegido")
    _seed_tenant_shell(6, name="Cliente Real 6", slug="cliente-real-6")
    _seed_tenant_shell(7, name="Founder Protegido 7", slug="founder-protegido-7")
    _seed_tenant_shell(8, name="Pago Ativo 8", slug="pago-ativo-8")
    _seed_tenant_shell(9, name="Fiscal Ativo 9", slug="fiscal-ativo-9")

    db = SessionLocal()
    try:
        db.add(
            SaaSCommercialGrant(
                restaurante_id=7,
                cohort_code="founders_5",
                fixed_monthly_price=0,
                active=True,
                granted_by="superadmin-test",
                reason="Proteção Founders",
            )
        )
        db.add(
            SaaSSubscription(
                restaurante_id=8,
                billing_cycle="monthly",
                payment_method_type="credit_card",
                status="active",
            )
        )
        db.add(
            FiscalDocument(
                restaurante_id=9,
                idempotency_key="fiscal-9-idem",
                environment="homologacao",
                status="authorized",
                total_amount=50.0,
                sale_snapshot={"total": 50.0},
            )
        )
        db.commit()
    finally:
        db.close()

    for blocked_id, expected_code in (
        (1, "protected_tenant"),
        (6, "protected_tenant"),
        (7, "active_founders_or_commercial_grant"),
        (8, "active_paid_subscription"),
        (9, "fiscal_retention_required"),
    ):
        plan_res = client.post(
            f"/api/provisioning/tenants/{blocked_id}/deprovision",
            headers=headers,
            json={"mode": "qa_purge", "dry_run": True},
        )
        assert plan_res.status_code == 200
        assert plan_res.json()["eligible"] is False
        assert any(b["code"] == expected_code for b in plan_res.json()["blockers"])

        exec_res = client.post(
            f"/api/provisioning/tenants/{blocked_id}/deprovision",
            headers=headers,
            json={
                "mode": "qa_purge",
                "dry_run": False,
                "expected_fingerprint": plan_res.json()["fingerprint"],
                "confirmation": plan_res.json()["expectedConfirmation"],
                "reason": "Tentativa que deve ser bloqueada por proteção",
            },
        )
        assert exec_res.status_code == 409


def test_tenant_10_complete_deprovision_verification_and_no_reuse_policy():
    headers = _provisioning_headers()
    _seed_tenant_shell(1, name="Modelo 1", slug="modelo-1")
    _seed_tenant_shell(6, name="Real 6", slug="real-6")
    qa10_user_jwt, qa10_slug = _seed_rich_qa_tenant_10()

    # Dry-run completo no ID 10
    plan_res = client.post(
        "/api/provisioning/tenants/10/deprovision",
        headers=headers,
        json={"mode": "qa_purge", "dry_run": True},
    )
    assert plan_res.status_code == 200, plan_res.text
    plan = plan_res.json()
    assert plan["exists"] is True
    assert plan["eligible"] is True
    assert plan["expectedConfirmation"] == "DEPROVISION_TENANT_10"
    assert plan["deleteTotal"] > 10
    assert "10/logo/test-logo.webp" in plan["storageAssets"]

    # Rejeita confirmação incorreta e fingerprint divergente
    bad_confirm = client.post(
        "/api/provisioning/tenants/10/deprovision",
        headers=headers,
        json={
            "mode": "qa_purge",
            "dry_run": False,
            "expected_fingerprint": plan["fingerprint"],
            "confirmation": "WRONG",
            "reason": "Homologação desligamento ID 10",
        },
    )
    assert bad_confirm.status_code == 422

    bad_fp = client.post(
        "/api/provisioning/tenants/10/deprovision",
        headers=headers,
        json={
            "mode": "qa_purge",
            "dry_run": False,
            "expected_fingerprint": "0" * 64,
            "confirmation": "DEPROVISION_TENANT_10",
            "reason": "Homologação desligamento ID 10",
        },
    )
    assert bad_fp.status_code == 409

    # Execução oficial da exclusão do ID 10
    exec_res = client.post(
        "/api/provisioning/tenants/10/deprovision",
        headers=headers,
        json={
            "mode": "qa_purge",
            "dry_run": False,
            "expected_fingerprint": plan["fingerprint"],
            "confirmation": plan["expectedConfirmation"],
            "reason": "Homologação oficial de desligamento integral do tenant QA ID 10",
        },
    )
    assert exec_res.status_code == 200, exec_res.text
    exec_data = exec_res.json()
    assert exec_data["alreadyDeprovisioned"] is False
    assert exec_data["deletedTotal"] >= plan["deleteTotal"]
    verification = exec_data["verification"]
    assert verification["clean"] is True
    assert verification["residualOperationalTotal"] == 0
    assert verification["auditLogsPreserved"] >= 1
    assert verification["idReusePolicy"]["reusable"] is False

    # Sessão antiga do ID 10 e cardápio público por ID/slug não funcionam mais
    old_session_check = client.get(
        "/api/onboarding/status",
        headers={"Authorization": f"Bearer {qa10_user_jwt}"},
    )
    assert old_session_check.status_code == 401
    assert client.get("/api/cardapio-digital/public?restaurante_id=10").status_code == 404
    assert client.get(f"/api/cardapio-digital/public?slug={qa10_slug}").status_code == 404

    # Idempotência em execução repetida + endpoint /verify dedicado
    repeat_res = client.post(
        "/api/provisioning/tenants/10/deprovision",
        headers=headers,
        json={
            "mode": "qa_purge",
            "dry_run": False,
            "confirmation": "DEPROVISION_TENANT_10",
            "reason": "Verificação idempotente após exclusão do ID 10",
        },
    )
    assert repeat_res.status_code == 200
    assert repeat_res.json()["alreadyDeprovisioned"] is True
    assert repeat_res.json()["deletedTotal"] == 0

    verify_res = client.get(
        "/api/provisioning/tenants/10/deprovision/verify",
        headers=headers,
    )
    assert verify_res.status_code == 200
    assert verify_res.json()["clean"] is True

    # Garante preservação dos outros tenants
    db = SessionLocal()
    try:
        assert db.query(Restaurante).filter(Restaurante.id == 1).one_or_none() is not None
        assert db.query(Restaurante).filter(Restaurante.id == 6).one_or_none() is not None
        assert (
            db.query(SuperAdminAuditLog)
            .filter(
                SuperAdminAuditLog.restaurante_id == 10,
                SuperAdminAuditLog.action == "TENANT_DEPROVISIONED",
            )
            .count()
            == 1
        )
    finally:
        db.close()


def test_client_offboarding_suspends_revokes_and_preserves_legal_history():
    headers = _provisioning_headers()
    tenant_id = 11
    _seed_tenant_shell(tenant_id, name="Cliente Cancelando 11", slug="cliente-cancelando-11")
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            uid = str(uuid.uuid4())
            db.add(
                Usuario(
                    id=uid,
                    restaurante_id=tenant_id,
                    nome="Dono 11",
                    email="dono11@exemplo.test",
                    cargo="admin",
                    status="ativo",
                    senha_hash=get_password_hash("Senha11!123"),
                )
            )
            db.add(
                PrintAgentToken(
                    restaurante_id=tenant_id,
                    agent_id="agent-11",
                    token_hash=hashlib.sha256(b"t11").hexdigest(),
                    ativo=True,
                    is_primary=True,
                )
            )
            db.add(
                PrintJob(
                    restaurante_id=tenant_id,
                    document_type="producao",
                    destination="COZINHA",
                    source_type="pedido",
                    source_id="src-11",
                    payload_text="Pendente 11",
                    status="pending",
                    idempotency_key="pj-11",
                )
            )
            db.add(
                Comanda(
                    id="cmd-11",
                    restaurante_id=tenant_id,
                    garcom_id=uid,
                    tipo="Retirada",
                    numero_pedido=1,
                    delivery_status="finalizado",
                )
            )
            db.commit()
    finally:
        db.close()

    old_jwt = create_access_token(
        subject=uid,
        restaurante_id=tenant_id,
        role="admin",
        token_version=1,
    )

    plan = client.post(
        f"/api/provisioning/tenants/{tenant_id}/deprovision",
        headers=headers,
        json={"mode": "client_offboarding", "dry_run": True},
    ).json()
    assert plan["eligible"] is True
    assert plan["expectedConfirmation"] == f"OFFBOARD_TENANT_{tenant_id}"

    offboard = client.post(
        f"/api/provisioning/tenants/{tenant_id}/deprovision",
        headers=headers,
        json={
            "mode": "client_offboarding",
            "dry_run": False,
            "expected_fingerprint": plan["fingerprint"],
            "confirmation": plan["expectedConfirmation"],
            "reason": "Solicitação formal de cancelamento contratual",
        },
    )
    assert offboard.status_code == 200, offboard.text
    # Sessão antiga imediatamente revogada e novo pedido público bloqueado (403)
    assert client.get("/api/onboarding/status", headers={"Authorization": f"Bearer {old_jwt}"}).status_code == 401
    assert client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": tenant_id,
            "cliente_nome": "Teste",
            "cliente_telefone": "85999990000",
            "tipo_pedido": "retirada",
            "forma_pagamento": "na_entrega",
            "forma_pagamento_detalhe": "dinheiro",
            "itens": [{"produto_id": "x", "quantidade": 1}],
        },
    ).status_code == 403

    db = SessionLocal()
    try:
        rest = db.query(Restaurante).filter(Restaurante.id == tenant_id).one()
        assert rest.saas_status == "suspended"
        with tenant_session_scope(db, tenant_id):
            agent = db.query(PrintAgentToken).filter(PrintAgentToken.restaurante_id == tenant_id).one()
            assert agent.ativo is False
            assert db.query(Comanda).filter(Comanda.id == "cmd-11").count() == 1
            assert db.query(PrintJob).filter(PrintJob.restaurante_id == tenant_id).count() == 0
    finally:
        db.close()


def test_verified_storage_cleanup_cross_tenant_protection_and_partial_retry(monkeypatch):
    import httpx
    from app.config import settings
    from app.services.tenant_deprovisioning import build_deprovision_plan, execute_deprovision

    monkeypatch.setattr(settings, "SUPABASE_URL", "https://proj.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "srv-secret-key")

    tid_target = 12
    tid_shared_holder = 13
    _seed_tenant_shell(tid_target, name="Loja Storage QA 12", slug="loja-storage-12")
    _seed_tenant_shell(tid_shared_holder, name="Loja Vizinha 13", slug="loja-vizinha-13")

    shared_path = f"{tid_target}/products/shared-foto.webp"
    exclusive_logo = f"{tid_target}/logo/logo-12.webp"
    exclusive_prod = f"{tid_target}/products/pizza-12.webp"
    exclusive_gallery = f"{tid_target}/products/galeria-12.webp"

    db = SessionLocal()
    try:
        with tenant_session_scope(db, tid_target):
            rest12 = db.query(Restaurante).filter(Restaurante.id == tid_target).one()
            rest12.logo_url = f"https://proj.supabase.co/storage/v1/object/public/cardapio-assets/{exclusive_logo}"
            rest12.banner_url = "https://external.cdn.invalid/unrelated.png"
            db.add(Categoria(id="cat-12", restaurante_id=tid_target, nome="Pizzas", ordem_exibicao=1))
            db.flush()
            db.add(
                Produto(
                    id="prod-12",
                    restaurante_id=tid_target,
                    categoria_id="cat-12",
                    nome="Pizza",
                    preco=50.0,
                    imagem=f"https://proj.supabase.co/storage/v1/object/public/cardapio-assets/{exclusive_prod}",
                    imagens_galeria=[
                        f"https://proj.supabase.co/storage/v1/object/public/cardapio-assets/{exclusive_gallery}",
                        f"https://proj.supabase.co/storage/v1/object/public/cardapio-assets/{shared_path}",
                    ],
                )
            )
            db.commit()

        with tenant_session_scope(db, tid_shared_holder):
            db.add(Categoria(id="cat-13", restaurante_id=tid_shared_holder, nome="Pizzas", ordem_exibicao=1))
            db.flush()
            db.add(
                Produto(
                    id="prod-13",
                    restaurante_id=tid_shared_holder,
                    categoria_id="cat-13",
                    nome="Pizza Compartilhada",
                    preco=55.0,
                    imagem=f"https://proj.supabase.co/storage/v1/object/public/cardapio-assets/{shared_path}",
                )
            )
            db.commit()

        plan = build_deprovision_plan(db, tid_target, mode="qa_purge")
        storage_plan = plan["storagePlan"]
        assert set(storage_plan["eligibleDeletePaths"]) == {
            exclusive_logo,
            exclusive_prod,
            exclusive_gallery,
        }
        assert shared_path in storage_plan["preservedSharedPaths"]
        assert "https://external.cdn.invalid/unrelated.png" in storage_plan["ignoredExternalOrUnowned"]

        # client_offboarding nunca apaga objetos de Storage
        offboard_plan = build_deprovision_plan(db, tid_target, mode="client_offboarding")
        assert offboard_plan["storagePlan"]["eligibleDeletePaths"] == []
        assert len(offboard_plan["storagePlan"]["retainedForOffboarding"]) >= 3

        # Simula falha transitória em um dos objetos no primeiro DELETE, depois sucesso idempotente no retry
        calls: list[list[str]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = request.read().decode("utf-8")
            import json as _json

            prefixes = _json.loads(body)["prefixes"]
            calls.append(prefixes)
            if prefixes == [exclusive_prod] and len(calls) <= 3:
                return httpx.Response(500, json={"error": "temporary"})
            return httpx.Response(200, json={"deleted": prefixes})

        mock_client = httpx.Client(transport=httpx.MockTransport(handler))
        exec_res = execute_deprovision(
            db,
            tid_target,
            mode="qa_purge",
            actor="agent:test:fp:12345678",
            reason="Teste limpeza storage com falha parcial",
            expected_fingerprint=plan["fingerprint"],
            confirmation=plan["expectedConfirmation"],
            storage_http_client=mock_client,
        )
        cleanup = exec_res["storageCleanup"]
        assert exclusive_logo in cleanup["deleted"]
        assert exclusive_gallery in cleanup["deleted"]
        assert shared_path not in [p for sub in calls for p in sub]
        assert cleanup["retryablePaths"] == [exclusive_prod]

        # Retomada idempotente usando retry_storage_paths
        retry_res = execute_deprovision(
            db,
            tid_target,
            mode="qa_purge",
            actor="agent:test:fp:12345678",
            reason="Retomada de objeto pendente no storage",
            confirmation=f"DEPROVISION_TENANT_{tid_target}",
            retry_storage_paths=cleanup["retryablePaths"] + ["13/logo/forbidden.webp"],
            storage_http_client=mock_client,
        )
        assert retry_res["alreadyDeprovisioned"] is True
        assert retry_res["storageCleanup"]["deleted"] == [exclusive_prod]
        assert retry_res["storageCleanup"]["retryablePaths"] == []
        assert "13/logo/forbidden.webp" in retry_res["storageCleanup"]["rejectedUnowned"]
        assert retry_res["verification"]["lastStorageCleanupAudit"]["deleted"] == [exclusive_prod]
    finally:
        db.close()
