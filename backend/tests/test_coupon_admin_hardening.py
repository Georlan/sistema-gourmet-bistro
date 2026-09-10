import uuid

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.database import SessionLocal, current_restaurante_id
from app.main import app
from app.models import Restaurante, Usuario
from app.routes.auth import create_access_token
from app.schemas import CupomCreate

client = TestClient(app)
TENANT_ID = 995
ADMIN_ID = "usr-coupon-admin-hardening"
WAITER_ID = "usr-coupon-waiter-hardening"


def _headers(subject: str, role: str):
    token = create_access_token(subject=subject, restaurante_id=TENANT_ID, role=role)
    return {"Authorization": f"Bearer {token}"}


def _ensure_users():
    db = SessionLocal()
    token = current_restaurante_id.set(TENANT_ID)
    try:
        if not db.query(Restaurante).filter(Restaurante.id == TENANT_ID).first():
            db.add(Restaurante(id=TENANT_ID, nome="Coupon Admin Hardening", slug="coupon-admin-hardening"))
        if not db.query(Usuario).filter(Usuario.id == ADMIN_ID).first():
            db.add(Usuario(
                id=ADMIN_ID,
                restaurante_id=TENANT_ID,
                nome="Admin Coupon Hardening",
                email="admin-coupon-hardening@koma.test",
                cargo="admin",
                status="ativo",
            ))
        if not db.query(Usuario).filter(Usuario.id == WAITER_ID).first():
            db.add(Usuario(
                id=WAITER_ID,
                restaurante_id=TENANT_ID,
                nome="Garcom Coupon Hardening",
                email="waiter-coupon-hardening@koma.test",
                cargo="garcom",
                status="ativo",
            ))
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()


def _coupon_payload(*, discount_type="porcentagem", value=10.0):
    return {
        "codigo": f"SAFE{uuid.uuid4().hex[:10].upper()}",
        "tipo_desconto": discount_type,
        "valor_desconto": value,
        "valor_minimo_pedido": 0.0,
        "limite_usos": None,
        "apenas_primeira_compra": False,
        "ativo": True,
    }


def test_percentage_coupon_cannot_exceed_full_order_value():
    _ensure_users()
    response = client.post(
        "/caixa/cupons",
        headers=_headers(ADMIN_ID, "admin"),
        json=_coupon_payload(value=100.01),
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Desconto percentual não pode ultrapassar 100%."

    accepted = client.post(
        "/caixa/cupons",
        headers=_headers(ADMIN_ID, "admin"),
        json=_coupon_payload(value=100.0),
    )
    assert accepted.status_code == 201


def test_fixed_coupon_keeps_manual_business_freedom():
    _ensure_users()
    response = client.post(
        "/caixa/cupons",
        headers=_headers(ADMIN_ID, "admin"),
        json=_coupon_payload(discount_type="fixo", value=150.0),
    )
    assert response.status_code == 201
    assert response.json()["valor_desconto"] == 150.0


def test_non_finite_coupon_value_is_rejected_by_input_contract():
    with pytest.raises(ValidationError):
        CupomCreate(
            codigo="FINITE10",
            tipo_desconto="fixo",
            valor_desconto=float("nan"),
        )


def test_waiter_cannot_read_or_mutate_coupon_administration():
    _ensure_users()
    headers = _headers(WAITER_ID, "garcom")

    listing = client.get("/caixa/cupons", headers=headers)
    assert listing.status_code == 403

    creation = client.post(
        "/caixa/cupons",
        headers=headers,
        json=_coupon_payload(),
    )
    assert creation.status_code == 403
