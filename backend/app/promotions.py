"""Promoções simples por tenant, vinculadas a produtos reais.

Não cria SKUs paralelos. Montagem, estoque, impressão e idempotência continuam
na pipeline canônica de itens. O preço é redistribuído aos itens já validados.
"""
from __future__ import annotations

from dataclasses import replace
from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone
from typing import Any

from .domain.orders.validation import ValidatedOrderInput
from .domain.orders.errors import OrderValidationError

VALID_PROMOTION_TYPES = ("combo", "compre_ganhe", "desconto_item")
MAX_SLOT_QUANTITY = 20
MAX_PROMOTION_TOTAL_ITEMS = 25


def normalize_promotion_type(promotion: dict) -> str:
    """Normaliza tipo da promoção preservando 'combo' para registros legados."""
    raw = promotion.get("tipo")
    if raw is None or raw == "":
        return "combo"
    return str(raw).strip()


def normalize_gift_name(value: Any) -> str | None:
    """Normaliza nome de brinde textual; string vazia/espaços vira None."""
    if value is None or not isinstance(value, str):
        return None
    cleaned = " ".join(value.split())
    return cleaned or None


def normalize_promotion_quantities(promotion: dict) -> list[int] | None:
    """Normaliza quantidades por etapa; ausente assume [1, ..., 1] (legado)."""
    parts = promotion.get("componentes")
    if not isinstance(parts, list) or not parts:
        return None
    raw = promotion.get("quantidades")
    if raw is None:
        return [1] * len(parts)
    if not isinstance(raw, list) or len(raw) != len(parts):
        return None
    if any(type(q) is not int or q < 1 or q > MAX_SLOT_QUANTITY for q in raw):
        return None
    if sum(raw) > MAX_PROMOTION_TOTAL_ITEMS:
        return None
    return list(raw)


def is_valid_promotion_structure(promotion: dict) -> bool:
    """Valida contrato estrutural de tipo, brinde_nome, etapas e quantidades."""
    tipo = normalize_promotion_type(promotion)
    if tipo not in VALID_PROMOTION_TYPES:
        return False
    parts = promotion.get("componentes")
    if not isinstance(parts, list) or not parts:
        return False
    if any(not isinstance(ids, list) or not ids for ids in parts):
        return False
    if normalize_promotion_quantities(promotion) is None:
        return False
    gift_name = normalize_gift_name(promotion.get("brinde_nome"))
    slot_count = len(parts)
    if tipo == "combo":
        return 2 <= slot_count <= 4 and gift_name is None
    if tipo == "compre_ganhe":
        return (slot_count == 2 and gift_name is None) or (
            slot_count == 1 and gift_name is not None
        )
    if tipo == "desconto_item":
        return slot_count == 1 and gift_name is None
    return False


def _append_gift_note(existing_notes: str | None, gift_name: str) -> str:
    tag = f"Brinde: {gift_name}"
    base = (existing_notes or "").strip()
    if not base:
        return tag
    if tag.lower() in base.lower():
        return base
    return f"{base} | {tag}"


def money(value: Any) -> Decimal:
    try:
        price = Decimal(str(value)).quantize(Decimal("0.01"))
        if not price.is_finite() or price < 0 or price > Decimal("100000.00"):
            raise ValueError("Preço de promoção inválido.")
        return price
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError("Preço de promoção inválido.") from exc


def promotion_status(promotion: dict, *, now: datetime | None = None) -> str:
    """Elegibilidade calculada em leitura e checkout, sem job ou escrita periódica."""
    now = now or datetime.now(timezone.utc)
    try:
        def timestamp(key: str):
            value = promotion.get(key)
            if not value:
                return None
            result = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if result.tzinfo is None:
                raise ValueError("Data sem fuso horário")
            return result
        start, end = timestamp("inicio_em"), timestamp("fim_em")
        if start and end and end <= start:
            return "encerrada"
        if end and now >= end:
            return "encerrada"
        if not promotion.get("ativo"):
            return "pausada"
        if start and now < start:
            return "agendada"
        return "ativa"
    except (ValueError, TypeError, AttributeError):
        return "encerrada"  # Configuração inválida nunca concede preço promocional.


