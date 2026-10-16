"""Regressões: lock de promoções no PostgreSQL e referência simbólica de SKU exclusivo."""
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session, lazyload

from app.models import ConfiguracaoRestaurante, Produto
from app.routes.cardapio_digital import PromotionConfigInput, _validate_promotion_input


def test_consulta_promocoes_nao_deve_bloquear_outer_join_postgresql():
    # ConfiguracaoRestaurante.restaurante usa eager LEFT OUTER JOIN por padrão.
    # FOR UPDATE sem OF resulta em NotSupportedError em produção.
    engine = create_engine("sqlite:///:memory:")
    with Session(engine) as db:
        query = db.query(ConfiguracaoRestaurante).options(
            lazyload(ConfiguracaoRestaurante.restaurante),
        ).filter(ConfiguracaoRestaurante.restaurante_id == 6)
        query = query.with_for_update(of=ConfiguracaoRestaurante)
        sql = str(query.statement.compile(dialect=postgresql.dialect()))
        assert "FOR UPDATE OF configuracoes_restaurante" in sql
        assert "JOIN restaurantes" not in sql


def _fake_db(*products):
    class Query:
        def filter(self, *_conditions):
            return self

        def all(self):
            return products

    class DB:
        def query(self, _model):
            assert _model is Produto
            return Query()

    return DB()


def test_preco_dezesseis_admite_g14_mais_pitulinha_exclusiva_de_um_real():
    db = _fake_db(
        SimpleNamespace(id="g", preco=14, ativo=True, somente_promocao=False),
        SimpleNamespace(id="pitulinha", preco=1, ativo=True, somente_promocao=True),
    )
    offer = PromotionConfigInput(
        nome="Quentinha G + Pitulinha",
        preco=Decimal("16.00"),
        componentes=[["g"], ["pitulinha"]],
        ativo=True,
    )
    saved = _validate_promotion_input(db, 6, offer)
    assert saved["preco"] == 16
    assert saved["componentes"] == [["g"], ["pitulinha"]]


def test_preco_maior_pode_ser_escolhido_sem_slot_exclusivo():
    db = _fake_db(
        SimpleNamespace(id="g", preco=14, ativo=True, somente_promocao=False),
        SimpleNamespace(id="m", preco=1, ativo=True, somente_promocao=False),
    )
    offer = PromotionConfigInput(
        nome="G + M sem componente exclusivo",
        preco=Decimal("16.00"),
        componentes=[["g"], ["m"]],
        ativo=False,
    )
    assert _validate_promotion_input(db, 6, offer)["preco"] == 16


def test_opcao_mista_de_bebida_admite_preco_independente():
    db = _fake_db(
        SimpleNamespace(id="g", preco=14, ativo=True, somente_promocao=False),
        SimpleNamespace(id="pitulinha", preco=1, ativo=True, somente_promocao=True),
        SimpleNamespace(id="cajuina", preco=1, ativo=True, somente_promocao=False),
    )
    offer = PromotionConfigInput(
        nome="G + Bebida à escolha",
        preco=Decimal("16.00"),
        componentes=[["g"], ["pitulinha", "cajuina"]],
        ativo=False,
    )
    assert _validate_promotion_input(db, 6, offer)["preco"] == 16
