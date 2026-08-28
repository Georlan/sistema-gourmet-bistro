import asyncio
import uuid
import pytest
from app.database import SessionLocal
from app.models import NotificacaoWhatsApp
from app.services.notificacoes import notificar_cliente_status_pedido, agendar_notificacao_status_task


def test_notificar_cliente_status_pedido_todos_status(monkeypatch):
    from app.services import whatsapp as whatsapp_service

    posted_messages = []

    def mock_enviar_texto(telefone, mensagem, contexto=""):
        posted_messages.append((telefone, mensagem))
        return whatsapp_service.ResultadoEnvioWhatsApp(
            sucesso=True,
            provider="evolution",
        )

    monkeypatch.setattr(
        whatsapp_service,
        "enviar_texto_whatsapp_detalhado",
        mock_enviar_texto,
    )


    db = SessionLocal()
    try:
        # Test status: recebido
        res = asyncio.run(notificar_cliente_status_pedido(
            db=db,
            comanda_id=101,
            novo_status="recebido",
            telefone_cliente="81999991111",
            nome_restaurante="Bistrô Teste",
        ))
        assert res["sucesso"] is True
        assert res["status_envio"] == "enviado"
        assert "Pedido recebido!" in res["conteudo"]

        # Test status: em_preparo
        res_prep = asyncio.run(notificar_cliente_status_pedido(
            db=db,
            comanda_id=102,
            novo_status="em_preparo",
            telefone_cliente="81999991111",
            nome_restaurante="Bistrô Teste",
        ))
        assert "preparado com carinho" in res_prep["conteudo"]

        # Test status: pronto
        res_pronto = asyncio.run(notificar_cliente_status_pedido(
            db=db,
            comanda_id=103,
            novo_status="pronto",
            telefone_cliente="81999991111",
            nome_restaurante="Bistrô Teste",
        ))
        assert "pronto!" in res_pronto["conteudo"]

        # Test status: saiu_entrega
        res_entrega = asyncio.run(notificar_cliente_status_pedido(
            db=db,
            comanda_id=104,
            novo_status="saiu_entrega",
            telefone_cliente="81999991111",
            nome_restaurante="Bistrô Teste",
            link_rastreamento="https://koma.app/track/104",
        ))
        assert "https://koma.app/track/104" in res_entrega["conteudo"]

        # Test status: entregue
        res_entregue = asyncio.run(notificar_cliente_status_pedido(
            db=db,
            comanda_id=105,
            novo_status="entregue",
            telefone_cliente="81999991111",
            nome_restaurante="Bistrô Teste",
        ))
        assert "Pedido entregue!" in res_entregue["conteudo"]

        # Test status: recusado
        res_recusado = asyncio.run(notificar_cliente_status_pedido(
            db=db,
            comanda_id=106,
            novo_status="recusado",
            telefone_cliente="81999991111",
            nome_restaurante="Bistrô Teste",
            telefone_restaurante="(81) 3333-4444",
        ))
        assert "Não conseguimos atender seu pedido" in res_recusado["conteudo"]
        assert "(81) 3333-4444" in res_recusado["conteudo"]

        # Check DB records created in notificacoes_whatsapp
        records = db.query(NotificacaoWhatsApp).filter(NotificacaoWhatsApp.tipo == "status_pedido").all()
        assert len(records) >= 6
    finally:
        db.close()



def test_agendar_notificacao_status_task(monkeypatch):
    from app.services import whatsapp as whatsapp_service

    class MockBackgroundTasks:
        def __init__(self):
            self.tasks = []
        def add_task(self, func, *args, **kwargs):
            self.tasks.append((func, args, kwargs))

    monkeypatch.setattr(
        whatsapp_service,
        "enviar_texto_whatsapp_detalhado",
        lambda *args, **kwargs: whatsapp_service.ResultadoEnvioWhatsApp(
            sucesso=True,
            provider="evolution",
            message_id="scheduled-message-id",
        ),
    )
    bg = MockBackgroundTasks()
    agendar_notificacao_status_task(
        background_tasks=bg,
        comanda_id=201,
        novo_status="pronto",
        telefone_cliente="81988887777",
        nome_restaurante="Bistrô Agendado",
        restaurante_id=1,
    )
    assert len(bg.tasks) == 1

    func, args, kwargs = bg.tasks[0]
    func(*args, **kwargs)

    with SessionLocal() as db:
        notificacao = db.query(NotificacaoWhatsApp).filter(
            NotificacaoWhatsApp.comanda_id == "201"
        ).one()
        assert notificacao.restaurante_id == 1
        assert notificacao.wamid == "scheduled-message-id"


def test_notificacao_de_status_identica_e_deduplicada(monkeypatch):
    from app.services import whatsapp as whatsapp_service

    chamadas = []
    monkeypatch.setattr(
        whatsapp_service,
        "enviar_texto_whatsapp_detalhado",
        lambda *args, **kwargs: (
            chamadas.append(args)
            or whatsapp_service.ResultadoEnvioWhatsApp(True, "evolution")
        ),
    )
    comanda_id = f"dedupe-{uuid.uuid4().hex}"

    with SessionLocal() as db:
        primeira = asyncio.run(notificar_cliente_status_pedido(
            db=db,
            comanda_id=comanda_id,
            novo_status="pronto",
            telefone_cliente="81988886666",
            nome_restaurante="Bistrô Dedupe",
            restaurante_id=1,
        ))
        segunda = asyncio.run(notificar_cliente_status_pedido(
            db=db,
            comanda_id=comanda_id,
            novo_status="pronto",
            telefone_cliente="81988886666",
            nome_restaurante="Bistrô Dedupe",
            restaurante_id=1,
        ))

        assert primeira["sucesso"] is True
        assert segunda["duplicada"] is True
        assert len(chamadas) == 1
        assert db.query(NotificacaoWhatsApp).filter(
            NotificacaoWhatsApp.comanda_id == comanda_id,
        ).count() == 1


def test_notificacao_com_falha_pode_ser_tentada_novamente(monkeypatch):
    from app.services import whatsapp as whatsapp_service

    resultados = iter((False, True))
    chamadas = []

    def enviar(*args, **kwargs):
        chamadas.append(args)
        sucesso = next(resultados)
        return whatsapp_service.ResultadoEnvioWhatsApp(sucesso, "evolution")

    monkeypatch.setattr(
        whatsapp_service,
        "enviar_texto_whatsapp_detalhado",
        enviar,
    )
    comanda_id = f"retry-{uuid.uuid4().hex}"

    with SessionLocal() as db:
        primeira = asyncio.run(notificar_cliente_status_pedido(
            db=db,
            comanda_id=comanda_id,
            novo_status="em_preparo",
            telefone_cliente="81988885555",
            nome_restaurante="Bistrô Retry",
            restaurante_id=1,
        ))
        segunda = asyncio.run(notificar_cliente_status_pedido(
            db=db,
            comanda_id=comanda_id,
            novo_status="em_preparo",
            telefone_cliente="81988885555",
            nome_restaurante="Bistrô Retry",
            restaurante_id=1,
        ))

        assert primeira["status_envio"] == "falhou"
        assert segunda["status_envio"] == "enviado"
        assert len(chamadas) == 2
        assert db.query(NotificacaoWhatsApp).filter(
            NotificacaoWhatsApp.comanda_id == comanda_id,
        ).count() == 2
