import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal, current_restaurante_id
from app.main import app
from app.models import ConfigFidelizacao, Cupom, Restaurante

client = TestClient(app)
TENANT_A = 992
TENANT_B = 991


def _seed_tenant(
    restaurante_id: int,
    *,
    slug: str,
    coupon_code: str,
    discount_type: str,
    discount_value: float,
    minimum_order: float,
    reward_type: str,
    reward_rate: float,
    point_value: float,
):
    db = SessionLocal()
    token = current_restaurante_id.set(restaurante_id)
    try:
        if not db.query(Restaurante).filter(Restaurante.id == restaurante_id).first():
            db.add(Restaurante(
                id=restaurante_id,
                nome=f"Restaurante {restaurante_id}",
                slug=slug,
            ))
            db.commit()

        db.add(Cupom(
            id=f"cup-public-{restaurante_id}-{uuid.uuid4().hex[:8]}",
            restaurante_id=restaurante_id,
            codigo=coupon_code,
            tipo_desconto=discount_type,
            valor_desconto=discount_value,
            valor_minimo_pedido=minimum_order,
            ativo=True,
        ))

        program = db.query(ConfigFidelizacao).filter(
            ConfigFidelizacao.restaurante_id == restaurante_id,
        ).first()
        if not program:
            program = ConfigFidelizacao(restaurante_id=restaurante_id)
            db.add(program)
        program.ativo = True
        program.tipo_recompensa = reward_type
        program.taxa_conversao = reward_rate
        program.valor_ponto_em_dinheiro = point_value
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_public_benefits_are_tenant_isolated_and_minimal():
    code_a = f"PUBLICA{uuid.uuid4().hex[:7].upper()}"
    code_b = f"OUTRA{uuid.uuid4().hex[:7].upper()}"

    # Cada seed usa seu próprio TenantSession/contexto. O teste deve provar o
    # isolamento público sem contornar o guard de escrita cross-tenant.
    _seed_tenant(
        TENANT_A,
        slug="benefits-contract-a",
        coupon_code=code_a,
        discount_type="porcentagem",
        discount_value=7.0,
        minimum_order=30.0,
        reward_type="CASHBACK",
        reward_rate=3.25,
        point_value=0.05,
    )
    _seed_tenant(
        TENANT_B,
        slug="benefits-contract-b",
        coupon_code=code_b,
        discount_type="fixo",
        discount_value=9.0,
        minimum_order=45.0,
        reward_type="PONTOS",
        reward_rate=2.0,
        point_value=0.10,
    )

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
