import logging
from sqlalchemy.orm import Session
from ..models import NotificacaoWhatsApp
from . import whatsapp as whatsapp_service

logger = logging.getLogger("koma.notificacoes")

MENSAGENS_STATUS = {
    "recebido": "✅ Pedido recebido! {restaurante} já começou a preparar.",
    "em_preparo": "🍳 Seu pedido está sendo preparado com carinho!",
    "pronto": "🎉 Seu pedido está pronto! Pode retirar na loja.",
    "saiu_entrega": "🛵 Saiu para entrega! Acompanhe: {link_rastreamento}",
    "entregue": "⭐ Pedido entregue! Obrigado por escolher {restaurante}.",
    "recusado": "❌ Não conseguimos atender seu pedido. Entre em contato: {telefone_restaurante}",
}


async def notificar_cliente_status_pedido(
    db: Session,
    comanda_id: int,
    novo_status: str,
    telefone_cliente: str,
    nome_restaurante: str,
    link_rastreamento: str | None = None,
    telefone_restaurante: str | None = None,
    restaurante_id: int | None = None,
) -> dict:
    """
    Monta e envia a mensagem de notificação de status de pedido para o cliente via WhatsApp
    e persiste o registro na tabela notificacoes_whatsapp.
    """
    status_normalizado = (novo_status or "").lower().strip()
    template_msg = MENSAGENS_STATUS.get(status_normalizado)

    if not template_msg:
        if "preparo" in status_normalizado or "producao" in status_normalizado:
            template_msg = MENSAGENS_STATUS["em_preparo"]
        elif "pronto" in status_normalizado:
            template_msg = MENSAGENS_STATUS["pronto"]
        elif "entrega" in status_normalizado or "despachado" in status_normalizado:
            template_msg = MENSAGENS_STATUS["saiu_entrega"]
        elif "entregue" in status_normalizado or "finalizado" in status_normalizado:
            template_msg = MENSAGENS_STATUS["entregue"]
        elif "recusado" in status_normalizado or "cancelado" in status_normalizado:
            template_msg = MENSAGENS_STATUS["recusado"]
        else:
            template_msg = f"Seu pedido no *{nome_restaurante}* foi atualizado para: *{novo_status}*."

    link_fmt = link_rastreamento if link_rastreamento else "no cardápio digital"
    tel_fmt = telefone_restaurante if telefone_restaurante else nome_restaurante

    conteudo = template_msg.format(
        restaurante=nome_restaurante,
        link_rastreamento=link_fmt,
        telefone_restaurante=tel_fmt,
    )

    if not telefone_cliente or not telefone_cliente.strip():
        logger.warning("[NOTIFICAÇÃO WA] Telefone do cliente não fornecido para comanda #%s", comanda_id)
        return {
            "sucesso": False,
            "motivo": "telefone_ausente",
            "conteudo": conteudo,
        }

    sucesso = whatsapp_service.enviar_texto_whatsapp(
        telefone_cliente,
        conteudo,
        contexto=f"notificação de status '{novo_status}' (comanda #{comanda_id})",
    )

    status_envio = "enviado" if sucesso else "falhou"

    try:
        notif = NotificacaoWhatsApp(
            restaurante_id=restaurante_id,
            comanda_id=comanda_id,
            telefone=telefone_cliente,
            tipo="status_pedido",
            status_envio=status_envio,
            conteudo=conteudo,
        )
        db.add(notif)
        db.commit()
        db.refresh(notif)
    except Exception as err:
        logger.error("[NOTIFICAÇÃO WA DB ERROR] Falha ao registrar em notificacoes_whatsapp: %s", err)
        db.rollback()

    return {
        "sucesso": sucesso,
        "status_envio": status_envio,
        "conteudo": conteudo,
        "telefone": telefone_cliente,
    }


def agendar_notificacao_status_task(
    background_tasks,
    db: Session,
    comanda_id: int,
    novo_status: str,
    telefone_cliente: str,
    nome_restaurante: str,
    link_rastreamento: str | None = None,
    telefone_restaurante: str | None = None,
    restaurante_id: int | None = None,
) -> None:
    """
    Auxiliar síncrono para agendar a notificação via FastAPI BackgroundTasks sem bloquear respostas HTTP.
    """
    import asyncio

    async def _runner():
        await notificar_cliente_status_pedido(
            db=db,
            comanda_id=comanda_id,
            novo_status=novo_status,
            telefone_cliente=telefone_cliente,
            nome_restaurante=nome_restaurante,
            link_rastreamento=link_rastreamento,
            telefone_restaurante=telefone_restaurante,
            restaurante_id=restaurante_id,
        )

    def _task_wrapper():
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(_runner())
            else:
                loop.run_until_complete(_runner())
        except RuntimeError:
            asyncio.run(_runner())

    if background_tasks is not None:
        background_tasks.add_task(_task_wrapper)

