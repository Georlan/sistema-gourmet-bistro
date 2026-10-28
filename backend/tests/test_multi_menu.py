"""Testes de ponta a ponta para múltiplos cardápios operacionais independentes."""
import uuid
import pytest
from decimal import Decimal
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock

from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.routes.auth import create_access_token
from app.models import (
    Cardapio,
    Categoria,
    ConfiguracaoRestaurante,
    Produto,
    Restaurante,
    Usuario,
    CaixaTurno,
)
from tools.prepare_id6_multi_menu import prepare_id6_multi_menu, MultiMenuPrepError

client = TestClient(app)


def _ensure_tenant(db, rest_id: int, nome: str, slug: str):
    rest = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not rest:
        rest = Restaurante(id=rest_id, nome=nome, plano="bistro", slug=slug, saas_status="active")
        db.add(rest)
        db.flush()
    else:
        rest.saas_status = "active"

    user = db.query(Usuario).filter(Usuario.email == f"admin_{rest_id}@koma.test").first()
    if not user:
        user = Usuario(
            id=str(uuid.uuid4()),
            restaurante_id=rest_id,
            email=f"admin_{rest_id}@koma.test",
            nome=f"Admin {rest_id}",
            role="admin",
            status="ativo",
            senha_hash="test-hash",
        )
        db.add(user)
        db.flush()
    else:
        user.status = "ativo"

    config = db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == rest_id).first()
    if not config:
        config = ConfiguracaoRestaurante(
            restaurante_id=rest_id,
            delivery_ativo=True,
            tipos_pedido_ativos=["consumo_local", "retirada", "delivery"],
            pedido_minimo=0.0,
            tipo_taxa_entrega="fixa",
            taxa_entrega_fixa=5.0,
        )
        db.add(config)
        db.flush()

    shift = db.query(CaixaTurno).filter_by(restaurante_id=rest_id, status="aberto").first()
    if not shift:
        db.add(CaixaTurno(restaurante_id=rest_id, aberto_por_id=user.id, saldo_inicial=0, status="aberto"))
        db.flush()

    db.commit()
    token = create_access_token(subject=user.id, restaurante_id=rest_id, role="admin")
    return rest, user, config, token


