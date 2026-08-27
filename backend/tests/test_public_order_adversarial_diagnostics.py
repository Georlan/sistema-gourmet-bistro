import concurrent.futures
import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import CaixaTurno, Categoria, Comanda, PrintJob, Produto, Restaurante, Usuario
from app.security import create_access_token


client = TestClient(app)

RESTAURANTE_ID = 99117
USER_ID = "usr-online-adversarial"
PRODUCT_ID = "prod-online-adversarial"
CATEGORY_ID = "cat-online-adversarial"


@pytest.fixture(scope="module", autouse=True)
def setup_adversarial_online_order_data():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        restaurante = db.query(Restaurante).filter(
            Restaurante.id == RESTAURANTE_ID,
        ).first()
        if restaurante is None:
            restaurante = Restaurante(
                id=RESTAURANTE_ID,
                nome="Koma Adversarial Diagnostics",
                plano="pro",
                slug="koma-adversarial-diagnostics",
            )
            db.add(restaurante)
        restaurante.plano = "pro"
        restaurante.status_override = None

        categoria = db.query(Categoria).filter(
            Categoria.restaurante_id == RESTAURANTE_ID,
            Categoria.id == CATEGORY_ID,
        ).first()
        if categoria is None:
            categoria = Categoria(
                id=CATEGORY_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Diagnostico",
                destino_impressao="COZINHA",
            )
            db.add(categoria)

        produto = db.query(Produto).filter(
            Produto.restaurante_id == RESTAURANTE_ID,
            Produto.id == PRODUCT_ID,
        ).first()
        if produto is None:
            produto = Produto(
                id=PRODUCT_ID,
                restaurante_id=RESTAURANTE_ID,
                categoria_id=CATEGORY_ID,
                nome="Produto Diagnostico Online",
                preco=25.0,
                ativo=True,
            )
            db.add(produto)
        else:
            produto.preco = 25.0
            produto.ativo = True

        usuario = db.query(Usuario).filter(
            Usuario.restaurante_id == RESTAURANTE_ID,
            Usuario.id == USER_ID,
        ).first()
        if usuario is None:
            usuario = Usuario(
                id=USER_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Operador Diagnostico",
                email="diag-online@koma.invalid",
                role="admin",
                cargo="admin",
                status="ativo",
            )
            db.add(usuario)
        else:
            usuario.role = "admin"
            usuario.cargo = "admin"
            usuario.status = "ativo"

        db.flush()
        turno = db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == RESTAURANTE_ID,
            CaixaTurno.status == "aberto",
        ).first()
        if turno is None:
            db.add(CaixaTurno(
                restaurante_id=RESTAURANTE_ID,
                aberto_por_id=USER_ID,
                saldo_inicial=0,
                status="aberto",
            ))
        db.commit()
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()

    yield


def _staff_headers():
    token = create_access_token(
        subject=USER_ID,
        restaurante_id=RESTAURANTE_ID,
        role="admin",
    )
    return {"Authorization": f"Bearer {token}"}


def _payload(
    *,
    modalidade="retirada",
    taxa=0.0,
    quantidade=1,
    idempotency_key=None,
    observacao="Diagnostico adversarial",
):
    suffix = uuid.uuid4().hex[:10]
    payload = {
        "restaurante_id": RESTAURANTE_ID,
        "itens": [{
            "produto_id": PRODUCT_ID,
            "quantidade": quantidade,
            "observacao": observacao,
        }],
        "cliente_nome": f"Cliente Diag {suffix}",
        "cliente_telefone": f"85{int(suffix[:8], 16) % 10**9:09d}",
        "endereco_entrega": "Rua Diagnostico, 117" if modalidade == "delivery" else "",
        "taxa_entrega": taxa,
        "forma_pagamento": "na_entrega",
        "tipo_pedido": modalidade,
    }
    if idempotency_key is not None:
        payload["idempotency_key"] = idempotency_key
    return payload


def _create_order(**kwargs):
    response = client.post("/cardapio/pedidos", json=_payload(**kwargs))
    assert response.status_code == 201, response.text
    return response.json()


def _print_jobs_for(comanda_id):
    db = SessionLocal()
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        return db.query(PrintJob).filter(
            PrintJob.restaurante_id == RESTAURANTE_ID,
            PrintJob.source_type == "pedido",
            PrintJob.source_id == comanda_id,
        ).count()
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()


