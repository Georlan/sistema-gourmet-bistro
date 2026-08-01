import os
import logging
import httpx
from ..config import settings
from ..database import SessionLocal
from ..models import Comanda, Restaurante

logger = logging.getLogger(__name__)


def enviar_notificacao_whatsapp_status(
    comanda_id: str,
    status_novo: str,
    status_anterior: str | None,
    restaurante_id: int
) -> bool:
    """
    Envia notificação via WhatsApp (Evolution API) quando o status da comanda muda.
    Esta função deve ser executada de forma assíncrona/background.
    Nunca propaga exceções para não interromper nem travar a transação do banco de dados.
    """
    if status_anterior == status_novo:
        logger.info(
            "[WHATSAPP IGNORED] Status inalterado para comanda_id=%s (%s == %s)",
            comanda_id,
            status_anterior,
            status_novo,
        )
        return False

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(
            Comanda.id == comanda_id,
            Comanda.restaurante_id == restaurante_id
        ).first()

        if not comanda:
            logger.warning("[WHATSAPP ERROR] Comanda id=%s não encontrada", comanda_id)
            return False

        telefone = comanda.delivery_telefone or ""
        tel_clean = "".join(c for c in telefone if c.isdigit())
        if not tel_clean:
            logger.info("[WHATSAPP SKIPPED] Comanda id=%s sem telefone cadastrado", comanda_id)
            return False

        # Adiciona DDI 55 se o número tiver 10 ou 11 dígitos
        if len(tel_clean) in (10, 11) and not tel_clean.startswith("55"):
            tel_clean = f"55{tel_clean}"

        nome_cliente = comanda.identificador or "Cliente"
        numero_pedido = comanda.numero_pedido
        nome_restaurante = "Restaurante"
        if comanda.restaurante_id:
            rest = db.query(Restaurante).filter(Restaurante.id == comanda.restaurante_id).first()
            if rest and rest.nome:
                nome_restaurante = rest.nome

        tipo_pedido = comanda.tipo or "Entrega"

        mensagem_texto = None

        if status_novo == "pronto" and tipo_pedido == "Retirada":
            mensagem_texto = (
                f"Olá {nome_cliente}! 👋 Seu pedido #{numero_pedido} no {nome_restaurante} "
                f"já está *PRONTO PARA RETIRADA*! 🍔 Pode vir buscar no nosso balcão. Te esperamos!"
            )
        elif status_novo == "transito" and tipo_pedido in ("Entrega", "Delivery"):
            mensagem_texto = (
                f"Olá {nome_cliente}! 🛵 Seu pedido #{numero_pedido} no {nome_restaurante} "
                f"acabou de *SAIR PARA ENTREGA*! 🚀 O entregador já está a caminho do seu endereço. Bom apetite!"
            )
        elif status_novo == "producao":
            mensagem_texto = (
                f"Olá {nome_cliente}! ✅ Seu pedido #{numero_pedido} no {nome_restaurante} "
                f"foi confirmado e já está *EM PREPARO* na nossa cozinha!"
            )
        elif status_novo == "recusado":
            mensagem_texto = (
                f"Olá {nome_cliente}. Infelizmente seu pedido #{numero_pedido} no {nome_restaurante} "
                f"foi recusado/cancelado no momento. Entre em contato conosco para mais detalhes."
            )

        if not mensagem_texto:
            logger.info(
                "[WHATSAPP SKIPPED] Nenhuma mensagem configurada para status=%s tipo=%s",
                status_novo,
                tipo_pedido,
            )
            return False

        evolution_url = getattr(settings, "EVOLUTION_API_URL", None) or os.getenv("EVOLUTION_API_URL", "")
        evolution_key = getattr(settings, "EVOLUTION_API_KEY", None) or os.getenv("EVOLUTION_API_KEY", "")
        evolution_instance = getattr(settings, "EVOLUTION_INSTANCE_NAME", None) or os.getenv("EVOLUTION_INSTANCE_NAME", "")

        if not (evolution_url and evolution_key and evolution_instance):
            logger.info(
                "[WHATSAPP SIMULADO/SKIPPED] Evolution API não configurada no .env. "
                "Mensagem para %s: '%s'",
                tel_clean,
                mensagem_texto,
            )
            return False

        url_disparo = f"{evolution_url.rstrip('/')}/message/sendText/{evolution_instance}"
        headers = {
            "Content-Type": "application/json",
            "apikey": evolution_key,
        }
        payload = {
            "number": tel_clean,
            "text": mensagem_texto,
        }

        with httpx.Client(timeout=5.0) as client:
            res = client.post(url_disparo, headers=headers, json=payload)
            if res.status_code in (200, 201):
                logger.info(
                    "[EVOLUTION API SUCCESS] Notificação enviada para comanda_id=%s tel=%s status=%s",
                    comanda_id,
                    tel_clean,
                    status_novo,
                )
                return True
            else:
                logger.warning(
                    "[EVOLUTION API HTTP %s] Falha ao enviar notificação para comanda_id=%s",
                    res.status_code,
                    comanda_id,
                )
                return False

    except Exception as err:
        logger.warning(
            "[EVOLUTION API EXCEPTION] Erro ao enviar notificação de WhatsApp para comanda_id=%s: %s",
            comanda_id,
            err,
        )
        return False
    finally:
        db.close()
