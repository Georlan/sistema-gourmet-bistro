from unittest.mock import patch
import json
import pytest
from fastapi.testclient import TestClient
from app.database import SessionLocal, Base, engine, current_restaurante_id
from app.main import app
from app.models import ActivityLog, Usuario, Produto, Categoria, Comanda, DeliveryCourierReassignmentAudit, Item, Lancamento, Motoboy
from app.security import get_password_hash

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_db():
    token_var = current_restaurante_id.set(1)
    try:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        
        db = SessionLocal()
        try:
            # Create category
            cat = Categoria(id="cat-del", restaurante_id=1, nome="Lanches")
            db.add(cat)
            
            # Create product
            prod = Produto(id="p-del", restaurante_id=1, nome="Burguer Simples", categoria_id="cat-del", preco=15.0, ativo=True)
            db.add(prod)
            
            # Create user
            user = Usuario(
                id="u-del-01",
                restaurante_id=1,
                nome="Delivery Agent",
                usuario="delagent",
                senha_hash=get_password_hash("123"),
                role="caixa",
                status="ativo",
            )
            db.add(user)
            db.commit()
        finally:
            db.close()
            
        yield
        Base.metadata.drop_all(bind=engine)
    finally:
        current_restaurante_id.reset(token_var)


def test_delivery_and_motoboy_flow(setup_db):
    # 1. Login
    login_res = client.post("/auth/login", json={"username": "delagent", "password": "123"})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    opened = client.post(
        "/caixa/turno/abrir",
        json={"saldo_inicial": 0},
        headers=headers,
    )
    assert opened.status_code == 201
    
    # 2. Cadastrar Motoboy
    motoboy_payload = {"nome": "Sandro Motos", "telefone": "81 99999-7777"}
    mb_res = client.post("/comandas/motoboys/cadastro", json=motoboy_payload, headers=headers)
    assert mb_res.status_code == 201
    mb_data = mb_res.json()
    assert mb_data["nome"] == "Sandro Motos"
    motoboy_id = mb_data["id"]
    
    # 3. Listar Motoboys
    mbs_res = client.get("/comandas/motoboys/lista", headers=headers)
    assert mbs_res.status_code == 200
    assert len(mbs_res.json()) >= 1
    
    # 4. Criar comanda de Delivery em estado legado "analise".
    # A state machine deve tratá-lo como equivalente a "pendente".
    comanda_payload = {
        "mesa_id": None,
        "garcom_id": "u-del-01",
        "tipo": "Delivery",
        "identificador": "Carlos Silva",
        "delivery_status": "analise",
        "delivery_telefone": "81 98888-3333",
        "delivery_endereco": "Rua das Flores, 123",
        "delivery_taxa": 6.50
    }
    create_res = client.post("/comandas/", json=comanda_payload, headers=headers)
    assert create_res.status_code == 201
    comanda_data = create_res.json()
    assert comanda_data["tipo"] == "Delivery"
    assert comanda_data["delivery_status"] == "analise"
    assert comanda_data["delivery_telefone"] == "81 98888-3333"
    comanda_id = comanda_data["id"]
    
    # 5. Listar Delivery Ativos
    actives_res = client.get("/comandas/delivery/ativos", headers=headers)
    assert actives_res.status_code == 200
    actives = actives_res.json()
    assert len(actives) >= 1
    assert any(a["id"] == comanda_id for a in actives)
    
    # 6. Aceitar: analise/pendente -> producao
    status_res = client.put(f"/comandas/{comanda_id}/delivery/status?status_novo=producao", headers=headers)
    assert status_res.status_code == 200
    assert status_res.json()["delivery_status"] == "producao"

    # A máquina não permite pular produção -> trânsito.
    invalid_dispatch = client.post(
        f"/comandas/{comanda_id}/delivery/despachar",
        json={"motoboy_id": motoboy_id},
        headers=headers,
    )
    assert invalid_dispatch.status_code == 409

    # 7. Produção -> pronto antes do despacho.
    ready_res = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=pronto",
        headers=headers,
    )
    assert ready_res.status_code == 200
    assert ready_res.json()["delivery_status"] == "pronto"

    # 8. Despachar com Motoboy: pronto -> transito
    dispatch_res = client.post(f"/comandas/{comanda_id}/delivery/despachar", json={"motoboy_id": motoboy_id}, headers=headers)
    assert dispatch_res.status_code == 200
    dispatch_data = dispatch_res.json()
    assert dispatch_data["delivery_status"] == "transito"
    assert dispatch_data["motoboy_id"] == motoboy_id

    # 9. Em rota, a troca normal permanece bloqueada.
    second_mb_res = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Lia Entregas", "telefone": "81 99999-8888"},
        headers=headers,
    )
    assert second_mb_res.status_code == 201
    second_motoboy_id = second_mb_res.json()["id"]

    normal_reassign = client.put(
        f"/comandas/{comanda_id}/delivery/entregador",
        json={"motoboy_id": second_motoboy_id},
        headers=headers,
    )
    assert normal_reassign.status_code == 409

    missing_reason = client.post(
        f"/comandas/{comanda_id}/delivery/entregador/reassign",
        json={"motoboy_id": second_motoboy_id, "motivo": ""},
        headers=headers,
    )
    assert missing_reason.status_code == 422

    same_courier = client.post(
        f"/comandas/{comanda_id}/delivery/entregador/reassign",
        json={"motoboy_id": motoboy_id, "motivo": "Correção de teste"},
        headers=headers,
    )
    assert same_courier.status_code == 409

    # 10. A exceção exige motivo, preserva trânsito e não dispara novo despacho.
    with patch("app.routes.orders._agendar_notificacao_whatsapp_status") as customer_status:
        reassigned = client.post(
            f"/comandas/{comanda_id}/delivery/entregador/reassign",
            json={
                "motoboy_id": second_motoboy_id,
                "motivo": "Entregador selecionado por engano",
            },
            headers=headers,
        )

    assert reassigned.status_code == 200, reassigned.text
    assert reassigned.json()["delivery_status"] == "transito"
    assert reassigned.json()["motoboy_id"] == second_motoboy_id
    customer_status.assert_not_called()

    db = SessionLocal(restaurante_id=1)
    try:
        audit = (
            db.query(DeliveryCourierReassignmentAudit)
            .filter(
                DeliveryCourierReassignmentAudit.restaurante_id == 1,
                DeliveryCourierReassignmentAudit.comanda_id == comanda_id,
            )
            .one()
        )
        assert audit.previous_motoboy_id == motoboy_id
        assert audit.new_motoboy_id == second_motoboy_id
        assert audit.previous_motoboy_name == "Sandro Motos"
        assert audit.new_motoboy_name == "Lia Entregas"
        assert audit.actor_user_id == "u-del-01"
        assert audit.reason == "Entregador selecionado por engano"
    finally:
        db.close()


