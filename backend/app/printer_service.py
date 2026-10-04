import datetime
import textwrap
from typing import Optional

from .config import settings
from .timezone_utils import get_operational_now, to_operational_local_time


def align_left(text: str, width: int) -> str:
    return text.ljust(width)[:width]


def align_right(text: str, width: int) -> str:
    return text.rjust(width)[:width]


def align_center(text: str, width: int) -> str:
    return text.center(width)[:width]


def split_justified(left_text: str, right_text: str, width: int) -> str:
    available = width - len(right_text)
    if available <= 0:
        return (left_text + right_text)[:width]
    return left_text.ljust(available)[:available] + right_text


def draw_separator(char: str = "-", width: int = 40) -> str:
    return char * width


ESC_FONT_A = "\x1bM\x00"
ESC_FONT_B = "\x1bM\x01"
ESC_BOLD_ON = "\x1bE\x01"
ESC_BOLD_OFF = "\x1bE\x00"
ESC_DOUBLE_HEIGHT_ON = "\x1b!\x10"
ESC_NORMAL_SIZE = "\x1b!\x00"
ESC_TIGHT_LINE = "\x1b3\x18"
# Mantém a fonte A no tamanho normal e aumenta somente o avanço vertical.
# 32 dots deixam a comanda mais longa e legível sem ampliar os caracteres.
ESC_RECEIPT_LINE = "\x1b3\x20"


def _single_line(value: object) -> str:
    return " ".join(str(value or "").replace("\x00", "").split())


def _format_brl(value: float) -> str:
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _order_type_label(tipo: object, mesa_id: Optional[int]) -> str:
    raw = _single_line(tipo)
    normalized = raw.casefold()
    if any(term in normalized for term in ("delivery", "entrega")):
        return "DELIVERY"
    if any(term in normalized for term in ("retir", "viagem", "balc")):
        return "RETIRADA"
    if mesa_id is not None or any(
        term in normalized for term in ("mesa", "local", "consumo", "salão", "salao")
    ):
        return "CONSUMO NO LOCAL"
    return raw.upper() or "CONSUMO NO LOCAL"


def _is_general_client(value: object) -> bool:
    return _single_line(value).casefold() in {"", "geral", "consumo geral"}


def _append_wrapped(lines: list[str], text: str, width: int, prefix: str = "") -> None:
    available = max(width - len(prefix), 1)
    wrapped = textwrap.wrap(
        _single_line(text),
        width=available,
        break_long_words=True,
        break_on_hyphens=False,
    ) or [""]
    lines.append(prefix + wrapped[0])
    continuation_prefix = " " * len(prefix)
    lines.extend(continuation_prefix + part for part in wrapped[1:])


def _append_wrapped_in_font(
    lines: list[str],
    text: str,
    width: int,
    prefix: str,
    font: str,
    restore_font: str = ESC_FONT_A,
) -> None:
    wrapped_lines: list[str] = []
    _append_wrapped(wrapped_lines, text, width, prefix)
    wrapped_lines[0] = font + wrapped_lines[0]
    wrapped_lines[-1] += restore_font
    lines.extend(wrapped_lines)


def _printable_product_name(code: str, name: str) -> str:
    clean_name = _single_line(name)
    clean_code = _single_line(code)
    if not clean_code:
        return clean_name
    normalized_name = clean_name.casefold()
    for prefix in (
        f"{clean_code} - ",
        f"{clean_code}-",
        f"[{clean_code}] ",
        f"[{clean_code}]",
    ):
        if normalized_name.startswith(prefix.casefold()):
            return clean_name[len(prefix):].lstrip()
    return clean_name


def _append_amount_line(lines: list[str], left: str, right: str, width: int) -> None:
    max_left = max(width - len(right) - 1, 1)
    wrapped = textwrap.wrap(
        _single_line(left),
        width=max_left,
        break_long_words=True,
        break_on_hyphens=False,
    ) or [""]
    lines.append(split_justified(wrapped[0], right, width))
    for continuation in wrapped[1:]:
        lines.append(f"   {continuation}"[:width])


def _append_bold_amount_line(lines: list[str], left: str, right: str, width: int) -> None:
    first_line = len(lines)
    _append_amount_line(lines, left, right, width)
    lines[first_line] = ESC_BOLD_ON + lines[first_line]
    lines[-1] += ESC_BOLD_OFF


