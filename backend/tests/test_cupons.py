import datetime

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal, current_restaurante_id
from app.models import ConfigFidelizacao, Restaurante, Usuario, Cupom
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


def test_beneficios_publicos_expoem_apenas_ofertas_seguras_e_programa():
    db = SessionLocal()
    token = current_restaurante_id.set(999)
    try:
        codes = ["PUBLICO7", "DIRECIONADO9", "DESLIGADO5", "EXPIRADO4"]
        db.query(Cupom).filter(
            Cupom.restaurante_id == 999,
            Cupom.codigo.in_(codes),
        ).delete(synchronize_session=False)

        db.add_all([
            Cupom(
                id="cup-public-benefits",
                restaurante_id=999,
                codigo="PUBLICO7",
                tipo_desconto="porcentagem",
                valor_desconto=7.0,
                valor_minimo_pedido=25.0,
                ativo=True,
                cliente_id=None,
            ),
            Cupom(
                id="cup-target-benefits",
                restaurante_id=999,
                codigo="DIRECIONADO9",
                tipo_desconto="porcentagem",
                valor_desconto=9.0,
                ativo=True,
                cliente_id="cliente-privado",
            ),
            Cupom(
                id="cup-disabled-benefits",
                restaurante_id=999,
                codigo="DESLIGADO5",
                tipo_desconto="porcentagem",
                valor_desconto=5.0,
                ativo=False,
            ),
            Cupom(
                id="cup-expired-benefits",
                restaurante_id=999,
                codigo="EXPIRADO4",
                tipo_desconto="porcentagem",
                valor_desconto=4.0,
                ativo=True,
                valido_ate=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(days=1),
            ),
        ])

        config = db.query(ConfigFidelizacao).filter(
            ConfigFidelizacao.restaurante_id == 999,
        ).first()
        if not config:
            config = ConfigFidelizacao(restaurante_id=999)
            db.add(config)
        config.ativo = True
        config.tipo_recompensa = "CASHBACK"
        config.taxa_conversao = 3.0
        config.valor_ponto_em_dinheiro = 0.05
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()

    res = client.get("/cardapio/cupons/beneficios", params={"restaurante_id": 999})
    assert res.status_code == 200, res.text
    assert "max-age=60" in res.headers.get("cache-control", "")

    payload = res.json()
    public_codes = {coupon["codigo"] for coupon in payload["cupons"]}
    assert "PUBLICO7" in public_codes
    assert "DIRECIONADO9" not in public_codes
    assert "DESLIGADO5" not in public_codes
    assert "EXPIRADO4" not in public_codes
    assert payload["programa"] == {
        "ativo": True,
        "tipo_recompensa": "CASHBACK",
        "taxa_conversao": 3.0,
        "valor_ponto_em_dinheiro": 0.05,
    }
