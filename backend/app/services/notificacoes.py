import asyncio
import hashlib
import logging

from sqlalchemy.orm import Session

from ..config import settings
from ..database import SessionLocal
from ..models import NotificacaoWhatsApp
from . import whatsapp as whatsapp_service

logger = logging.getLogger("koma.notificacoes")

MENSAGENS_STATUS = {
    "recebido": "✅ Pedido recebido! {restaurante} já começou a preparar.\nPedido #{numero_pedido}.",
    "em_preparo": "🍳 Seu pedido está sendo preparado com carinho!\nPedido #{numero_pedido} • {restaurante}.",
    "pronto": "🎉 Seu pedido está pronto! Pode retirar na loja.\nPedido #{numero_pedido} • {restaurante}.",
    "pronto_delivery": "🎉 Seu pedido está pronto e aguardando o entregador.\nPedido #{numero_pedido} • {restaurante}.",
    "saiu_entrega": "🛵 Saiu para entrega! O entregador já está a caminho.\nPedido #{numero_pedido} • {restaurante}.",
    "saiu_entrega_rastreio": "🛵 Saiu para entrega! Acompanhe: {link_rastreamento}",
    "entregue": "⭐ Pedido entregue! Obrigado por escolher {restaurante}.\nPedido #{numero_pedido}.",
    "recusado": "❌ Não conseguimos atender seu pedido. Entre em contato: {telefone_restaurante}",
}


async def enviar_notificacao_whatsapp(
    db: Session,
    *,
    telefone: str,
    conteudo: str,
    tipo: str,
    restaurante_id: int | None,
    comanda_id: str | int | None = None,
    conteudo_auditoria: str | None = None,
    contexto: str = "notificação operacional",
) -> dict:
    """Persiste e envia uma mensagem operacional, com deduplicação segura."""
    telefone_limpo = (telefone or "").strip()
    auditoria = conteudo_auditoria or conteudo
    comanda_ref = str(comanda_id) if comanda_id is not None else None

    if not telefone_limpo:
        return {
            "sucesso": False,
            "motivo": "telefone_ausente",
            "conteudo": auditoria,
        }

    existente = db.query(NotificacaoWhatsApp).filter(
        NotificacaoWhatsApp.restaurante_id == restaurante_id,
        NotificacaoWhatsApp.comanda_id == comanda_ref,
        NotificacaoWhatsApp.tipo == tipo,
        NotificacaoWhatsApp.conteudo == auditoria,
        NotificacaoWhatsApp.status_envio.in_(("pendente", "enviado", "entregue")),
    ).first()
    if existente:
        return {
            "sucesso": True,
            "status_envio": existente.status_envio,
            "duplicada": True,
            "conteudo": auditoria,
            "telefone": telefone_limpo,
            "wamid": existente.wamid,
        }

    try:
        notif = NotificacaoWhatsApp(
            restaurante_id=restaurante_id,
            comanda_id=comanda_ref,
            telefone=telefone_limpo,
            tipo=tipo,
            status_envio="pendente",
            conteudo=auditoria,
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
            "conteudo": auditoria,
            "telefone": telefone_limpo,
        }

    resultado = whatsapp_service.enviar_texto_whatsapp_detalhado(
        telefone_limpo,
        conteudo,
        contexto=contexto,
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
        "conteudo": auditoria,
        "telefone": telefone_limpo,
        "wamid": resultado.message_id,
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
    numero_pedido: str | int | None = None,
    modalidade: str | None = None,
) -> dict:
    """Monta, persiste e envia a atualização de pedido via WhatsApp."""
    status_normalizado = (novo_status or "").lower().strip()
    template_msg = MENSAGENS_STATUS.get(status_normalizado)
    if status_normalizado == "saiu_entrega" and link_rastreamento:
        template_msg = MENSAGENS_STATUS["saiu_entrega_rastreio"]
    if status_normalizado == "pronto" and (modalidade or "").strip().casefold() in {
        "entrega",
        "delivery",
    }:
        template_msg = MENSAGENS_STATUS["pronto_delivery"]

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

    conteudo = template_msg.format(
        restaurante=nome_restaurante,
        link_rastreamento=link_rastreamento or "no cardápio digital",
        telefone_restaurante=telefone_restaurante or nome_restaurante,
        numero_pedido=numero_pedido or comanda_id,
    )

    if not telefone_cliente or not telefone_cliente.strip():
        logger.warning(
            "[NOTIFICAÇÃO WA] Telefone do cliente não fornecido para comanda #%s",
            comanda_id,
        )
        return {
            "sucesso": False,
            "motivo": "telefone_ausente",
            "conteudo": conteudo,
        }

    return await enviar_notificacao_whatsapp(
        db,
        telefone=telefone_cliente,
        conteudo=conteudo,
        tipo="status_pedido",
        restaurante_id=restaurante_id,
        comanda_id=comanda_id,
        contexto=f"notificação de status '{novo_status}' (comanda #{comanda_id})",
    )


