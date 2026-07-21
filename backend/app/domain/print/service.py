from typing import Union, Any, Optional
from sqlalchemy.orm import Session
from .types import (
    DocumentType,
    PaperWidth,
    ProductionDocumentData,
    ClosingDocumentData,
    DeliveryDocumentData,
    PrintItemData
)
from .production import format_production_document
from .closing import format_closing_document
from .delivery import format_delivery_document

class PrintService:
    """
    Serviço central unificado de geração de documentos de impressão do Kôma.
    Toda solicitação de impressão passa por este serviço.
    """

    @staticmethod
    def generate(
        document_type: Union[DocumentType, str],
        data: Union[ProductionDocumentData, ClosingDocumentData, DeliveryDocumentData, dict],
        width: Union[PaperWidth, int] = PaperWidth.WIDTH_80MM
    ) -> str:
        """
        Gera o conteúdo em texto puro formatado para o tipo de documento solicitado.
        
        :param document_type: DocumentType.PRODUCAO | DocumentType.FECHAMENTO | DocumentType.ENTREGA
        :param data: Dataclass específica do tipo ou dicionário com os campos requeridos
        :param width: PaperWidth.WIDTH_80MM (48 colunas) ou PaperWidth.WIDTH_58MM (32 colunas)
        :return: String em texto puro pronta para impressão
        """
        if isinstance(document_type, str):
            try:
                document_type = DocumentType(document_type.upper())
            except ValueError:
                raise ValueError(
                    f"Tipo de documento de impressão inválido: '{document_type}'. "
                    f"Tipos suportados: PRODUCAO, FECHAMENTO, ENTREGA"
                )

        if document_type == DocumentType.PRODUCAO:
            doc_data = data if isinstance(data, ProductionDocumentData) else PrintService._parse_production_data(data)
            return format_production_document(doc_data, width)
        
        elif document_type == DocumentType.FECHAMENTO:
            doc_data = data if isinstance(data, ClosingDocumentData) else PrintService._parse_closing_data(data)
            return format_closing_document(doc_data, width)
        
        elif document_type == DocumentType.ENTREGA:
            doc_data = data if isinstance(data, DeliveryDocumentData) else PrintService._parse_delivery_data(data)
            return format_delivery_document(doc_data, width)
        
        else:
            raise ValueError(f"Tipo de documento não suportado: {document_type}")

    @staticmethod
    def _parse_item(item_raw: Any) -> PrintItemData:
        if isinstance(item_raw, PrintItemData):
            return item_raw
        if isinstance(item_raw, dict):
            return PrintItemData(
                codigo=str(item_raw.get("codigo") or item_raw.get("codigo_produto") or item_raw.get("produto_id") or ""),
                nome=str(item_raw.get("nome") or item_raw.get("produto_nome") or ""),
                quantidade=int(item_raw.get("quantidade", 1)),
                preco_unit=float(item_raw.get("preco_unit") or item_raw.get("preco") or 0.0),
                cliente_nome=str(item_raw.get("cliente_nome") or item_raw.get("cliente") or "Consumo Geral"),
                observacao=str(item_raw.get("observacao") or "")
            )
        
        # Leitura flexível de objeto SQLAlchemy ou similar
        produto = getattr(item_raw, "produto", None)
        codigo = getattr(produto, "id", None) or getattr(item_raw, "produto_id", "")
        nome = getattr(produto, "nome", None) or getattr(item_raw, "nome", "")
        return PrintItemData(
            codigo=str(codigo),
            nome=str(nome),
            quantidade=getattr(item_raw, "quantidade", 1),
            preco_unit=getattr(item_raw, "preco_unit", 0.0),
            cliente_nome=getattr(item_raw, "cliente_nome", "Consumo Geral") or "Consumo Geral",
            observacao=getattr(item_raw, "observacao", "") or ""
        )

    @staticmethod
    def _parse_production_data(data: dict) -> ProductionDocumentData:
        raw_items = data.get("itens", [])
        parsed_items = [PrintService._parse_item(i) for i in raw_items]
        return ProductionDocumentData(
            restaurante_nome=data.get("restaurante_nome", "KÔMA"),
            numero_pedido=str(data.get("numero_pedido", "")),
            tipo_pedido=data.get("tipo_pedido", "CONSUMO LOCAL"),
            mesa=data.get("mesa"),
            horario=data.get("horario", ""),
            garcom_nome=data.get("garcom_nome", ""),
            numero_lancamento=data.get("numero_lancamento"),
            itens=parsed_items
        )

    @staticmethod
    def _parse_closing_data(data: dict) -> ClosingDocumentData:
        raw_items = data.get("itens", [])
        parsed_items = [PrintService._parse_item(i) for i in raw_items]
        return ClosingDocumentData(
            restaurante_nome=data.get("restaurante_nome", "KÔMA"),
            mesa=data.get("mesa"),
            numero_pedido=data.get("numero_pedido"),
            data_hora=data.get("data_hora", ""),
            desconto=float(data.get("desconto", 0.0)),
            itens=parsed_items
        )

    @staticmethod
    def _parse_delivery_data(data: dict) -> DeliveryDocumentData:
        raw_items = data.get("itens", [])
        parsed_items = [PrintService._parse_item(i) for i in raw_items]
        return DeliveryDocumentData(
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
            itens=parsed_items
        )

    @staticmethod
    def generate_from_comanda(
        db: Session,
        comanda_id: str,
        document_type: Union[DocumentType, str],
        width: Union[PaperWidth, int] = PaperWidth.WIDTH_80MM,
        garcom_nome: Optional[str] = None
    ) -> str:
        from app.models import Comanda, Item, Mesa, Usuario
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
        if not comanda:
            raise ValueError(f"Comanda ID '{comanda_id}' não encontrada no banco de dados.")

        mesa_obj = db.query(Mesa).filter(Mesa.id == comanda.mesa_id).first() if comanda.mesa_id else None
        mesa_nome = mesa_obj.nome or str(mesa_obj.id) if mesa_obj else None

        garcom_obj = db.query(Usuario).filter(Usuario.id == comanda.garcom_id).first() if comanda.garcom_id else None
        garcom = garcom_nome or (garcom_obj.nome if garcom_obj else "EQUIPE")

        itens_db = db.query(Item).filter(Item.comanda_id == comanda_id, Item.status != "cancelado").all()
        print_items = [PrintService._parse_item(item) for item in itens_db]

        horario_str = comanda.criado_em.strftime("%d/%m %H:%M") if comanda.criado_em else ""

        doc_type_enum = DocumentType(document_type.upper()) if isinstance(document_type, str) else document_type

        if doc_type_enum == DocumentType.PRODUCAO:
            payload = ProductionDocumentData(
                restaurante_nome="KÔMA",
                numero_pedido=str(comanda.numero_pedido),
                tipo_pedido=comanda.tipo or "CONSUMO LOCAL",
                mesa=mesa_nome,
                horario=horario_str,
                garcom_nome=garcom,
                itens=print_items
            )
            return PrintService.generate(doc_type_enum, payload, width)

        elif doc_type_enum == DocumentType.FECHAMENTO:
            payload = ClosingDocumentData(
                restaurante_nome="KÔMA",
                mesa=mesa_nome or f"PED #{comanda.numero_pedido}",
                numero_pedido=str(comanda.numero_pedido),
                data_hora=horario_str,
                itens=print_items
            )
            return PrintService.generate(doc_type_enum, payload, width)

        elif doc_type_enum == DocumentType.ENTREGA:
            payload = DeliveryDocumentData(
                restaurante_nome="KÔMA",
                numero_pedido=str(comanda.numero_pedido),
                tipo_pedido="DELIVERY",
                data_hora=horario_str,
                cliente_nome=comanda.identificador or "CLIENTE",
                cliente_telefone=comanda.delivery_telefone or "",
                logradouro=comanda.delivery_endereco or "",
                taxa_entrega=comanda.delivery_taxa or 0.0,
                itens=print_items
            )
            return PrintService.generate(doc_type_enum, payload, width)

        raise ValueError(f"Tipo de documento não suportado: {document_type}")
