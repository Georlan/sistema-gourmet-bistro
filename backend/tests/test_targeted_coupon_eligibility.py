import uuid

from fastapi.testclient import TestClient

from app.application.orders.validation_loader import ValidationDataLoader
from app.database import SessionLocal, current_restaurante_id
from app.domain.orders.types import FulfillmentType
from app.main import app
from app.models import Cupom, Restaurante
from app.services.clientes import cadastrar_ou_atualizar_cliente

client = TestClient(app)
TENANT_ID = 994


def _seed_targeted_coupon():
    db = SessionLocal()
    token = current_restaurante_id.set(TENANT_ID)
    try:
        if not db.query(Restaurante).filter(Restaurante.id == TENANT_ID).first():
            db.add(Restaurante(id=TENANT_ID, nome="Targeted Coupon Test", slug="targeted-coupon-test"))
            db.commit()

        target = cadastrar_ou_atualizar_cliente(
            db,
            restaurante_id=TENANT_ID,
            telefone="85999991001",
            nome="Cliente Destinatario",
        )
        other = cadastrar_ou_atualizar_cliente(
            db,
            restaurante_id=TENANT_ID,
            telefone="85999991002",
            nome="Cliente Outro",
        )
        db.commit()
        db.refresh(target)
        db.refresh(other)

        code = f"VIP{uuid.uuid4().hex[:8].upper()}"
        coupon = Cupom(
            id=f"cup-target-{uuid.uuid4().hex[:10]}",
            restaurante_id=TENANT_ID,
            codigo=code,
            tipo_desconto="porcentagem",
            valor_desconto=10.0,
            valor_minimo_pedido=0.0,
            usos_atuais=0,
            ativo=True,
            cliente_id=target.id,
        )
        db.add(coupon)
        db.commit()
        return code, str(target.id), target.telefone, other.telefone
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_public_validation_only_accepts_targeted_coupon_for_its_customer():
    code, _target_id, target_phone, other_phone = _seed_targeted_coupon()

    missing_identity = client.post(
        "/cardapio/cupons/validar",
        json={"restaurante_id": TENANT_ID, "codigo": code, "subtotal": 100.0},
    )
    assert missing_identity.status_code == 200
    assert missing_identity.json()["valido"] is False

    wrong_customer = client.post(
        "/cardapio/cupons/validar",
        json={
            "restaurante_id": TENANT_ID,
            "codigo": code,
            "subtotal": 100.0,
            "telefone": other_phone,
        },
    )
    assert wrong_customer.status_code == 200
    assert wrong_customer.json()["valido"] is False
    assert wrong_customer.json()["desconto_calculado"] == 0.0

    target_customer = client.post(
        "/cardapio/cupons/validar",
        json={
            "restaurante_id": TENANT_ID,
            "codigo": code,
            "subtotal": 100.0,
            "telefone": target_phone,
        },
    )
    assert target_customer.status_code == 200
    assert target_customer.json()["valido"] is True
    assert target_customer.json()["desconto_calculado"] == 10.0


def test_order_validation_loader_never_sends_wrong_targeted_coupon_to_pricing():
    code, target_id, target_phone, other_phone = _seed_targeted_coupon()
    db = SessionLocal()
    token = current_restaurante_id.set(TENANT_ID)
    try:
        wrong_context = ValidationDataLoader.build_validation_context(
            db,
            restaurante_id=TENANT_ID,
            fulfillment=FulfillmentType.PICKUP,
            itens_solicitados=[],
            cupom_codigo=code,
            cliente_telefone=other_phone,
        )
        assert wrong_context.coupon is not None
        assert wrong_context.coupon.is_active is False

        phone_context = ValidationDataLoader.build_validation_context(
            db,
            restaurante_id=TENANT_ID,
            fulfillment=FulfillmentType.PICKUP,
            itens_solicitados=[],
            cupom_codigo=code,
            cliente_telefone=target_phone,
        )
        assert phone_context.coupon is not None
        assert phone_context.coupon.is_active is True

        authenticated_context = ValidationDataLoader.build_validation_context(
            db,
            restaurante_id=TENANT_ID,
            fulfillment=FulfillmentType.PICKUP,
            itens_solicitados=[],
            cupom_codigo=code,
            cliente_id=target_id,
        )
        assert authenticated_context.coupon is not None
        assert authenticated_context.coupon.is_active is True
    finally:
        current_restaurante_id.reset(token)
        db.close()
