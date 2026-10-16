"""Promoções simples por tenant, vinculadas a produtos reais.

Não cria SKUs paralelos. Montagem, estoque, impressão e idempotência continuam
na pipeline canônica de itens. O preço é redistribuído aos itens já validados.
"""
from __future__ import annotations

from dataclasses import replace
from decimal import Decimal, InvalidOperation
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


def active_promotions(config: Any, products: list[Any]) -> list[dict]:
    """Exibe somente ofertas ativas cujos componentes são vendáveis."""
    products_by_id = {str(product.id): product for product in products if product.ativo}
    visible: list[dict] = []
    for promotion in getattr(config, "promocoes", None) or []:
        if not promotion.get("ativo"):
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
    if promotion is None or not promotion.get("ativo"):
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
) -> ValidatedOrderInput:
    """Exige 1 unidade real por slot; adicionais mantêm o preço original.

    O cliente nunca envia preço ou desconto. Apenas o id da promoção;
    o servidor revalida a política ativa no tenant da transação.
    """
    parts = promotion.get("componentes") or []
    if not promotion.get("ativo") or len(parts) != 2:
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
    if promo_price > base_total:
        raise OrderValidationError("Promoção incompatível com os preços atuais.")
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
