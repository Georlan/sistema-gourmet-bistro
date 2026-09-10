import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal, current_restaurante_id
from app.main import app
from app.models import ConfigFidelizacao, Cupom, Restaurante

client = TestClient(app)
TENANT_A = 992
TENANT_B = 991


def _ensure_restaurant(db, restaurante_id: int, slug: str):
    if not db.query(Restaurante).filter(Restaurante.id == restaurante_id).first():
        db.add(Restaurante(id=restaurante_id, nome=f"Restaurante {restaurante_id}", slug=slug))
        db.commit()


def _set_program(db, restaurante_id: int, *, reward_type: str, rate: float, point_value: float):
    program = db.query(ConfigFidelizacao).filter(
        ConfigFidelizacao.restaurante_id == restaurante_id,
    ).first()
    if not program:
        program = ConfigFidelizacao(restaurante_id=restaurante_id)
        db.add(program)
    program.ativo = True
    program.tipo_recompensa = reward_type
    program.taxa_conversao = rate
    program.valor_ponto_em_dinheiro = point_value


def test_public_benefits_are_tenant_isolated_and_minimal():
    code_a = f"PUBLICA{uuid.uuid4().hex[:7].upper()}"
    code_b = f"OUTRA{uuid.uuid4().hex[:7].upper()}"

    db = SessionLocal()
    token = current_restaurante_id.set(TENANT_A)
    try:
        _ensure_restaurant(db, TENANT_A, "benefits-contract-a")
        _ensure_restaurant(db, TENANT_B, "benefits-contract-b")

        db.add(Cupom(
            id=f"cup-public-a-{uuid.uuid4().hex[:8]}",
            restaurante_id=TENANT_A,
            codigo=code_a,
            tipo_desconto="porcentagem",
            valor_desconto=7.0,
            valor_minimo_pedido=30.0,
            ativo=True,
        ))
        db.add(Cupom(
            id=f"cup-public-b-{uuid.uuid4().hex[:8]}",
            restaurante_id=TENANT_B,
            codigo=code_b,
            tipo_desconto="fixo",
            valor_desconto=9.0,
            valor_minimo_pedido=45.0,
            ativo=True,
        ))
        _set_program(db, TENANT_A, reward_type="CASHBACK", rate=3.25, point_value=0.05)
        _set_program(db, TENANT_B, reward_type="PONTOS", rate=2.0, point_value=0.10)
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()

    response = client.get("/cardapio/cupons/beneficios", params={"restaurante_id": TENANT_A})
    assert response.status_code == 200
    assert "max-age=60" in response.headers.get("cache-control", "")

    payload = response.json()
    assert set(payload) == {"cupons", "programa"}

    codes = {coupon["codigo"] for coupon in payload["cupons"]}
    assert code_a in codes
    assert code_b not in codes

    own_coupon = next(coupon for coupon in payload["cupons"] if coupon["codigo"] == code_a)
    assert set(own_coupon) == {
        "codigo",
        "tipo_desconto",
        "valor_desconto",
        "valor_minimo_pedido",
        "valido_ate",
        "apenas_primeira_compra",
    }

    assert payload["programa"] == {
        "ativo": True,
        "tipo_recompensa": "CASHBACK",
        "taxa_conversao": 3.25,
        "valor_ponto_em_dinheiro": 0.05,
    }

    serialized = response.text.lower()
    for internal_name in (
        "koma_fee",
        "koma_fee_fraction",
        "margin_before_incentive",
        "minimum_margin",
        "safe_discount_ceiling",
        "required_order_growth_percent",
        "subscription",
        "split",
    ):
        assert internal_name not in serialized
