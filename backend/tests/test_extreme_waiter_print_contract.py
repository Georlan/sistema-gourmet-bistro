from types import SimpleNamespace

import pytest

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import PrintJob, Restaurante
from app.routes import printing as printing_routes


TENANT_ID = 2991


@pytest.fixture(autouse=True)
def setup_extreme_waiter_print_contract(monkeypatch):
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(TENANT_ID)
    db = SessionLocal()
    try:
        if not db.query(Restaurante).filter(Restaurante.id == TENANT_ID).first():
            db.add(
                Restaurante(
                    id=TENANT_ID,
                    nome="KÔMA Teste Impressão",
                    slug="koma-teste-impressao-2991",
                    plano="pro",
                )
            )
            db.commit()
        db.query(PrintJob).filter(PrintJob.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.commit()
    finally:
        db.close()

    # Entitlement e preferências têm cobertura própria. Aqui o contrato é:
    # ação sintética -> um PrintJob canônico, sem pedido real.
    monkeypatch.setattr(
        printing_routes,
        "_require_physical_printing",
        lambda db, restaurante_id: None,
    )
    monkeypatch.setattr(
        printing_routes,
        "get_print_preferences",
        lambda db, restaurante_id: SimpleNamespace(
            restaurant_name="KÔMA Teste",
            restaurant_name_position="cabecalho",
        ),
    )

    yield

    current_restaurante_id.reset(token)


def test_extreme_waiter_print_enqueues_canonical_synthetic_receipt():
    db = SessionLocal()
    try:
        before = db.query(PrintJob).filter(PrintJob.restaurante_id == TENANT_ID).count()

        response = printing_routes.imprimir_teste_extremo_garcom(
            db=db,
            current_user=SimpleNamespace(nome="Admin Teste"),
        )

        after = db.query(PrintJob).filter(PrintJob.restaurante_id == TENANT_ID).count()
        job = db.get(PrintJob, response["job_id"])

        assert after == before + 1
        assert response["status"] == "enqueued"
        assert response["destination"] == "COZINHA"
        assert job is not None
        assert job.restaurante_id == TENANT_ID
        assert job.document_type == "producao"
        assert job.destination == "COZINHA"
        assert job.source_type == "teste_extremo_garcom"
        assert job.status == "pending"

        ticket = job.payload_text
        assert "TESTE-88-Z" in ticket
        assert "CONSUMO NO LOCAL" in ticket
        assert "MESA: 99" in ticket
        assert "GARÇOM: GARÇOM TESTE COM NOME MUITO COMPRIDO" in ticket
        assert "GEORLAN" in ticket
        assert "ANA CLIENTE COM NOME COMPRIDO" in ticket
        assert "TESTE DE IMPRESSÃO GARÇOM" in ticket
        assert "NÃO É PEDIDO REAL" in ticket
    finally:
        db.close()


def test_extreme_waiter_print_is_a_distinct_http_contract():
    paths = app.openapi()["paths"]
    assert "/impressao/teste-extremo-garcom" in paths
    assert "post" in paths["/impressao/teste-extremo-garcom"]
