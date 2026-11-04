import uuid
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine, current_restaurante_id
from app.main import app
from app.models import (
    Categoria,
    Comanda,
    Item,
    Lancamento,
    Mesa,
    Produto,
    Restaurante,
    Usuario,
)
from app.security import create_access_token

client = TestClient(app)

TENANT_A = 701
TENANT_B = 702


@pytest.fixture(autouse=True)
def setup_test_db():
    Base.metadata.create_all(bind=engine)
    
    # Setup Tenant A
    token_a = current_restaurante_id.set(TENANT_A)
    try:
        with SessionLocal() as db:
            if not db.query(Restaurante).filter(Restaurante.id == TENANT_A).first():
                db.add(Restaurante(id=TENANT_A, nome="Restaurante Teste A", plano="pro", slug="rest-701"))
                db.commit()

            if not db.query(Usuario).filter(Usuario.id == "usr-admin-701").first():
                db.add(Usuario(id="usr-admin-701", restaurante_id=TENANT_A, nome="Admin A", cargo="admin", role="admin", status="ativo"))
            if not db.query(Usuario).filter(Usuario.id == "usr-caixa-701").first():
                db.add(Usuario(id="usr-caixa-701", restaurante_id=TENANT_A, nome="Caixa A", cargo="caixa", role="caixa", status="ativo"))
            if not db.query(Usuario).filter(Usuario.id == "usr-garcom-701").first():
                db.add(Usuario(id="usr-garcom-701", restaurante_id=TENANT_A, nome="Garcom A", cargo="garcom", role="garcom", status="ativo"))
            if not db.query(Categoria).filter(Categoria.id == "cat-lanches").first():
                db.add(Categoria(id="cat-lanches", restaurante_id=TENANT_A, nome="Lanches"))
                db.commit()

            if not db.query(Produto).filter(Produto.id == "prod-d8-bacon").first():
                db.add(Produto(id="prod-d8-bacon", restaurante_id=TENANT_A, categoria_id="cat-lanches", nome="D8 Bacon", preco=29.90, ativo=True))
            if not db.query(Produto).filter(Produto.id == "prod-suco").first():
                db.add(Produto(id="prod-suco", restaurante_id=TENANT_A, categoria_id="cat-lanches", nome="Suco", preco=10.00, ativo=True))
            if not db.query(Mesa).filter(Mesa.restaurante_id == TENANT_A, Mesa.id == 1).first():
                db.add(Mesa(id=1, restaurante_id=TENANT_A, nome="Mesa 01", capacidade=4))
            if not db.query(Mesa).filter(Mesa.restaurante_id == TENANT_A, Mesa.id == 2).first():
                db.add(Mesa(id=2, restaurante_id=TENANT_A, nome="Mesa 02", capacidade=4))
            if not db.query(Mesa).filter(Mesa.restaurante_id == TENANT_A, Mesa.id == 5).first():
                db.add(Mesa(id=5, restaurante_id=TENANT_A, nome="Mesa 05", capacidade=4))
            db.commit()
    finally:
        current_restaurante_id.reset(token_a)

    # Setup Tenant B isoladamente
    token_b = current_restaurante_id.set(TENANT_B)
    try:
        with SessionLocal() as db:
            if not db.query(Restaurante).filter(Restaurante.id == TENANT_B).first():
                db.add(Restaurante(id=TENANT_B, nome="Restaurante Teste B", plano="pro", slug="rest-702"))
                db.commit()
            if not db.query(Usuario).filter(Usuario.id == "usr-admin-702").first():
                db.add(Usuario(id="usr-admin-702", restaurante_id=TENANT_B, nome="Admin B", cargo="admin", role="admin", status="ativo"))
            if not db.query(Categoria).filter(Categoria.id == "cat-lanches-b").first():
                db.add(Categoria(id="cat-lanches-b", restaurante_id=TENANT_B, nome="Lanches B"))
                db.commit()
            if not db.query(Produto).filter(Produto.id == "prod-d8-bacon-b").first():
                db.add(Produto(id="prod-d8-bacon-b", restaurante_id=TENANT_B, categoria_id="cat-lanches-b", nome="D8 Bacon B", preco=29.90, ativo=True))
            if not db.query(Mesa).filter(Mesa.restaurante_id == TENANT_B, Mesa.id == 1).first():
                db.add(Mesa(id=1, restaurante_id=TENANT_B, nome="Mesa 01 B", capacidade=4))
            db.commit()
    finally:
        current_restaurante_id.reset(token_b)

    yield


