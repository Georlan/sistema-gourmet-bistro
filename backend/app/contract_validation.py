from __future__ import annotations

import re


_NON_DIGITS = re.compile(r"\D+")


def normalize_tax_id(value: str | None) -> str:
    return _NON_DIGITS.sub("", value or "")


def _has_repeated_digits(value: str) -> bool:
    return bool(value) and len(set(value)) == 1


def is_valid_cpf(value: str | None) -> bool:
    digits = normalize_tax_id(value)
    if len(digits) != 11 or _has_repeated_digits(digits):
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
    digits = normalize_tax_id(value)
    if len(digits) != 14 or _has_repeated_digits(digits):
        return False

    numbers = [int(char) for char in digits]

    def calculate(base: list[int], weights: list[int]) -> int:
        total = sum(number * weight for number, weight in zip(base, weights, strict=True))
        remainder = total % 11
        return 0 if remainder < 2 else 11 - remainder

    first = calculate(numbers[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    if first != numbers[12]:
        return False
    second = calculate(numbers[:13], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return second == numbers[13]


def tax_id_kind(value: str | None) -> str | None:
    digits = normalize_tax_id(value)
    if len(digits) == 11 and is_valid_cpf(digits):
        return "cpf"
    if len(digits) == 14 and is_valid_cnpj(digits):
        return "cnpj"
    return None
