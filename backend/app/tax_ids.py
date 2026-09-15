from __future__ import annotations

import re


_TAX_ID_FORMATTING = re.compile(r"[.\-/\s]")
_NON_DIGITS = re.compile(r"\D+")


class TaxIdError(ValueError):
    pass


def normalize_cpf(value: str | None) -> str:
    return _NON_DIGITS.sub("", value or "")


def normalize_cnpj(value: str | None) -> str:
    """Remove apenas formatação e valida a estrutura do CNPJ.

    A validade dos dígitos verificadores é responsabilidade de ``is_valid_cnpj``.
    Essa separação mantém o helper útil para normalização após uma validação já
    executada, sem confundir estrutura com situação fiscal/cadastral.
    """
    raw = str(value or "").strip().upper()
    normalized = _TAX_ID_FORMATTING.sub("", raw)
    if not re.fullmatch(r"[A-Z0-9]{12}[0-9]{2}", normalized):
        raise TaxIdError("CNPJ inválido.")
    return normalized


def _has_repeated(value: str) -> bool:
    return bool(value) and len(set(value)) == 1


def is_valid_cpf(value: str | None) -> bool:
    digits = normalize_cpf(value)
    if len(digits) != 11 or _has_repeated(digits):
        return False

    numbers = [int(char) for char in digits]
    first_sum = sum(numbers[index] * (10 - index) for index in range(9))
    first = (first_sum * 10) % 11
    if first == 10:
        first = 0
    if first != numbers[9]:
        return False

    second_sum = sum(numbers[index] * (11 - index) for index in range(10))
    second = (second_sum * 10) % 11
    if second == 10:
        second = 0
    return second == numbers[10]


def is_valid_cnpj(value: str | None) -> bool:
    try:
        cnpj = normalize_cnpj(value)
    except TaxIdError:
        return False
    if _has_repeated(cnpj):
        return False

    # Regra oficial do CNPJ alfanumérico: valor do caractere = ASCII - 48.
    # Para CNPJs numéricos isso produz exatamente os valores 0..9 históricos.
    base_values = [ord(char) - 48 for char in cnpj[:12]]

    def calculate(base: list[int], weights: tuple[int, ...]) -> int:
        total = sum(item * weight for item, weight in zip(base, weights, strict=True))
        remainder = total % 11
        return 0 if remainder < 2 else 11 - remainder

    first = calculate(base_values, (5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2))
    second = calculate(
        base_values + [first],
        (6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2),
    )
    return cnpj[12:] == f"{first}{second}"


def normalize_tax_id(value: str | None) -> str:
    """Normaliza CPF/CNPJ sem promover documento inválido a um tipo válido.

    Chamadores que precisam saber o tipo devem usar ``tax_id_kind`` antes de
    persistir/autorizar operações sensíveis.
    """
    raw = str(value or "").strip()
    cpf_candidate = normalize_cpf(raw)
    if len(cpf_candidate) == 11 and is_valid_cpf(cpf_candidate):
        return cpf_candidate
    try:
        return normalize_cnpj(raw)
    except TaxIdError:
        return cpf_candidate


def tax_id_kind(value: str | None) -> str | None:
    raw = str(value or "").strip()
    cpf = normalize_cpf(raw)
    if len(cpf) == 11 and is_valid_cpf(cpf):
        return "cpf"
    if is_valid_cnpj(raw):
        return "cnpj"
    return None
