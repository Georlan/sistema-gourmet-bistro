from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

class DocumentType(str, Enum):
    """Tipos oficiais de documentos de impressão do Kôma."""
    PRODUCAO = "PRODUCAO"
    FECHAMENTO = "FECHAMENTO"
    ENTREGA = "ENTREGA"

class PaperWidth(int, Enum):
    """Largura do papel térmico em colunas padrão."""
    WIDTH_80MM = 48
    WIDTH_58MM = 32

@dataclass
class PrintItemData:
    """Dados de um item a ser impresso."""
    codigo: str
    nome: str
    quantidade: int = 1
    preco_unit: float = 0.0
    cliente_nome: str = "Consumo Geral"
    observacao: str = ""

    @property
    def total(self) -> float:
        return round(self.quantidade * self.preco_unit, 2)

@dataclass
class ProductionDocumentData:
    """Dados para o documento TIPO 1 - PRODUÇÃO (Cozinha/Bar)."""
    restaurante_nome: str = "KÔMA"
    numero_pedido: str = ""
    tipo_pedido: str = "CONSUMO LOCAL"  # CONSUMO LOCAL / RETIRADA / DELIVERY
    mesa: Optional[str] = None
    horario: str = ""
    garcom_nome: str = ""
    numero_lancamento: Optional[str] = None
    itens: List[PrintItemData] = field(default_factory=list)

@dataclass
class ClosingDocumentData:
    """Dados para o documento TIPO 2 - FECHAMENTO (Conferência / Conta)."""
    restaurante_nome: str = "KÔMA"
    mesa: Optional[str] = None
    numero_pedido: Optional[str] = None
    data_hora: str = ""
    desconto: float = 0.0
    itens: List[PrintItemData] = field(default_factory=list)

@dataclass
class DeliveryDocumentData:
    """Dados para o documento TIPO 3 - ENTREGA (Motoboy / Delivery)."""
    restaurante_nome: str = "KÔMA"
    numero_pedido: str = ""
    tipo_pedido: str = "DELIVERY"
    data_hora: str = ""
    cliente_nome: str = ""
    cliente_telefone: str = ""
    logradouro: str = ""
    bairro: str = ""
    complemento: Optional[str] = None
    ponto_referencia: Optional[str] = None
    taxa_entrega: float = 0.0
    desconto: float = 0.0
    forma_pagamento: str = "DINHEIRO"
    troco_para: Optional[float] = None
    valor_troco: Optional[float] = None
    itens: List[PrintItemData] = field(default_factory=list)
