"""Regressões permanentes da auditoria Red Team 02 (Administrador Malicioso de Tenant).

Cobre isolamento horizontal, escalação vertical (incluindo RT02-01 em
WaiterModifiersAdapter.handle_launch_items), proteção contra promoção indireta
em PATCH /auth/usuarios/{user_id} e enforcement de entitlements por plano.
"""

from __future__ import annotations

import uuid
import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine, tenant_session_scope
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    ConfiguracaoRestaurante,
    Cupom,
    Mesa,
    Produto,
    Restaurante,
    Usuario,
)
from app.security import create_access_token, get_password_hash


def _seed_rt02_tenant(db, rid: int, slug: str, plano: str) -> None:
    if db.query(Restaurante).filter(Restaurante.id == rid).first() is None:
        db.add(
            Restaurante(
                id=rid,
                nome=f"RT02 CI {rid}",
                slug=slug,
                plano=plano,
                saas_status="active",
            )
        )
        db.flush()
    if db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == rid).first() is None:
        db.add(ConfiguracaoRestaurante(restaurante_id=rid))
    if db.query(Categoria).filter(Categoria.id == f"rt02-ci-cat-{rid}").first() is None:
        db.add(Categoria(id=f"rt02-ci-cat-{rid}", restaurante_id=rid, nome=f"Cat {rid}"))
        db.flush()
    if db.query(Produto).filter(Produto.id == f"rt02-ci-prod-{rid}").first() is None:
        db.add(
            Produto(
                id=f"rt02-ci-prod-{rid}",
                restaurante_id=rid,
                categoria_id=f"rt02-ci-cat-{rid}",
                nome=f"Prato {rid}",
                preco=42.0,
                ativo=True,
            )
        )
    if db.query(Cupom).filter(Cupom.id == f"rt02-ci-cup-{rid}").first() is None:
        db.add(
            Cupom(
                id=f"rt02-ci-cup-{rid}",
                restaurante_id=rid,
                codigo=f"RT02CI{rid}",
                tipo_desconto="porcentagem",
                valor_desconto=10.0,
                ativo=True,
            )
        )
    if db.query(Mesa).filter(Mesa.restaurante_id == rid, Mesa.id == 1).first() is None:
        db.add(Mesa(id=1, restaurante_id=rid, capacidade=4, nome=f"Mesa {rid}-1"))
    for role in ("admin", "gerente", "caixa", "garcom", "cozinha", "motoboy"):
        uid = f"rt02-ci-{role}-{rid}"
        if db.query(Usuario).filter(Usuario.id == uid).first() is None:
            db.add(
                Usuario(
                    id=uid,
                    restaurante_id=rid,
                    nome=f"{role.title()} {rid}",
                    email=f"{role}.{rid}@rt02-ci.invalid",
                    cargo=role,
                    role=role,
                    status="ativo",
                    senha_hash=get_password_hash("StrongRT02CI!2026"),
                )
            )
    db.flush()
    if db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == rid, CaixaTurno.status == "aberto").first() is None:
        db.add(
            CaixaTurno(
                restaurante_id=rid,
                aberto_por_id=f"rt02-ci-admin-{rid}",
                saldo_inicial=100.0,
                status="aberto",
            )
        )
    if db.query(Comanda).filter(Comanda.id == f"rt02-ci-cmd-{rid}").first() is None:
        db.add(
            Comanda(
                id=f"rt02-ci-cmd-{rid}",
                restaurante_id=rid,
                garcom_id=f"rt02-ci-garcom-{rid}",
                mesa_id=1,
                numero_pedido=rid,
                tipo="Consumo no Local",
                fechada=False,
            )
        )
    db.commit()


@pytest.fixture(scope="module")
def rt02_client():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for rid, slug, plano in [
            (711, "rt02-ci-alpha", "premium"),
            (712, "rt02-ci-beta", "premium"),
            (713, "rt02-ci-pocket", "pocket"),
        ]:
            with tenant_session_scope(db, rid):
                _seed_rt02_tenant(db, rid, slug, plano)
    finally:
        db.close()

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


def _auth(uid: str, rid: int) -> dict[str, str]:
    token = create_access_token(subject=uid, restaurante_id=rid, token_version=1)
    return {"Authorization": f"Bearer {token}"}


