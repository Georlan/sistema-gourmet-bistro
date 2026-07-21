from dataclasses import dataclass, field
from typing import List, Optional

@dataclass
class PrintItem:
    """Representa um item genérico a ser processado no domínio de impressão."""
    codigo: str
    nome: str
    quantidade: int = 1
    preco_unit: float = 0.0
    cliente_nome: str = "GERAL"
    observacao: str = ""
    destino_impressao: str = "COZINHA"

    @property
    def total(self) -> float:
        return round(self.quantidade * self.preco_unit, 2)

@dataclass
class OrderPrintData:
    """Dados de um pedido para emissão de documento de PRODUÇÃO."""
    restaurante_nome: str = "KÔMA"
    numero_pedido: str = ""
    tipo_pedido: str = "LOCAL"  # LOCAL | RETIRADA | DELIVERY
    mesa: Optional[str] = None
    horario: str = ""
    garcom_nome: str = ""
    numero_lancamento: Optional[str] = None
    itens: List[PrintItem] = field(default_factory=list)

@dataclass
class CommandPrintData:
    """Dados de uma comanda/mesa para emissão de documento de FECHAMENTO."""
    restaurante_nome: str = "KÔMA"
    mesa: Optional[str] = None
    numero_pedido: Optional[str] = None
    data_hora: str = ""
    desconto: float = 0.0
    itens: List[PrintItem] = field(default_factory=list)

@dataclass
class DeliveryOrderPrintData:
    """Dados de um pedido de delivery para emissão de documento de ENTREGA."""
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
    observacao_entrega: Optional[str] = None
    itens: List[PrintItem] = field(default_factory=list)
