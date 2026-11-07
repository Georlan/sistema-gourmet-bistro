from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import datetime
from pathlib import Path
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.contract_models import ContractAcceptance, RestaurantContractAcceptance
from app.database import TenantSession
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.models import (
    Comanda,
    ConfiguracaoRestaurante,
    ProductImageRetirement,
    Restaurante,
    SuperAdminAuditLog,
    Usuario,
)
from app.restaurant_profile_models import RestauranteOperationProfile
from app.routes import (
    contracts,
    signups,
    super_admin_contracts,
    super_admin_onboarding,
    super_admin_profile_onboarding,
)
from app.routes.super_admin_onboarding import restaurant_trials
from app.saas_billing_models import SaaSBillingSetup, SaaSSubscription
from app.services import restaurant_provisioning, tenant_id_reuse
from app.signup_models import RestaurantSignup, SignupNotification

VALID_CPF = "52998224725"
VALID_CNPJ = "11222333000181"
BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _documents() -> dict[str, dict]:
    return {
        "terms": {
            "slug": "termos",
            "title": "Termos de Contratação e Uso do KÔMA",
            "version": LEGAL_VERSION,
            "effectiveDate": "05/09/2026",
            "sections": [{"title": "Objeto", "paragraphs": ["Snapshot de teste."]}],
        },
        "commercial": {
            "slug": "planos",
            "title": "Condições Comerciais dos Planos KÔMA",
            "version": LEGAL_VERSION,
            "effectiveDate": "05/09/2026",
            "sections": [{"title": "Preço", "paragraphs": ["Snapshot de teste."]}],
        },
        "dpa": {
            "slug": "dpa",
            "title": "Anexo de Tratamento de Dados",
            "version": LEGAL_VERSION,
            "effectiveDate": "05/09/2026",
            "sections": [{"title": "Papéis", "paragraphs": ["Snapshot de teste."]}],
        },
        "privacy": {
            "slug": "privacidade",
            "title": "Política de Privacidade do KÔMA",
            "version": LEGAL_VERSION,
            "effectiveDate": "05/09/2026",
            "sections": [{"title": "Transparência", "paragraphs": ["Snapshot de teste."]}],
        },
    }


def _contract_payload(name: str = "JE Lanches", email: str = "je@example.com") -> dict:
    return {
        "request_id": str(uuid.uuid4()),
        "contracting_party_name": f"{name} Ltda",
        "contracting_party_tax_id": VALID_CNPJ,
        "restaurant_name": name,
        "representative_name": "Responsável Legal",
        "representative_tax_id": VALID_CPF,
        "representative_role": "Proprietário",
        "email": email,
        "phone": "88997484108",
        "plan": "pocket",
        "billing_cycle": "mensal",
        "powers_declared": True,
        "legal_version": LEGAL_VERSION,
        "legal_source_commit": LEGAL_SOURCE_COMMIT,
        "legal_source_blob_sha": LEGAL_SOURCE_BLOB_SHA,
        "documents": _documents(),
    }


def _onboarding_payload(
    *,
    name: str = "Restaurante Teste",
    slug: str | None = None,
    restaurant_id: int | None = None,
) -> dict:
    suffix = uuid.uuid4().hex[:8]
    body: dict[str, object] = {
        "name": name,
        "subdomain": slug or f"rest-{suffix}",
        "plan": "pocket",
        "admin_name": "Admin Teste",
        "admin_email": f"admin-{suffix}@example.test",
        "temporary_password": f"Temp-{suffix}-123!",
    }
    if restaurant_id is not None:
        body["restaurant_id"] = restaurant_id
    return body