def _delivery_headers():
    login_res = client.post("/auth/login", json={"username": "delagent", "password": "123"})
    assert login_res.status_code == 200
    headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}
    opened = client.post("/caixa/turno/abrir", json={"saldo_inicial": 0}, headers=headers)
    assert opened.status_code in {201, 400, 409}
    return headers


def test_delivery_can_become_pickup_before_dispatch_without_losing_history(setup_db):
    headers = _delivery_headers()
    courier = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Rita Conversão", "telefone": "81 98888-6655"},
        headers=headers,
    )
    assert courier.status_code == 201, courier.text
    courier_id = courier.json()["id"]

    created = client.post(
        "/comandas/",
        json={
            "mesa_id": None,
            "garcom_id": "u-del-01",
            "tipo": "Delivery",
            "identificador": "Cliente que vem buscar",
            "delivery_status": "producao",
            "delivery_telefone": "81 97777-1111",
            "delivery_endereco": "Rua Original, 10",
            "delivery_taxa": 8.5,
            "delivery_forma_pagamento": "dinheiro",
            "delivery_troco_para": 50,
            "motoboy_id": courier_id,
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    order_id = created.json()["id"]

    missing_reason = client.post(
        f"/comandas/{order_id}/delivery/converter-retirada",
        json={"motivo": ""},
        headers=headers,
    )
    assert missing_reason.status_code == 422

    converted = client.post(
        f"/comandas/{order_id}/delivery/converter-retirada",
        json={"motivo": "Cliente decidiu retirar no balcão"},
        headers=headers,
    )
    assert converted.status_code == 200, converted.text
    payload = converted.json()
    assert payload["tipo"] == "Retirada"
    assert payload["delivery_status"] == "producao"
    assert payload["motoboy_id"] is None
    assert float(payload["delivery_taxa"]) == 0.0
    assert payload["delivery_endereco"] == "Rua Original, 10"

    db = SessionLocal(restaurante_id=1)
    try:
        log = (
            db.query(ActivityLog)
            .filter(
                ActivityLog.restaurante_id == 1,
                ActivityLog.garcom_id == "u-del-01",
                ActivityLog.action == "CONVERT_FULFILLMENT",
            )
            .order_by(ActivityLog.id.desc())
            .first()
        )
        assert log is not None
        details = json.loads(log.details)
        assert details["comanda_id"] == order_id
        assert details["fulfillment_original"] == "Delivery"
        assert details["fulfillment_atual"] == "Retirada"
        assert details["delivery_status_preservado"] == "producao"
        assert details["motoboy_id_anterior"] == courier_id
        assert details["delivery_taxa_anterior"] == 8.5
        assert details["motivo"] == "Cliente decidiu retirar no balcão"
    finally:
        db.close()

    active = client.get("/comandas/delivery/ativos", headers=headers)
    assert active.status_code == 200
    projected = next(order for order in active.json() if order["id"] == order_id)
    assert projected["tipo"] == "Retirada"
    assert projected["delivery_status"] == "producao"


def test_delivery_to_pickup_rejects_in_route_and_paid_delivery_fee(setup_db):
    headers = _delivery_headers()
    courier = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Nando Conversão", "telefone": "81 98888-6677"},
        headers=headers,
    )
    assert courier.status_code == 201, courier.text
    courier_id = courier.json()["id"]

    in_route = client.post(
        "/comandas/",
        json={
            "mesa_id": None,
            "garcom_id": "u-del-01",
            "tipo": "Delivery",
            "identificador": "Cliente em rota",
            "delivery_status": "pronto",
            "delivery_telefone": "81 96666-1111",
            "delivery_endereco": "Rua Em Rota, 20",
            "delivery_taxa": 7,
            "motoboy_id": courier_id,
        },
        headers=headers,
    )
    assert in_route.status_code == 201, in_route.text
    in_route_id = in_route.json()["id"]
    dispatched = client.post(
        f"/comandas/{in_route_id}/delivery/despachar",
        json={"motoboy_id": courier_id},
        headers=headers,
    )
    assert dispatched.status_code == 200, dispatched.text

    blocked_route = client.post(
        f"/comandas/{in_route_id}/delivery/converter-retirada",
        json={"motivo": "Cliente apareceu no restaurante"},
        headers=headers,
    )
    assert blocked_route.status_code == 409
    assert "já saiu para entrega" in blocked_route.json()["detail"]

    paid = client.post(
        "/comandas/",
        json={
            "mesa_id": None,
            "garcom_id": "u-del-01",
            "tipo": "Delivery",
            "identificador": "Cliente taxa paga",
            "delivery_status": "pronto",
            "delivery_telefone": "81 95555-1111",
            "delivery_endereco": "Rua Taxa Paga, 30",
            "delivery_taxa": 9,
        },
        headers=headers,
    )
    assert paid.status_code == 201, paid.text
    paid_id = paid.json()["id"]

    db = SessionLocal(restaurante_id=1)
    try:
        paid_order = db.query(Comanda).filter(
            Comanda.restaurante_id == 1,
            Comanda.id == paid_id,
        ).one()
        paid_order.online_payment_status = "approved"
        paid_order.valor_pago = 9
        db.commit()
    finally:
        db.close()

    blocked_finance = client.post(
        f"/comandas/{paid_id}/delivery/converter-retirada",
        json={"motivo": "Cliente vem retirar"},
        headers=headers,
    )
    assert blocked_finance.status_code == 409
    assert "ajuste financeiro/estorno" in blocked_finance.json()["detail"]


def test_cash_payment_uses_fee_and_discounts_without_finishing_fulfillment(setup_db):
    headers = _delivery_headers()
    order_id = "delivery-finance-decoupled"

    db = SessionLocal(restaurante_id=1)
    try:
        existing = db.query(Comanda).filter(
            Comanda.restaurante_id == 1,
            Comanda.id == order_id,
        ).first()
        if existing is not None:
            db.delete(existing)
            db.flush()

        comanda = Comanda(
            id=order_id,
            restaurante_id=1,
            mesa_id=None,
            garcom_id="u-del-01",
            tipo="Delivery",
            identificador="Cliente financeiro",
            numero_pedido=9901,
            fechada=False,
            valor_pago=0,
            delivery_status="pronto",
            delivery_telefone="81944443333",
            delivery_endereco="Rua Financeira, 18",
            delivery_taxa=5,
            valor_desconto_cupom=2,
        )
        launch = Lancamento(
            id="launch-delivery-finance-decoupled",
            restaurante_id=1,
            comanda_id=order_id,
            garcom_id="u-del-01",
            origem="caixa",
            status="pronto",
        )
        item = Item(
            id="item-delivery-finance-decoupled",
            restaurante_id=1,
            comanda_id=order_id,
            lancamento_id=launch.id,
            produto_id="p-del",
            preco_unit=15,
            observacao="",
            cliente_nome="Cliente financeiro",
            status="pronto",
            pago=False,
        )
        db.add_all([comanda, launch, item])
        db.commit()
    finally:
        db.close()

    # Total canônico: 15 itens + 5 frete - 2 desconto = 18.
    first = client.post(
        f"/caixa/comandas/{order_id}/pagar",
        json={
            "valor": 15,
            "metodo": "dinheiro",
            "idempotency_key": "delivery-finance-partial-1",
        },
        headers=headers,
    )
    assert first.status_code == 201, first.text

    close_with_fee_open = client.put(f"/comandas/{order_id}/fechar", headers=headers)
    assert close_with_fee_open.status_code == 400
    assert "Valor devido: R$18.00" in close_with_fee_open.json()["detail"]

    db = SessionLocal(restaurante_id=1)
    try:
        partial = db.query(Comanda).filter(Comanda.id == order_id).one()
        assert float(partial.valor_pago) == 15.0
        assert partial.fechada is False
        assert partial.delivery_status == "pronto"
    finally:
        db.close()

    second = client.post(
        f"/caixa/comandas/{order_id}/pagar",
        json={
            "valor": 3,
            "metodo": "dinheiro",
            "idempotency_key": "delivery-finance-partial-2",
        },
        headers=headers,
    )
    assert second.status_code == 201, second.text

    db = SessionLocal(restaurante_id=1)
    try:
        paid = db.query(Comanda).filter(Comanda.id == order_id).one()
        assert float(paid.valor_pago) == 18.0
        assert paid.fechada is False
        assert paid.delivery_status == "pronto"
        assert all(item.pago for item in paid.itens)
    finally:
        db.close()

    finalized = client.put(f"/comandas/{order_id}/fechar", headers=headers)
    assert finalized.status_code == 200, finalized.text
    assert finalized.json()["fechada"] is True
    assert finalized.json()["delivery_status"] == "finalizado"


def test_quick_counter_sale_still_closes_immediately_after_full_payment(setup_db):
    headers = _delivery_headers()
    created = client.post(
        "/comandas/venda-direta",
        json={
            "tipo": "Balcão",
            "idempotency_key": "quick-counter-finance-decoupling",
            "itens": [{"produto_id": "p-del"}],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    payload = created.json()
    assert payload["tipo"] == "Retirada"
    assert payload["identificador"] == "Balcão"

    paid = client.post(
        f"/caixa/comandas/{payload['id']}/pagar",
        json={
            "valor": 15,
            "metodo": "dinheiro",
            "idempotency_key": "quick-counter-finance-payment",
        },
        headers=headers,
    )
    assert paid.status_code == 201, paid.text

    db = SessionLocal(restaurante_id=1)
    try:
        sale = db.query(Comanda).filter(Comanda.id == payload["id"]).one()
        assert sale.fechada is True
        assert float(sale.valor_pago) == 15.0
    finally:
        db.close()
