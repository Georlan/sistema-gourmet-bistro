from __future__ import annotations

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError

from app.database import Base
from app.models import Categoria, Comanda, Mesa, Pagamento, Produto, Restaurante, Usuario


def _check_names(table) -> set[str]:
    return {
        constraint.name
        for constraint in table.constraints
        if constraint.name and constraint.__class__.__name__ == "CheckConstraint"
    }


def _index_names(table) -> set[str]:
    return {index.name for index in table.indexes if index.name}


def test_financial_checks_and_fk_indexes_are_in_model_metadata():
    assert "ck_produtos_preco_nonnegative_finite" in _check_names(
        Produto.__table__
    )
    assert "ck_pagamentos_valor_positive_finite" in _check_names(
        Pagamento.__table__
    )
    assert "ck_pagamentos_metodo" in _check_names(Pagamento.__table__)
    assert "ix_produtos_tenant_categoria_fk" in _index_names(
        Produto.__table__
    )


def test_product_price_constraint_rejects_negative_values():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            Restaurante.__table__.insert().values(
                id=2,
                nome="Restaurante de teste",
                plano="pocket",
            )
        )
        connection.execute(
            Categoria.__table__.insert().values(
                pk=1,
                id="cat-teste",
                restaurante_id=2,
                nome="Categoria de teste",
            )
        )

    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                Produto.__table__.insert().values(
                    pk=1,
                    id="produto-invalido",
                    restaurante_id=2,
                    nome="Produto inválido",
                    categoria_id="cat-teste",
                    preco=-0.01,
                )
            )


def test_composite_foreign_keys_reject_cross_tenant_links():
    engine = create_engine("sqlite+pysqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _connection_record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            Restaurante.__table__.insert().values(
                id=2,
                nome="Segundo restaurante",
                plano="pocket",
            )
        )
        connection.execute(
            Categoria.__table__.insert().values(
                id="categoria-tenant-1",
                restaurante_id=1,
                nome="Categoria do tenant 1",
            )
        )
        connection.execute(
            Mesa.__table__.insert().values(
                id=99,
                restaurante_id=1,
                capacidade=2,
            )
        )
        connection.execute(
            Usuario.__table__.insert().values(
                id="usuario-tenant-2",
                restaurante_id=2,
                nome="Usuário tenant 2",
                cargo="garcom",
                status="ativo",
            )
        )

    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                Produto.__table__.insert().values(
                    id="produto-cruzado",
                    restaurante_id=2,
                    nome="Produto cruzado",
                    categoria_id="categoria-tenant-1",
                    preco=1,
                )
            )

    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                Comanda.__table__.insert().values(
                    id="comanda-cruzada",
                    restaurante_id=2,
                    mesa_id=99,
                    garcom_id="usuario-tenant-2",
                    numero_pedido=999,
                    tipo="Consumo no Local",
                )
            )


@pytest.mark.parametrize(
    ("valor", "metodo", "idempotency_key"),
    [
        (0, "pix", "pagamento-zero"),
        (10, "cheque", "metodo-invalido"),
        (10, "pix", "   "),
    ],
)
def test_payment_constraints_reject_invalid_financial_state(
    valor: float,
    metodo: str,
    idempotency_key: str,
):
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                Pagamento.__table__.insert().values(
                    id="pagamento-invalido",
                    restaurante_id=1,
                    comanda_id="comanda-inexistente",
                    turno_id=1,
                    valor=valor,
                    metodo=metodo,
                    status="aprovado",
                    idempotency_key=idempotency_key,
                )
            )