@pytest.fixture()
def isolated_env(monkeypatch):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    for tbl in (
        Restaurante.__table__,
        RestauranteOperationProfile.__table__,
        ConfiguracaoRestaurante.__table__,
        Usuario.__table__,
        SuperAdminAuditLog.__table__,
        Comanda.__table__,
        ProductImageRetirement.__table__,
        ContractAcceptance.__table__,
        RestaurantContractAcceptance.__table__,
        RestaurantSignup.__table__,
        SignupNotification.__table__,
        SaaSBillingSetup.__table__,
        SaaSSubscription.__table__,
        restaurant_trials,
    ):
        tbl.create(engine, checkfirst=True)

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE transaction_reset_backups (
                    backup_id TEXT NOT NULL,
                    restaurante_id INTEGER NOT NULL,
                    table_name TEXT NOT NULL,
                    row_count INTEGER NOT NULL,
                    data_json TEXT NOT NULL,
                    created_at TEXT,
                    legacy_tenant_label TEXT,
                    detached_from_active_id_at TEXT
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE storage_objects (
                    id TEXT PRIMARY KEY,
                    bucket_id TEXT NOT NULL,
                    name TEXT NOT NULL
                )
                """
            )
        )

    TestingSessionLocal = sessionmaker(
        bind=engine,
        class_=TenantSession,
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
    )

    # Semeia os tenants ativos de produção (especialmente o ID 6 protegido)
    with TestingSessionLocal() as db:
        for rid, rname, rslug in (
            (6, "Quentinha Caseira", "quentinha-caseira"),
            (7, "Espetaria", "espetaria"),
            (8, "D8 Burger", "d8-burger"),
            (9, "KÔMA QA Sandbox", "koma-qa-sandbox"),
        ):
            db.add(
                Restaurante(
                    id=rid,
                    nome=rname,
                    slug=rslug,
                    plano="pro",
                    saas_status="active",
                )
            )
        db.commit()

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr(contracts, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(super_admin_onboarding, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(
        super_admin_profile_onboarding, "SessionLocal", TestingSessionLocal
    )
    monkeypatch.setattr(super_admin_contracts, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(
        restaurant_provisioning,
        "pause_provider_during_onboarding",
        lambda subscription_id: {"id": subscription_id, "status": "paused"},
    )
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_NAME", "Prestador de Teste")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_TAX_ID", VALID_CPF)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_ADDRESS", "Endereço jurídico de teste, 100")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_LOCATION", "Limoeiro do Norte/CE")

    test_app = FastAPI()
    test_app.include_router(contracts.router)
    test_app.include_router(super_admin_onboarding.router, prefix="/api")
    test_app.include_router(
        super_admin_profile_onboarding.router, prefix="/api/super-admin"
    )
    test_app.include_router(
        super_admin_contracts.router, prefix="/api/super-admin"
    )
    test_app.include_router(signups.admin_router, prefix="/api/super-admin")

    test_app.dependency_overrides[signups.get_db] = override_get_db
    test_app.dependency_overrides[super_admin_onboarding.get_current_admin] = (
        lambda: {"user": "owner@koma.test", "role": "superadmin"}
    )

    with TestClient(test_app) as client:
        yield client, TestingSessionLocal, engine


def _seed_id1_production_backups(session_factory) -> None:
    """Insere os 15 registros de backup histórico de reset_r1_20260811_182741."""
    tables_counts = [
        ("caixa_movimentacoes", 1),
        ("caixa_turnos", 4),
        ("caixa_turnos_post_reset", 1),
        ("clientes", 1),
        ("comandas", 259),
        ("historico_fidelidade", 0),
        ("item_modificadores", 0),
        ("itens", 364),
        ("lancamentos", 296),
        ("mensagens_whatsapp", 0),
        ("otp_challenges", 1),
        ("pagamentos", 189),
        ("print_jobs", 46),
        ("public_rate_limits", 2),
        ("rascunhos_pedidos", 0),
    ]
    with session_factory() as db:
        for table_name, row_count in tables_counts:
            db.execute(
                text(
                    """
                    INSERT INTO transaction_reset_backups
                    (backup_id, restaurante_id, table_name, row_count, data_json, created_at)
                    VALUES (:b_id, 1, :t_name, :r_cnt, :d_json, '2026-08-11T18:28:59Z')
                    """
                ),
                {
                    "b_id": "reset_r1_20260811_182741",
                    "t_name": table_name,
                    "r_cnt": row_count,
                    "d_json": '[{"restaurante_id": 1}]' if row_count else "[]",
                },
            )
        db.commit()


def _seed_storage_orphans(session_factory, tenant_id: int, count: int, folder: str = "logo") -> None:
    with session_factory() as db:
        for idx in range(count):
            db.execute(
                text(
                    """
                    INSERT INTO storage_objects (id, bucket_id, name)
                    VALUES (:id, 'cardapio-assets', :name)
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "name": f"{tenant_id}/{folder}/file_{idx}.jpg",
                },
            )
        db.commit()


