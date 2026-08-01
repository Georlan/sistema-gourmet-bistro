import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import Comanda, Motoboy, Restaurante, Usuario
from app.routes import orders
from app.security import create_access_token
from app.services import whatsapp as whatsapp_service


client = TestClient(app)
RESTAURANTE_ID = 930
USUARIO_ID = "admin-whatsapp-930"
MOTOBOY_ID = 930
TELEFONE = "81999990000"


@pytest.fixture(scope="module", autouse=True)
def preparar_tenant_whatsapp():
    Base.metadata.create_all(bind=engine)
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        with SessionLocal() as db:
            restaurante = db.query(Restaurante).filter(
                Restaurante.id == RESTAURANTE_ID
            ).first()
            if not restaurante:
                db.add(
                    Restaurante(
                        id=RESTAURANTE_ID,
                        nome="Restaurante WhatsApp Teste",
                        plano="pocket",
                        slug="restaurante-whatsapp-teste",
                    )
                )
                db.commit()

            usuario = db.query(Usuario).filter(Usuario.id == USUARIO_ID).first()
            if not usuario:
                db.add(
                    Usuario(
                        id=USUARIO_ID,
                        restaurante_id=RESTAURANTE_ID,
                        nome="Admin WhatsApp",
                        cargo="admin",
                        status="ativo",
                    )
                )
            else:
                usuario.status = "ativo"
                usuario.cargo = "admin"

            motoboy = db.query(Motoboy).filter(Motoboy.id == MOTOBOY_ID).first()
            if not motoboy:
                db.add(
                    Motoboy(
                        id=MOTOBOY_ID,
                        restaurante_id=RESTAURANTE_ID,
                        nome="Motoboy WhatsApp",
                        telefone="81988880000",
                        ativo=True,
                    )
                )
            db.commit()
        yield
    finally:
        current_restaurante_id.reset(tenant_token)


def _headers():
    token = create_access_token(
        subject=USUARIO_ID,
        restaurante_id=RESTAURANTE_ID,
        role="admin",
    )
    return {"Authorization": f"Bearer {token}"}


def _criar_comanda(tipo: str, status_inicial: str = "pendente") -> str:
    comanda_id = f"whatsapp-{uuid.uuid4().hex}"
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        with SessionLocal() as db:
            db.add(
                Comanda(
                    id=comanda_id,
                    restaurante_id=RESTAURANTE_ID,
                    garcom_id=USUARIO_ID,
                    tipo=tipo,
                    identificador="Maria Cliente",
                    numero_pedido=321,
                    delivery_status=status_inicial,
                    delivery_telefone=TELEFONE,
                    delivery_endereco="Rua dos Testes, 10",
                    delivery_taxa=0,
                    fechada=False,
                    valor_pago=0,
                )
            )
            db.commit()
        return comanda_id
    finally:
        current_restaurante_id.reset(tenant_token)


@pytest.mark.parametrize(
    ("tipo", "novo_status", "mensagem_esperada"),
    [
        (
            "Retirada",
            "pronto",
            "Olá, Maria Cliente! 👋 Seu pedido #321 no Restaurante WhatsApp Teste já está PRONTO PARA RETIRADA! 🍔 Pode vir buscar no nosso balcão. Te esperamos!",
        ),
        (
            "Entrega",
            "transito",
            "Olá, Maria Cliente! 🛵 Seu pedido #321 no Restaurante WhatsApp Teste acabou de SAIR PARA ENTREGA! 🚀 Nosso entregador já está a caminho do seu endereço. Bom apetite!",
        ),
        (
            "Delivery",
            "recusado",
            "Olá, Maria Cliente. Infelizmente seu pedido #321 no Restaurante WhatsApp Teste não pôde ser aceito no momento. Entre em contato conosco para mais detalhes.",
        ),
    ],
)
def test_mudanca_status_enfileira_notificacao(
    monkeypatch,
    tipo,
    novo_status,
    mensagem_esperada,
):
    chamadas = []
    monkeypatch.setattr(
        orders,
        "enviar_notificacao_whatsapp_task",
        lambda telefone, mensagem: chamadas.append((telefone, mensagem)),
    )
    comanda_id = _criar_comanda(tipo)

    response = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo={novo_status}",
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    assert chamadas == [(TELEFONE, mensagem_esperada)]


def test_status_repetido_nao_duplica_notificacao(monkeypatch):
    chamadas = []
    monkeypatch.setattr(
        orders,
        "enviar_notificacao_whatsapp_task",
        lambda telefone, mensagem: chamadas.append((telefone, mensagem)),
    )
    comanda_id = _criar_comanda("Retirada")

    primeira = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=pronto",
        headers=_headers(),
    )
    segunda = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=pronto",
        headers=_headers(),
    )

    assert primeira.status_code == 200, primeira.text
    assert segunda.status_code == 200, segunda.text
    assert len(chamadas) == 1


def test_despachar_enfileira_notificacao_transito(monkeypatch):
    chamadas = []
    monkeypatch.setattr(
        orders,
        "enviar_notificacao_whatsapp_task",
        lambda telefone, mensagem: chamadas.append((telefone, mensagem)),
    )
    comanda_id = _criar_comanda("Entrega")

    response = client.post(
        f"/comandas/{comanda_id}/delivery/despachar",
        headers=_headers(),
        json={"motoboy_id": MOTOBOY_ID},
    )
    repetida = client.post(
        f"/comandas/{comanda_id}/delivery/despachar",
        headers=_headers(),
        json={"motoboy_id": MOTOBOY_ID},
    )

    assert response.status_code == 200, response.text
    assert repetida.status_code == 200, repetida.text
    assert len(chamadas) == 1
    assert chamadas[0][0] == TELEFONE
    assert "SAIR PARA ENTREGA" in chamadas[0][1]


def test_falha_evolution_nao_impede_transicao(monkeypatch):
    class ClienteComFalha:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def post(self, *args, **kwargs):
            raise httpx.ConnectError("Evolution indisponível")

    monkeypatch.setattr(settings, "EVOLUTION_API_URL", "https://evolution.test")
    monkeypatch.setattr(settings, "EVOLUTION_API_KEY", "chave-teste")
    monkeypatch.setattr(settings, "EVOLUTION_INSTANCE_NAME", "koma-teste")
    monkeypatch.setattr(
        whatsapp_service.httpx,
        "Client",
        lambda *args, **kwargs: ClienteComFalha(),
    )
    comanda_id = _criar_comanda("Retirada")

    response = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=pronto",
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    with SessionLocal() as db:
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        assert comanda.delivery_status == "pronto"