def _append_bold_wrapped(
    lines: list[str],
    text: str,
    width: int,
    prefix: str = "",
) -> None:
    first_line = len(lines)
    _append_wrapped(lines, text, width, prefix)
    lines[first_line] = ESC_BOLD_ON + lines[first_line]
    lines[-1] += ESC_BOLD_OFF


def _append_composition_group(
    lines: list[str],
    text: str,
    width: int,
    prefix: str = "   ",
) -> None:
    """Destaca a linha do grupo sem quebrar o texto visível com comandos ESC/POS."""
    clean = _single_line(text).upper()
    _append_bold_wrapped(lines, clean, width, prefix)


def _critical_center(text: str, width: int) -> str:
    return (
        ESC_DOUBLE_HEIGHT_ON
        + ESC_BOLD_ON
        + align_center(text, width)
        + ESC_BOLD_OFF
        + ESC_NORMAL_SIZE
    )


def _payment_method_label_for_print(value: object) -> Optional[str]:
    raw = _single_line(value)
    if not raw:
        return None
    normalized = " ".join(raw.lower().replace("_", " ").replace("-", " ").split())
    return {
        "pix": "PIX",
        "dinheiro": "DINHEIRO",
        "cartao credito": "CARTÃO DE CRÉDITO",
        "cartao de credito": "CARTÃO DE CRÉDITO",
        "credito": "CARTÃO DE CRÉDITO",
        "cartao debito": "CARTÃO DE DÉBITO",
        "cartao de debito": "CARTÃO DE DÉBITO",
        "debito": "CARTÃO DE DÉBITO",
    }.get(normalized, raw.upper())


def _delivery_ticket_total(comanda) -> float:
    items_total = sum(
        float(getattr(item, "preco_unit", 0.0) or 0.0)
        for item in getattr(comanda, "itens", [])
        if getattr(item, "status", None) != "cancelado"
    )
    delivery_fee = max(float(getattr(comanda, "delivery_taxa", 0.0) or 0.0), 0.0)
    discounts = max(
        float(getattr(comanda, "valor_desconto_cupom", 0.0) or 0.0)
        + float(getattr(comanda, "valor_desconto_cashback", 0.0) or 0.0),
        0.0,
    )
    return max(items_total + delivery_fee - discounts, 0.0)


def _append_delivery_address(
    lines: list[str],
    comanda,
    width: int,
    address_snapshot: Optional[dict] = None,
) -> None:
    lines.append(ESC_BOLD_ON + align_center("ENDEREÇO DE ENTREGA", width) + ESC_BOLD_OFF)

    snapshot = address_snapshot or {}
    street = _single_line(snapshot.get("logradouro"))
    number = _single_line(snapshot.get("numero"))
    if street or number:
        main = ", ".join(part for part in (street, number) if part)
        _append_bold_wrapped(lines, main.upper(), width)

        complement = _single_line(snapshot.get("complemento"))
        neighborhood = _single_line(snapshot.get("bairro"))
        city = _single_line(snapshot.get("cidade"))
        state = _single_line(snapshot.get("uf")).upper()
        postal_code = "".join(
            char for char in str(snapshot.get("cep") or "") if char.isdigit()
        )
        reference = _single_line(snapshot.get("referencia"))

        if complement:
            _append_wrapped(lines, f"COMPLEMENTO: {complement}".upper(), width)
        if neighborhood:
            _append_wrapped(lines, f"BAIRRO: {neighborhood}".upper(), width)
        if city or state:
            place = " / ".join(part for part in (city, state) if part)
            _append_wrapped(lines, f"CIDADE: {place}".upper(), width)
        if len(postal_code) == 8:
            postal_code = f"{postal_code[:5]}-{postal_code[5:]}"
        if postal_code:
            lines.append(f"CEP: {postal_code}")
        if reference:
            _append_bold_wrapped(lines, f"REF.: {reference}".upper(), width)
        return

    legacy_address = _single_line(getattr(comanda, "delivery_endereco", None)) or "NÃO INFORMADO"
    _append_bold_wrapped(lines, legacy_address.upper(), width)
    neighborhood = _single_line(getattr(comanda, "delivery_bairro", None))
    if neighborhood and neighborhood.casefold() not in legacy_address.casefold():
        _append_wrapped(lines, f"BAIRRO: {neighborhood}".upper(), width)


