import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal, current_restaurante_id
from app.main import app
from app.models import ActivityLog, Cupom, Restaurante, Usuario
from app.routes.auth import create_access_token

client = TestClient(app)


def _ensure_admin_and_headers():
    db = SessionLocal()
    token = current_restaurante_id.set(997)
    try:
        rest = db.query(Restaurante).filter(Restaurante.id == 997).first()
        if not rest:
            db.add(Restaurante(id=997, nome="Restaurante Coupon Deactivation", slug="rest-997"))
        user = db.query(Usuario).filter(Usuario.id == "usr-coupon-deactivation").first()
        if not user:
            db.add(Usuario(
                id="usr-coupon-deactivation",
                restaurante_id=997,
                nome="Admin Coupon Deactivation",
                email="coupondeactivation@koma.test",
                cargo="admin",
                status="ativo",
            ))
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()

    access_token = create_access_token(
        subject="usr-coupon-deactivation",
        restaurante_id=997,
        role="admin",
    )
    return {"Authorization": f"Bearer {access_token}"}


def test_delete_desativa_cupom_preserva_historico_e_audita():
    headers = _ensure_admin_and_headers()
    coupon_id = f"cup-soft-{uuid.uuid4().hex[:10]}"
    code = f"SOFT{uuid.uuid4().hex[:8].upper()}"

    db = SessionLocal()
    token = current_restaurante_id.set(997)
    try:
        db.add(Cupom(
            id=coupon_id,
            restaurante_id=997,
            codigo=code,
            tipo_desconto="porcentagem",
            valor_desconto=12.0,
            valor_minimo_pedido=40.0,
            limite_usos=20,
            usos_atuais=3,
            ativo=True,
        ))
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()

    response = client.delete(f"/caixa/cupons/{coupon_id}", headers=headers)
    assert response.status_code == 204

    db = SessionLocal()
    try:
        coupon = db.query(Cupom).filter(
            Cupom.restaurante_id == 997,
            Cupom.id == coupon_id,
        ).one()
        assert coupon.ativo is False
        assert coupon.usos_atuais == 3
        assert coupon.codigo == code

        log = db.query(ActivityLog).filter(
            ActivityLog.restaurante_id == 997,
            ActivityLog.garcom_id == "usr-coupon-deactivation",
            ActivityLog.action == "DEACTIVATE_COUPON",
        ).order_by(ActivityLog.id.desc()).first()
        assert log is not None
        assert code in log.details
        assert "3 uso(s)" in log.details
    finally:
        db.close()


def test_delete_nao_alcanca_cupom_de_outro_tenant():
    headers = _ensure_admin_and_headers()
    other_coupon_id = f"cup-other-{uuid.uuid4().hex[:10]}"
    other_code = f"OTHER{uuid.uuid4().hex[:8].upper()}"

    db = SessionLocal()
    token = current_restaurante_id.set(996)
    try:
        other_rest = db.query(Restaurante).filter(Restaurante.id == 996).first()
        if not other_rest:
            db.add(Restaurante(id=996, nome="Restaurante Other Coupon", slug="rest-996"))
            db.commit()
        db.add(Cupom(
            id=other_coupon_id,
            restaurante_id=996,
            codigo=other_code,
            tipo_desconto="fixo",
            valor_desconto=5.0,
            ativo=True,
        ))
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()

    response = client.delete(f"/caixa/cupons/{other_coupon_id}", headers=headers)
    assert response.status_code == 404

    db = SessionLocal()
    try:
        coupon = db.query(Cupom).filter(
            Cupom.restaurante_id == 996,
            Cupom.id == other_coupon_id,
        ).one()
        assert coupon.ativo is True
    finally:
        db.close()
