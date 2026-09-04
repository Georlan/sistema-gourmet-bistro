"""Fixtures e helpers de snapshot para os Characterization Tests de Pedidos."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Cupom,
    GrupoModificador,
    Insumo,
    Item,
    ItemModificador,
    Lancamento,
    Mesa,
    MovimentacaoEstoque,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    ProdutoInsumo,
    Restaurante,
    ConfiguracaoRestaurante,
    Usuario,
    Comanda,
    Motoboy,
)
from app.security import create_access_token, get_password_hash

CHAR_RESTAURANT_ID = 777
CHAR_RESTAURANT_SLUG = "bistro-characterization-777"


@pytest.fixture(scope="module")
def char_client():
    """TestClient configurado para testes de caracterização."""
    return TestClient(app)


@pytest.fixture(scope="module")
def char_setup(char_client):
    """Configura dados reais no banco isolado de teste para a matriz de caracterização."""
    token_var = current_restaurante_id.set(CHAR_RESTAURANT_ID)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # 1. Restaurante
        rest = db.query(Restaurante).filter(Restaurante.id == CHAR_RESTAURANT_ID).first()
        if not rest:
            rest = Restaurante(
                id=CHAR_RESTAURANT_ID,
                nome="Bistrô Characterization",
                slug=CHAR_RESTAURANT_SLUG,
                plano="pro",
            )
            db.add(rest)
            db.commit()

        config = db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == CHAR_RESTAURANT_ID).first()
        if not config:
            config = ConfiguracaoRestaurante(
                restaurante_id=CHAR_RESTAURANT_ID,
                taxa_entrega_fixa=7.0,
                tipo_taxa_entrega="fixa",
            )
            db.add(config)
            db.commit()

        # 2. Usuário Operador / Caixa e Garçom
        user = db.query(Usuario).filter(Usuario.id == "usr-char-admin").first()
        if not user:
            user = Usuario(
                id="usr-char-admin",
                restaurante_id=CHAR_RESTAURANT_ID,
                nome="Admin Characterization",
                email="admin777@koma.com",
                usuario="admin777",
                senha_hash=get_password_hash("senha123"),
                role="admin",
                cargo="admin",
                status="ativo",
            )
            db.add(user)
            db.commit()

        garcom = db.query(Usuario).filter(Usuario.id == "usr-char-garcom").first()
        if not garcom:
            garcom = Usuario(
                id="usr-char-garcom",
                restaurante_id=CHAR_RESTAURANT_ID,
                nome="Garçom Characterization",
                email="garcom777@koma.com",
                usuario="garcom777",
                senha_hash=get_password_hash("senha123"),
                role="garcom",
                cargo="garcom",
                status="ativo",
            )
            db.add(garcom)
            db.commit()

        # 3. Mesa
        mesa = db.query(Mesa).filter(
            Mesa.restaurante_id == CHAR_RESTAURANT_ID,
            Mesa.id == 1,
        ).first()
        if not mesa:
            mesa = Mesa(
                id=1,
                restaurante_id=CHAR_RESTAURANT_ID,
                capacidade=4,
                nome="Mesa 01",
            )
            db.add(mesa)

        # 4. Categorias
        cat_lanches = db.query(Categoria).filter(Categoria.id == "cat-char-lanches").first()
        if not cat_lanches:
            cat_lanches = Categoria(
                id="cat-char-lanches",
                restaurante_id=CHAR_RESTAURANT_ID,
                nome="Lanches",
            )
            db.add(cat_lanches)

        cat_bebidas = db.query(Categoria).filter(Categoria.id == "cat-char-bebidas").first()
        if not cat_bebidas:
            cat_bebidas = Categoria(
                id="cat-char-bebidas",
                restaurante_id=CHAR_RESTAURANT_ID,
                nome="Bebidas",
            )
            db.add(cat_bebidas)

        # 5. Insumos de Estoque
        ins_pao = db.query(Insumo).filter(Insumo.id == "ins-char-pao").first()
        if not ins_pao:
            ins_pao = Insumo(
                id="ins-char-pao",
                restaurante_id=CHAR_RESTAURANT_ID,
                nome="Pão Brioche",
                unidade_medida="un",
                estoque_atual=100.0,
                estoque_minimo=10.0,
                preco_medio_custo=2.0,
            )
            db.add(ins_pao)

        ins_carne = db.query(Insumo).filter(Insumo.id == "ins-char-carne").first()
        if not ins_carne:
            ins_carne = Insumo(
                id="ins-char-carne",
                restaurante_id=CHAR_RESTAURANT_ID,
                nome="Carne 150g",
                unidade_medida="un",
                estoque_atual=100.0,
                estoque_minimo=10.0,
                preco_medio_custo=5.0,
            )
            db.add(ins_carne)

        # 6. Produtos
        prod_simples = db.query(Produto).filter(Produto.id == "prod-char-simples").first()
        if not prod_simples:
            prod_simples = Produto(
                id="prod-char-simples",
                restaurante_id=CHAR_RESTAURANT_ID,
                categoria_id="cat-char-lanches",
                nome="Burguer Simples",
                preco=25.0,
                ativo=True,
            )
            db.add(prod_simples)

        prod_especial = db.query(Produto).filter(Produto.id == "prod-char-especial").first()
        if not prod_especial:
            prod_especial = Produto(
                id="prod-char-especial",
                restaurante_id=CHAR_RESTAURANT_ID,
                categoria_id="cat-char-lanches",
                nome="Burguer Especial",
                preco=35.0,
                ativo=True,
            )
            db.add(prod_especial)

        prod_refri = db.query(Produto).filter(Produto.id == "prod-char-refri").first()
        if not prod_refri:
            prod_refri = Produto(
                id="prod-char-refri",
                restaurante_id=CHAR_RESTAURANT_ID,
                categoria_id="cat-char-bebidas",
                nome="Refrigerante Lata",
                preco=8.0,
                ativo=True,
            )
            db.add(prod_refri)

        # 7. Ficha técnica (prod_simples consome 1 pao e 1 carne)
        db.flush()
        ft_pao = db.query(ProdutoInsumo).filter(
            ProdutoInsumo.restaurante_id == CHAR_RESTAURANT_ID,
            ProdutoInsumo.produto_id == "prod-char-simples",
            ProdutoInsumo.insumo_id == "ins-char-pao",
        ).first()
        if not ft_pao:
            ft_pao = ProdutoInsumo(
                restaurante_id=CHAR_RESTAURANT_ID,
                produto_id="prod-char-simples",
                insumo_id="ins-char-pao",
                quantidade=1.0,
            )
            db.add(ft_pao)

        ft_carne = db.query(ProdutoInsumo).filter(
            ProdutoInsumo.restaurante_id == CHAR_RESTAURANT_ID,
            ProdutoInsumo.produto_id == "prod-char-simples",
            ProdutoInsumo.insumo_id == "ins-char-carne",
        ).first()
        if not ft_carne:
            ft_carne = ProdutoInsumo(
                restaurante_id=CHAR_RESTAURANT_ID,
                produto_id="prod-char-simples",
                insumo_id="ins-char-carne",
                quantidade=1.0,
            )
            db.add(ft_carne)

        # 8. Modificadores
        grp_adic = db.query(GrupoModificador).filter(GrupoModificador.id == "grp-char-adic").first()
        if not grp_adic:
            grp_adic = GrupoModificador(
                id="grp-char-adic",
                restaurante_id=CHAR_RESTAURANT_ID,
                nome="Adicionais Extras",
                min_selecoes=0,
                max_selecoes=5,
                tipo="opcional",
            )
            db.add(grp_adic)

        db.flush()
        opt_bacon = db.query(OpcaoModificador).filter(OpcaoModificador.id == "mod-char-bacon").first()
        if not opt_bacon:
            opt_bacon = OpcaoModificador(
                id="mod-char-bacon",
                restaurante_id=CHAR_RESTAURANT_ID,
                grupo_id="grp-char-adic",
                nome="Bacon Crocante",
                preco_adicional=5.0,
                ativo=True,
            )
            db.add(opt_bacon)

        opt_cheddar = db.query(OpcaoModificador).filter(OpcaoModificador.id == "mod-char-cheddar").first()
        if not opt_cheddar:
            opt_cheddar = OpcaoModificador(
                id="mod-char-cheddar",
                restaurante_id=CHAR_RESTAURANT_ID,
                grupo_id="grp-char-adic",
                nome="Cheddar Extra",
                preco_adicional=4.0,
                ativo=True,
            )
            db.add(opt_cheddar)

        # Vinculo Grupo <-> Produto
        pg_simples = db.query(ProdutoGrupoModificador).filter(
            ProdutoGrupoModificador.produto_id == "prod-char-simples",
            ProdutoGrupoModificador.grupo_id == "grp-char-adic",
        ).first()
        if not pg_simples:
            pg_simples = ProdutoGrupoModificador(
                restaurante_id=CHAR_RESTAURANT_ID,
                produto_id="prod-char-simples",
                grupo_id="grp-char-adic",
            )
            db.add(pg_simples)

        # 9. Cupons
        cupom_10 = db.query(Cupom).filter(
            Cupom.restaurante_id == CHAR_RESTAURANT_ID,
            Cupom.codigo == "CHAR10",
        ).first()
        if not cupom_10:
            cupom_10 = Cupom(
                restaurante_id=CHAR_RESTAURANT_ID,
                codigo="CHAR10",
                tipo_desconto="porcentagem",
                valor_desconto=10.0,
                valor_minimo_pedido=0.0,
                ativo=True,
            )
            db.add(cupom_10)

        cupom_fixo15 = db.query(Cupom).filter(
            Cupom.restaurante_id == CHAR_RESTAURANT_ID,
            Cupom.codigo == "FIXO15",
        ).first()
        if not cupom_fixo15:
            cupom_fixo15 = Cupom(
                restaurante_id=CHAR_RESTAURANT_ID,
                codigo="FIXO15",
                tipo_desconto="fixo",
                valor_desconto=15.0,
                valor_minimo_pedido=40.0,
                ativo=True,
            )
            db.add(cupom_fixo15)

        # 10. Motoboy
        motoboy = db.query(Motoboy).filter(
            Motoboy.restaurante_id == CHAR_RESTAURANT_ID,
            Motoboy.id == 1,
        ).first()
        if not motoboy:
            motoboy = Motoboy(
                id=1,
                restaurante_id=CHAR_RESTAURANT_ID,
                nome="Motoboy Char 1",
                telefone="11999998888",
                ativo=True,
            )
            db.add(motoboy)

        db.commit()
    finally:
        db.close()

    # Gera token de autenticação de admin
    token = create_access_token(
        subject="usr-char-admin",
        restaurante_id=CHAR_RESTAURANT_ID,
        role="admin",
    )
    headers = {"Authorization": f"Bearer {token}"}

    # Garante turno aberto para operações do caixa
    char_client.post(
        "/caixa/turno/abrir",
        json={"saldo_inicial": 100.0},
        headers=headers,
    )

    yield {
        "restaurant_id": CHAR_RESTAURANT_ID,
        "slug": CHAR_RESTAURANT_SLUG,
        "headers": headers,
    }

    current_restaurante_id.reset(token_var)


def capture_order_snapshot(db: Session, comanda_id: str) -> Dict[str, Any]:
    """Captura o estado observável e exato de uma comanda no banco para asserções comportamentais."""
    comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
    if not comanda:
        return {}

    lancamentos = []
    for lanc in comanda.lancamentos:
        lancamentos.append({
            "id": lanc.id,
            "timestamp": str(lanc.timestamp),
            "itens_count": len(lanc.itens),
        })

    itens = []
    for it in comanda.itens:
        mods = []
        item_mods = db.query(ItemModificador).filter(ItemModificador.item_id == it.id).all()
        for m in item_mods:
            mods.append({
                "modificador_id": m.opcao_modificador_id,
                "preco_adicional": float(m.preco_aplicado or 0.0),
            })
        itens.append({
            "id": it.id,
            "produto_id": it.produto_id,
            "preco_unit": float(it.preco_unit or 0.0),
            "status": it.status,
            "observacao": it.observacao,
            "cliente_nome": it.cliente_nome,
            "modificadores": sorted(mods, key=lambda x: x["modificador_id"]),
        })

    # Movimentações de estoque geradas para os itens da comanda
    item_ids = [it.id for it in comanda.itens]
    movimentacoes = []
    if item_ids:
        movs = db.query(MovimentacaoEstoque).filter(
            MovimentacaoEstoque.referencia_id.in_(item_ids)
        ).all()
        for mv in movs:
            movimentacoes.append({
                "id": mv.id,
                "insumo_id": mv.insumo_id,
                "tipo": mv.tipo,
                "quantidade": float(mv.quantidade or 0.0),
                "motivo": mv.motivo,
                "referencia_id": mv.referencia_id,
            })

    return {
        "id": comanda.id,
        "numero_pedido": comanda.numero_pedido,
        "tipo": comanda.tipo,
        "delivery_status": comanda.delivery_status,
        "delivery_taxa": float(comanda.delivery_taxa or 0.0),
        "delivery_endereco": comanda.delivery_endereco,
        "delivery_telefone": comanda.delivery_telefone,
        "valor_desconto_cupom": float(getattr(comanda, "valor_desconto_cupom", 0.0) or 0.0),
        "valor_desconto_cashback": float(getattr(comanda, "valor_desconto_cashback", 0.0) or 0.0),
        "idempotency_key": comanda.idempotency_key,
        "mesa_id": comanda.mesa_id,
        "lancamentos": lancamentos,
        "itens": sorted(itens, key=lambda x: x["produto_id"]),
        "movimentacoes_estoque": sorted(movimentacoes, key=lambda x: x["insumo_id"]),
    }
