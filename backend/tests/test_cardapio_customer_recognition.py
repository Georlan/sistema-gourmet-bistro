from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import Cliente, PublicRateLimit, Restaurante


client = TestClient(app)


def _ensure_restaurant(db, restaurante_id: int, slug: str) -> None:
    restaurante = db.query(Restaurante).filter(Restaurante.id == restaurante_id).first()
    if restaurante is None:
        db.add(
            Restaurante(
                id=restaurante_id,
                nome=f"Restaurante Reconhecimento {restaurante_id}",
                slug=slug,
                plano="pro",
            )
        )
        db.commit()


def test_public_customer_recognition_is_minimal_and_tenant_scoped():
    Base.metadata.create_all(bind=engine)
    tenant_a = 9910
    tenant_b = 9911
    telefone = "85999991234"
    db = SessionLocal()
    try:
        _ensure_restaurant(db, tenant_a, "reconhecimento-9910")
        _ensure_restaurant(db, tenant_b, "reconhecimento-9911")

        cliente = db.query(Cliente).filter(
            Cliente.restaurante_id == tenant_a,
            Cliente.telefone == telefone,
        ).first()
        if cliente is None:
            db.add(
                Cliente(
                    id=str(uuid.uuid4()),
                    restaurante_id=tenant_a,
                    telefone=telefone,
                    nome="Cliente Privado",
                    endereco="Rua que não pode vazar, 123",
                    saldo_pontos=77,
                    saldo_cashback=12.34,
                )
            )
            db.commit()

        found = client.post(
            "/cardapio/clientes/reconhecer",
            json={"restaurante_id": tenant_a, "telefone": telefone},
        )
        assert found.status_code == 200
        assert found.json() == {"found": True}

        other_tenant = client.post(
            "/cardapio/clientes/reconhecer",
            json={"restaurante_id": tenant_b, "telefone": telefone},
        )
        assert other_tenant.status_code == 200
        assert other_tenant.json() == {"found": False}
    finally:
        db.query(PublicRateLimit).filter(
            PublicRateLimit.restaurante_id.in_([tenant_a, tenant_b])
        ).delete(synchronize_session=False)
        db.query(Cliente).filter(
            Cliente.restaurante_id.in_([tenant_a, tenant_b])
        ).delete(synchronize_session=False)
        db.query(Restaurante).filter(
            Restaurante.id.in_([tenant_a, tenant_b])
        ).delete(synchronize_session=False)
        db.commit()
        db.close()