def test_diag_delivery_fee_is_currently_controlled_by_public_request():
    free_delivery = _create_order(modalidade="delivery", taxa=0)
    expensive_delivery = _create_order(modalidade="delivery", taxa=9999)

    assert free_delivery["total"] == 25.0
    assert expensive_delivery["total"] == 10024.0

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        free = db.query(Comanda).filter(Comanda.id == free_delivery["comanda_id"]).one()
        expensive = db.query(Comanda).filter(Comanda.id == expensive_delivery["comanda_id"]).one()
        assert float(free.delivery_taxa) == 0.0
        assert float(expensive.delivery_taxa) == 9999.0
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()


def test_diag_anonymous_burst_currently_creates_distinct_orders_without_otp_or_rate_limit():
    created_ids = []
    for index in range(12):
        response = client.post(
            "/cardapio/pedidos",
            json=_payload(observacao=f"burst-anonimo-{index}-{uuid.uuid4().hex}"),
        )
        assert response.status_code == 201, response.text
        created_ids.append(response.json()["comanda_id"])

    assert len(created_ids) == 12
    assert len(set(created_ids)) == 12


def test_diag_reused_idempotency_key_with_changed_cart_silently_returns_first_order():
    key = f"diag-changed-cart-{uuid.uuid4().hex}"
    first_payload = _payload(
        quantidade=1,
        idempotency_key=key,
        observacao="carrinho-original",
    )
    second_payload = {
        **first_payload,
        "itens": [{
            "produto_id": PRODUCT_ID,
            "quantidade": 2,
            "observacao": "carrinho-alterado",
        }],
    }

    first = client.post("/cardapio/pedidos", json=first_payload)
    second = client.post("/cardapio/pedidos", json=second_payload)

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert second.json()["comanda_id"] == first.json()["comanda_id"]

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        comanda = db.query(Comanda).filter(
            Comanda.id == first.json()["comanda_id"],
        ).one()
        assert len(comanda.itens) == 1
        assert comanda.itens[0].observacao == "carrinho-original"
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()


def test_diag_pending_order_can_skip_acceptance_and_be_finalized_while_still_open():
    order = _create_order()
    comanda_id = order["comanda_id"]

    forced = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=finalizado",
        headers=_staff_headers(),
    )
    assert forced.status_code == 200, forced.text
    assert forced.json()["delivery_status"] == "finalizado"
    assert forced.json()["fechada"] is False
    assert _print_jobs_for(comanda_id) == 0

    active = client.get("/comandas/delivery/ativos", headers=_staff_headers())
    assert active.status_code == 200
    assert any(item["id"] == comanda_id for item in active.json())


def test_diag_accepted_order_can_regress_to_pending_after_being_printed():
    order = _create_order()
    comanda_id = order["comanda_id"]
    headers = _staff_headers()

    accepted = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=producao",
        headers=headers,
    )
    assert accepted.status_code == 200, accepted.text
    assert _print_jobs_for(comanda_id) == 1

    regressed = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=pendente",
        headers=headers,
    )
    assert regressed.status_code == 200, regressed.text
    assert regressed.json()["delivery_status"] == "pendente"

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        assert all(item.impresso_em is not None for item in comanda.itens)
        assert all(item.status == "preparando" for item in comanda.itens)
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()


def test_diag_accepted_order_can_be_refused_with_pending_print_job_already_created():
    order = _create_order()
    comanda_id = order["comanda_id"]
    headers = _staff_headers()

    accepted = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=producao",
        headers=headers,
    )
    assert accepted.status_code == 200, accepted.text
    assert _print_jobs_for(comanda_id) == 1

    refused = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=recusado",
        headers=headers,
    )
    assert refused.status_code == 200, refused.text
    assert refused.json()["delivery_status"] == "recusado"
    assert refused.json()["fechada"] is True

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        jobs = db.query(PrintJob).filter(
            PrintJob.restaurante_id == RESTAURANTE_ID,
            PrintJob.source_type == "pedido",
            PrintJob.source_id == comanda_id,
        ).all()
        assert all(item.status == "cancelado" for item in comanda.itens)
        assert len(jobs) == 1
        assert jobs[0].status == "pending"
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()


def test_diag_rejected_closed_order_can_be_moved_back_to_production():
    order = _create_order()
    comanda_id = order["comanda_id"]
    headers = _staff_headers()

    refused = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=recusado",
        headers=headers,
    )
    assert refused.status_code == 200, refused.text
    assert refused.json()["fechada"] is True

    reopened_by_status = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=producao",
        headers=headers,
    )
    assert reopened_by_status.status_code == 200, reopened_by_status.text
    assert reopened_by_status.json()["delivery_status"] == "producao"
    assert reopened_by_status.json()["fechada"] is True
    assert _print_jobs_for(comanda_id) == 0


