from fastapi.testclient import TestClient
from app.main import app
from app.models import Produto
from test_product_read_stage3b import setup_db, headers, TestingSessionLocal, TENANT


def test_import_preview_payload_merges_and_replace_inactivates_only_on_request():
    client=TestClient(app)
    auth=headers(client)
    payload={'mode':'merge','products':[{'id':'new-product','nome':'Prato novo','preco':25.9,'categoria_id':'cat-pratos'}]}
    merged=client.post('/produtos/importar',headers=auth,json=payload)
    assert merged.status_code==200, merged.text
    with TestingSessionLocal() as db:
        assert db.query(Produto).filter(Produto.restaurante_id==TENANT,Produto.id=='prod-100').one().ativo
    payload['mode']='replace'
    assert client.post('/produtos/importar',headers=auth,json=payload).status_code==200
    with TestingSessionLocal() as db:
        assert not db.query(Produto).filter(Produto.restaurante_id==TENANT,Produto.id=='prod-100').one().ativo
        assert db.query(Produto).filter(Produto.restaurante_id==TENANT,Produto.id=='new-product').one().ativo


def test_empty_and_invalid_imports_do_not_clear_catalog():
    client=TestClient(app); auth=headers(client)
    assert client.post('/produtos/importar',headers=auth,json={'mode':'replace','products':[]}).status_code==422
    assert client.post('/produtos/importar',headers=auth,json={'products':[{'id':'bad','nome':'Preço inválido','preco':-1,'categoria_id':'cat-test'}]}).status_code==422
    with TestingSessionLocal() as db:
        assert db.query(Produto).filter(Produto.restaurante_id==TENANT,Produto.id=='prod-100').one().ativo