def active_promotions(config: Any, products: list[Any]) -> list[dict]:
    """Exibe somente ofertas ativas cujos componentes são vendáveis."""
    products_by_id = {str(product.id): product for product in products if product.ativo}
    visible: list[dict] = []
    for promotion in getattr(config, "promocoes", None) or []:
        if promotion_status(promotion) != "ativa":
            continue
        if not is_valid_promotion_structure(promotion):
            continue
        parts = promotion.get("componentes") or []
        if any(
            not any(str(identifier) in products_by_id for identifier in ids)
            for ids in parts
        ):
            continue
        visible.append({
            "id": promotion["id"],
            "nome": promotion["nome"],
            "descricao": promotion.get("descricao", ""),
            "imagem_url": promotion.get("imagem_url"),
            "tipo": normalize_promotion_type(promotion),
            "brinde_nome": normalize_gift_name(promotion.get("brinde_nome")),
            "preco": float(money(promotion["preco"])),
            "componentes": parts,
            "quantidades": normalize_promotion_quantities(promotion),
            "inicio_em": promotion.get("inicio_em"),
            "fim_em": promotion.get("fim_em"),
        })
    return visible


def _to_cents(value: Decimal) -> int:
    return int((value.quantize(Decimal("0.01")) * 100).to_integral_value())


def _from_cents(cents: int) -> Decimal:
    return (Decimal(cents) / Decimal(100)).quantize(Decimal("0.01"))


def _item_integer_quantity(item: Any) -> int:
    qty = item.quantity
    if qty <= 0 or qty != int(qty):
        raise OrderValidationError("Quantidade inválida para item da promoção.")
    return int(qty)


def _promotion_item_instances(
    validated: ValidatedOrderInput, promotion: dict, item_indices: tuple[int, ...] | None = None,
) -> list[list[int]]:
    parts = promotion.get("componentes") or []
    quantities = normalize_promotion_quantities(promotion)
    if quantities is None:
        raise OrderValidationError("Promoção incompleta.")
    items = list(validated.items)
    if item_indices is not None:
        if (
            len(item_indices) < len(parts)
            or len(set(item_indices)) != len(item_indices)
            or any(type(i) is not int or i < 0 or i >= len(items) for i in item_indices)
        ):
            raise OrderValidationError("Composição de promoção inválida.")
        instances: list[list[int]] = []
        cursor = 0
        while cursor < len(item_indices):
            instance_start = cursor
            for slot, required_qty in zip(parts, quantities):
                allowed = {str(pid) for pid in slot}
                acc = 0
                while cursor < len(item_indices) and acc < required_qty:
                    idx = item_indices[cursor]
                    item = items[idx]
                    if str(item.product_id) not in allowed:
                        break
                    acc += _item_integer_quantity(item)
                    cursor += 1
                if acc != required_qty:
                    msg = (
                        "Monte uma unidade de cada item da promoção."
                        if required_qty == 1
                        else "Monte a quantidade exata de cada item da promoção."
                    )
                    raise OrderValidationError(msg)
            instances.append(list(item_indices[instance_start:cursor]))
        if not instances or cursor != len(item_indices):
            raise OrderValidationError("Composição de promoção inválida.")
        return instances

    selected: list[int] = []
    used: set[int] = set()
    for choices, required_qty in zip(parts, quantities):
        if not choices:
            raise OrderValidationError("Promoção incompleta.")
        allowed = {str(pid) for pid in choices}
        matches = [
            index for index, item in enumerate(items)
            if index not in used and str(item.product_id) in allowed
        ]
        total_qty = sum(_item_integer_quantity(items[i]) for i in matches) if matches else 0
        if not matches or total_qty != required_qty:
            msg = (
                "Monte uma unidade de cada item da promoção."
                if required_qty == 1
                else "Monte a quantidade exata de cada item da promoção."
            )
            raise OrderValidationError(msg)
        used.update(matches)
        selected.extend(matches)

    return [selected]


def _promotion_item_indices(
    validated: ValidatedOrderInput, promotion: dict, item_indices: tuple[int, ...] | None = None,
) -> list[int]:
    return [
        idx
        for instance in _promotion_item_instances(validated, promotion, item_indices)
        for idx in instance
    ]


def validate_exclusive_promotion_parts(
    exclusive_ids: set[str],
    promotion: dict | None,
    validated: ValidatedOrderInput,
    *, item_indices: tuple[int, ...] | None = None,
) -> None:
    """Protege SKUs exclusivos inclusive de pedidos forjados e itens extras."""
    if not exclusive_ids:
        return
    if (
        promotion is None
        or promotion_status(promotion) != "ativa"
        or not is_valid_promotion_structure(promotion)
    ):
        raise OrderValidationError("Item exclusivo disponível somente dentro de uma promoção ativa.")
    selected = _promotion_item_indices(validated, promotion, item_indices)
    if any(str(item.product_id) in exclusive_ids and index not in selected
           for index, item in enumerate(validated.items)):
        raise OrderValidationError("Item exclusivo não pertence à composição escolhida.")


