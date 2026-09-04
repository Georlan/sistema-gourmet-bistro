from dataclasses import dataclass


@dataclass
class PrintItem:
    """Item canônico usado pelo roteamento e pelo renderer universal."""

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