def test_multi_menu_tenant_isolation():
    """Valida isolamento multi-tenant: tenant A não acessa nem modifica cardápios de tenant B."""
    db = SessionLocal()
    token_var = current_restaurante_id.set(888)
    try:
        _, _, _, token_888 = _ensure_tenant(db, 888, "Tenant 888", "tenant-888")
        current_restaurante_id.set(889)
        _, _, _, token_889 = _ensure_tenant(db, 889, "Tenant 889", "tenant-889")

        # 1. Tenant 888 cria um cardápio
        headers_888 = {"Authorization": f"Bearer {token_888}"}
        res = client.post(
            "/produtos/menus",
            json={"nome": "Cardápio 888", "identificador": "menu-888", "ordem_exibicao": 1},
            headers=headers_888,
        )
        assert res.status_code == 201, res.text
        menu_888_id = res.json()["id"]

        # 2. Tenant 889 lista cardápios e NÃO deve ver o do 888
        headers_889 = {"Authorization": f"Bearer {token_889}"}
        res = client.get("/produtos/menus", headers=headers_889)
        assert res.status_code == 200
        data = res.json()
        assert not any(m["id"] == menu_888_id for m in data["cardapios"])

        # 3. Tenant 889 tenta publicar o cardápio do 888 -> 404
        res = client.post(f"/produtos/menus/{menu_888_id}/publicar", headers=headers_889)
        assert res.status_code == 404

        # 4. Tenant 889 tenta criar produto apontando para cardápio do 888 -> 400
        cat889 = Categoria(id="cat-889", restaurante_id=889, nome="Cat 889")
        db.add(cat889)
        db.commit()
        res = client.post(
            "/produtos/",
            json={
                "id": f"p889-{uuid.uuid4().hex[:6]}",
                "nome": "Produto Invasor",
                "categoria_id": "cat-889",
                "preco": 10.0,
                "cardapio_id": menu_888_id,
            },
            headers=headers_889,
        )
        assert res.status_code == 400
        assert "O cardápio informado não existe" in res.json()["detail"]
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_menu_publishing_and_switching():
    """Valida publicação manual e troca atômica entre cardápios."""
    db = SessionLocal()
    token_var = current_restaurante_id.set(887)
    try:
        rest, _, _, token = _ensure_tenant(db, 887, "Tenant 887", "tenant-887")
        headers = {"Authorization": f"Bearer {token}"}

        # Cria Manhã e Meio-Dia
        res1 = client.post(
            "/produtos/menus",
            json={"nome": "Manhã", "identificador": "manha", "ordem_exibicao": 1},
            headers=headers,
        )
        assert res1.status_code == 201
        menu_manha_id = res1.json()["id"]

        res2 = client.post(
            "/produtos/menus",
            json={"nome": "Meio-Dia", "identificador": "meio-dia", "ordem_exibicao": 2},
            headers=headers,
        )
        assert res2.status_code == 201
        menu_meio_dia_id = res2.json()["id"]

        # Publica Manhã
        with patch("app.routes.products.notify_catalog_update"):
            res_pub1 = client.post(f"/produtos/menus/{menu_manha_id}/publicar", headers=headers)
            assert res_pub1.status_code == 200
            assert res_pub1.json()["cardapio_ativo_id"] == menu_manha_id
            assert res_pub1.json()["cardapio_ativo_nome"] == "Manhã"

        # Verifica na API pública
        res_pub = client.get(f"/api/cardapio-digital/public?slug={rest.slug}")
        assert res_pub.status_code == 200
        assert res_pub.json()["restaurante"]["cardapio_ativo_id"] == menu_manha_id
        assert res_pub.json()["restaurante"]["cardapio_ativo_nome"] == "Manhã"

        # Publica Meio-Dia
        with patch("app.routes.products.notify_catalog_update"):
            res_pub2 = client.post(f"/produtos/menus/{menu_meio_dia_id}/publicar", headers=headers)
            assert res_pub2.status_code == 200
            assert res_pub2.json()["cardapio_ativo_id"] == menu_meio_dia_id
            assert res_pub2.json()["cardapio_ativo_nome"] == "Meio-Dia"

        # Verifica na API pública que Meio-Dia é agora o ativo
        res_pub = client.get(f"/api/cardapio-digital/public?slug={rest.slug}")
        assert res_pub.status_code == 200
        assert res_pub.json()["restaurante"]["cardapio_ativo_id"] == menu_meio_dia_id
        assert res_pub.json()["restaurante"]["cardapio_ativo_nome"] == "Meio-Dia"

        # Re-publicar Meio-Dia é idempotente
        res_idem = client.post(f"/produtos/menus/{menu_meio_dia_id}/publicar", headers=headers)
        assert res_idem.status_code == 200
        assert res_idem.json()["status"] == "publicado"
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_product_exclusive_membership_and_transfer():
    """Valida exclusividade do produto em um cardápio e transferência com preservação de ID."""
    db = SessionLocal()
    token_var = current_restaurante_id.set(886)
    try:
        rest, _, _, token = _ensure_tenant(db, 886, "Tenant 886", "tenant-886")
        headers = {"Authorization": f"Bearer {token}"}

        # Cria categoria
        cat886 = Categoria(id="cat-886", restaurante_id=886, nome="Geral 886")
        db.add(cat886)
        db.commit()

        # Cria 2 cardápios
        res_m1 = client.post("/produtos/menus", json={"nome": "Menu 1", "identificador": "m1"}, headers=headers)
        assert res_m1.status_code == 201
        m1_id = res_m1.json()["id"]
        res_m2 = client.post("/produtos/menus", json={"nome": "Menu 2", "identificador": "m2"}, headers=headers)
        assert res_m2.status_code == 201
        m2_id = res_m2.json()["id"]

        # Cria produto no Menu 1
        prod_id = f"p886-{uuid.uuid4().hex[:6]}"
        res_p = client.post(
            "/produtos/",
            json={
                "id": prod_id,
                "nome": "Item Exclusivo",
                "categoria_id": "cat-886",
                "preco": 25.50,
                "cardapio_id": m1_id,
            },
            headers=headers,
        )
        assert res_p.status_code == 201
        assert res_p.json()["cardapio_id"] == m1_id

        # Transfere produto para Menu 2
        res_patch = client.patch(
            f"/produtos/{prod_id}/cardapio",
            json={"cardapio_id": m2_id},
            headers=headers,
        )
        assert res_patch.status_code == 200
        assert res_patch.json()["cardapio_id"] == m2_id
        assert res_patch.json()["id"] == prod_id
        assert float(res_patch.json()["preco"]) == 25.50

        # Transfere para None (desatribuído)
        res_unassign = client.patch(
            f"/produtos/{prod_id}/cardapio",
            json={"cardapio_id": None},
            headers=headers,
        )
        assert res_unassign.status_code == 200
        assert res_unassign.json()["cardapio_id"] is None
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_digital_menu_and_order_validation():
    """Valida filtro do cardápio digital pelo cardápio ativo e bloqueio de produtos inativos no checkout."""
    db = SessionLocal()
    token_var = current_restaurante_id.set(885)
    try:
        rest, _, config, token = _ensure_tenant(db, 885, "Tenant 885", "tenant-885")
        headers = {"Authorization": f"Bearer {token}"}

        # Cria categorias
        cat1 = Categoria(id="cat-manha-885", restaurante_id=885, nome="Matinal")
        cat2 = Categoria(id="cat-almoco-885", restaurante_id=885, nome="Almoço")
        db.add_all([cat1, cat2])
        db.commit()

        # Cria Cardápios
        res_m1 = client.post("/produtos/menus", json={"nome": "Manhã", "identificador": "manha"}, headers=headers)
        assert res_m1.status_code == 201
        m1_id = res_m1.json()["id"]
        res_m2 = client.post("/produtos/menus", json={"nome": "Meio-Dia", "identificador": "meio-dia"}, headers=headers)
        assert res_m2.status_code == 201
        m2_id = res_m2.json()["id"]

        # Cria Produto 1 em Manhã e Produto 2 em Meio-Dia
        p1 = Produto(
            id="prod-cuscuz-885",
            restaurante_id=885,
            categoria_id="cat-manha-885",
            cardapio_id=m1_id,
            nome="Cuscuz com Ovo",
            preco=10.0,
            ativo=True,
        )
        p2 = Produto(
            id="prod-quentinha-885",
            restaurante_id=885,
            categoria_id="cat-almoco-885",
            cardapio_id=m2_id,
            nome="Quentinha G",
            preco=22.0,
            ativo=True,
        )
        db.add_all([p1, p2])
        db.commit()

        # Publica Manhã
        client.post(f"/produtos/menus/{m1_id}/publicar", headers=headers)

        # 1. Cardápio Digital deve retornar Cuscuz e categoria Matinal, mas NÃO Quentinha nem categoria Almoço
        res_digital = client.get(f"/api/cardapio-digital/public?slug={rest.slug}")
        assert res_digital.status_code == 200
        prods = res_digital.json()["produtos"]
        prod_ids = [p["id"] for p in prods]
        assert "prod-cuscuz-885" in prod_ids
        assert "prod-quentinha-885" not in prod_ids

        cats = res_digital.json()["categorias"]
        cat_ids = [c["id"] for c in cats]
        assert "cat-manha-885" in cat_ids
        assert "cat-almoco-885" not in cat_ids

        # 2. Checkout: Tentar pedir Quentinha (cardápio Meio-Dia, inativo no momento) deve ser REJEITADO (400)
        order_payload_invalid = {
            "restaurante_id": 885,
            "itens": [{"produto_id": "prod-quentinha-885", "quantidade": 1}],
            "cliente_nome": "Cliente Teste",
            "cliente_telefone": "11988887777",
            "endereco_entrega": "Rua Teste, 100",
            "forma_pagamento": "na_entrega",
            "tipo_pedido": "delivery",
        }
        res_order_bad = client.post("/cardapio/pedidos", json=order_payload_invalid)
        assert res_order_bad.status_code == 400
        assert "pertence a um cardápio inativo no momento" in res_order_bad.json()["detail"]

        # 3. Checkout: Pedir Cuscuz (cardápio Manhã, ativo) deve ter SUCESSO (201)
        order_payload_valid = {
            "restaurante_id": 885,
            "itens": [{"produto_id": "prod-cuscuz-885", "quantidade": 1}],
            "cliente_nome": "Cliente Teste",
            "cliente_telefone": "11988887777",
            "endereco_entrega": "Rua Teste, 100",
            "forma_pagamento": "na_entrega",
            "tipo_pedido": "delivery",
        }
        res_order_ok = client.post("/cardapio/pedidos", json=order_payload_valid)
        assert res_order_ok.status_code == 201
        assert res_order_ok.json()["status"] == "success"

        # 4. Agora troca o cardápio ativo para Meio-Dia
        client.post(f"/produtos/menus/{m2_id}/publicar", headers=headers)

        # 5. Agora o Cuscuz deve ser REJEITADO e a Quentinha deve ser ACEITA
        res_order_cuscuz = client.post("/cardapio/pedidos", json=order_payload_valid)
        assert res_order_cuscuz.status_code == 400
        assert "pertence a um cardápio inativo no momento" in res_order_cuscuz.json()["detail"]

        res_order_quentinha = client.post("/cardapio/pedidos", json=order_payload_invalid)
        assert res_order_quentinha.status_code == 201

    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_legacy_single_menu_tenant_non_regression():
    """Valida não-regressão: restaurantes com cardápio único continuam funcionando sem cardapio_ativo_id."""
    db = SessionLocal()
    token_var = current_restaurante_id.set(884)
    try:
        rest, _, config, token = _ensure_tenant(db, 884, "Tenant Legado 884", "tenant-884")
        # Garante que cardapio_ativo_id é None
        config.cardapio_ativo_id = None
        db.commit()

        # Cria produto sem cardapio_id
        cat = Categoria(id="cat-legada-884", restaurante_id=884, nome="Tradicional")
        db.add(cat)
        db.commit()

        p = Produto(
            id="prod-legado-884",
            restaurante_id=884,
            categoria_id="cat-legada-884",
            cardapio_id=None,
            nome="Pizza Tradicional",
            preco=45.0,
            ativo=True,
        )
        db.add(p)
        db.commit()

        # Digital menu retorna produto normalmente
        res_pub = client.get(f"/api/cardapio-digital/public?slug={rest.slug}")
        assert res_pub.status_code == 200
        assert res_pub.json()["restaurante"]["cardapio_ativo_id"] is None
        assert any(prod["id"] == "prod-legado-884" for prod in res_pub.json()["produtos"])

        # Pedido é aceito normalmente
        order_payload = {
            "restaurante_id": 884,
            "itens": [{"produto_id": "prod-legado-884", "quantidade": 1}],
            "cliente_nome": "Cliente Legado",
            "cliente_telefone": "11977776666",
            "endereco_entrega": "Rua Antiga, 50",
            "forma_pagamento": "na_entrega",
            "tipo_pedido": "delivery",
        }
        res_order = client.post("/cardapio/pedidos", json=order_payload)
        assert res_order.status_code == 201
        assert res_order.json()["status"] == "success"
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_prepare_id6_tool_safety_and_idempotence():
    """Valida ferramenta de preparação: restrição ao tenant 6, pausa padrão e idempotência."""
    # Garante que tenant 6 existe no banco local de teste
    db = SessionLocal()
    token_var = current_restaurante_id.set(6)
    try:
        _ensure_tenant(db, 6, "Quentinhas Caseiras", "quentinhas-caseiras")
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    # Falha se tenant != 6
    with pytest.raises(MultiMenuPrepError):
        prepare_id6_multi_menu(tenant_id=999)

    # Executa dry-run
    res_dry = prepare_id6_multi_menu(tenant_id=6, apply=False)
    assert res_dry["apply"] is False
    assert res_dry["tenant_id"] == 6

    # Executa com apply
    res_apply1 = prepare_id6_multi_menu(tenant_id=6, apply=True)
    assert res_apply1["apply"] is True

    # Executa segunda vez: 100% idempotente
    res_apply2 = prepare_id6_multi_menu(tenant_id=6, apply=True)
    assert res_apply2["cardapio_manha"]["created"] is False
    assert res_apply2["cardapio_meio_dia"]["created"] is False
    assert len(res_apply2["products_created_morning"]) == 0
