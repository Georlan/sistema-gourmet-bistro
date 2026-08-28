import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import Comanda, Motoboy, NotificacaoWhatsApp, Restaurante, Usuario
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


def _criar_comanda(
    tipo: str,
    status_inicial: str = "pendente",
    *,
    motoboy_id: int | None = None,
) -> str:
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
                    motoboy_id=motoboy_id,
                    fechada=False,
                    valor_pago=0,
                )
            )
            db.commit()
        return comanda_id
    finally:
        current_restaurante_id.reset(tenant_token)


@pytest.mark.parametrize(
    ("tipo", "status_inicial", "novo_status", "motoboy_id", "trecho_esperado"),
    [
        (
            "Retirada",
            "producao",
            "pronto",
            None,
            "🎉 Seu pedido está pronto! Pode retirar na loja.",
        ),
        (
            "Entrega",
            "pronto",
            "transito",
            MOTOBOY_ID,
            "🛵 Saiu para entrega!",
        ),
        (
            "Delivery",
            "pendente",
            "recusado",
            None,
            "❌ Não conseguimos atender seu pedido.",
        ),
    ],
)
def test_mudanca_status_enfileira_notificacao(
    monkeypatch,
    tipo,
    status_inicial,
    novo_status,
    motoboy_id,
    trecho_esperado,
):
    chamadas = []
    monkeypatch.setattr(
        whatsapp_service,
        "enviar_texto_whatsapp_detalhado",
        lambda telefone, mensagem, contexto="": (
            chamadas.append((telefone, mensagem))
            or whatsapp_service.ResultadoEnvioWhatsApp(
                sucesso=True,
                provider="evolution",
                message_id="evolution-message-test",
                recipient_id="5581999990000@s.whatsapp.net",
                provider_status="pending",
            )
        ),
    )
    comanda_id = _criar_comanda(
        tipo,
        status_inicial,
        motoboy_id=motoboy_id,
    )

    response = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo={novo_status}",
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    assert len(chamadas) == 1
    assert chamadas[0][0] == TELEFONE
    assert trecho_esperado in chamadas[0][1]
    with SessionLocal() as db:
        notificacao = db.query(NotificacaoWhatsApp).filter(
            NotificacaoWhatsApp.comanda_id == comanda_id
        ).one()
        assert notificacao.wamid == "evolution-message-test"
        assert notificacao.status_envio == "enviado"


def test_status_repetido_nao_duplica_notificacao(monkeypatch):
    chamadas = []
    monkeypatch.setattr(
        whatsapp_service,
        "enviar_texto_whatsapp_detalhado",
        lambda telefone, mensagem, contexto="": (
            chamadas.append((telefone, mensagem))
            or whatsapp_service.ResultadoEnvioWhatsApp(True, "evolution")
        ),
    )
    comanda_id = _criar_comanda("Retirada", "producao")

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
        whatsapp_service,
        "enviar_texto_whatsapp_detalhado",
        lambda telefone, mensagem, contexto="": (
            chamadas.append((telefone, mensagem))
            or whatsapp_service.ResultadoEnvioWhatsApp(True, "evolution")
        ),
    )
    comanda_id = _criar_comanda("Entrega", "pronto")

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
    assert len(chamadas) == 2
    assert chamadas[0][0] == "81988880000"
    assert "NOVA ENTREGA" in chamadas[0][1]
    assert "/entregador?token=" in chamadas[0][1]
    assert chamadas[1][0] == TELEFONE
    assert "entrega" in chamadas[1][1].lower()

    with SessionLocal() as db:
        registros = db.query(NotificacaoWhatsApp).filter(
            NotificacaoWhatsApp.comanda_id == comanda_id,
        ).all()
        assert {registro.tipo for registro in registros} == {
            "atribuicao_motoboy",
            "status_pedido",
        }
        atribuicao = next(
            registro for registro in registros
            if registro.tipo == "atribuicao_motoboy"
        )
        assert "token=" not in atribuicao.conteudo


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
    comanda_id = _criar_comanda("Retirada", "producao")

    response = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=pronto",
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    with SessionLocal() as db:
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        assert comanda.delivery_status == "pronto"


