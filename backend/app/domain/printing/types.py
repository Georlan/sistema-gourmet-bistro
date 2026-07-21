from enum import Enum

class PrintDocumentType(str, Enum):
    PRODUCAO = "producao"
    FECHAMENTO = "fechamento"
    ENTREGA = "entrega"

class PaperWidth(int, Enum):
    WIDTH_80MM = 48
    WIDTH_58MM = 32

class PrintDestination(str, Enum):
    COZINHA = "COZINHA"
    NENHUM = "NENHUM"
    BAR = "BAR"
    PIZZA = "PIZZA"
    CHAPA = "CHAPA"
    SOBREMESA = "SOBREMESA"
    EXPEDICAO = "EXPEDICAO"
