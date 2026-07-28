"""Conversão segura de cupons de texto para bytes ESC/POS."""

from typing import Final


INITIALIZE: Final[bytes] = b"\x1b@"
# ESC t 3 seleciona PC860, a tabela portuguesa documentada pelo ESC/POS.
PORTUGUESE_CODE_PAGE: Final[bytes] = b"\x1bt\x03"
PAPER_FEED: Final[bytes] = b"\n\n\n"
PARTIAL_CUT: Final[bytes] = b"\x1d\x56\x42\x00"
SIMULATED_CUT_MARKER: Final[str] = "[CUT]"


def build_escpos_payload(payload_text: str, encoding: str = "cp860") -> bytes:
    """
    Prepara um trabalho RAW independente do sistema operacional.

    O PostgreSQL não aceita bytes NUL em colunas TEXT. O backend transporta
    esses bytes como a sequência literal ``\\x00`` e o agente os restaura aqui.
    O marcador visual ``[CUT]`` nunca deve chegar ao papel.
    """
    normalized = (
        (payload_text or "")
        .replace(SIMULATED_CUT_MARKER, "")
        .replace("\\x00", "\x00")
    )
    body = normalized.encode(encoding, errors="replace")
    return (
        INITIALIZE
        + PORTUGUESE_CODE_PAGE
        + body
        + PAPER_FEED
        + PARTIAL_CUT
    )
