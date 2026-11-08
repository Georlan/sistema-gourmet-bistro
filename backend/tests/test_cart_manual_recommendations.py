"""Manual cart recommendations: tenant safety, persistence and automatic default."""
import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base, current_restaurante_id
from app.models import Categoria, Produto, Restaurante, ConfiguracaoRestaurante
from app.routes.cardapio_digital import (
    CartRecommendationsUpdate,
    _public_configuration,
    atualizar_recomendacoes_sacola,
    obter_recomendacoes_sacola,
)


@pytest.fixture
def catalog():
    engine = create_engine("sqlite://")
    token = current_restaurante_id.set(91)
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add_all([
                Restaurante(id=91, nome="Restaurante 91", plano="pocket"),
                Restaurante(id=92, nome="Restaurante 92", plano="pocket"),
            ])
            db.flush()
            db.add_all([
                Categoria(id="cat-91", restaurante_id=91, nome="Bebidas"),
                Categoria(id="cat-92", restaurante_id=92, nome="Bebidas"),
            ])
            db.flush()
            db.add_all([
                Produto(id="suco", restaurante_id=91, categoria_id="cat-91", nome="Suco", preco=7),
                Produto(id="batata", restaurante_id=91, categoria_id="cat-91", nome="Batata", preco=15),
                Produto(id="exclusivo", restaurante_id=91, categoria_id="cat-91",
                        nome="Só combo", preco=2, somente_promocao=True),
                Produto(id="outro", restaurante_id=92, categoria_id="cat-92", nome="Outro", preco=4),
            ])
            db.commit()
            yield db
    finally:
        current_restaurante_id.reset(token)
        engine.dispose()


def _save(db, mode, product_ids):
    tasks = BackgroundTasks()
    value = atualizar_recomendacoes_sacola(
        CartRecommendationsUpdate(modo=mode, produto_ids=product_ids),
        tasks, db=db, current_user=object(),
    )
    return value, tasks


def test_manual_product_order_is_persisted_and_publicly_projected(catalog):
    db = catalog
    assert obter_recomendacoes_sacola(db=db, current_user=object()) == {
        "modo": "automatico", "produto_ids": [],
    }
    result, tasks = _save(db, "manual", ["batata", "suco"])
    assert result == {"modo": "manual", "produto_ids": ["batata", "suco"]}
    assert len(tasks.tasks) == 1  # existing config_updated WebSocket path
    assert obter_recomendacoes_sacola(db=db, current_user=object()) == result
    config = _public_configuration(db, 91)
    assert config is not None
    assert config.recomendacoes_sacola_ids == ["batata", "suco"]

    cleared, _ = _save(db, "automatico", [])
    assert cleared == {"modo": "automatico", "produto_ids": []}
    assert db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=91).one().recomendacoes_sacola_ids is None


@pytest.mark.parametrize("ids", [
    ["outro"], ["exclusivo"], ["desconhecido"], ["suco", "suco"],
])
def test_foreign_exclusive_missing_and_duplicate_skus_rejected(catalog, ids):
    with pytest.raises(HTTPException) as error:
        _save(catalog, "manual", ids)
    assert error.value.status_code == 422
    assert obter_recomendacoes_sacola(db=catalog, current_user=object())["modo"] == "automatico"


def test_manual_requires_a_product_and_automatic_rejects_ids(catalog):
    with pytest.raises(HTTPException) as missing:
        _save(catalog, "manual", [])
    assert missing.value.status_code == 422
    with pytest.raises(HTTPException) as invalid_auto:
        _save(catalog, "automatico", ["suco"])
    assert invalid_auto.value.status_code == 422