def _create_ready_contract(client: TestClient, session_factory, name: str = "JE Lanches") -> str:
    accepted = client.post(
        "/api/contracts/accept",
        json=_contract_payload(
            name=name,
            email=f"owner-{uuid.uuid4().hex[:6]}@jelanches.test",
        ),
    )
    assert accepted.status_code == 201, accepted.text
    protocol = accepted.json()["protocol"]

    with session_factory() as db:
        db.add(
            SaaSBillingSetup(
                protocol=protocol,
                provider="mercado_pago",
                payment_method_type="pix",
                status="ready",
                billing_cycle="monthly",
            )
        )
        db.commit()
    return protocol


def test_auto_selection_prioritizes_id_1_when_clean_and_preserves_tenant_6(
    isolated_env,
):
    client, session_factory, _ = isolated_env

    elig = client.get("/api/super-admin/restaurantes/id-eligibility")
    assert elig.status_code == 200, elig.text
    body = elig.json()
    assert body["suggestedId"] == 1
    assert body["priorityReport"]["id"] == 1
    assert body["priorityReport"]["eligible"] is True
    assert 6 not in body["eligibleIds"]
    assert body["eligibleIds"][:5] == [1, 2, 3, 4, 5]

    created = client.post(
        "/api/super-admin/restaurantes/provisionar",
        json=_onboarding_payload(name="JE Lanches Homolog", slug="je-lanches-homolog"),
    )
    assert created.status_code == 201, created.text
    created_data = created.json()
    assert created_data["id"] == "1"
    assert created_data["idSelectionMode"] == "auto_lowest_eligible"

    # O próximo provisionamento automático deve sugerir e usar o ID 2
    second = client.post(
        "/api/super-admin/restaurantes",
        json=_onboarding_payload(name="Segundo Tenant", slug="segundo-tenant"),
    )
    assert second.status_code == 201, second.text
    assert second.json()["id"] == "2"

    # Garante que o tenant 6 permaneceu intacto
    with session_factory() as db:
        tenant_6 = db.query(Restaurante).filter(Restaurante.id == 6).one()
        assert tenant_6.slug == "quentinha-caseira"
        assert tenant_6.nome == "Quentinha Caseira"


def test_manual_selection_of_eligible_id_across_superadmin_flows(isolated_env):
    client, session_factory, _ = isolated_env

    # 1. Escolha manual via /api/super-admin/restaurantes/provisionar
    resp_prov = client.post(
        "/api/super-admin/restaurantes/provisionar",
        json=_onboarding_payload(
            name="Manual Quatro",
            slug="manual-quatro",
            restaurant_id=4,
        ),
    )
    assert resp_prov.status_code == 201, resp_prov.text
    assert resp_prov.json()["id"] == "4"
    assert resp_prov.json()["idSelectionMode"] == "manual"

    # 2. Escolha manual via /api/super-admin/contracts/{protocol}/activate
    protocol_act = _create_ready_contract(client, session_factory, name="Contrato ID Cinco")
    resp_act = client.post(
        f"/api/super-admin/contracts/{protocol_act}/activate",
        json={
            "reason": "Ativação escolhendo manualmente o ID 5 elegível",
            "restaurant_id": 5,
        },
    )
    assert resp_act.status_code == 200, resp_act.text
    assert resp_act.json()["restaurantId"] == "5"

    # 3. Escolha manual via /api/super-admin/signups/{protocol}/release
    protocol_rel = _create_ready_contract(client, session_factory, name="Signup ID Tres")
    resp_rel = client.post(
        f"/api/super-admin/signups/{protocol_rel}/release",
        json={
            "reason": "Liberação escolhendo manualmente o ID 3 elegível",
            "restaurant_id": 3,
        },
    )
    assert resp_rel.status_code == 200, resp_rel.text
    assert resp_rel.json()["restaurant_id"] == "3"

    with session_factory() as db:
        audit_logs = (
            db.query(SuperAdminAuditLog)
            .filter(SuperAdminAuditLog.restaurante_id.in_([3, 4, 5]))
            .all()
        )
        assert len(audit_logs) == 3
        for log in audit_logs:
            assert log.after_data["id_selection_mode"] == "manual"
            assert log.after_data["requested_restaurant_id"] == log.restaurante_id