def _delivery_payment_lines(comanda, *, total: float, width: int) -> list[str]:
    amount_paid = max(float(getattr(comanda, "valor_pago", 0.0) or 0.0), 0.0)
    amount_due = max(float(total) - amount_paid, 0.0)
    online_paid = (
        _single_line(getattr(comanda, "online_payment_status", None)).casefold()
        == "approved"
    )
    fully_paid = online_paid or bool(getattr(comanda, "fechada", False)) or amount_due < 0.01
    method = _payment_method_label_for_print(
        getattr(comanda, "delivery_forma_pagamento", None)
    )

    block = [ESC_BOLD_ON + align_center("PAGAMENTO", width) + ESC_BOLD_OFF]
    if fully_paid:
        if method:
            block.append(ESC_BOLD_ON + f"FORMA: {method}" + ESC_BOLD_OFF)
        block.append(_critical_center("PAGO ONLINE" if online_paid else "PAGO", width))
        block.append(_critical_center("NÃO COBRAR", width))
        return block

    block.append(_critical_center(f"COBRAR {_format_brl(amount_due)}", width))
    if method:
        block.append(ESC_BOLD_ON + f"FORMA: {method}" + ESC_BOLD_OFF)

    change_for = getattr(comanda, "delivery_troco_para", None)
    if change_for is not None and float(change_for or 0.0) > 0:
        change_for_value = float(change_for)
        block.append(
            ESC_BOLD_ON
            + f"TROCO PARA: {_format_brl(change_for_value)}"
            + ESC_BOLD_OFF
        )
        change_to_take = max(change_for_value - amount_due, 0.0)
        if change_to_take >= 0.01:
            block.append(
                ESC_BOLD_ON
                + f"LEVAR TROCO: {_format_brl(change_to_take)}"
                + ESC_BOLD_OFF
            )
    return block


def safe_get(obj, key, default=""):
    if obj is None:
        return default
    if isinstance(obj, dict):
        val = obj.get(key, default)
        return val if val is not None else default
    val = getattr(obj, key, default)
    return val if val is not None else default


def _resolve_missing_product_prices(items: list) -> dict[str, float]:
    missing_codes = {
        _single_line(
            safe_get(item, "codigo")
            or safe_get(safe_get(item, "produto"), "id")
        )
        for item in items
        if not (safe_get(item, "preco_unit") or safe_get(item, "preco"))
    }
    missing_codes.discard("")
    if not missing_codes:
        return {}

    db = None
    try:
        from .database import SessionLocal, current_restaurante_id
        from .models import Produto

        restaurante_id = current_restaurante_id.get()
        if not restaurante_id:
            return {}
        db = SessionLocal(restaurante_id=restaurante_id)
        rows = db.query(Produto.id, Produto.preco).filter(
            Produto.restaurante_id == restaurante_id,
            Produto.id.in_(missing_codes),
        ).all()
        return {str(product_id): float(price or 0.0) for product_id, price in rows}
    except Exception:
        return {}
    finally:
        if db is not None:
            db.close()


def _resolve_service_charge_settings() -> tuple[bool, float]:
    db = None
    try:
        from .database import SessionLocal, current_restaurante_id
        from .models import ConfiguracaoRestaurante

        restaurante_id = current_restaurante_id.get()
        if not restaurante_id:
            return False, 10.0
        db = SessionLocal(restaurante_id=restaurante_id)
        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == restaurante_id
        ).first()
        if config is None:
            return False, 10.0
        return bool(config.taxa_servico_ativa), float(config.taxa_servico_padrao or 10.0)
    except Exception:
        return False, 10.0
    finally:
        if db is not None:
            db.close()