def apply_promotion_to_validated(
    validated: ValidatedOrderInput,
    promotion: dict,
    *, exclusive_ids: set[str] | None = None, expected_price: Decimal | None = None,
    item_indices: tuple[int, ...] | None = None,
) -> ValidatedOrderInput:
    """Exige a quantidade configurada por slot; adicionais mantêm o preço original.

    O cliente nunca envia preço ou desconto. Apenas o id da promoção;
    o servidor revalida a política ativa no tenant da transação.
    """
    if promotion_status(promotion) != "ativa" or not is_valid_promotion_structure(promotion):
        raise OrderValidationError("Promoção indisponível.")
    items = list(validated.items)
    instances = _promotion_item_instances(validated, promotion, item_indices)
    promo_price = money(promotion["preco"])
    if expected_price is not None and money(expected_price) != promo_price:
        raise OrderValidationError("O preço desta oferta mudou. Atualize o cardápio e revise a promoção antes de confirmar.")

    gift_name = normalize_gift_name(promotion.get("brinde_nome"))
    is_compre_ganhe = normalize_promotion_type(promotion) == "compre_ganhe"

    for selected in instances:
        base_total = sum(
            (items[index].base_price * items[index].quantity for index in selected),
            Decimal("0.00"),
        ).quantize(Decimal("0.01"))
        if promo_price > base_total:
            # Preço próprio da oferta: atribuir a diferença a um componente real.
            # Preferir exclusivo mantém a referência histórica das quentinhas.
            surcharge_cents = _to_cents(promo_price - base_total)
            eligible = [index for index in selected
                        if str(items[index].product_id) in (exclusive_ids or set())]
            eligible_single = [index for index in eligible if _item_integer_quantity(items[index]) == 1]
            selected_single = [index for index in selected if _item_integer_quantity(items[index]) == 1]
            if eligible_single:
                target = eligible_single[0]
            elif eligible:
                target = eligible[0]
            elif selected_single:
                target = selected_single[0]
            else:
                target = selected[0]
            target_item = items[target]
            qty = _item_integer_quantity(target_item)
            base_cents = _to_cents(target_item.base_price)
            per_unit_cents, rem_cents = divmod(surcharge_cents, qty)
            if rem_cents == 0:
                items[target] = replace(
                    target_item,
                    base_price=_from_cents(base_cents + per_unit_cents),
                )
            else:
                items[target] = replace(
                    target_item,
                    quantity=Decimal(qty - rem_cents),
                    base_price=_from_cents(base_cents + per_unit_cents),
                )
                items.append(
                    replace(
                        target_item,
                        quantity=Decimal(rem_cents),
                        base_price=_from_cents(base_cents + per_unit_cents + 1),
                    )
                )
        elif promo_price < base_total:
            # Distribuição determinística entre componentes, nunca preço unitário negativo
            # e sempre com precisão exata em centavos.
            remainder_cents = _to_cents(base_total - promo_price)
            for index in selected:
                if remainder_cents == 0:
                    break
                item = items[index]
                qty = _item_integer_quantity(item)
                base_cents = _to_cents(item.base_price)
                line_cents = base_cents * qty
                apply_cents = min(remainder_cents, line_cents)
                if apply_cents == 0:
                    continue
                per_unit_cents, rem_cents = divmod(apply_cents, qty)
                if rem_cents == 0:
                    items[index] = replace(
                        item,
                        base_price=_from_cents(base_cents - per_unit_cents),
                    )
                else:
                    items[index] = replace(
                        item,
                        quantity=Decimal(qty - rem_cents),
                        base_price=_from_cents(base_cents - per_unit_cents),
                    )
                    items.append(
                        replace(
                            item,
                            quantity=Decimal(rem_cents),
                            base_price=_from_cents(base_cents - per_unit_cents - 1),
                        )
                    )
                remainder_cents -= apply_cents
            if remainder_cents:
                raise OrderValidationError("Preço promocional inválido.")

        if gift_name and is_compre_ganhe:
            primary = selected[0]
            items[primary] = replace(
                items[primary],
                notes=_append_gift_note(items[primary].notes, gift_name),
            )
    return replace(validated, items=tuple(items))
