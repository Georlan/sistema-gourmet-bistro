from __future__ import annotations

import re

from ..tax_ids import TaxIdError, normalize_cnpj as _normalize_cnpj


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
    try:
        return _normalize_cnpj(str(value or ""))
    except TaxIdError as exc:
        raise FiscalIdentifierError(str(exc)) from exc


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
