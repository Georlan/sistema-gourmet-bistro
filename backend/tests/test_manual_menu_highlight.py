import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base, current_restaurante_id
from app.models import Restaurante, Categoria, Produto
from app.routes.cardapio_digital import (
    MenuHighlightUpdate, obter_destaque_cardapio, atualizar_destaque_cardapio,
    _public_configuration,
)

@pytest.fixture
def catalog():
    engine = create_engine('sqlite://')
    token = current_restaurante_id.set(91)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add_all([Restaurante(id=91,nome='A'), Restaurante(id=92,nome='B')]); db.flush()
        db.add_all([Categoria(id='a',restaurante_id=91,nome='A'),Categoria(id='b',restaurante_id=92,nome='B')]); db.flush()
        db.add_all([Produto(id='p1',restaurante_id=91,categoria_id='a',nome='Prato',preco=10),
                    Produto(id='off',restaurante_id=91,categoria_id='a',nome='Pausado',preco=10,ativo=False),
                    Produto(id='foreign',restaurante_id=92,categoria_id='b',nome='Outro',preco=10)])
        db.commit()
        yield db
    current_restaurante_id.reset(token)
    engine.dispose()

def test_manual_highlight_persists_per_restaurant_and_can_return_to_automatic(catalog):
    assert obter_destaque_cardapio(db=catalog,current_user=object()) == {'produto_id': None}
    tasks = BackgroundTasks()
    result = atualizar_destaque_cardapio(MenuHighlightUpdate(produto_id='p1'),tasks,db=catalog,current_user=object())
    assert result == {'produto_id': 'p1'}
    assert _public_configuration(catalog,91).destaque_cardapio_produto_id == 'p1'
    assert len(tasks.tasks) == 1
    assert atualizar_destaque_cardapio(MenuHighlightUpdate(produto_id=None),BackgroundTasks(),db=catalog,current_user=object()) == {'produto_id': None}

@pytest.mark.parametrize('value',['foreign','off','missing'])
def test_rejects_foreign_paused_or_unknown_products(catalog,value):
    with pytest.raises(HTTPException) as error:
        atualizar_destaque_cardapio(MenuHighlightUpdate(produto_id=value),BackgroundTasks(),db=catalog,current_user=object())
    assert error.value.status_code == 422
