import datetime
import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine, tenant_session_scope
from app.main import app
from app.models import (
    Cliente,
    Comanda,
    Cupom,
    Restaurante,
    Usuario,
)
from app.security import get_password_hash
from app.services.central_whatsapp import recipient_fingerprint
from app.services.clientes import cadastrar_ou_atualizar_cliente
from app.services.whatsapp_opt_out import block_contact


client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        r1 = db.query(Restaurante).filter(Restaurante.id == 1).first()
        if r1:
            r1.nome = "Bistro B9"
            r1.slug = "bistro-b9"
            r1.plano = "premium"
        else:
            db.add(Restaurante(id=1, nome="Bistro B9", slug="bistro-b9", plano="premium"))
        db.flush()
        db.add(
            Usuario(
                id="u-admin-b9",
                restaurante_id=1,
                nome="Admin B9",
                email="adminb9@test.com",
                cargo="admin",
                status="ativo",
                senha_hash=get_password_hash("senha1234"),
            )
        )
        db.commit()
    finally:
        db.close()


def _headers() -> dict[str, str]:
    res = client.post("/auth/login", json={"username": "adminb9@test.com", "password": "senha1234"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_whatsapp_opt_out_blocks_manual_crm_contact_and_hides_from_opportunities():
    headers = _headers()
    phone = "85999887766"

    db = SessionLocal()
    try:
        with tenant_session_scope(db, 1):
            cliente = cadastrar_ou_atualizar_cliente(
                db,
                restaurante_id=1,
                telefone=phone,
                nome="Maria OptOut",
            )
            # Cliente tem 1 compra concluída há 10 dias -> normalmente entraria em SECOND_PURCHASE
            past = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=10)
            db.add(
                Comanda(
                    id="cmd-b9-1",
                    restaurante_id=1,
                    garcom_id="u-admin-b9",
                    numero_pedido=1,
                    cliente_id=cliente.id,
                    tipo="Delivery",
                    delivery_telefone=phone,
                    delivery_status="finalizado",
                    fechada=True,
                    valor_pago=50.0,
                    criado_em=past,
                    fechado_em=past,
                )
            )
            # Cliente clicou em "Parar de receber" no WhatsApp (sem nunca ter tido whatsapp_marketing_opt_in=True)
            digest = recipient_fingerprint(1, phone)
            block_contact(db, 1, digest, marketing_only=True)
            db.commit()
            cliente_id = str(cliente.id)
    finally:
        db.close()

    # 1. Perfil CRM deve refletir opt_out_marketing=True
    profile_res = client.get(f"/fidelidade/clientes/{cliente_id}/perfil", headers=headers)
    assert profile_res.status_code == 200, profile_res.text
    assert profile_res.json()["dados_declarados"]["opt_out_marketing"] is True
    assert profile_res.json()["comportamento_observado"]["oportunidades_elegiveis"] == []

    # 2. Resumo CRM não deve contar o cliente opt-out como elegível em SECOND_PURCHASE
    overview_res = client.get("/fidelidade/crm/resumo", headers=headers)
    assert overview_res.status_code == 200, overview_res.text
    second_purchase = next(
        opp for opp in overview_res.json()["oportunidades"] if opp["chave"] == "SECOND_PURCHASE"
    )
    assert second_purchase["elegiveis_count"] == 0
    assert cliente_id not in second_purchase["elegiveis_cliente_ids"]

    # 3. Registrar contato CRM (WhatsApp ou confirmação manual) deve falhar com 409
    contact_res = client.post(
        "/fidelidade/crm/contatos",
        json={
            "cliente_id": cliente_id,
            "objetivo": "SECOND_PURCHASE",
            "canal": "WHATSAPP_MANUAL",
            "acao_executada": "CONTATO_MANUAL_CONFIRMADO",
        },
        headers=headers,
    )
    assert contact_res.status_code == 409, contact_res.text


def test_first_purchase_coupon_rejects_returning_customer_with_encrypted_phone():
    phone = "85988776655"
    db = SessionLocal()
    try:
        with tenant_session_scope(db, 1):
            cliente = cadastrar_ou_atualizar_cliente(
                db,
                restaurante_id=1,
                telefone=phone,
                nome="Joao Recorrente",
            )
            db.add(
                Comanda(
                    id="cmd-prev-1",
                    restaurante_id=1,
                    garcom_id="u-admin-b9",
                    numero_pedido=2,
                    cliente_id=cliente.id,
                    tipo="Delivery",
                    delivery_telefone=phone,
                    delivery_status="finalizado",
                    fechada=True,
                    valor_pago=40.0,
                )
            )
            db.add(
                Cupom(
                    id="cup-first-1",
                    restaurante_id=1,
                    codigo="PRIMEIRA10",
                    tipo_desconto="porcentagem",
                    valor_desconto=10.0,
                    valor_minimo_pedido=0.0,
                    apenas_primeira_compra=True,
                    ativo=True,
                )
            )
            db.commit()
    finally:
        db.close()

    # 1. Cliente recorrente (com telefone encriptado no banco) NÃO pode usar cupom de primeira compra
    res_returning = client.post(
        "/cardapio/cupons/validar",
        json={
            "restaurante_id": 1,
            "codigo": "PRIMEIRA10",
            "subtotal": 60.0,
            "telefone": "(85) 98877-6655",
        },
    )
    assert res_returning.status_code == 200, res_returning.text
    assert res_returning.json()["valido"] is False
    assert "primeiro pedido" in res_returning.json()["mensagem"].lower()

    # 2. Sem informar telefone, cupom de primeira compra não pode ser aprovado cegamente
    res_no_phone = client.post(
        "/cardapio/cupons/validar",
        json={
            "restaurante_id": 1,
            "codigo": "PRIMEIRA10",
            "subtotal": 60.0,
        },
    )
    assert res_no_phone.status_code == 200, res_no_phone.text
    assert res_no_phone.json()["valido"] is False

    # 3. Novo cliente sem pedido anterior PODE usar o cupom normalmente
    res_new = client.post(
        "/cardapio/cupons/validar",
        json={
            "restaurante_id": 1,
            "codigo": "PRIMEIRA10",
            "subtotal": 60.0,
            "telefone": "(85) 91111-2222",
        },
    )
    assert res_new.status_code == 200, res_new.text
    assert res_new.json()["valido"] is True
    assert res_new.json()["desconto_calculado"] == pytest.approx(6.0)


def test_first_purchase_coupon_rejects_guest_returning_order_without_cliente_id():
    phone = "85977665544"
    db = SessionLocal()
    try:
        with tenant_session_scope(db, 1):
            db.add(
                Comanda(
                    id="cmd-guest-prev",
                    restaurante_id=1,
                    garcom_id="u-admin-b9",
                    numero_pedido=3,
                    cliente_id=None,
                    tipo="Delivery",
                    delivery_telefone=phone,
                    delivery_status="finalizado",
                    fechada=True,
                    valor_pago=35.0,
                )
            )
            db.add(
                Cupom(
                    id="cup-first-2",
                    restaurante_id=1,
                    codigo="BEMVINDO",
                    tipo_desconto="valor_fixo",
                    valor_desconto=5.0,
                    valor_minimo_pedido=0.0,
                    apenas_primeira_compra=True,
                    ativo=True,
                )
            )
            db.commit()
    finally:
        db.close()

    res = client.post(
        "/cardapio/cupons/validar",
        json={
            "restaurante_id": 1,
            "codigo": "BEMVINDO",
            "subtotal": 50.0,
            "telefone": "85977665544",
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["valido"] is False
    assert "primeiro pedido" in res.json()["mensagem"].lower()
