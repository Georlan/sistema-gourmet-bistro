"""Módulo canônico para cálculo e verificação de fingerprint de idempotência de pedidos."""

from __future__ import annotations

from dataclasses import dataclass
import datetime
from decimal import Decimal
import hashlib
import json
from typing import Any, Optional, Sequence

from ...services.clientes import normalizar_telefone_cliente

CURRENT_FINGERPRINT_VERSION = 1


@dataclass(frozen=True)
class OrderIntentFingerprint:
    """Resultado determinístico do cálculo de fingerprint da intenção do pedido."""

    fingerprint: str
    version: int
    canonical_payload: dict[str, Any]


def _normalize_item_quantity(quantity: object) -> int | str:
    """Normaliza quantidade decimal de item de forma estável, sem dependência de float binário."""
    d = Decimal(str(quantity))
    if d == d.to_integral():
        return int(d)
    return str(d.normalize())


def _normalize_monetary_amount(amount: Optional[object]) -> Optional[str]:
    """Normaliza valores monetários para representação com 2 casas decimais."""
    if amount is None:
        return None
    raw = str(amount).strip()
    if not raw:
        return None
    try:
        d = Decimal(raw)
        return f"{d:.2f}"
    except Exception:
        return None


def _normalize_scheduled_for(scheduled: Optional[datetime.datetime | str]) -> Optional[str]:
    """Normaliza data/hora de agendamento para UTC ISO-8601 canônico."""
    if scheduled is None:
        return None
    if isinstance(scheduled, datetime.datetime):
        dt = scheduled
    elif isinstance(scheduled, str):
        raw = scheduled.strip()
        if not raw:
            return None
        iso_str = raw.replace("Z", "+00:00")
        try:
            dt = datetime.datetime.fromisoformat(iso_str)
        except ValueError:
            return None
    else:
        return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    else:
        dt = dt.astimezone(datetime.timezone.utc)
    return dt.isoformat()


def build_order_intent_canonical_dict(
    *,
    restaurante_id: int,
    tipo_pedido: str,
    itens: Sequence[Any],
    cliente_nome: Optional[str] = None,
    cliente_telefone: Optional[str] = None,
    endereco_entrega: Optional[str] = None,
    bairro: Optional[str] = None,
    forma_pagamento: Optional[str] = None,
    forma_pagamento_detalhe: Optional[str] = None,
    cliente_email: Optional[str] = None,
    troco_para: Optional[object] = None,
    cupom_codigo: Optional[str] = None,
    usar_cashback: bool = False,
    scheduled_for: Optional[datetime.datetime | str] = None,
) -> dict[str, Any]:
    """Monta a representação canônica da intenção do pedido público."""
    normalized_modalidade = str(tipo_pedido or "").strip().lower()

    # Itens: preserva ordem de linhas informadas pelo cliente
    normalized_itens: list[dict[str, Any]] = []
    for item in itens:
        if isinstance(item, dict):
            prod_id = item.get("produto_id")
            qty = item.get("quantidade", 1)
            mods = item.get("modificador_ids") or []
            obs = item.get("observacao")
        else:
            prod_id = getattr(item, "produto_id", getattr(item, "product_id", None))
            qty = getattr(item, "quantidade", getattr(item, "quantity", 1))
            mods = getattr(item, "modificador_ids", getattr(item, "modifier_ids", ()))
            obs = getattr(item, "observacao", getattr(item, "notes", None))

        clean_prod_id = str(prod_id or "").strip()
        clean_obs = str(obs or "").strip()
        sorted_modifiers = sorted(str(m).strip() for m in (mods or ()) if str(m).strip())

        normalized_itens.append({
            "modificador_ids": sorted_modifiers,
            "observacao": clean_obs,
            "produto_id": clean_prod_id,
            "quantidade": _normalize_item_quantity(qty),
        })

    clean_phone = ""
    if cliente_telefone:
        try:
            clean_phone = normalizar_telefone_cliente(str(cliente_telefone))
        except ValueError:
            clean_phone = "".join(c for c in str(cliente_telefone) if c.isdigit())

    is_delivery = normalized_modalidade == "delivery"
    clean_address = str(endereco_entrega or "").strip() if is_delivery and endereco_entrega else None
    clean_bairro = str(bairro or "").strip() if is_delivery and bairro else None

    clean_cupom = str(cupom_codigo).strip().upper() if cupom_codigo and str(cupom_codigo).strip() else None
    clean_email = str(cliente_email).strip().lower() if cliente_email and str(cliente_email).strip() else None
    clean_nome = " ".join(str(cliente_nome or "").strip().split()) if cliente_nome else ""

    clean_forma = str(forma_pagamento or "").strip().lower()
    clean_detalhe = str(forma_pagamento_detalhe or "").strip().lower() if forma_pagamento_detalhe else None
    clean_troco = _normalize_monetary_amount(troco_para)
    clean_scheduled = _normalize_scheduled_for(scheduled_for)

    return {
        "bairro": clean_bairro,
        "cliente_email": clean_email,
        "cliente_nome": clean_nome,
        "cliente_telefone": clean_phone,
        "cupom_codigo": clean_cupom,
        "endereco_entrega": clean_address,
        "forma_pagamento": clean_forma,
        "forma_pagamento_detalhe": clean_detalhe,
        "itens": normalized_itens,
        "restaurante_id": int(restaurante_id),
        "scheduled_for": clean_scheduled,
        "tipo_pedido": normalized_modalidade,
        "troco_para": clean_troco,
        "usar_cashback": bool(usar_cashback),
    }


