"""Manual cart recommendations keep tenant boundaries, availability and SKU identity."""
import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base, current_restaurante_id
from app.models import Categoria, ConfiguracaoRestaurante, Produto, Restaurante
from app.routes.cardapio_digital import (
    _public_configuration,
    _public_restaurant_payload,
    CartRecommendationsWrite,
    obter_recomendacoes_sacola,
    salvar_recomendacoes_sacola,
)


@pytest.fixture
def catalog():
    engine = create_engine("sqlite://")
    token = current_restaurante_id.set(91)
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add_all([
                Restaurante(id=91, nome="Loja 91", plano="pocket"),
                Restaurante(id=92, nome="Loja 92", plano="pocket"),
            ])
            db.flush()
            db.add_all([
                Categoria(id="c91", restaurante_id=91, nome="Pastéis"),
                Categoria(id="c92", restaurante_id=92, nome="Pastéis"),
            ])
            db.flush()
            db.add_all([
                Produto(id="carne", restaurante_id=91, categoria_id="c91", nome="Pastel carne", preco=7, ativo=True),
                Produto(id="queijo", restaurante_id=91, categoria_id="c91", nome="Pastel queijo", preco=8, ativo=True),
                Produto(id="pausado", restaurante_id=91, categoria_id="c91", nome="Pausado", preco=5, ativo=False),
                Produto(id="combo", restaurante_id=91, categoria_id="c91", nome="Só combo", preco=5, ativo=True, somente_promocao=True),
                Produto(id="vizinho", restaurante_id=92, categoria_id="c92", nome="Vizinho", preco=20, ativo=True),
            ])
            db.commit()
            yield db
    finally:
        current_restaurante_id.reset(token)
        engine.dispose()


def update(db, ids, before=()):
    return salvar_recomendacoes_sacola(
        CartRecommendationsWrite(produto_ids=list(ids), anteriores=list(before)),
        BackgroundTasks(), db=db, current_user=object(),
    )


def test_curated_skus_preserve_order_and_reset_to_automatic(catalog):
    db = catalog
    assert obter_recomendacoes_sacola(db=db, current_user=object()) == {"produto_ids": []}
    assert update(db, ["queijo", "carne"]) == {"produto_ids": ["queijo", "carne"]}
    assert obter_recomendacoes_sacola(db=db, current_user=object()) == {"produto_ids": ["queijo", "carne"]}
    config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=91).one()
    assert config.recomendacoes_sacola_ids == ["queijo", "carne"]
    public_config = _public_configuration(db, 91)
    payload = _public_restaurant_payload(db.query(Restaurante).filter_by(id=91).one(), public_config)
    assert payload["recomendacoes_sacola_ids"] == ["queijo", "carne"]
    assert update(db, [], ["queijo", "carne"]) == {"produto_ids": []}
    db.refresh(config)
    assert config.recomendacoes_sacola_ids is None


@pytest.mark.parametrize("ids,expected_status", [
    (["vizinho"], 422),
    (["pausado"], 422),
    (["combo"], 422),
    (["carne", "carne"], 422),
    ([""], 422),
])
def test_invalid_cross_tenant_paused_and_promotion_only_products_rejected(catalog, ids, expected_status):
    db = catalog
    with pytest.raises(HTTPException) as caught:
        update(db, ids)
    assert caught.value.status_code == expected_status
    assert obter_recomendacoes_sacola(db=db, current_user=object()) == {"produto_ids": []}


def test_optimistic_update_does_not_erase_another_session(catalog):
    db = catalog
    update(db, ["carne"])
    with pytest.raises(HTTPException) as caught:
        update(db, ["queijo"])
    assert caught.value.status_code == 409
    assert obter_recomendacoes_sacola(db=db, current_user=object()) == {"produto_ids": ["carne"]}


def test_six_item_limit_enforced_by_request_schema():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        CartRecommendationsWrite(produto_ids=[str(i) for i in range(7)], anteriores=[])
