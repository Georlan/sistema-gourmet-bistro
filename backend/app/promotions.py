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
        parts = promotion.get("componentes") or []
        if len(parts) != 2 or any(
            not isinstance(ids, list) or not ids or
            not any(str(identifier) in products_by_id for identifier in ids)
            for ids in parts
        ):
            continue
        visible.append({
            "id": promotion["id"],
            "nome": promotion["nome"],
            "descricao": promotion.get("descricao", ""),
            "preco": float(money(promotion["preco"])),
            "componentes": parts,
            "inicio_em": promotion.get("inicio_em"),
            "fim_em": promotion.get("fim_em"),
        })
    return visible


def validate_exclusive_promotion_parts(
    exclusive_ids: set[str],
    promotion: dict | None,
    validated: ValidatedOrderInput,
) -> None:
    """Protege SKUs exclusivos inclusive de pedidos forjados e itens extras."""
    if not exclusive_ids:
        return
    if promotion is None or promotion_status(promotion) != "ativa":
        raise OrderValidationError("Item exclusivo disponível somente dentro de uma promoção ativa.")
    selected: set[str] = set()
    for slot in promotion.get("componentes") or []:
        matching = [
            str(item.product_id) for item in validated.items
            if str(item.product_id) in {str(pid) for pid in slot}
        ]
        if len(matching) != 1 or matching[0] in selected:
            raise OrderValidationError("Promoção precisa de um produto válido em cada etapa.")
        selected.add(matching[0])
    if not exclusive_ids.issubset(selected):
        raise OrderValidationError("Item exclusivo não pertence à composição escolhida.")


def apply_promotion_to_validated(
    validated: ValidatedOrderInput,
    promotion: dict,
    *, exclusive_ids: set[str] | None = None, expected_price: Decimal | None = None,
) -> ValidatedOrderInput:
    """Exige 1 unidade real por slot; adicionais mantêm o preço original.

    O cliente nunca envia preço ou desconto. Apenas o id da promoção;
    o servidor revalida a política ativa no tenant da transação.
    """
    parts = promotion.get("componentes") or []
    if promotion_status(promotion) != "ativa" or len(parts) != 2:
        raise OrderValidationError("Promoção indisponível.")
    items = list(validated.items)
    selected: list[int] = []
    for choices in parts:
        if not choices:
            raise OrderValidationError("Promoção incompleta.")
        matches = [
            index for index, item in enumerate(items)
            if str(item.product_id) in {str(pid) for pid in choices}
        ]
        if len(matches) != 1 or matches[0] in selected or items[matches[0]].quantity != 1:
            raise OrderValidationError("Monte uma unidade de cada item da promoção.")
        selected.append(matches[0])

    base_total = sum((items[index].base_price for index in selected), Decimal("0.00"))
    promo_price = money(promotion["preco"])
    if expected_price is not None and money(expected_price) != promo_price:
        raise OrderValidationError("O preço desta oferta mudou. Atualize o cardápio e revise a promoção antes de confirmar.")
    if promo_price > base_total:
        # Preço próprio da oferta: atribuir a diferença a um componente real.
        # Preferir exclusivo mantém a referência histórica das quentinhas.
        eligible = [index for index in selected
                    if str(items[index].product_id) in (exclusive_ids or set())]
        target = eligible[0] if eligible else selected[0]
        items[target] = replace(
            items[target],
            base_price=items[target].base_price + promo_price - base_total,
        )
        return replace(validated, items=tuple(items))
    # Distribuir a diferença em um item real mantém estoque e comanda canônicos.
    discount = base_total - promo_price
    first = selected[0]
    if discount > items[first].base_price:
        # Distribuição determinística entre componentes, nunca preço unitário negativo.
        remainder = discount
        for index in selected:
            part = min(remainder, items[index].base_price)
            items[index] = replace(items[index], base_price=items[index].base_price - part)
            remainder -= part
            if remainder == 0:
                break
        if remainder:
            raise OrderValidationError("Preço promocional inválido.")
    else:
        items[first] = replace(items[first], base_price=items[first].base_price - discount)
    return replace(validated, items=tuple(items))