def test_occupied_id_6_is_rejected_and_protected(isolated_env):
    client, session_factory, _ = isolated_env

    resp = client.post(
        "/api/super-admin/restaurantes/provisionar",
        json=_onboarding_payload(
            name="Tentativa Colisao Seis",
            slug="colisao-seis",
            restaurant_id=6,
        ),
    )
    assert resp.status_code == 409, resp.text
    assert "#6" in resp.json()["detail"]
    assert "ocupado" in resp.json()["detail"].lower()

    protocol = _create_ready_contract(client, session_factory, name="Contrato Colisao Seis")
    resp_contract = client.post(
        f"/api/super-admin/contracts/{protocol}/activate",
        json={"reason": "Tentativa inválida de usar ID 6", "restaurant_id": 6},
    )
    assert resp_contract.status_code == 409, resp_contract.text
    assert "#6" in resp_contract.json()["detail"]

    with session_factory() as db:
        tenant_6 = db.query(Restaurante).filter(Restaurante.id == 6).one()
        assert tenant_6.slug == "quentinha-caseira"


def test_historical_id1_backups_and_storage_orphans_block_reuse_without_deleting_backups(
    isolated_env,
):
    client, session_factory, _ = isolated_env

    # Simula exatamente o cenário auditado em produção:
    # - ID 1 com 15 registros em transaction_reset_backups + 8 objetos em 1/logo/*
    # - ID 2 com 36 objetos em 2/products/*
    _seed_id1_production_backups(session_factory)
    _seed_storage_orphans(session_factory, tenant_id=1, count=8, folder="logo")
    _seed_storage_orphans(session_factory, tenant_id=2, count=36, folder="products")

    elig = client.get(
        "/api/super-admin/restaurantes/id-eligibility",
        params={"candidate_id": 1},
    )
    assert elig.status_code == 200, elig.text
    summary = elig.json()

    # Como IDs 1 e 2 possuem resíduos históricos, o menor ID elegível sugerido é o 3
    assert summary["suggestedId"] == 3
    assert summary["eligibleIds"][:4] == [3, 4, 5, 10]

    id1_report = summary["priorityReport"]
    assert id1_report["id"] == 1
    assert id1_report["eligible"] is False
    assert id1_report["status"] == "ineligible_history"
    blocker_codes = {b["code"] for b in id1_report["blockers"]}
    assert "historical_backup_residue" in blocker_codes
    assert "storage_prefix_residue" in blocker_codes

    backup_blocker = next(
        b for b in id1_report["blockers"] if b["code"] == "historical_backup_residue"
    )
    assert backup_blocker["count"] == 15
    assert "reset_r1_20260811_182741" in backup_blocker["detail"]

    # Escolha manual do ID 1 ou ID 2 deve ser bloqueada com 409 Conflict
    manual_id1 = client.post(
        "/api/super-admin/restaurantes/provisionar",
        json=_onboarding_payload(name="Tentativa ID 1", slug="tentativa-id-1", restaurant_id=1),
    )
    assert manual_id1.status_code == 409, manual_id1.text
    assert "reset_r1_20260811_182741" in manual_id1.json()["detail"]
    assert "cardapio-assets" in manual_id1.json()["detail"]

    manual_id2 = client.post(
        "/api/super-admin/restaurantes/provisionar",
        json=_onboarding_payload(name="Tentativa ID 2", slug="tentativa-id-2", restaurant_id=2),
    )
    assert manual_id2.status_code == 409, manual_id2.text
    assert "cardapio-assets" in manual_id2.json()["detail"]

    # Seleção automática pula IDs 1 e 2 e provisiona no ID 3 sem apagar nenhum backup
    auto_resp = client.post(
        "/api/super-admin/restaurantes/provisionar",
        json=_onboarding_payload(name="Tenant Auto Limpo", slug="tenant-auto-limpo"),
    )
    assert auto_resp.status_code == 201, auto_resp.text
    assert auto_resp.json()["id"] == "3"

    # Os 15 registros de backup permanecem 100% preservados
    with session_factory() as db:
        backup_count = db.execute(
            text("SELECT COUNT(*) FROM transaction_reset_backups WHERE restaurante_id = 1")
        ).scalar()
        assert int(backup_count) == 15


