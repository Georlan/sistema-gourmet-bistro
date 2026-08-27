import uuid

from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    Insumo,
    MovimentacaoEstoque,
    Produto,
    ProdutoInsumo,
    Restaurante,
    Usuario,
)
from app.security import create_access_token


client = TestClient(app)
RESTAURANTE_ID = 99119
USER_ID = "usr-inventory-online-diag"
PRODUCT_ID = "prod-inventory-online-diag"
CATEGORY_ID = "cat-inventory-online-diag"
INSUMO_ID = "insumo-inventory-online-diag"


def _seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).first()
        if restaurante is None:
            db.add(Restaurante(
                id=RESTAURANTE_ID,
                nome="Estoque Pedido Online Diagnostico",
                plano="pro",
                slug="estoque-pedido-online-diagnostico",
                status_override="Forçado Aberto",
            ))

        categoria = db.query(Categoria).filter(
            Categoria.restaurante_id == RESTAURANTE_ID,
            Categoria.id == CATEGORY_ID,
        ).first()
        if categoria is None:
            db.add(Categoria(
                id=CATEGORY_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Diagnostico",
                destino_impressao="COZINHA",
            ))

        produto = db.query(Produto).filter(
            Produto.restaurante_id == RESTAURANTE_ID,
            Produto.id == PRODUCT_ID,
        ).first()
        if produto is None:
            db.add(Produto(
                id=PRODUCT_ID,
                restaurante_id=RESTAURANTE_ID,
                categoria_id=CATEGORY_ID,
                nome="Produto com Ficha Diagnostico",
                preco=30,
                ativo=True,
            ))

        insumo = db.query(Insumo).filter(
            Insumo.restaurante_id == RESTAURANTE_ID,
            Insumo.id == INSUMO_ID,
        ).first()
        if insumo is None:
            insumo = Insumo(
                id=INSUMO_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Ingrediente Diagnostico",
                estoque_atual=10,
                estoque_minimo=2,
                estoque_maximo=20,
                unidade_medida="un",
                preco_medio_custo=1,
            )
            db.add(insumo)
        else:
            insumo.estoque_atual = 10

        usuario = db.query(Usuario).filter(
            Usuario.restaurante_id == RESTAURANTE_ID,
            Usuario.id == USER_ID,
        ).first()
        if usuario is None:
            db.add(Usuario(
                id=USER_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Operador Estoque Diagnostico",
                email="inventory-online-diag@koma.invalid",
                role="admin",
                cargo="admin",
                status="ativo",
            ))

        db.flush()

        recipe = db.query(ProdutoInsumo).filter(
            ProdutoInsumo.restaurante_id == RESTAURANTE_ID,
            ProdutoInsumo.produto_id == PRODUCT_ID,
            ProdutoInsumo.insumo_id == INSUMO_ID,
        ).first()
        if recipe is None:
            db.add(ProdutoInsumo(
                restaurante_id=RESTAURANTE_ID,
                produto_id=PRODUCT_ID,
                insumo_id=INSUMO_ID,
                quantidade=1,
            ))
        else:
            recipe.quantidade = 1

        turno = db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == RESTAURANTE_ID,
            CaixaTurno.status == "aberto",
        ).first()
        if turno is None:
            db.add(CaixaTurno(
                restaurante_id=RESTAURANTE_ID,
                aberto_por_id=USER_ID,
                saldo_inicial=0,
                status="aberto",
            ))

        db.query(MovimentacaoEstoque).filter(
            MovimentacaoEstoque.restaurante_id == RESTAURANTE_ID,
            MovimentacaoEstoque.insumo_id == INSUMO_ID,
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()


def _staff_headers():
    token = create_access_token(
        subject=USER_ID,
        restaurante_id=RESTAURANTE_ID,
        role="admin",
    )
    return {"Authorization": f"Bearer {token}"}


def test_diag_pending_anonymous_order_already_consumes_recipe_stock_before_acceptance():
    _seed()
    response = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": RESTAURANTE_ID,
            "itens": [{
                "produto_id": PRODUCT_ID,
                "quantidade": 3,
                "observacao": "ainda aguardando aceite",
            }],
            "cliente_nome": "Cliente Estoque Pendente",
            "cliente_telefone": "85999991119",
            "endereco_entrega": "",
            "taxa_entrega": 0,
            "forma_pagamento": "na_entrega",
            "tipo_pedido": "retirada",
            "idempotency_key": f"diag-stock-pending-{uuid.uuid4().hex}",
        },
    )

    assert response.status_code == 201, response.text
    comanda_id = response.json()["comanda_id"]

    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        insumo = db.query(Insumo).filter(Insumo.id == INSUMO_ID).one()
        movements = db.query(MovimentacaoEstoque).filter(
            MovimentacaoEstoque.restaurante_id == RESTAURANTE_ID,
            MovimentacaoEstoque.insumo_id == INSUMO_ID,
            MovimentacaoEstoque.origem == "venda_automatica",
        ).all()

        assert comanda.delivery_status == "pendente"
        assert float(insumo.estoque_atual) == 7.0
        assert len(movements) == 3
    finally:
        current_restaurante_id.reset(token)
        db.close()

    refused = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=recusado",
        headers=_staff_headers(),
    )
    assert refused.status_code == 200, refused.text

    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        insumo = db.query(Insumo).filter(Insumo.id == INSUMO_ID).one()
        reversals = db.query(MovimentacaoEstoque).filter(
            MovimentacaoEstoque.restaurante_id == RESTAURANTE_ID,
            MovimentacaoEstoque.insumo_id == INSUMO_ID,
            MovimentacaoEstoque.origem == "cancelamento_venda",
        ).all()
        assert float(insumo.estoque_atual) == 10.0
        assert len(reversals) == 3
    finally:
        current_restaurante_id.reset(token)
        db.close()
