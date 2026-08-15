from typing import Union, Dict, List, Optional, Any
from .types import PrintDocumentType, PaperWidth, PrintDestination
from .models import PrintItem, OrderPrintData, CommandPrintData, DeliveryOrderPrintData
from .routing import group_items_by_print_destination, is_production_destination
from .grouping import group_items_by_customer, group_equivalent_items
from .production_formatter import format_production_document
from .closing_formatter import format_closing_document
from .delivery_formatter import format_delivery_document


def _resolve_restaurant_name(current_name: str) -> str:
    """Substitui o placeholder Kôma pelo nome configurado do tenant atual."""
    name = (current_name or "").strip()
    if name.casefold() not in {"kôma", "koma"}:
        return name or "KÔMA"

    db = None
    try:
        from sqlalchemy.orm import joinedload
        from ...database import SessionLocal, current_restaurante_id
        from ...models import ConfiguracaoRestaurante

        restaurante_id = current_restaurante_id.get()
        if not restaurante_id:
            return name or "KÔMA"
        db = SessionLocal(restaurante_id=restaurante_id)
        config = (
            db.query(ConfiguracaoRestaurante)
            .options(joinedload(ConfiguracaoRestaurante.restaurante))
            .filter(ConfiguracaoRestaurante.restaurante_id == restaurante_id)
            .first()
        )
        if config:
            return (
                config.impressao_nome_restaurante
                or (config.restaurante.nome if config.restaurante else None)
                or name
                or "KÔMA"
            )
    except Exception:
        pass
    finally:
        if db is not None:
            db.close()
    return name or "KÔMA"


