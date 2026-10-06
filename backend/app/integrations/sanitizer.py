"""
Sanitizador de PII para Integrações Externas (Linear, PostHog, etc.).
Garante que nenhum dado pessoal sensível de clientes (CPFs, cartões, emails,
telefones, senhas ou tokens) seja transmitido para plataformas de terceiros.
"""
import re
from typing import Any, Dict, List, Set, Union

BANNED_PII_KEYS: Set[str] = {
    "name",
    "nome",
    "cliente_nome",
    "customer_name",
    "phone",
    "telefone",
    "celular",
    "cliente_telefone",
    "customer_phone",
    "email",
    "cliente_email",
    "customer_email",
    "address",
    "endereco",
    "endereco_entrega",
    "cpf",
    "cnpj",
    "cartao",
    "card_number",
    "card",
    "token",
    "access_token",
    "password",
    "senha",
    "secret",
    "secret_key",
    "bearer",
    "api_key",
}

# Expressões regulares para detecção de PII
_CPF_REGEX = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}[-\s]?\d{2}\b")
_CARD_REGEX = re.compile(r"\b(?:\d[ -]*?){13,19}\b")
_PHONE_REGEX = re.compile(r"(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b")
_EMAIL_REGEX = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
_JWT_TOKEN_REGEX = re.compile(r"eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+")
_BEARER_TOKEN_REGEX = re.compile(r"(?i)bearer\s+[a-zA-Z0-9_\-\.]{16,}")


def sanitize_text(text: str) -> str:
    """
    Substitui padrões identificados de dados sensíveis por marcadores de redação.
    """
    if not text or not isinstance(text, str):
        return ""

    sanitized = text

    # Redigir tokens JWT ou Bearer
    sanitized = _JWT_TOKEN_REGEX.sub("[TOKEN_REDACTED]", sanitized)
    sanitized = _BEARER_TOKEN_REGEX.sub("Bearer [TOKEN_REDACTED]", sanitized)

    # Redigir números de cartão
    sanitized = _CARD_REGEX.sub("[CARTAO_REDACTED]", sanitized)

    # Redigir CPF
    sanitized = _CPF_REGEX.sub("[CPF_REDACTED]", sanitized)

    # Redigir e-mails
    sanitized = _EMAIL_REGEX.sub("[EMAIL_REDACTED]", sanitized)

    # Redigir telefones
    sanitized = _PHONE_REGEX.sub("[TELEFONE_REDACTED]", sanitized)

    return sanitized


def sanitize_payload(data: Union[Dict[str, Any], List[Any], Any]) -> Any:
    """
    Sanitiza recursivamente um dicionário ou lista, removendo chaves proibidas
    e aplicando higienização em textos.
    """
    if isinstance(data, dict):
        clean_dict = {}
        for key, val in data.items():
            lower_key = str(key).lower().strip()
            if lower_key in BANNED_PII_KEYS:
                clean_dict[key] = "[REDACTED_PII]"
                continue
            clean_dict[key] = sanitize_payload(val)
        return clean_dict
    elif isinstance(data, list):
        return [sanitize_payload(item) for item in data]
    elif isinstance(data, str):
        return sanitize_text(data)
    else:
        return data