def test_id1_becomes_eligible_when_backups_are_non_destructively_detached_and_storage_cleaned(
    isolated_env,
):
    client, session_factory, _ = isolated_env
    _seed_id1_production_backups(session_factory)
    _seed_storage_orphans(session_factory, tenant_id=1, count=8, folder="logo")

    # Desacopla o backup para arquivo histórico sem apagar nenhuma das 15 linhas
    # e remove apenas os arquivos órfãos de storage sob 1/logo/*
    with session_factory() as db:
        db.execute(
            text(
                """
                UPDATE transaction_reset_backups
                   SET legacy_tenant_label = 'legacy_r1_20260811',
                       detached_from_active_id_at = '2026-11-03T20:00:00Z'
                 WHERE backup_id = 'reset_r1_20260811_182741'
                """
            )
        )
        db.execute(
            text(
                "DELETE FROM storage_objects WHERE bucket_id = 'cardapio-assets' AND name LIKE '1/%'"
            )
        )
        db.commit()

    elig = client.get("/api/super-admin/restaurantes/id-eligibility")
    assert elig.status_code == 200
    assert elig.json()["suggestedId"] == 1
    assert elig.json()["priorityReport"]["eligible"] is True

    # Verifica que todas as 15 linhas de backup continuam preservadas
    with session_factory() as db:
        preserved_count = db.execute(
            text(
                "SELECT COUNT(*) FROM transaction_reset_backups "
                "WHERE backup_id = 'reset_r1_20260811_182741'"
            )
        ).scalar()
        assert int(preserved_count) == 15


def test_public_table_or_audit_residue_blocks_historical_id_reuse(isolated_env):
    client, session_factory, _ = isolated_env

    # Insere um resíduo órfão em product_image_retirements para o ID 1
    # e um resíduo em comandas para o ID 2
    now = datetime.datetime.now(datetime.timezone.utc)
    with session_factory() as db:
        db.add(
            ProductImageRetirement(
                restaurante_id=1,
                object_path="1/products/orphan.webp",
                state="pending",
                reason="replaced",
                attempts=0,
                retired_at=now,
                eligible_after=now,
            )
        )
        db.add(
            Comanda(
                id="cmd-orphan-2",
                restaurante_id=2,
                garcom_id="garcom-1",
                numero_pedido="001",
            )
        )
        db.commit()

    elig = client.get("/api/super-admin/restaurantes/id-eligibility")
    assert elig.status_code == 200
    data = elig.json()
    assert data["suggestedId"] == 3

    resp_1 = client.post(
        "/api/super-admin/restaurantes",
        json=_onboarding_payload(name="Residue 1", slug="residue-1", restaurant_id=1),
    )
    assert resp_1.status_code == 409
    assert "product_image_retirements" in resp_1.json()["detail"]

    resp_2 = client.post(
        "/api/super-admin/restaurantes",
        json=_onboarding_payload(name="Residue 2", slug="residue-2", restaurant_id=2),
    )
    assert resp_2.status_code == 409
    assert "comandas" in resp_2.json()["detail"]


def test_id_selection_is_exclusive_to_superadmin_and_public_checkout_uses_sequence(
    isolated_env,
):
    client, session_factory, _ = isolated_env

    # Sem credencial Super Admin, o endpoint de elegibilidade falha fechado
    isolated_env_app = client.app
    saved_override = isolated_env_app.dependency_overrides.pop(
        super_admin_onboarding.get_current_admin, None
    )
    try:
        unauth = client.get("/api/super-admin/restaurantes/id-eligibility")
        assert unauth.status_code in {401, 403}
    finally:
        if saved_override is not None:
            isolated_env_app.dependency_overrides[
                super_admin_onboarding.get_current_admin
            ] = saved_override

    protocol = _create_ready_contract(client, session_factory, name="Checkout Publico")
    with session_factory() as db:
        acceptance = restaurant_provisioning.resolve_activation_acceptance(db, protocol)
        billing = (
            db.query(SaaSBillingSetup)
            .filter(SaaSBillingSetup.protocol == protocol)
            .one()
        )
        # Fluxo público (allow_id_reuse=False) proíbe requested_restaurant_id manual
        with pytest.raises( Exception ) as exc_info:
            restaurant_provisioning.provision_restaurant_for_contract(
                db,
                acceptance=acceptance,
                billing_setup=billing,
                actor="saas_checkout",
                requested_restaurant_id=1,
                allow_id_reuse=False,
            )
        assert getattr(exc_info.value, "status_code", None) == 403

        # Fluxo público sem allow_id_reuse aloca sequencialmente após o maior ID (9 -> 10),
        # preservando IDs baixos (1..5) exclusivos para decisão do Super Admin.
        res = restaurant_provisioning.provision_restaurant_for_contract(
            db,
            acceptance=acceptance,
            billing_setup=billing,
            actor="saas_checkout",
            allow_id_reuse=False,
        )
        assert res["restaurant_id"] == 10
        assert res["id_selection_mode"] == "sequence"


