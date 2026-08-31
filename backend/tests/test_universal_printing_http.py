import datetime

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    Categoria,
    Comanda,
    ConfiguracaoRestaurante,
    Item,
    Lancamento,
    PrintJob,
    Produto,
    Restaurante,
    Usuario,
)
from app.security import create_access_token


TENANT_ID = 2881
USER_ID = "usr-universal-print-2881"
CATEGORY_ID = "cat-universal-print-none"
PRODUCT_ID = "prod-universal-print-water"
COMMAND_ID = "c-universal-print"
LAUNCH_ID = "l-universal-print"

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_universal_printing_http():
    Base.metadata.create_all(bind=engine)
    tenant_token = current_restaurante_id.set(None)
    db = SessionLocal(restaurante_id=None)
    try:
        db.query(PrintJob).filter(PrintJob.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Item).filter(Item.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Lancamento).filter(Lancamento.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Comanda).filter(Comanda.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == TENANT_ID
        ).delete(synchronize_session=False)
        db.query(Produto).filter(Produto.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Categoria).filter(Categoria.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Usuario).filter(Usuario.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Restaurante).filter(Restaurante.id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.commit()

        db.add(Restaurante(id=TENANT_ID, nome="Bistrô Universal", plano="bistro"))
        db.flush()
        db.add(
            Usuario(
                id=USER_ID,
                restaurante_id=TENANT_ID,
                nome="Admin Impressão",
                email="universal-print@teste.local",
                role="admin",
                status="ativo",
            )
        )
        db.add(
            Categoria(
                id=CATEGORY_ID,
                restaurante_id=TENANT_ID,
                nome="Bebidas sem via própria",
                destino_impressao="NENHUM",
            )
        )
        db.add(
            Produto(
                id=PRODUCT_ID,
                restaurante_id=TENANT_ID,
                categoria_id=CATEGORY_ID,
                nome="Água de Coco",
                preco=5.0,
                ativo=True,
            )
        )
        db.add(
            ConfiguracaoRestaurante(
                restaurante_id=TENANT_ID,
                perm_garcom_print=True,
                impressao_nome_restaurante="Bistrô Universal",
                impressao_nome_posicao="cabecalho",
                taxa_servico_ativa=False,
            )
        )
        now = datetime.datetime(2026, 8, 31, 21, 56, tzinfo=datetime.timezone.utc)
        db.add(
            Comanda(
                id=COMMAND_ID,
                restaurante_id=TENANT_ID,
                garcom_id=USER_ID,
                tipo="Retirada",
                identificador="GEORLAN",
                numero_pedido=901,
                fechada=False,
                criado_em=now,
                delivery_status="producao",
            )
        )
        db.flush()
        db.add(
            Lancamento(
                id=LAUNCH_ID,
                restaurante_id=TENANT_ID,
                comanda_id=COMMAND_ID,
                garcom_id=USER_ID,
                origem="cardapio",
                status="producao",
                timestamp=now,
            )
        )
        db.add(
            Item(
                id="i-universal-print-water",
                restaurante_id=TENANT_ID,
                comanda_id=COMMAND_ID,
                lancamento_id=LAUNCH_ID,
                produto_id=PRODUCT_ID,
                preco_unit=5.0,
                cliente_nome="GEORLAN",
                observacao="",
                status="preparando",
                pago=False,
            )
        )
        db.commit()
        yield
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)


def _headers():
    token = create_access_token(
        subject=USER_ID,
        restaurante_id=TENANT_ID,
        role="admin",
    )
    return {"Authorization": f"Bearer {token}"}


def _jobs():
    db = SessionLocal()
    try:
        return list(
            db.query(PrintJob)
            .filter(PrintJob.restaurante_id == TENANT_ID)
            .order_by(PrintJob.created_at.asc(), PrintJob.id.asc())
            .all()
        )
    finally:
        db.close()


def _without_reprint_marker(text: str) -> str:
    return "\n".join(
        line for line in text.splitlines() if line.strip() != "REIMPRESSÃO"
    )


def test_universal_route_prints_pickup_even_when_every_item_is_nenhum():
    response = client.post(
        "/impressao",
        headers=_headers(),
        json={
            "source_type": "pedido",
            "source_id": LAUNCH_ID,
            "action": "imprimir",
            "idempotency_key": "universal-http-initial-901",
        },
    )

    assert response.status_code == 200, response.text
    jobs = _jobs()
    assert len(jobs) == 1
    job = jobs[0]
    assert job.destination == "COZINHA"
    assert job.document_type == "producao"
    assert "PED #901" in job.payload_text
    assert "MESA BALCAO" in job.payload_text
    assert "RETIRADA" in job.payload_text
    assert "ÁGUA DE COCO" in job.payload_text
    assert "REIMPRESSÃO" not in job.payload_text


def test_legacy_reprint_alias_uses_same_model_and_only_adds_reprint_marker():
    initial = client.post(
        "/impressao",
        headers=_headers(),
        json={
            "source_type": "pedido",
            "source_id": LAUNCH_ID,
            "action": "imprimir",
            "idempotency_key": "universal-http-base-901",
        },
    )
    assert initial.status_code == 200, initial.text
    original_payload = _jobs()[-1].payload_text

    response = client.post(
        f"/comandas/lancamentos/{LAUNCH_ID}/reimprimir",
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    reprint_payload = _jobs()[-1].payload_text
    assert "REIMPRESSÃO" in reprint_payload
    assert _without_reprint_marker(reprint_payload) == original_payload