def test_rt02_01_modifier_launch_blocks_non_salon_roles_on_empty_comanda(rt02_client: TestClient):
    """Regressão RT02-01: cozinha e motoboy não podem lançar itens via /cardapio/modificadores/lancamentos/{id}."""
    for role in ("cozinha", "motoboy"):
        headers = _auth(f"rt02-ci-{role}-711", 711)
        resp = rt02_client.post(
            "/cardapio/modificadores/lancamentos/rt02-ci-cmd-711",
            json={
                "garcom_id": f"rt02-ci-{role}-711",
                "itens": [{"produto_id": "rt02-ci-prod-711", "observacao": "", "modificador_ids": []}],
            },
            headers=headers,
        )
        assert resp.status_code == 403, f"{role} bypass: {resp.status_code} {resp.text}"

    # Garçom autorizado continua lançando normalmente
    resp_ok = rt02_client.post(
        "/cardapio/modificadores/lancamentos/rt02-ci-cmd-711",
        json={
            "garcom_id": "rt02-ci-garcom-711",
            "itens": [{"produto_id": "rt02-ci-prod-711", "observacao": "", "modificador_ids": []}],
        },
        headers=_auth("rt02-ci-garcom-711", 711),
    )
    assert resp_ok.status_code in (200, 201), resp_ok.text


def test_rt02_horizontal_isolation_and_spoofing_blocked(rt02_client: TestClient):
    """Admin malicioso do tenant 711 não lê nem altera recursos do tenant 712 mesmo falsificando headers."""
    h711_spoof = {
        **_auth("rt02-ci-admin-711", 711),
        "X-Tenant-ID": "712",
        "X-Restaurante-ID": "712",
    }

    assert rt02_client.get("/produtos/rt02-ci-prod-712", headers=h711_spoof).status_code == 404
    assert rt02_client.put("/produtos/rt02-ci-prod-712", json={"nome": "X", "preco": 1.0}, headers=h711_spoof).status_code == 404
    assert rt02_client.delete("/produtos/rt02-ci-prod-712", headers=h711_spoof).status_code == 404
    assert rt02_client.get("/comandas/rt02-ci-cmd-712", headers=h711_spoof).status_code == 404
    assert rt02_client.delete("/caixa/cupons/rt02-ci-cup-712", headers=h711_spoof).status_code == 404
    assert rt02_client.get("/caixa/config-cardapio/712", headers=h711_spoof).status_code == 404
    assert rt02_client.put("/caixa/config-cardapio/712", json={"nome": "Hacked"}, headers=h711_spoof).status_code == 404
    assert rt02_client.patch("/auth/usuarios/rt02-ci-garcom-712", json={"status": "inativo"}, headers=h711_spoof).status_code == 404
    assert rt02_client.post("/auth/lojas/712/entrar", headers=h711_spoof).status_code == 403
    assert rt02_client.post(
        "/caixa/comandas/rt02-ci-cmd-712/pagar",
        json={"valor": 1.0, "metodo": "pix", "idempotency_key": str(uuid.uuid4())},
        headers=h711_spoof,
    ).status_code == 404


def test_rt02_vertical_boundaries_and_plan_entitlements(rt02_client: TestClient):
    """Valida fronteiras verticais de papel, bloqueio de promoção para admin e entitlements de plano."""
    for role in ("garcom", "cozinha", "motoboy"):
        h = _auth(f"rt02-ci-{role}-711", 711)
        assert rt02_client.post("/caixa/turno/abrir", json={"saldo_inicial": 100}, headers=h).status_code == 403
        assert rt02_client.get("/estoque/insumos", headers=h).status_code == 403
        assert rt02_client.post("/caixa/funcionarios", json={"nome": "X", "telefone": "85999991111", "cargo": "garcom"}, headers=h).status_code == 403
        assert rt02_client.get("/api/subscription", headers=h).status_code == 403
        assert rt02_client.get("/api/super-admin/restaurantes", headers=h).status_code == 403

    h_admin_711 = _auth("rt02-ci-admin-711", 711)
    assert rt02_client.get("/api/super-admin/restaurantes", headers=h_admin_711).status_code == 403
    assert rt02_client.patch("/auth/usuarios/rt02-ci-garcom-711", json={"cargo": "admin"}, headers=h_admin_711).status_code in (403, 422)

    h_admin_713 = _auth("rt02-ci-admin-713", 713)
    assert rt02_client.get("/estoque/insumos", headers=h_admin_713).status_code == 403
    assert rt02_client.post(
        "/caixa/cupons",
        json={"codigo": "POCKET713", "tipo_desconto": "porcentagem", "valor_desconto": 10},
        headers=h_admin_713,
    ).status_code == 403
    assert rt02_client.get("/estoque/insumos", headers=h_admin_711).status_code == 200
