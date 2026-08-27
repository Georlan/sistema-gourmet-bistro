import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal, current_restaurante_id
from app.models import Restaurante, Usuario, Categoria, Produto, ConfiguracaoRestaurante, Cupom, Cliente, Comanda
from app.routes.auth import create_access_token

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_checkout_test():
    db = SessionLocal()
    token = current_restaurante_id.set(999)
    try:
        rest = db.query(Restaurante).filter(Restaurante.id == 999).first()
        if not rest:
            rest = Restaurante(id=999, nome="Restaurante Teste 999", slug="rest-999")
            db.add(rest)
            db.commit()

        user = db.query(Usuario).filter(Usuario.id == "usr-admin-chk").first()
        if not user:
            user = Usuario(
                id="usr-admin-chk",
                restaurante_id=999,
                nome="Admin Checkout",
                email="chkadmin@koma.com",
                cargo="caixa",
                status="ativo",
            )
            db.add(user)
            db.commit()

        config = db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == 999).first()
        if not config:
            config = ConfiguracaoRestaurante(
                restaurante_id=999,
                delivery_ativo=True,
                pedido_minimo=30.0,
                frete_gratis_valor=100.0,
                tabela_taxas_bairros=[
                    {"bairro": "Centro", "taxa": 5.0},
                    {"bairro": "Boa Viagem", "taxa": 12.0},
                ],
            )
            db.add(config)
            db.commit()
        else:
            config.pedido_minimo = 30.0
            config.frete_gratis_valor = 100.0
            config.tabela_taxas_bairros = [
                {"bairro": "Centro", "taxa": 5.0},
                {"bairro": "Boa Viagem", "taxa": 12.0},
            ]
            db.commit()

        cat = db.query(Categoria).filter(Categoria.restaurante_id == 999, Categoria.id == "cat-chk").first()
        if not cat:
            cat = Categoria(id="cat-chk", restaurante_id=999, nome="Pratos")
            db.add(cat)
            db.commit()

        prod1 = db.query(Produto).filter(Produto.restaurante_id == 999, Produto.id == "prod-chk-1").first()
        if not prod1:
            prod1 = Produto(id="prod-chk-1", restaurante_id=999, categoria_id="cat-chk", nome="Prato Executivo", preco=20.0, ativo=True)
            db.add(prod1)
            db.commit()

        prod2 = db.query(Produto).filter(Produto.restaurante_id == 999, Produto.id == "prod-chk-2").first()
        if not prod2:
            prod2 = Produto(id="prod-chk-2", restaurante_id=999, categoria_id="cat-chk", nome="Combo Família", preco=120.0, ativo=True)
            db.add(prod2)
            db.commit()

        cupom = db.query(Cupom).filter(Cupom.restaurante_id == 999, Cupom.codigo == "CHK10").first()
        if not cupom:
            cupom = Cupom(
                id="cup-chk-10",
                restaurante_id=999,
                codigo="CHK10",
                tipo_desconto="fixo",
                valor_desconto=10.0,
                valor_minimo_pedido=30.0,
                ativo=True,
            )
            db.add(cupom)
            db.commit()

        # Cliente com cashback
        cli = db.query(Cliente).filter(Cliente.restaurante_id == 999, Cliente.id == "cli-chk-1").first()
        if not cli:
            cli = Cliente(
                id="cli-chk-1",
                restaurante_id=999,
                nome="Cliente Cashback",
                telefone="81999991234",
                saldo_cashback=15.0,
            )
            db.add(cli)
            db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_pedido_minimo_rejeita_pedido_pequeno():
    # Subtotal R$ 20.0 < Mínimo R$ 30.0
    res = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": 999,
            "cliente_nome": "Cliente Teste",
            "cliente_telefone": "81999991234",
            "endereco_entrega": "Rua Teste, 100",
            "tipo_pedido": "delivery",
            "itens": [{"produto_id": "prod-chk-1", "quantidade": 1}],
        }
    )
    assert res.status_code == 400
    assert "mínimo" in res.json()["detail"]


def test_taxa_por_bairro_e_frete_gratis_e_cupom():
    # Pedido de Combo Família (R$ 120.0) -> Frete grátis (> R$ 100) + Cupom CHK10 (R$ 10 off)
    res = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": 999,
            "cliente_nome": "Cliente Teste",
            "cliente_telefone": "81999991234",
            "endereco_entrega": "Rua Centro, 50",
            "bairro": "Centro",
            "tipo_pedido": "delivery",
            "cupom_codigo": "CHK10",
            "forma_pagamento_detalhe": "dinheiro",
            "troco_para": 150.0,
            "itens": [{"produto_id": "prod-chk-2", "quantidade": 1}],
        }
    )
    assert res.status_code == 201
    data = res.json()
    assert data["status"] == "success"
    # Total esperado: 120 (combo) - 10 (cupom) + 0 (frete grátis) = 110.0
    assert data["total"] == 110.0
