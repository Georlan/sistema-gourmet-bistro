import logging
from sqlalchemy.orm import Session
from ..database import SessionLocal
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

    notif = None
    try:
        notif = NotificacaoWhatsApp(
            restaurante_id=restaurante_id,
            comanda_id=comanda_id,
            telefone=telefone_cliente,
            tipo="status_pedido",
            status_envio="pendente",
            conteudo=conteudo,
        )
        db.add(notif)
        db.commit()
        db.refresh(notif)
    except Exception as err:
        logger.error(
            "[NOTIFICAÇÃO WA DB ERROR] Falha ao preparar registro de envio: %s",
            type(err).__name__,
        )
        db.rollback()
        return {
            "sucesso": False,
            "status_envio": "falhou",
            "motivo": "registro_indisponivel",
            "conteudo": conteudo,
            "telefone": telefone_cliente,
        }

    resultado = whatsapp_service.enviar_texto_whatsapp_detalhado(
        telefone_cliente,
        conteudo,
        contexto=f"notificação de status '{novo_status}' (comanda #{comanda_id})",
    )
    status_envio = "enviado" if resultado.sucesso else "falhou"

    try:
        notif.status_envio = status_envio
        notif.wamid = resultado.message_id
        notif.recipient_id = resultado.recipient_id
        notif.status = resultado.provider_status
        notif.error_code = resultado.error_code
        notif.error_title = resultado.error_message
        notif.error_message = None
        notif.raw_payload = None
        db.commit()
    except Exception as err:
        logger.error(
            "[NOTIFICAÇÃO WA DB ERROR] Falha ao atualizar resultado do envio: %s",
            type(err).__name__,
        )
        db.rollback()

    return {
        "sucesso": resultado.sucesso,
        "status_envio": status_envio,
        "conteudo": conteudo,
        "telefone": telefone_cliente,
        "wamid": resultado.message_id,
    }


def agendar_notificacao_status_task(
    background_tasks,
    comanda_id: str | int,
    novo_status: str,
    telefone_cliente: str,
    nome_restaurante: str,
    link_rastreamento: str | None = None,
    telefone_restaurante: str | None = None,
    restaurante_id: int | None = None,
) -> None:
    """
    Agenda o envio sem reutilizar a sessão de banco ligada à requisição HTTP.
    """
    import asyncio

    async def _runner():
        db = SessionLocal(restaurante_id=restaurante_id)
        try:
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
        finally:
            db.close()

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