def test_envio_evolution_retorna_id_da_mensagem(monkeypatch):
    class RespostaAceita:
        status_code = 201

        @staticmethod
        def raise_for_status():
            return None

        @staticmethod
        def json():
            return {
                "key": {
                    "id": "BAE5Evo123",
                    "remoteJid": "5581999990000@s.whatsapp.net",
                },
                "status": "PENDING",
            }

    class ClienteEvolution:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        @staticmethod
        def post(*args, **kwargs):
            assert kwargs["json"] == {
                "number": "5581999990000",
                "text": "Mensagem de teste",
            }
            assert kwargs["headers"]["Origin"] == "https://koma.test"
            return RespostaAceita()

    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    monkeypatch.setattr(settings, "EVOLUTION_API_URL", "https://evolution.test")
    monkeypatch.setattr(settings, "EVOLUTION_API_KEY", "chave-teste")
    monkeypatch.setattr(settings, "EVOLUTION_INSTANCE_NAME", "koma-teste")
    monkeypatch.setattr(settings, "EVOLUTION_API_ORIGIN", "https://koma.test")
    monkeypatch.setattr(
        whatsapp_service.httpx,
        "Client",
        lambda *args, **kwargs: ClienteEvolution(),
    )

    resultado = whatsapp_service.enviar_texto_whatsapp_detalhado(
        "(81) 99999-0000",
        "Mensagem de teste",
    )

    assert resultado.sucesso is True
    assert resultado.message_id == "BAE5Evo123"
    assert resultado.recipient_id == "5581999990000@s.whatsapp.net"
    assert resultado.provider_status == "pending"


def test_otp_evolution_nao_tenta_meta(monkeypatch):
    chamadas = []
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_PROVIDER", "evolution")
    monkeypatch.setattr(
        whatsapp_service,
        "enviar_otp_whatsapp_meta",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Meta não deveria ser chamada")
        ),
    )
    monkeypatch.setattr(
        whatsapp_service,
        "enviar_texto_whatsapp",
        lambda telefone, mensagem, contexto="": chamadas.append(
            (telefone, mensagem, contexto)
        ) or True,
    )

    enviado = whatsapp_service.enviar_codigo_otp_whatsapp(
        "81999990000",
        "123456",
        "Bistrô Teste",
    )

    assert enviado is True
    assert len(chamadas) == 1
    assert "123456" in chamadas[0][1]


def test_diagnostico_evolution_indica_configuracao_ausente(monkeypatch):
    monkeypatch.setattr(settings, "EVOLUTION_API_URL", "")
    monkeypatch.setattr(settings, "EVOLUTION_API_KEY", "")
    monkeypatch.setattr(settings, "EVOLUTION_INSTANCE_NAME", "")

    resultado = whatsapp_service.obter_status_evolution()

    assert resultado == {
        "status": "red",
        "configured": False,
        "connected": False,
        "details": "Evolution API não configurada",
    }


def test_diagnostico_evolution_confirma_instancia_conectada(monkeypatch):
    class RespostaConectada:
        status_code = 200

        @staticmethod
        def raise_for_status():
            return None

        @staticmethod
        def json():
            return {"instance": {"instanceName": "koma-teste", "state": "open"}}

    class ClienteConectado:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        @staticmethod
        def get(*args, **kwargs):
            return RespostaConectada()

    monkeypatch.setattr(settings, "EVOLUTION_API_URL", "https://evolution.test")
    monkeypatch.setattr(settings, "EVOLUTION_API_KEY", "chave-teste")
    monkeypatch.setattr(settings, "EVOLUTION_INSTANCE_NAME", "koma-teste")
    monkeypatch.setattr(
        whatsapp_service.httpx,
        "Client",
        lambda *args, **kwargs: ClienteConectado(),
    )

    resultado = whatsapp_service.obter_status_evolution()

    assert resultado == {
        "status": "green",
        "configured": True,
        "connected": True,
        "details": "WhatsApp conectado",
    }
