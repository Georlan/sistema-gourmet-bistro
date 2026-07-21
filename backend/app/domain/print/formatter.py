import textwrap
from typing import List

def center_text(text: str, width: int) -> str:
    """Centraliza o texto na largura informada."""
    return text.strip().center(width)

def separator(char: str = "-", width: int = 48) -> str:
    """Gera uma linha separadora com o caractere e largura especificados."""
    return char * width

def justify_two_columns(left: str, right: str, width: int) -> str:
    """
    Justifica texto à esquerda e valor/texto à direita em uma única linha.
    Exemplo: justify_two_columns("SUBTOTAL", "66,90", 48)
    """
    left_str = left.strip()
    right_str = right.strip()
    min_spaces = 1
    max_left_len = width - len(right_str) - min_spaces

    if len(left_str) > max_left_len and max_left_len > 0:
        left_str = left_str[:max_left_len]

    spaces = max(width - len(left_str) - len(right_str), 1)
    return left_str + (" " * spaces) + right_str

def format_currency(value: float, include_symbol: bool = False) -> str:
    """
    Formata valor monetário com duas casas decimais no padrão brasileiro.
    Exemplo: 38.0 -> "38,00" ou "R$ 38,00"
    """
    formatted = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    if include_symbol:
        return f"R$ {formatted}"
    return formatted

def wrap_text(text: str, width: int, indent: str = "   ") -> List[str]:
    """
    Quebra textos longos mantendo indentação para observações.
    """
    if not text:
        return []
    
    usable_width = width - len(indent)
    if usable_width <= 5:
        usable_width = width
        indent = ""

    lines = textwrap.wrap(text.strip(), width=usable_width)
    return [f"{indent}{line}" for line in lines]