def test_concurrency_two_simultaneous_creations_never_receive_same_id(
    tmp_path, monkeypatch
):
    db_file = tmp_path / "concurrency_id_reuse.sqlite"
    engine = create_engine(
        f"sqlite+pysqlite:///{db_file}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    for tbl in (
        Restaurante.__table__,
        RestauranteOperationProfile.__table__,
        ConfiguracaoRestaurante.__table__,
        Usuario.__table__,
        SuperAdminAuditLog.__table__,
        restaurant_trials,
    ):
        tbl.create(engine, checkfirst=True)

    TestingSessionLocal = sessionmaker(
        bind=engine,
        class_=TenantSession,
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
    )

    with TestingSessionLocal() as db:
        db.add(
            Restaurante(
                id=6,
                nome="Quentinha Caseira",
                slug="quentinha-caseira",
                plano="pro",
                saas_status="active",
            )
        )
        db.commit()

    monkeypatch.setattr(super_admin_onboarding, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(
        super_admin_profile_onboarding, "SessionLocal", TestingSessionLocal
    )

    test_app = FastAPI()
    test_app.include_router(super_admin_onboarding.router, prefix="/api")
    test_app.include_router(
        super_admin_profile_onboarding.router, prefix="/api/super-admin"
    )
    test_app.dependency_overrides[super_admin_onboarding.get_current_admin] = (
        lambda: {"user": "owner@koma.test", "role": "superadmin"}
    )

    # 1. Duas criações simultâneas com seleção automática (restaurant_id=None)
    def auto_provision(idx: int):
        with TestClient(test_app) as local_client:
            return local_client.post(
                "/api/super-admin/restaurantes/provisionar",
                json=_onboarding_payload(
                    name=f"Auto Concorrente {idx}",
                    slug=f"auto-concorrente-{idx}",
                ),
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(auto_provision, 1), pool.submit(auto_provision, 2)]
        responses = [f.result() for f in futures]

    assert [r.status_code for r in responses] == [201, 201]
    assigned_ids = {int(r.json()["id"]) for r in responses}
    assert assigned_ids == {1, 2}

    # 2. Duas criações simultâneas disputando manualmente o mesmo ID 3
    def manual_provision(idx: int):
        with TestClient(test_app) as local_client:
            return local_client.post(
                "/api/super-admin/restaurantes/provisionar",
                json=_onboarding_payload(
                    name=f"Manual Concorrente {idx}",
                    slug=f"manual-concorrente-{idx}",
                    restaurant_id=3,
                ),
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(manual_provision, 1), pool.submit(manual_provision, 2)]
        manual_responses = [f.result() for f in futures]

    statuses = sorted(r.status_code for r in manual_responses)
    assert statuses == [201, 409]
    winner = next(r for r in manual_responses if r.status_code == 201)
    assert winner.json()["id"] == "3"


def test_postgresql_sequence_is_never_manipulated_with_setval():
    files_to_check = [
        BACKEND_ROOT / "app" / "services" / "tenant_id_reuse.py",
        BACKEND_ROOT / "app" / "routes" / "super_admin_onboarding.py",
        BACKEND_ROOT / "app" / "routes" / "super_admin_profile_onboarding.py",
        BACKEND_ROOT / "app" / "services" / "restaurant_provisioning.py",
        BACKEND_ROOT
        / "alembic"
        / "versions"
        / "f0a1b2c3d4e5_tenant_id_reuse_eligibility.py",
    ]
    for path in files_to_check:
        source = path.read_text(encoding="utf-8").lower()
        assert "setval(" not in source, f"Uso proibido de setval em {path.name}"
        assert "alter sequence" not in source, (
            f"Manipulação manual de sequência proibida em {path.name}"
        )
