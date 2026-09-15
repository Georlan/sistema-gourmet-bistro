from __future__ import annotations

import re


class FiscalIdentifierError(ValueError):
    pass


# Códigos de UF usados nos códigos de município do IBGE.
# A fonte canônica é a API de Localidades do IBGE registrada no compliance registry.
IBGE_UF_CODE_TO_SIGLA: dict[str, str] = {
    "11": "RO",
    "12": "AC",
    "13": "AM",
    "14": "RR",
    "15": "PA",
    "16": "AP",
    "17": "TO",
    "21": "MA",
    "22": "PI",
    "23": "CE",
    "24": "RN",
    "25": "PB",
    "26": "PE",
    "27": "AL",
    "28": "SE",
    "29": "BA",
    "31": "MG",
    "32": "ES",
    "33": "RJ",
    "35": "SP",
    "41": "PR",
    "42": "SC",
    "43": "RS",
    "50": "MS",
    "51": "MT",
    "52": "GO",
    "53": "DF",
}


def digits_only(value: object) -> str:
    return re.sub(r"\D", "", str(value or ""))


def normalize_cnpj(value: object) -> str:
    """Normaliza e valida CNPJ numérico ou alfanumérico.

    Desde julho/2026 novas inscrições podem usar letras nos 12 primeiros
    caracteres. Os dois DVs continuam numéricos e usam módulo 11; para o
    cálculo oficial, cada caractere é convertido por ``ASCII - 48``.
    """

    raw = str(value or "").strip().upper()
    cnpj = re.sub(r"[.\-/\s]", "", raw)
    if not re.fullmatch(r"[A-Z0-9]{12}[0-9]{2}", cnpj):
        raise FiscalIdentifierError("CNPJ inválido.")
    if len(set(cnpj)) == 1:
        raise FiscalIdentifierError("CNPJ inválido.")

    base_values = [ord(char) - 48 for char in cnpj[:12]]

    def _digit(base: list[int], weights: tuple[int, ...]) -> int:
        total = sum(value * weight for value, weight in zip(base, weights, strict=True))
        remainder = total % 11
        return 0 if remainder < 2 else 11 - remainder

    first = _digit(base_values, (5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2))
    second = _digit(
        base_values + [first],
        (6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2),
    )
    if cnpj[12:] != f"{first}{second}":
        raise FiscalIdentifierError("CNPJ inválido.")
    return cnpj


def normalize_ibge_municipality_code(value: object) -> str:
    code = digits_only(value)
    if len(code) != 7:
        raise FiscalIdentifierError("Código IBGE do município deve ter 7 dígitos.")
    if code == "0000000":
        raise FiscalIdentifierError("Código IBGE do município inválido.")
    return code


def normalize_uf(value: object) -> str:
    uf = str(value or "").strip().upper()
    if len(uf) != 2 or uf not in set(IBGE_UF_CODE_TO_SIGLA.values()):
        raise FiscalIdentifierError("UF inválida.")
    return uf


def uf_from_ibge_municipality_code(value: object) -> str:
    code = normalize_ibge_municipality_code(value)
    uf = IBGE_UF_CODE_TO_SIGLA.get(code[:2])
    if uf is None:
        raise FiscalIdentifierError("Código IBGE não pertence a uma UF conhecida.")
    return uf


def normalize_cep(value: object) -> str:
    cep = digits_only(value)
    if len(cep) != 8:
        raise FiscalIdentifierError("CEP deve ter 8 dígitos.")
    return cep


def normalize_digits(value: object, *, field: str, length: int) -> str:
    normalized = digits_only(value)
    if len(normalized) != length:
        raise FiscalIdentifierError(f"{field} deve ter {length} dígitos.")
    return normalized