def _token_caixa(tenant_id=TENANT_A, role="caixa", uid="usr-caixa-701"):
    return create_access_token(subject=uid, restaurante_id=tenant_id, role=role)


def test_regressao_pedido_15_rejeita_delivery_status_e_cancela_via_cancelar_itens():
    """Regressão do incidente de 04/11/2026:
    - Mesa: 01
    - Pedido: #15
    - Comanda: c-e5e82559
    - Quantidade: 3 itens (3x D8 Bacon de R$ 29,90 = R$ 89,70)
    - Origem: garçom
    - Coluna: Prontos e recebimentos
    """
    comanda_id = f"c-e5e82559-{uuid.uuid4().hex[:6]}"
    item_ids = [f"it-15-{i}-{uuid.uuid4().hex[:4]}" for i in range(1, 4)]
    
    with SessionLocal() as db:
        comanda = Comanda(
            id=comanda_id,
            restaurante_id=TENANT_A,
            mesa_id=1,
            numero_pedido=15,
            tipo="Consumo no Local",
            garcom_id="usr-garcom-701",
            status_comanda=None,
            delivery_status=None,
            fechada=False,
            valor_pago=0,
            criado_em=datetime.now(timezone.utc),
        )
        db.add(comanda)
        db.flush()

        lanc = Lancamento(
            id=f"lanc-15-{uuid.uuid4().hex[:6]}",
            restaurante_id=TENANT_A,
            comanda_id=comanda_id,
            origem="garcom",
            garcom_id="usr-garcom-701",
            status="pronto",
        )
        db.add(lanc)
        db.flush()

        for it_id in item_ids:
            db.add(Item(
                id=it_id,
                restaurante_id=TENANT_A,
                comanda_id=comanda_id,
                lancamento_id=lanc.id,
                produto_id="prod-d8-bacon",
                preco_unit=29.90,
                status="pronto",
                pago=False,
            ))
        db.commit()

    token = _token_caixa()

    # 1. Prova que rota digital falha exatamente com o erro 400 observado em produção
    resp_digital = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=recusado",
        headers={"Authorization": f"Bearer {token}"},
        json={"reason": "pedido lançado por engano"},
    )
    assert resp_digital.status_code == 400
    assert "A comanda informada não possui ciclo operacional digital." in resp_digital.json()["detail"]

    # 2. Prova que a rota correta (cancelar-itens) cancela cirurgicamente os 3 itens
    resp_cancel = client.post(
        "/mesas/1/cancelar-itens",
        headers={"Authorization": f"Bearer {token}"},
        json={"motivo": "pedido lançado por engano", "item_ids": item_ids},
    )
    assert resp_cancel.status_code == 200
    data = resp_cancel.json()
    assert data["status"] == "cancelado"
    assert data["mesa_id"] == 1
    assert data["itens_cancelados"] == 3
    assert data["comandas_fechadas"] == 1
    assert data["total_cancelado"] == 89.70
    assert data["mesa_liberada"] is True

    # 3. Verifica no banco
    with SessionLocal() as db:
        c = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        assert c.fechada is True
        for it_id in item_ids:
            it = db.query(Item).filter(Item.id == it_id).one()
            assert it.status == "cancelado"


