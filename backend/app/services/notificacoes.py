import asyncio
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


def operational_notices_enabled(db: Session, restaurante_id: int) -> bool:
    from ..models import ConfiguracaoRestaurante
    tenant = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=restaurante_id).first()
    return bool(tenant and tenant.whatsapp_alerts_enabled is True)


def status_recipient_eligible(db: Session, restaurante_id: int, comanda_id, telefone: str) -> bool:
    """Local policy only. Re-evaluate consent in the task, never probe Evolution."""
    from ..models import Cliente, Comanda, ConfiguracaoRestaurante
    from .customer_status_whatsapp import eligible_order_status_recipient
    from .customer_whatsapp_dispatch import opted_out, customer_notices_enabled
    from .central_whatsapp import recipient_fingerprint
    from .tenant_order_whatsapp import phones_match

    tenant = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=restaurante_id).first()
    if tenant is None or tenant.whatsapp_customer_notices_enabled is not True:
        return False
    # The transactional customer outbox owns these milestones when released.
    if tenant.whatsapp_platform_managed is True or customer_notices_enabled(restaurante_id, tenant):
        return False
    order = db.query(Comanda).filter_by(restaurante_id=restaurante_id, id=str(comanda_id)).first()
    if order is None or not phones_match(order.delivery_telefone, telefone):
        return False
    customer = db.query(Cliente).filter_by(restaurante_id=restaurante_id, id=order.cliente_id).first() if order.cliente_id else None
    return eligible_order_status_recipient(
        restaurant_id=restaurante_id, order=order, customer=customer,
        opted_out=opted_out(db, restaurante_id, recipient_fingerprint(restaurante_id, telefone)),
    )


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
    if not settings.KOMA_WHATSAPP_AUTOMATION_ENABLED:
        return {"sucesso": False, "status_envio": "ignorado", "motivo": "automacao_desativada"}

    telefone_limpo = (telefone or "").strip()
    auditoria = conteudo_auditoria or conteudo
    comanda_ref = str(comanda_id) if comanda_id is not None else None

    if not telefone_limpo:
        return {
            "sucesso": False,
            "motivo": "telefone_ausente",
            "conteudo": auditoria,
        }

    # Resolver restaurante_id a partir do contexto, sessão ou comanda se não fornecido
    if restaurante_id is None or not (isinstance(restaurante_id, int) and restaurante_id > 0):
        sess_rid = getattr(db, "restaurante_id", None)
        if isinstance(sess_rid, int) and sess_rid > 0:
            restaurante_id = sess_rid
        else:
            from ..database import current_restaurante_id
            ctx_rid = current_restaurante_id.get()
            if isinstance(ctx_rid, int) and ctx_rid > 0:
                restaurante_id = ctx_rid
            elif comanda_ref:
                from ..models import Comanda
                c_row = db.query(Comanda.restaurante_id).filter(Comanda.id == comanda_ref).first()
                if c_row and isinstance(c_row[0], int) and c_row[0] > 0:
                    restaurante_id = int(c_row[0])
            try:
                if (restaurante_id is None or restaurante_id <= 0) and db.get_bind().dialect.name == "sqlite":
                    restaurante_id = 1
            except Exception:
                pass

    if restaurante_id is None or not (isinstance(restaurante_id, int) and restaurante_id > 0):
        logger.warning(
            "[NOTIFICAÇÃO WA] Envios operacionais exigem restaurante_id válido e identificável."
        )
        return {
            "sucesso": False,
            "motivo": "tenant_invalido",
            "conteudo": auditoria,
            "telefone": telefone_limpo,
        }

    if tipo != "status_pedido" and not operational_notices_enabled(db, restaurante_id):
        return {"sucesso": False, "status_envio": "ignorado", "motivo": "integracao_desativada", "conteudo": auditoria}

    if tipo == "status_pedido" and not status_recipient_eligible(db, restaurante_id, comanda_ref, telefone_limpo):
        return {"sucesso": False, "status_envio": "ignorado", "motivo": "destinatario_nao_elegivel", "conteudo": auditoria}

    if comanda_ref is not None:
        from ..models import Comanda
        # Serialize duplicate tasks for one check. Commit of the pending record
        # releases the lock before HTTP; another worker then sees that record.
        db.query(Comanda.id).filter_by(restaurante_id=restaurante_id, id=comanda_ref).with_for_update().first()

    existente = db.query(NotificacaoWhatsApp).filter(
        NotificacaoWhatsApp.restaurante_id == restaurante_id,
        NotificacaoWhatsApp.comanda_id == comanda_ref,
        NotificacaoWhatsApp.tipo == tipo,
        NotificacaoWhatsApp.conteudo == auditoria,
        NotificacaoWhatsApp.status_envio.in_(("pendente", "enviado", "entregue", "falhou", "ignorado")),
    ).first()
    if existente:
        return {
            "sucesso": existente.status_envio in {"enviado", "entregue"},
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

    # Re-read after reserving the pending notification, then release SQL before
    # waiting on the provider. A queued task never owns a consent snapshot.
    db.expire_all()
    eligible = settings.KOMA_WHATSAPP_AUTOMATION_ENABLED and (
        status_recipient_eligible(db, restaurante_id, comanda_ref, telefone_limpo)
        if tipo == "status_pedido" else operational_notices_enabled(db, restaurante_id)
    )
    db.rollback()
    if not eligible:
        notif.status_envio = "ignorado"
        notif.error_title = "Ignorado: autorização alterada antes do envio."
        db.commit()
        return {"sucesso": False, "status_envio": "ignorado", "motivo": "autorizacao_revogada"}

    resultado = whatsapp_service.enviar_texto_whatsapp_detalhado(
        telefone_limpo,
        conteudo,
        contexto=contexto,
    )
    status_envio = "enviado" if resultado.sucesso else ("ignorado" if resultado.provider_status == "skipped_disabled" else "falhou")

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
    if not settings.KOMA_WHATSAPP_AUTOMATION_ENABLED:
        return {"sucesso": False, "status_envio": "ignorado", "motivo": "automacao_desativada"}

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
            # Starlette executa callbacks síncronos de BackgroundTasks em worker
            # threads. Crie um loop dedicado para esta coroutine e nunca dependa
            # de um event loop herdado da thread da requisição.
            asyncio.run(runner())
        except Exception:
            # Notificação é side effect opcional: uma falha aqui não pode voltar
            # para o ASGI stack depois que a operação de domínio já foi concluída.
            logger.exception("[NOTIFICAÇÃO WA TASK ERROR] Falha em tarefa assíncrona de notificação")

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
    db: Session | None = None,
) -> None:
    """Agenda um envio genérico sem reutilizar a sessão da requisição."""

    # Retired operational sender. Central transactional notices own delivery.
    return


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

    # Do not allocate a session/task for a retired per-status transport.
    return