def compute_order_intent_fingerprint(
    *,
    restaurante_id: int,
    tipo_pedido: str,
    itens: Sequence[Any],
    cliente_nome: Optional[str] = None,
    cliente_telefone: Optional[str] = None,
    endereco_entrega: Optional[str] = None,
    bairro: Optional[str] = None,
    forma_pagamento: Optional[str] = None,
    forma_pagamento_detalhe: Optional[str] = None,
    cliente_email: Optional[str] = None,
    troco_para: Optional[object] = None,
    cupom_codigo: Optional[str] = None,
    usar_cashback: bool = False,
    scheduled_for: Optional[datetime.datetime | str] = None,
    version: int = CURRENT_FINGERPRINT_VERSION,
) -> OrderIntentFingerprint:
    """Calcula o fingerprint SHA-256 determinístico para uma intenção de pedido."""
    canonical_dict = build_order_intent_canonical_dict(
        restaurante_id=restaurante_id,
        tipo_pedido=tipo_pedido,
        itens=itens,
        cliente_nome=cliente_nome,
        cliente_telefone=cliente_telefone,
        endereco_entrega=endereco_entrega,
        bairro=bairro,
        forma_pagamento=forma_pagamento,
        forma_pagamento_detalhe=forma_pagamento_detalhe,
        cliente_email=cliente_email,
        troco_para=troco_para,
        cupom_codigo=cupom_codigo,
        usar_cashback=usar_cashback,
        scheduled_for=scheduled_for,
    )
    canonical_json = json.dumps(
        canonical_dict,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    fingerprint_hash = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    return OrderIntentFingerprint(
        fingerprint=fingerprint_hash,
        version=version,
        canonical_payload=canonical_dict,
    )


def compute_fingerprint_for_public_payload(
    payload: Any,
    *,
    scheduled_for: Optional[datetime.datetime | str] = None,
    version: int = CURRENT_FINGERPRINT_VERSION,
) -> OrderIntentFingerprint:
    """Calcula fingerprint a partir do schema de entrada CardapioPedidoCreate / Agendavel."""
    target_schedule = (
        scheduled_for
        if scheduled_for is not None
        else getattr(payload, "scheduled_for", None)
    )
    return compute_order_intent_fingerprint(
        restaurante_id=payload.restaurante_id,
        tipo_pedido=payload.tipo_pedido,
        itens=payload.itens,
        cliente_nome=payload.cliente_nome,
        cliente_telefone=payload.cliente_telefone,
        endereco_entrega=payload.endereco_entrega,
        bairro=payload.bairro,
        forma_pagamento=payload.forma_pagamento,
        forma_pagamento_detalhe=payload.forma_pagamento_detalhe,
        cliente_email=payload.cliente_email,
        troco_para=payload.troco_para,
        cupom_codigo=payload.cupom_codigo,
        usar_cashback=payload.usar_cashback,
        scheduled_for=target_schedule,
        version=version,
    )