def _agendar_corrotina(background_tasks, runner) -> None:
    def _task_wrapper():
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(runner())
            else:
                loop.run_until_complete(runner())
        except RuntimeError:
            asyncio.run(runner())

    if background_tasks is not None:
        background_tasks.add_task(_task_wrapper)


def agendar_notificacao_whatsapp_task(
    background_tasks,
    *,
    telefone: str,
    conteudo: str,
    tipo: str,
    restaurante_id: int,
    comanda_id: str | int | None = None,
    conteudo_auditoria: str | None = None,
    contexto: str = "notificação operacional",
) -> None:
    """Agenda um envio genérico sem reutilizar a sessão da requisição."""

    async def _runner():
        db = SessionLocal(restaurante_id=restaurante_id)
        try:
            await enviar_notificacao_whatsapp(
                db,
                telefone=telefone,
                conteudo=conteudo,
                tipo=tipo,
                restaurante_id=restaurante_id,
                comanda_id=comanda_id,
                conteudo_auditoria=conteudo_auditoria,
                contexto=contexto,
            )
        finally:
            db.close()

    _agendar_corrotina(background_tasks, _runner)


def agendar_convite_equipe_task(
    background_tasks,
    *,
    restaurante_id: int,
    usuario_id: str,
    telefone: str,
    nome_pessoa: str,
    nome_restaurante: str,
    token_convite: str,
) -> None:
    link = f"{settings.KOMA_PUBLIC_APP_URL}/ativar?token={token_convite}"
    conteudo = (
        f"Olá, {nome_pessoa}! Você foi convidado para trabalhar no "
        f"*{nome_restaurante}*.\n\nCrie sua senha e ative sua conta: {link}\n\n"
        "Este convite expira em 24 horas."
    )
    token_ref = hashlib.sha256(token_convite.encode("utf-8")).hexdigest()[:12]
    agendar_notificacao_whatsapp_task(
        background_tasks,
        telefone=telefone,
        conteudo=conteudo,
        tipo="convite_equipe",
        restaurante_id=restaurante_id,
        conteudo_auditoria=f"Convite de equipe para usuário {usuario_id} ({token_ref}).",
        contexto="convite de equipe",
    )


def agendar_notificacao_status_task(
    background_tasks,
    comanda_id: str | int,
    novo_status: str,
    telefone_cliente: str,
    nome_restaurante: str,
    link_rastreamento: str | None = None,
    telefone_restaurante: str | None = None,
    restaurante_id: int | None = None,
    numero_pedido: str | int | None = None,
    modalidade: str | None = None,
) -> None:
    """Agenda o envio sem reutilizar a sessão ligada à requisição HTTP."""

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
                numero_pedido=numero_pedido,
                modalidade=modalidade,
            )
        finally:
            db.close()

    _agendar_corrotina(background_tasks, _runner)