class PrintDocumentService:
    """Serviço central de geração dos documentos de impressão do Kôma."""

    @staticmethod
    def group_items_by_print_destination(items: List[PrintItem]) -> Dict[str, List[PrintItem]]:
        return group_items_by_print_destination(items)

    @staticmethod
    def group_items_by_customer(items: List[PrintItem]) -> Dict[str, List[PrintItem]]:
        return group_items_by_customer(items)

    @staticmethod
    def group_equivalent_items(items: List[PrintItem], match_observations: bool = True) -> List[PrintItem]:
        return group_equivalent_items(items, match_observations=match_observations)

    @staticmethod
    def generate_production(
        order: Union[OrderPrintData, dict],
        width: Union[PaperWidth, int] = PaperWidth.WIDTH_80MM
    ) -> Optional[Dict[str, str]]:
        """Gera vias de produção por destino, descartando itens NENHUM."""
        parsed_order = PrintDocumentService._parse_order_data(order)
        parsed_order.restaurante_nome = _resolve_restaurant_name(
            parsed_order.restaurante_nome
        )
        destinations_map = group_items_by_print_destination(parsed_order.itens)
        if not destinations_map:
            return None

        result_docs: Dict[str, str] = {}
        for dest_name, dest_items in destinations_map.items():
            sub_order = OrderPrintData(
                restaurante_nome=parsed_order.restaurante_nome,
                numero_pedido=parsed_order.numero_pedido,
                tipo_pedido=parsed_order.tipo_pedido,
                mesa=parsed_order.mesa,
                horario=parsed_order.horario,
                garcom_nome=parsed_order.garcom_nome,
                numero_lancamento=parsed_order.numero_lancamento,
                itens=dest_items
            )
            result_docs[dest_name] = format_production_document(sub_order, width)
        return result_docs

    @staticmethod
    def generate_closing(
        command: Union[CommandPrintData, dict],
        width: Union[PaperWidth, int] = PaperWidth.WIDTH_80MM
    ) -> str:
        parsed_command = PrintDocumentService._parse_command_data(command)
        return format_closing_document(parsed_command, width)

    @staticmethod
    def generate_delivery(
        delivery_order: Union[DeliveryOrderPrintData, dict],
        width: Union[PaperWidth, int] = PaperWidth.WIDTH_80MM
    ) -> str:
        parsed_delivery = PrintDocumentService._parse_delivery_data(delivery_order)
        return format_delivery_document(parsed_delivery, width)

    @staticmethod
    def _parse_item(item_raw: Any) -> PrintItem:
        if isinstance(item_raw, PrintItem):
            return item_raw
        if isinstance(item_raw, dict):
            dest = str(item_raw.get("destino_impressao") or item_raw.get("destino") or "COZINHA")
            return PrintItem(
                codigo=str(item_raw.get("codigo") or item_raw.get("codigo_produto") or item_raw.get("produto_id") or ""),
                nome=str(item_raw.get("nome") or item_raw.get("produto_nome") or ""),
                quantidade=int(item_raw.get("quantidade", 1)),
                preco_unit=float(item_raw.get("preco_unit") or item_raw.get("preco") or 0.0),
                cliente_nome=str(item_raw.get("cliente_nome") or item_raw.get("cliente") or "GERAL"),
                observacao=str(item_raw.get("observacao") or ""),
                destino_impressao=dest
            )

        produto = getattr(item_raw, "produto", None)
        categoria = getattr(produto, "categoria", None) if produto else None
        dest_db = getattr(categoria, "destino_impressao", "COZINHA") if categoria else "COZINHA"
        codigo = getattr(produto, "id", None) or getattr(item_raw, "produto_id", "")
        nome = getattr(produto, "nome", None) or getattr(item_raw, "nome", "")
        return PrintItem(
            codigo=str(codigo),
            nome=str(nome),
            quantidade=getattr(item_raw, "quantidade", 1),
            preco_unit=getattr(item_raw, "preco_unit", 0.0),
            cliente_nome=getattr(item_raw, "cliente_nome", "GERAL") or "GERAL",
            observacao=getattr(item_raw, "observacao", "") or "",
            destino_impressao=dest_db or "COZINHA"
        )

    @staticmethod
    def _parse_order_data(data: Union[OrderPrintData, dict]) -> OrderPrintData:
        if isinstance(data, OrderPrintData):
            return data
        raw_items = data.get("itens", [])
        return OrderPrintData(
            restaurante_nome=data.get("restaurante_nome", "KÔMA"),
            numero_pedido=str(data.get("numero_pedido", "")),
            tipo_pedido=data.get("tipo_pedido", "LOCAL"),
            mesa=data.get("mesa"),
            horario=data.get("horario", ""),
            garcom_nome=data.get("garcom_nome", ""),
            numero_lancamento=data.get("numero_lancamento"),
            itens=[PrintDocumentService._parse_item(i) for i in raw_items]
        )

    @staticmethod
    def _parse_command_data(data: Union[CommandPrintData, dict]) -> CommandPrintData:
        if isinstance(data, CommandPrintData):
            return data
        raw_items = data.get("itens", [])
        return CommandPrintData(
            restaurante_nome=data.get("restaurante_nome", "KÔMA"),
            mesa=data.get("mesa"),
            numero_pedido=data.get("numero_pedido"),
            data_hora=data.get("data_hora", ""),
            desconto=float(data.get("desconto", 0.0)),
            itens=[PrintDocumentService._parse_item(i) for i in raw_items]
        )

    @staticmethod
    def _parse_delivery_data(data: Union[DeliveryOrderPrintData, dict]) -> DeliveryOrderPrintData:
        if isinstance(data, DeliveryOrderPrintData):
            return data
        raw_items = data.get("itens", [])
        return DeliveryOrderPrintData(
            restaurante_nome=data.get("restaurante_nome", "KÔMA"),
            numero_pedido=str(data.get("numero_pedido", "")),
            tipo_pedido=data.get("tipo_pedido", "DELIVERY"),
            data_hora=data.get("data_hora", ""),
            cliente_nome=data.get("cliente_nome", ""),
            cliente_telefone=data.get("cliente_telefone", ""),
            logradouro=data.get("logradouro", ""),
            bairro=data.get("bairro", ""),
            complemento=data.get("complemento"),
            ponto_referencia=data.get("ponto_referencia"),
            taxa_entrega=float(data.get("taxa_entrega", 0.0)),
            desconto=float(data.get("desconto", 0.0)),
            forma_pagamento=data.get("forma_pagamento", "DINHEIRO"),
            troco_para=float(data["troco_para"]) if data.get("troco_para") is not None else None,
            valor_troco=float(data["valor_troco"]) if data.get("valor_troco") is not None else None,
            observacao_entrega=data.get("observacao_entrega"),
            itens=[PrintDocumentService._parse_item(i) for i in raw_items]
        )
