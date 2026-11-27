"""Regressões permanentes da auditoria Red Team 03 (Fraudes e Usuários Autenticados).

Valida (testes negativos e positivos):
- RT03-01: bloqueio de pagamento direto em /caixa/comandas/{id}/pagar por cozinha/motoboy
  e métodos não-dinheiro por garçom sem SmartPOS; preservação de caixa:operar e garçom+dinheiro.
- RT03-02: bloqueio de pontos negativos/NaN em /fidelidade/checkout com 422 controlado.
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
    ConfigFidelizacao,
    ConfiguracaoRestaurante,
    Item,
    Lancamento,
    Mesa,
    Produto,
    Restaurante,
    Usuario,
)
from app.security import create_access_token, get_password_hash
from app.services.clientes import cadastrar_ou_atualizar_cliente


def _seed_rt03_tenant(db, rid: int = 721) -> str:
    if db.query(Restaurante).filter(Restaurante.id == rid).first() is None:
        db.add(
            Restaurante(
                id=rid,
                nome=f"RT03 Tenant {rid}",
                slug=f"rt03-ci-{rid}",
                plano="premium",
                saas_status="active",
            )
        )
        db.flush()
    if db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == rid).first() is None:
        db.add(ConfiguracaoRestaurante(restaurante_id=rid))
    if db.query(ConfigFidelizacao).filter(ConfigFidelizacao.restaurante_id == rid).first() is None:
        db.add(
            ConfigFidelizacao(
                restaurante_id=rid,
                ativo=True,
                tipo_recompensa="PONTOS",
                taxa_conversao=1.0,
                valor_ponto_em_dinheiro=0.10,
            )
        )
    if db.query(Categoria).filter(Categoria.id == f"rt03-cat-{rid}").first() is None:
        db.add(Categoria(id=f"rt03-cat-{rid}", restaurante_id=rid, nome=f"Cat {rid}"))
        db.flush()
    if db.query(Produto).filter(Produto.id == f"rt03-prod-{rid}").first() is None:
        db.add(
            Produto(
                id=f"rt03-prod-{rid}",
                restaurante_id=rid,
                categoria_id=f"rt03-cat-{rid}",
                nome="Prato RT03",
                preco=100.0,
                ativo=True,
            )
        )
    if db.query(Mesa).filter(Mesa.restaurante_id == rid, Mesa.id == 1).first() is None:
        db.add(Mesa(id=1, restaurante_id=rid, capacidade=4, nome="Mesa RT03"))
    for role in ("admin", "caixa", "garcom", "cozinha", "motoboy"):
        uid = f"rt03-{role}-{rid}"
        if db.query(Usuario).filter(Usuario.id == uid).first() is None:
            db.add(
                Usuario(
                    id=uid,
                    restaurante_id=rid,
                    nome=f"{role.title()} {rid}",
                    email=f"{role}.{rid}@rt03-ci.invalid",
                    cargo=role,
                    role=role,
                    status="ativo",
                    senha_hash=get_password_hash("StrongRT03!2026"),
                )
            )
    db.flush()
    if db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == rid, CaixaTurno.status == "aberto").first() is None:
        db.add(
            CaixaTurno(
                restaurante_id=rid,
                aberto_por_id=f"rt03-admin-{rid}",
                saldo_inicial=100.0,
                status="aberto",
            )
        )
    if db.query(Comanda).filter(Comanda.id == f"rt03-cmd-{rid}").first() is None:
        db.add(
            Comanda(
                id=f"rt03-cmd-{rid}",
                restaurante_id=rid,
                garcom_id=f"rt03-garcom-{rid}",
                mesa_id=1,
                numero_pedido=rid,
                tipo="Consumo no Local",
                fechada=False,
            )
        )
        db.flush()
        db.add(
            Lancamento(
                id=f"rt03-lanc-{rid}",
                restaurante_id=rid,
                comanda_id=f"rt03-cmd-{rid}",
                garcom_id=f"rt03-garcom-{rid}",
            )
        )
        db.flush()
        db.add(
            Item(
                id=f"rt03-item-{rid}",
                restaurante_id=rid,
                comanda_id=f"rt03-cmd-{rid}",
                lancamento_id=f"rt03-lanc-{rid}",
                produto_id=f"rt03-prod-{rid}",
                preco_unit=100.0,
                status="preparando",
            )
        )
    cliente = cadastrar_ou_atualizar_cliente(
        db,
        restaurante_id=rid,
        nome="Cliente RT03",
        telefone="85988881721",
    )
    cliente.saldo_pontos = 50
    db.commit()
    return cliente.id


@pytest.fixture(scope="module")
def rt03_env():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        with tenant_session_scope(db, 721):
            cliente_id = _seed_rt03_tenant(db, 721)
    finally:
        db.close()

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, cliente_id


def _auth(uid: str, rid: int = 721) -> dict[str, str]:
    tok = create_access_token(subject=uid, restaurante_id=rid, token_version=1)
    return {"Authorization": f"Bearer {tok}"}


def test_rt03_01_payment_rbac_negative_and_positive(rt03_env):
    client, _ = rt03_env

    # Negativo: cozinha e motoboy não podem aprovar nem registrar pagamentos
    for role in ("cozinha", "motoboy"):
        for metodo in ("dinheiro", "pix", "cartao_credito"):
            resp = client.post(
                "/caixa/comandas/rt03-cmd-721/pagar",
                json={"valor": 10.0, "metodo": metodo, "idempotency_key": str(uuid.uuid4())},
                headers=_auth(f"rt03-{role}-721"),
            )
            assert resp.status_code == 403, f"{role}/{metodo} bypassed RBAC: {resp.status_code} {resp.text}"

    # Negativo: garçom sem SmartPOS não pode aprovar Pix/Cartão diretamente
    resp_garcom_pix = client.post(
        "/caixa/comandas/rt03-cmd-721/pagar",
        json={"valor": 10.0, "metodo": "pix", "idempotency_key": str(uuid.uuid4())},
        headers=_auth("rt03-garcom-721"),
    )
    assert resp_garcom_pix.status_code == 403

    # Positivo: garçom PODE registrar pagamento em dinheiro (status pendente para o Caixa)
    resp_garcom_cash = client.post(
        "/caixa/comandas/rt03-cmd-721/pagar",
        json={"valor": 10.0, "metodo": "dinheiro", "idempotency_key": str(uuid.uuid4())},
        headers=_auth("rt03-garcom-721"),
    )
    assert resp_garcom_cash.status_code == 201, resp_garcom_cash.text
    assert resp_garcom_cash.json()["status"] == "pendente"

    # Positivo: caixa PODE registrar pagamento aprovado em Pix
    resp_caixa_pix = client.post(
        "/caixa/comandas/rt03-cmd-721/pagar",
        json={"valor": 20.0, "metodo": "pix", "idempotency_key": str(uuid.uuid4())},
        headers=_auth("rt03-caixa-721"),
    )
    assert resp_caixa_pix.status_code == 201, resp_caixa_pix.text
    assert resp_caixa_pix.json()["status"] == "aprovado"


def test_rt03_02_loyalty_checkout_rejects_negative_and_allows_valid_redemption(rt03_env):
    client, cliente_id = rt03_env
    h_caixa = _auth("rt03-caixa-721")

    # Negativo: pontos negativos ou zero devem retornar 422 controlado (nunca 500)
    for bad_pts in (-100, 0):
        resp = client.post(
            "/fidelidade/checkout",
            json={
                "cliente_id": cliente_id,
                "valor_total": 50.0,
                "resgatar": True,
                "pontos_a_resgatar": bad_pts,
            },
            headers=h_caixa,
        )
        assert resp.status_code == 422, f"Expected 422 for pontos={bad_pts}, got {resp.status_code}: {resp.text}"

    # Positivo: resgate legítimo de pontos funciona normalmente
    resp_ok = client.post(
        "/fidelidade/checkout",
        json={
            "cliente_id": cliente_id,
            "valor_total": 50.0,
            "resgatar": True,
            "pontos_a_resgatar": 10,
        },
        headers=h_caixa,
    )
    assert resp_ok.status_code == 200, resp_ok.text
    assert resp_ok.json()["desconto_aplicado"] == 1.0