def _load_open_table_receipt_items(mesa_id: object) -> list[dict]:
    """Carrega o snapshot financeiro atual da mesa para a mesma via canônica."""
    if mesa_id is None:
        return []

    mesa_lookup = mesa_id
    try:
        raw_mesa = str(mesa_id).strip()
        if raw_mesa.isdigit():
            mesa_lookup = int(raw_mesa)
    except Exception:
        mesa_lookup = mesa_id

    db = None
    try:
        from sqlalchemy.orm import joinedload

        from .database import SessionLocal, current_restaurante_id
        from .models import Comanda, Item

        restaurante_id = current_restaurante_id.get()
        if not restaurante_id:
            return []

        db = SessionLocal(restaurante_id=restaurante_id)
        rows = (
            db.query(Item)
            .join(Comanda, Comanda.id == Item.comanda_id)
            .options(joinedload(Item.produto))
            .filter(
                Item.restaurante_id == restaurante_id,
                Comanda.restaurante_id == restaurante_id,
                Comanda.mesa_id == mesa_lookup,
                Comanda.fechada == False,
                Item.status != "cancelado",
            )
            .order_by(Comanda.criado_em.asc(), Item.id.asc())
            .all()
        )
        result = []
        for item in rows:
            if item.produto is None:
                continue
            result.append(
                {
                    "codigo": str(item.produto_id or item.produto.id),
                    "produto": {
                        "id": str(item.produto_id or item.produto.id),
                        "nome": item.produto.nome,
                    },
                    "preco_unit": float(item.preco_unit or 0.0),
                    "status": item.status or "preparando",
                    "cliente_nome": item.cliente_nome or "Consumo Geral",
                    "observacao": item.observacao or "",
                    "quantidade": 1,
                }
            )
        return result
    except Exception:
        return []
    finally:
        if db is not None:
            db.close()


def format_item_line(name: str, qty: int, price_unit: float, width: int = 40) -> str:
    qty_str = f"{qty}x"
    price_str = f"{price_unit:.2f}"
    total_str = f"{(qty * price_unit):.2f}"
    name_lines = textwrap.wrap(name, width=21)
    first_name = name_lines[0] if name_lines else ""
    line = first_name.ljust(21) + qty_str.rjust(4) + price_str.rjust(7) + total_str.rjust(8)
    for extra in name_lines[1:]:
        line += "\n" + extra.ljust(21)
    return line


def format_kitchen_item(
    qty: int,
    name: str,
    observation: str = "",
    client_name: str = "",
    width: int = 40,
    preco_unit: float = 0.0,
) -> str:
    qty_str = f"{qty}x"
    if preco_unit > 0:
        total = qty * preco_unit
        price_col = f"R${total:.2f}"
        name_width = width - len(qty_str) - 1 - len(price_col) - 1
        header = f"{qty_str} {name[:name_width].ljust(name_width)} {price_col}"
    else:
        header = f"{qty_str} {name}"
    if observation:
        obs_clean = observation.replace("\n", " | ").replace(", ", " | ")
        obs_lines = textwrap.wrap(f"  * {obs_clean}", width=width)
        return header + "\n" + "\n".join(obs_lines)
    return header