def test_comanda_multiplos_lancamentos_cancela_somente_selecionado():
    """Cancelamento de um pedido específico em comanda com múltiplos lançamentos
    preserva os outros lançamentos, seus itens e mantém a mesa ocupada.
    """
    comanda_id = f"c-multi-{uuid.uuid4().hex[:6]}"
    item_l1_id = f"it-l1-{uuid.uuid4().hex[:4]}"
    item_l2_id = f"it-l2-{uuid.uuid4().hex[:4]}"

    with SessionLocal() as db:
        comanda = Comanda(
            id=comanda_id,
            restaurante_id=TENANT_A,
            mesa_id=2,
            numero_pedido=101,
            tipo="Consumo no Local",
            garcom_id="usr-garcom-701",
            fechada=False,
            valor_pago=0,
            criado_em=datetime.now(timezone.utc),
        )
        db.add(comanda)
        db.flush()

        lanc1 = Lancamento(
            id=f"lanc-1-{uuid.uuid4().hex[:6]}",
            restaurante_id=TENANT_A,
            comanda_id=comanda_id,
            origem="garcom",
            garcom_id="usr-garcom-701",
            status="pronto",
        )
        lanc2 = Lancamento(
            id=f"lanc-2-{uuid.uuid4().hex[:6]}",
            restaurante_id=TENANT_A,
            comanda_id=comanda_id,
            origem="garcom",
            garcom_id="usr-garcom-701",
            status="producao",
        )
        db.add_all([lanc1, lanc2])
        db.flush()

        it1 = Item(
            id=item_l1_id,
            restaurante_id=TENANT_A,
            comanda_id=comanda_id,
            lancamento_id=lanc1.id,
            produto_id="prod-d8-bacon",
            preco_unit=29.90,
            status="pronto",
            pago=False,
        )
        it2 = Item(
            id=item_l2_id,
            restaurante_id=TENANT_A,
            comanda_id=comanda_id,
            lancamento_id=lanc2.id,
            produto_id="prod-suco",
            preco_unit=10.00,
            status="preparando",
            pago=False,
        )
        db.add_all([it1, it2])
        db.commit()

    token = _token_caixa()

    # Cancela somente o item do lançamento 1
    resp = client.post(
        "/mesas/2/cancelar-itens",
        headers={"Authorization": f"Bearer {token}"},
        json={"motivo": "Cliente cancelou apenas o primeiro pedido", "item_ids": [item_l1_id]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["itens_cancelados"] == 1
    assert data["comandas_fechadas"] == 0
    assert data["mesa_liberada"] is False

    with SessionLocal() as db:
        c = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        assert c.fechada is False
        it_l1 = db.query(Item).filter(Item.id == item_l1_id).one()
        it_l2 = db.query(Item).filter(Item.id == item_l2_id).one()
        assert it_l1.status == "cancelado"
        assert it_l2.status == "preparando"


def test_cancelamento_bloqueado_se_houver_pagamento_registrado():
    comanda_id = f"c-paid-{uuid.uuid4().hex[:6]}"
    item_id = f"it-paid-{uuid.uuid4().hex[:4]}"

    with SessionLocal() as db:
        comanda = Comanda(
            id=comanda_id,
            restaurante_id=TENANT_A,
            mesa_id=1,
            garcom_id="usr-caixa-701",
            numero_pedido=201,
            tipo="Consumo no Local",
            fechada=False,
            valor_pago=29.90,
        )
        db.add(comanda)
        db.flush()

        lanc = Lancamento(
            id=f"lanc-paid-{uuid.uuid4().hex[:6]}",
            restaurante_id=TENANT_A,
            comanda_id=comanda_id,
            origem="garcom",
            garcom_id="usr-garcom-701",
            status="pronto",
        )
        db.add(lanc)
        db.flush()

        db.add(Item(
            id=item_id,
            restaurante_id=TENANT_A,
            comanda_id=comanda_id,
            lancamento_id=lanc.id,
            produto_id="prod-d8-bacon",
            preco_unit=29.90,
            status="pronto",
            pago=False,
        ))
        db.commit()

    token = _token_caixa()
    resp = client.post(
        "/mesas/1/cancelar-itens",
        headers={"Authorization": f"Bearer {token}"},
        json={"motivo": "Cancelamento indevido com pagamento", "item_ids": [item_id]},
    )
    assert resp.status_code == 409
    assert "Há pagamento registrado neste pedido" in resp.json()["detail"]


def test_cancelamento_bloqueado_se_item_pago():
    comanda_id = f"c-itpaid-{uuid.uuid4().hex[:6]}"
    item_id = f"it-paid-flag-{uuid.uuid4().hex[:4]}"

    with SessionLocal() as db:
        comanda = Comanda(
            id=comanda_id,
            restaurante_id=TENANT_A,
            mesa_id=1,
            garcom_id="usr-caixa-701",
            numero_pedido=202,
            tipo="Consumo no Local",
            fechada=False,
            valor_pago=0,
        )
        db.add(comanda)
        db.flush()

        lanc = Lancamento(
            id=f"lanc-itpaid-{uuid.uuid4().hex[:6]}",
            restaurante_id=TENANT_A,
            comanda_id=comanda_id,
            origem="garcom",
            garcom_id="usr-garcom-701",
            status="pronto",
        )
        db.add(lanc)
        db.flush()

        db.add(Item(
            id=item_id,
            restaurante_id=TENANT_A,
            comanda_id=comanda_id,
            lancamento_id=lanc.id,
            produto_id="prod-d8-bacon",
            preco_unit=29.90,
            status="pronto",
            pago=True,
        ))
        db.commit()

    token = _token_caixa()
    resp = client.post(
        "/mesas/1/cancelar-itens",
        headers={"Authorization": f"Bearer {token}"},
        json={"motivo": "Cancelamento item já pago", "item_ids": [item_id]},
    )
    assert resp.status_code == 409
    assert "Há item pago neste pedido" in resp.json()["detail"]


def test_duplo_cancelamento_retorna_conflito():
    comanda_id = f"c-dup-{uuid.uuid4().hex[:6]}"
    item_id = f"it-dup-{uuid.uuid4().hex[:4]}"
    item2_id = f"it-dup2-{uuid.uuid4().hex[:4]}"

    with SessionLocal() as db:
        comanda = Comanda(
            id=comanda_id,
            restaurante_id=TENANT_A,
            mesa_id=1,
            garcom_id="usr-caixa-701",
            numero_pedido=203,
            tipo="Consumo no Local",
            fechada=False,
            valor_pago=0,
        )
        db.add(comanda)
        db.flush()

        lanc = Lancamento(
            id=f"lanc-dup-{uuid.uuid4().hex[:6]}",
            restaurante_id=TENANT_A,
            comanda_id=comanda_id,
            origem="garcom",
            garcom_id="usr-garcom-701",
            status="pronto",
        )
        db.add(lanc)
        db.flush()

        db.add_all([
            Item(
                id=item_id,
                restaurante_id=TENANT_A,
                comanda_id=comanda_id,
                lancamento_id=lanc.id,
                produto_id="prod-d8-bacon",
                preco_unit=29.90,
                status="pronto",
                pago=False,
            ),
            Item(
                id=item2_id,
                restaurante_id=TENANT_A,
                comanda_id=comanda_id,
                lancamento_id=lanc.id,
                produto_id="prod-suco",
                preco_unit=10.00,
                status="pronto",
                pago=False,
            ),
        ])
        db.commit()

    token = _token_caixa()
    resp1 = client.post(
        "/mesas/1/cancelar-itens",
        headers={"Authorization": f"Bearer {token}"},
        json={"motivo": "Primeiro cancelamento", "item_ids": [item_id]},
    )
    assert resp1.status_code == 200

    resp2 = client.post(
        "/mesas/1/cancelar-itens",
        headers={"Authorization": f"Bearer {token}"},
        json={"motivo": "Segundo cancelamento", "item_ids": [item_id]},
    )
    assert resp2.status_code == 409
    assert "já foram cancelados" in resp2.json()["detail"]


def test_bloqueio_sem_permissao():
    token_sem_perm = _token_caixa(role="garcom", uid="usr-garcom-701")
    resp = client.post(
        "/mesas/1/cancelar-itens",
        headers={"Authorization": f"Bearer {token_sem_perm}"},
        json={"motivo": "Tentativa sem permissão", "item_ids": ["dummy-id"]},
    )
    assert resp.status_code == 403


def test_isolamento_multitenant_nao_permite_cancelar_itens_outro_restaurante():
    comanda_id = f"c-tenantb-{uuid.uuid4().hex[:6]}"
    item_id = f"it-tenantb-{uuid.uuid4().hex[:4]}"

    token_b = current_restaurante_id.set(TENANT_B)
    try:
        with SessionLocal() as db:
            comanda = Comanda(
                id=comanda_id,
                restaurante_id=TENANT_B,
                mesa_id=1,
                garcom_id="usr-admin-702",
                numero_pedido=301,
                tipo="Consumo no Local",
                fechada=False,
                valor_pago=0,
            )
            db.add(comanda)
            db.flush()

            lanc = Lancamento(
                id=f"lanc-b-{uuid.uuid4().hex[:6]}",
                restaurante_id=TENANT_B,
                comanda_id=comanda_id,
                origem="garcom",
                garcom_id="usr-admin-702",
                status="pronto",
            )
            db.add(lanc)
            db.flush()

            db.add(Item(
                id=item_id,
                restaurante_id=TENANT_B,
                comanda_id=comanda_id,
                lancamento_id=lanc.id,
                produto_id="prod-d8-bacon-b",
                preco_unit=29.90,
                status="pronto",
                pago=False,
            ))
            db.commit()
    finally:
        current_restaurante_id.reset(token_b)

    token_tenant_a = _token_caixa(tenant_id=TENANT_A)
    resp = client.post(
        "/mesas/1/cancelar-itens",
        headers={"Authorization": f"Bearer {token_tenant_a}"},
        json={"motivo": "Ataque cross-tenant", "item_ids": [item_id]},
    )
    assert resp.status_code == 409
    assert "O pedido mudou ou contém itens que não pertencem mais a esta mesa" in resp.json()["detail"]


def test_pedido_digital_delivery_cancela_via_delivery_status():
    comanda_id = f"c-dig-del-{uuid.uuid4().hex[:6]}"
    with SessionLocal() as db:
        comanda = Comanda(
            id=comanda_id,
            restaurante_id=TENANT_A,
            mesa_id=None,
            garcom_id="usr-caixa-701",
            numero_pedido=401,
            tipo="Delivery",
            delivery_status="producao",
            fechada=False,
            criado_em=datetime.now(timezone.utc),
        )
        db.add(comanda)
        db.flush()

        lanc = Lancamento(
            id=f"lanc-del-{uuid.uuid4().hex[:6]}",
            restaurante_id=TENANT_A,
            comanda_id=comanda_id,
            origem="cardapio",
            garcom_id="usr-caixa-701",
            status="producao",
        )
        db.add(lanc)
        db.commit()

    token = _token_caixa()
    resp = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=recusado",
        headers={"Authorization": f"Bearer {token}"},
        json={"reason": "Sem motoboy no momento"},
    )
    assert resp.status_code == 200
    assert resp.json()["delivery_status"] == "recusado"


def test_pedido_digital_vinculado_a_mesa_mantem_ciclo_digital():
    comanda_id = f"c-dig-mesa-{uuid.uuid4().hex[:6]}"
    with SessionLocal() as db:
        comanda = Comanda(
            id=comanda_id,
            restaurante_id=TENANT_A,
            mesa_id=5,  # Associado à mesa 5
            garcom_id="usr-caixa-701",
            numero_pedido=402,
            tipo="Retirada",
            delivery_status="pronto",
            fechada=False,
            criado_em=datetime.now(timezone.utc),
        )
        db.add(comanda)
        db.flush()

        lanc = Lancamento(
            id=f"lanc-ret-{uuid.uuid4().hex[:6]}",
            restaurante_id=TENANT_A,
            comanda_id=comanda_id,
            origem="caixa",
            garcom_id="usr-caixa-701",
            status="pronto",
        )
        db.add(lanc)
        db.commit()

    token = _token_caixa()
    resp = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=recusado",
        headers={"Authorization": f"Bearer {token}"},
        json={"reason": "Cliente desistiu"},
    )
    assert resp.status_code == 200
    assert resp.json()["delivery_status"] == "recusado"
