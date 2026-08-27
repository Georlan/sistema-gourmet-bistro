import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal, current_restaurante_id
from app.models import Restaurante, Usuario, Cupom
from app.routes.auth import create_access_token

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_cupons_test():
    db = SessionLocal()
    token = current_restaurante_id.set(999)
    try:
        rest = db.query(Restaurante).filter(Restaurante.id == 999).first()
        if not rest:
            rest = Restaurante(id=999, nome="Restaurante Teste 999", slug="rest-999")
            db.add(rest)
            db.commit()

        user = db.query(Usuario).filter(Usuario.id == "usr-admin-cupom").first()
        if not user:
            user = Usuario(
                id="usr-admin-cupom",
                restaurante_id=999,
                nome="Admin Cupom",
                email="cupomadmin@koma.com",
                cargo="admin",
                status="ativo",
            )
            db.add(user)
            db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()


def _auth_headers():
    token = create_access_token(subject="usr-admin-cupom", restaurante_id=999, role="admin")
    return {"Authorization": f"Bearer {token}"}


def test_criar_e_listar_cupons():
    headers = _auth_headers()
    # Criar cupom de 10%
    res = client.post(
        "/caixa/cupons",
        headers=headers,
        json={
            "codigo": "DESCONTO10",
            "tipo_desconto": "porcentagem",
            "valor_desconto": 10.0,
            "valor_minimo_pedido": 50.0,
        }
    )
    assert res.status_code in (201, 409)

    # Listar cupons
    res_list = client.get("/caixa/cupons", headers=headers)
    assert res_list.status_code == 200
    cupons = res_list.json()
    assert any(c["codigo"] == "DESCONTO10" for c in cupons)


def test_validar_cupom_publico():
    headers = _auth_headers()
    # Cria cupom fixo de R$ 15,00 para pedidos acima de R$ 60,00
    client.post(
        "/caixa/cupons",
        headers=headers,
        json={
            "codigo": "BEMVINDO15",
            "tipo_desconto": "fixo",
            "valor_desconto": 15.0,
            "valor_minimo_pedido": 60.0,
        }
    )

    # Validação abaixo do mínimo -> deve recusar amigavelmente
    res_invalido = client.post(
        "/cardapio/cupons/validar",
        json={
            "restaurante_id": 999,
            "codigo": "BEMVINDO15",
            "subtotal": 40.0,
        }
    )
    assert res_invalido.status_code == 200
    data_inv = res_invalido.json()
    assert data_inv["valido"] is False
    assert "mínimo" in data_inv["mensagem"]

    # Validação acima do mínimo -> deve aprovar e calcular desconto
    res_valido = client.post(
        "/cardapio/cupons/validar",
        json={
            "restaurante_id": 999,
            "codigo": "BEMVINDO15",
            "subtotal": 80.0,
        }
    )
    assert res_valido.status_code == 200
    data_val = res_valido.json()
    assert data_val["valido"] is True
    assert data_val["desconto_calculado"] == 15.0