class PrinterService:
    """Fonte única dos layouts térmicos legados do Kôma."""

    def __init__(self):
        self.width = settings.PRINTER_WIDTH

    def generate_kitchen_ticket(
        self,
        num_pedido: int,
        tipo: str,
        mesa_id: Optional[int],
        garcom_nome: str,
        items: list,
        is_reprint: bool = False,
        restaurant_name: Optional[str] = None,
        restaurant_name_position: str = "cabecalho",
        print_footer: Optional[str] = None,
        source_committed: bool = False,
    ) -> str:
        """Compatibilidade com os fluxos antigos de produção.

        Consumo no Local não possui layout próprio: o payload é adaptado e
        encaminhado ao mesmo generate_receipt usado por Extrato Completo.
        Assim impressão automática, caixa e reimpressão têm uma única fonte
        visual. is_reprint não altera a aparência da via de mesa.
        """
        order_type = _order_type_label(tipo, mesa_id)
        resolved_prices = _resolve_missing_product_prices(items)

        if order_type == "CONSUMO NO LOCAL":
            taxa_servico_ativa, taxa_servico_padrao = _resolve_service_charge_settings()
            receipt_items = []
            for item in items:
                if safe_get(item, "status") == "cancelado":
                    continue
                produto = safe_get(item, "produto")
                codigo = _single_line(
                    safe_get(item, "codigo") or safe_get(produto, "id")
                )
                nome = _single_line(
                    safe_get(item, "nome") or safe_get(produto, "nome")
                )
                preco_unit = float(
                    safe_get(item, "preco_unit")
                    or safe_get(item, "preco")
                    or resolved_prices.get(codigo, 0.0)
                    or 0.0
                )
                receipt_items.append(
                    {
                        "codigo": codigo,
                        "produto": {"id": codigo, "nome": nome},
                        "preco_unit": preco_unit,
                        "status": safe_get(item, "status") or "preparando",
                        "cliente_nome": (
                            safe_get(item, "cliente_nome")
                            or safe_get(item, "cliente_nome_custom")
                            or "Consumo Geral"
                        ),
                        "observacao": safe_get(item, "observacao") or "",
                        "quantidade": max(int(safe_get(item, "quantidade") or 1), 1),
                    }
                )

            table_snapshot = _load_open_table_receipt_items(mesa_id)
            if table_snapshot:
                receipt_items = (
                    table_snapshot
                    if is_reprint or source_committed
                    else table_snapshot + receipt_items
                )

            return self.generate_receipt(
                num_pedido=num_pedido,
                tipo=tipo,
                mesa_id=mesa_id,
                garcom_nome=garcom_nome,
                comandas_details=[{"identificador": "Consumo Geral", "itens": receipt_items}],
                print_header=restaurant_name,
                print_footer=print_footer,
                taxa_servico_ativa=taxa_servico_ativa,
                taxa_servico_padrao=taxa_servico_padrao,
                apenas_valores=False,
                restaurant_name_position=restaurant_name_position,
            )

        width = self.width
        lines: list[str] = [ESC_TIGHT_LINE + ESC_FONT_A, draw_separator("=", width)]
        position = (
            restaurant_name_position
            if restaurant_name_position in {"cabecalho", "rodape", "oculto"}
            else "cabecalho"
        )
        brand = _single_line(restaurant_name or "KÔMA GOURMET BISTRÔ")
        now = get_operational_now()

        if position == "cabecalho" and brand:
            lines.append(ESC_BOLD_ON + align_center(brand.upper(), width) + ESC_BOLD_OFF)
            lines.append(draw_separator("=", width))
        lines.append(ESC_BOLD_ON + align_center(order_type, width) + ESC_BOLD_OFF)
        if is_reprint:
            lines.append(ESC_BOLD_ON + align_center("REIMPRESSÃO", width) + ESC_BOLD_OFF)
        lines.append(draw_separator("=", width))
        mesa_str = f"MESA: {mesa_id}" if mesa_id is not None else "SEM MESA"
        lines.append(
            ESC_BOLD_ON
            + split_justified(f"PEDIDO: #{num_pedido}", mesa_str, width)
            + ESC_BOLD_OFF
        )
        lines.append(
            split_justified(
                f"DATA: {now.strftime('%d/%m/%Y')}",
                f"HORA: {now.strftime('%H:%M')}",
                width,
            )
        )
        lines.append(f"GARÇOM: {_single_line(garcom_nome or 'CAIXA').upper()}")
        lines.append(draw_separator("-", width))

        grouped: dict[str, dict] = {}
        for item in items:
            if safe_get(item, "status") == "cancelado":
                continue
            produto = safe_get(item, "produto")
            codigo = _single_line(safe_get(item, "codigo") or safe_get(produto, "id"))
            nome = _single_line(safe_get(item, "nome") or safe_get(produto, "nome"))
            observacao = _single_line(safe_get(item, "observacao"))
            composition = tuple(safe_get(item, "composicao", ()))
            modifier_signature = tuple(safe_get(item, "modifier_signature", ()))
            cliente = _single_line(
                safe_get(item, "cliente_nome")
                or safe_get(item, "cliente_nome_custom")
                or "Consumo Geral"
            ) or "Consumo Geral"
            quantidade = max(int(safe_get(item, "quantidade") or 1), 1)
            preco_unit = float(
                safe_get(item, "preco_unit")
                or safe_get(item, "preco")
                or resolved_prices.get(codigo, 0.0)
                or 0.0
            )
            group = grouped.setdefault(cliente.casefold(), {"label": cliente, "items": {}})
            key = (codigo, nome, observacao, preco_unit, composition, modifier_signature)
            group["items"][key] = group["items"].get(key, 0) + quantidade

        for index, group in enumerate(grouped.values()):
            if index:
                lines.append(draw_separator("-", width))
            if not _is_general_client(group["label"]):
                lines.append(
                    ESC_BOLD_ON
                    + align_center(f"CLIENTE: {group['label'].upper()}", width)
                    + ESC_BOLD_OFF
                )
            for (codigo, nome, observacao, preco_unit, composition, _signature), quantidade in group["items"].items():
                _append_bold_amount_line(
                    lines,
                    f"{quantidade}x {_printable_product_name(codigo, nome).upper()}",
                    _format_brl(quantidade * preco_unit),
                    width,
                )
                for composition_line in composition:
                    _append_wrapped(lines, composition_line.upper(), width, "   ")
                if observacao:
                    _append_wrapped_in_font(
                        lines, observacao.upper(), width, "   OBS: ", ESC_FONT_A
                    )
                lines.append("")

        lines.append(draw_separator("-", width))
        if print_footer:
            _append_wrapped(lines, print_footer, width)
        if position == "rodape" and brand:
            lines.append(ESC_BOLD_ON + align_center(brand.upper(), width) + ESC_BOLD_OFF)
        lines.append(align_center("Gerenciado por Kôma", width))
        lines.append(align_center("Documento não fiscal", width))
        return "\n".join(lines)

    def generate_receipt(
        self,
        num_pedido: int,
        tipo: str,
        mesa_id: Optional[int],
        garcom_nome: str,
        comandas_details: list,
        opened_at: Optional[datetime.datetime] = None,
        print_header: Optional[str] = None,
        print_footer: Optional[str] = None,
        taxa_servico_ativa: bool = True,
        taxa_servico_padrao: float = 10.0,
        apenas_valores: bool = False,
        restaurant_name_position: str = "cabecalho",
        production_hierarchy: bool = False,
    ) -> str:
        """Renderizador canônico de mesa.

        apenas_valores=False é o modelo de Extrato Completo e também a origem
        de toda via automática/reimpressão de Consumo no Local.
        apenas_valores=True mantém o modelo FECHAMENTO.
        """
        width = self.width
        # Comandas de cliente usam a mesma fonte de antes, mas com entrelinha
        # confortável. Este renderizador é compartilhado por garçom, Caixa,
        # reimpressão e pedidos locais originados na Maquininha.
        lines: list[str] = [ESC_RECEIPT_LINE + ESC_FONT_A]
        position = (
            restaurant_name_position
            if restaurant_name_position in {"cabecalho", "rodape", "oculto"}
            else "cabecalho"
        )
        header_text = _single_line(print_header or "KÔMA GOURMET BISTRÔ")

        lines.append(draw_separator("=", width))
        now = get_operational_now()
        if apenas_valores and mesa_id is not None:
            opening_time = opened_at or now
            if isinstance(opening_time, datetime.datetime) and opening_time.tzinfo is not None:
                opening_time = to_operational_local_time(opening_time)
            opening_str = (
                opening_time.strftime("%H:%M")
                if isinstance(opening_time, (datetime.datetime, datetime.date))
                else str(opening_time)[:5]
            )
            lines.append(ESC_BOLD_ON + align_center("FECHAMENTO", width) + ESC_BOLD_OFF)
            lines.append(draw_separator("=", width))
            lines.append(
                ESC_BOLD_ON
                + split_justified(f"MESA: {mesa_id}", f"ABERTURA: {opening_str}", width)
                + ESC_BOLD_OFF
            )
            lines.append(draw_separator("=", width))
            lines.append("")
        else:
            if position == "cabecalho" and header_text:
                lines.append(
                    ESC_BOLD_ON + align_center(header_text.upper(), width) + ESC_BOLD_OFF
                )
                lines.append(draw_separator("=", width))
            order_type = _order_type_label(tipo, mesa_id)
            lines.append(ESC_BOLD_ON + align_center(order_type, width) + ESC_BOLD_OFF)
            lines.append(draw_separator("=", width))
            mesa_str = f"MESA: {mesa_id}" if mesa_id is not None else "SEM MESA"
            lines.append(
                ESC_BOLD_ON
                + split_justified(f"PEDIDO: #{num_pedido}", mesa_str, width)
                + ESC_BOLD_OFF
            )
            lines.append(
                split_justified(
                    f"DATA: {now.strftime('%d/%m/%Y')}",
                    f"HORA: {now.strftime('%H:%M')}",
                    width,
                )
            )
            lines.append(f"GARÇOM: {_single_line(garcom_nome)}")
            lines.append(draw_separator("-", width))
            lines.append("")

        lines.append(ESC_BOLD_ON + "ITENS" + ESC_BOLD_OFF)
        lines.append("")

        grouped_by_client: dict[str, dict] = {}
        for comanda in comandas_details:
            for item in comanda.get("itens", []):
                if item.get("status") == "cancelado":
                    continue
                client = (
                    item.get("cliente_nome")
                    or item.get("cliente_nome_custom")
                    or comanda.get("identificador")
                    or "Consumo Geral"
                )
                client = _single_line(client) or "Consumo Geral"
                group = grouped_by_client.setdefault(
                    client.casefold(), {"label": client, "items": []}
                )
                group["items"].append(item)

        has_named_client = any(
            not _is_general_client(group["label"])
            for group in grouped_by_client.values()
        )
        grand_total = 0.0

        for group in grouped_by_client.values():
            client = group["label"]
            is_general = _is_general_client(client)
            if not is_general:
                lines.append(
                    ESC_BOLD_ON
                    + align_center(f"CLIENTE: {client.upper()}", width)
                    + ESC_BOLD_OFF
                )

            grouped_items: dict[tuple, int] = {}
            for item in group["items"]:
                produto = item["produto"]
                product_name = _single_line(produto["nome"])
                product_code = _single_line(item.get("codigo") or produto.get("id"))
                observation = "" if apenas_valores else _single_line(item.get("observacao"))
                composition = () if apenas_valores else tuple(item.get("composicao") or ())
                modifier_signature = tuple(item.get("modifier_signature") or ())
                key = (product_code, product_name, float(item["preco_unit"]), observation, composition, modifier_signature)
                qty = max(int(item.get("quantidade") or 1), 1)
                grouped_items[key] = grouped_items.get(key, 0) + qty

            client_subtotal = 0.0
            for (product_code, product_name, unit_price, observation, composition, _signature), qty in grouped_items.items():
                item_total = qty * unit_price
                client_subtotal += item_total
                item_label = (
                    f"{qty}x {_printable_product_name(product_code, product_name).upper()}"
                )
                if production_hierarchy:
                    _append_bold_wrapped(lines, item_label, width)
                else:
                    _append_bold_amount_line(
                        lines,
                        item_label,
                        _format_brl(item_total),
                        width,
                    )
                for composition_index, composition_line in enumerate(composition):
                    if production_hierarchy:
                        if composition_index:
                            lines.append("")
                        _append_composition_group(
                            lines,
                            composition_line,
                            width,
                            "   ",
                        )
                    else:
                        _append_wrapped(lines, composition_line.upper(), width, "   ")
                if not apenas_valores and observation:
                    _append_wrapped_in_font(
                        lines, observation.upper(), width, "   OBS: ", ESC_FONT_A
                    )
                lines.append("")

            grand_total += client_subtotal
            lines.append(draw_separator("-", width))
            if is_general and not has_named_client:
                continue

            subtotal_label = (
                "SUBTOTAL CONSUMO GERAL"
                if is_general
                else f"SUBTOTAL {client.upper()}"
            )
            _append_amount_line(lines, subtotal_label, _format_brl(client_subtotal), width)
            lines.append(draw_separator("-", width))
            lines.append("")

        if taxa_servico_ativa:
            service_charge = grand_total * (taxa_servico_padrao / 100.0)
            final_total = grand_total + service_charge
            lines.append(
                split_justified("SUBTOTAL CONSUMO:", _format_brl(grand_total), width)
            )
            lines.append(
                split_justified(
                    f"TAXA DE SERVIÇO ({taxa_servico_padrao:g}%):",
                    _format_brl(service_charge),
                    width,
                )
            )
            lines.append(draw_separator("-", width))
        else:
            final_total = grand_total

        if lines and lines[-1] != "":
            lines.append("")
        lines.append(
            ESC_BOLD_ON
            + split_justified(
                "TOTAL GERAL DA MESA:", _format_brl(final_total), width
            )
            + ESC_BOLD_OFF
        )
        lines.append(draw_separator("=", width))
        lines.append("")
        lines.append(align_center("Gerenciado por Kôma", width))
        if print_footer:
            _append_wrapped(lines, print_footer, width)
        if not apenas_valores and position == "rodape" and header_text:
            lines.append(
                ESC_BOLD_ON + align_center(header_text.upper(), width) + ESC_BOLD_OFF
            )
        lines.append(align_center("Documento não fiscal", width))
        lines.append("")
        return "\n".join(lines)

    def _generate_delivery_courier_ticket(
        self,
        comanda,
        motoboy_nome: str,
        *,
        address_snapshot: Optional[dict] = None,
    ) -> str:
        width = self.width
        total = _delivery_ticket_total(comanda)
        now = get_operational_now()
        customer = (
            _single_line(getattr(comanda, "identificador", None)).upper()
            or "NÃO INFORMADO"
        )

        lines = [
            ESC_RECEIPT_LINE + ESC_FONT_A,
            draw_separator("=", width),
            _critical_center("ENTREGA", width),
            _critical_center(f"PEDIDO #{comanda.numero_pedido}", width),
            draw_separator("=", width),
            ESC_BOLD_ON + f"CLIENTE: {customer}" + ESC_BOLD_OFF,
            f"TELEFONE: {format_phone_for_print(comanda.delivery_telefone)}",
            draw_separator("-", width),
        ]

        _append_delivery_address(
            lines,
            comanda,
            width,
            address_snapshot=address_snapshot,
        )
        lines.append(draw_separator("-", width))
        lines.extend(_delivery_payment_lines(comanda, total=total, width=width))
        lines.append(draw_separator("-", width))

        lines.append(ESC_BOLD_ON + "ITENS" + ESC_BOLD_OFF)
        for item in getattr(comanda, "itens", []):
            if getattr(item, "status", None) == "cancelado":
                continue
            lines.append(
                format_kitchen_item(
                    1,
                    item.produto.nome,
                    item.observacao or "",
                    item.cliente_nome or "",
                    width,
                )
            )

        lines.extend(
            [
                draw_separator("-", width),
                ESC_BOLD_ON + f"MOTOBOY: {motoboy_nome.upper()}" + ESC_BOLD_OFF,
                f"DATA: {now.strftime('%d/%m/%Y %H:%M')}",
                draw_separator("=", width),
                align_center("Gerenciado por Kôma", width),
                align_center("Documento não fiscal", width),
            ]
        )
        return "\n".join(lines)

    def generate_delivery_unified_ticket(
        self,
        comanda,
        motoboy_nome: str,
        *,
        address_snapshot: Optional[dict] = None,
    ) -> str:
        return self._generate_delivery_courier_ticket(
            comanda,
            motoboy_nome,
            address_snapshot=address_snapshot,
        )

    def generate_delivery_kitchen_ticket(self, comanda) -> str:
        width = self.width
        lines = [
            ESC_RECEIPT_LINE + ESC_FONT_A,
            draw_separator("=", width),
            ESC_BOLD_ON + align_center("VIA COZINHA - DELIVERY", width) + ESC_BOLD_OFF,
            draw_separator("=", width),
        ]
        lines.append(
            ESC_BOLD_ON
            + f"PEDIDO #{comanda.numero_pedido} | ENTREGA"
            + ESC_BOLD_OFF
        )
        lines.append(
            f"CLIENTE: {comanda.identificador.upper() if comanda.identificador else 'NÃO INFORMADO'}"
        )
        lines.append(f"DATA: {get_operational_now().strftime('%d/%m/%Y %H:%M')}")
        lines.append(draw_separator("-", width))
        for item in comanda.itens:
            if item.status != "cancelado":
                lines.append(
                    format_kitchen_item(
                        1,
                        item.produto.nome,
                        item.observacao or "",
                        item.cliente_nome or "",
                        width,
                    )
                )
        lines.append(draw_separator("=", width))
        return "\n".join(lines)

    def generate_delivery_motoboy_ticket(
        self,
        comanda,
        motoboy_nome: str,
        *,
        address_snapshot: Optional[dict] = None,
    ) -> str:
        return self._generate_delivery_courier_ticket(
            comanda,
            motoboy_nome,
            address_snapshot=address_snapshot,
        )


def format_phone_for_print(phone: Optional[str]) -> str:
    """Formata o telefone completo para documentos operacionais autorizados.

    A proteção de PII acontece no controle de acesso ao pedido/documento, não por
    truncamento do contato necessário ao atendimento. Aceita números brasileiros
    com ou sem DDI 55 e preserva entradas não padronizadas sem inventar dígitos.
    """
    if not phone:
        return "NÃO INFORMADO"
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) in {12, 13} and digits.startswith("55"):
        digits = digits[2:]
    if len(digits) == 11:
        return f"({digits[:2]}) {digits[2:7]}-{digits[7:]}"
    if len(digits) == 10:
        return f"({digits[:2]}) {digits[2:6]}-{digits[6:]}"
    return digits or "NÃO INFORMADO"


printer_service = PrinterService()