def test_diag_pending_delivery_can_be_dispatched_twice_without_acceptance_and_duplicates_delivery_prints():
    order = _create_order(modalidade="delivery", taxa=7)
    comanda_id = order["comanda_id"]
    headers = _staff_headers()

    motoboy = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": f"Motoboy Diag {uuid.uuid4().hex[:6]}", "telefone": "85999991117"},
        headers=headers,
    )
    assert motoboy.status_code == 201, motoboy.text
    motoboy_id = motoboy.json()["id"]

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        before = db.query(PrintJob).filter(
            PrintJob.restaurante_id == RESTAURANTE_ID,
        ).count()
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()

    first_dispatch = client.post(
        f"/comandas/{comanda_id}/delivery/despachar",
        json={"motoboy_id": motoboy_id},
        headers=headers,
    )
    assert first_dispatch.status_code == 200, first_dispatch.text
    assert first_dispatch.json()["delivery_status"] == "transito"
    assert _print_jobs_for(comanda_id) == 0

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        after_first = db.query(PrintJob).filter(
            PrintJob.restaurante_id == RESTAURANTE_ID,
        ).count()
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()

    second_dispatch = client.post(
        f"/comandas/{comanda_id}/delivery/despachar",
        json={"motoboy_id": motoboy_id},
        headers=headers,
    )
    assert second_dispatch.status_code == 200, second_dispatch.text

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        after_second = db.query(PrintJob).filter(
            PrintJob.restaurante_id == RESTAURANTE_ID,
        ).count()
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()

    assert after_first > before
    assert after_second > after_first


def test_same_idempotency_key_under_concurrent_public_requests_collapses_to_one_order():
    key = f"diag-concurrent-create-{uuid.uuid4().hex}"
    payload = _payload(idempotency_key=key, observacao="concorrencia-create")

    def submit():
        with TestClient(app) as concurrent_client:
            response = concurrent_client.post("/cardapio/pedidos", json=payload)
            return response.status_code, response.json()

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _index: submit(), range(4)))

    assert all(status == 201 for status, _body in results), results
    ids = {body["comanda_id"] for _status, body in results}
    assert len(ids) == 1

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        assert db.query(Comanda).filter(
            Comanda.restaurante_id == RESTAURANTE_ID,
            Comanda.idempotency_key == key,
        ).count() == 1
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()


def test_concurrent_accept_requests_create_only_one_initial_production_print_job():
    order = _create_order()
    comanda_id = order["comanda_id"]
    headers = _staff_headers()
    endpoint = f"/comandas/{comanda_id}/delivery/status?status_novo=producao"

    def accept():
        with TestClient(app) as concurrent_client:
            response = concurrent_client.put(endpoint, headers=headers)
            return response.status_code, response.json()

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _index: accept(), range(4)))

    assert all(status == 200 for status, _body in results), results
    assert _print_jobs_for(comanda_id) == 1


def test_forced_invalid_status_is_rejected_without_changing_order():
    order = _create_order()
    comanda_id = order["comanda_id"]

    response = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=hackeado",
        headers=_staff_headers(),
    )
    assert response.status_code == 422

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        assert comanda.delivery_status == "pendente"
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()


def test_public_order_rejects_more_than_200_units():
    response = client.post(
        "/cardapio/pedidos",
        json={
            **_payload(),
            "itens": [
                {
                    "produto_id": PRODUCT_ID,
                    "quantidade": 100,
                    "observacao": "lote-a",
                },
                {
                    "produto_id": PRODUCT_ID,
                    "quantidade": 100,
                    "observacao": "lote-b",
                },
                {
                    "produto_id": PRODUCT_ID,
                    "quantidade": 1,
                    "observacao": "lote-c",
                },
            ],
        },
    )
    assert response.status_code == 422
    assert "no máximo 200 unidades" in response.json()["detail"]


def test_public_order_rejects_mismatched_header_and_body_idempotency_keys():
    response = client.post(
        "/cardapio/pedidos",
        headers={"X-Idempotency-Key": f"header-{uuid.uuid4().hex}"},
        json=_payload(idempotency_key=f"body-{uuid.uuid4().hex}"),
    )
    assert response.status_code == 422
    assert "chave idempotente" in response.json()["detail"].lower()
