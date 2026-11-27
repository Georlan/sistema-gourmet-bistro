"""Constantes e presets canônicos de segmento, slug e cardápio para provisionamento."""

from __future__ import annotations

import re
import unicodedata
from typing import Any

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DEFAULT_TRIAL_DAYS = 7
INVITATION_TTL_HOURS = 72
SUPPORTED_OPERATION_PROFILES = ("generic", "pizzaria", "acai", "churrasco", "marmitaria")

RESERVED_SLUGS = {
    "www",
    "central",
    "admin",
    "superadmin",
    "super-admin",
    "api",
    "app",
    "static",
    "assets",
    "mail",
    "smtp",
    "cardapio",
    "caixa",
    "garcom",
    "entregador",
    "motoboy",
    "sistema-gourmet-bistro",
}

SEGMENT_CATEGORY_PRESETS: dict[str, tuple[dict[str, str], ...]] = {
    "hamburgueria": (
        {"id": "cat-hamburgueres", "nome": "Hambúrgueres", "destino_impressao": "COZINHA"},
        {"id": "cat-combos", "nome": "Combos", "destino_impressao": "COZINHA"},
        {"id": "cat-porcoes", "nome": "Porções e Batatas", "destino_impressao": "COZINHA"},
        {"id": "cat-bebidas", "nome": "Bebidas", "destino_impressao": "NENHUM"},
        {"id": "cat-sobremesas", "nome": "Sobremesas", "destino_impressao": "NENHUM"},
    ),
    "pizzaria": (
        {"id": "cat-pizzas-tradicionais", "nome": "Pizzas Tradicionais", "destino_impressao": "COZINHA"},
        {"id": "cat-pizzas-especiais", "nome": "Pizzas Especiais", "destino_impressao": "COZINHA"},
        {"id": "cat-pizzas-doces", "nome": "Pizzas Doces", "destino_impressao": "COZINHA"},
        {"id": "cat-bordas-esfihas", "nome": "Esfihas e Calzones", "destino_impressao": "COZINHA"},
        {"id": "cat-bebidas", "nome": "Bebidas", "destino_impressao": "NENHUM"},
    ),
    "marmitaria": (
        {"id": "cat-pratos-executivos", "nome": "Pratos Executivos", "destino_impressao": "COZINHA"},
        {"id": "cat-porcoes-extras", "nome": "Porções Extras", "destino_impressao": "COZINHA"},
        {"id": "cat-bebidas", "nome": "Bebidas", "destino_impressao": "NENHUM"},
        {"id": "cat-sobremesas", "nome": "Sobremesas", "destino_impressao": "NENHUM"},
    ),
    "pastelaria": (
        {"id": "cat-pasteis-salgados", "nome": "Pastéis Salgados", "destino_impressao": "COZINHA"},
        {"id": "cat-pasteis-doces", "nome": "Pastéis Doces", "destino_impressao": "COZINHA"},
        {"id": "cat-salgados", "nome": "Salgados e Porções", "destino_impressao": "COZINHA"},
        {"id": "cat-caldos-bebidas", "nome": "Caldo de Cana e Bebidas", "destino_impressao": "NENHUM"},
    ),
    "acaiteria": (
        {"id": "cat-acai-montado", "nome": "Açaí no Copo / Tigela", "destino_impressao": "COZINHA"},
        {"id": "cat-vitaminas-cremes", "nome": "Cremes e Vitaminas", "destino_impressao": "COZINHA"},
        {"id": "cat-bebidas", "nome": "Águas e Bebidas", "destino_impressao": "NENHUM"},
    ),
    "restaurante": (
        {"id": "cat-entradas", "nome": "Entradas", "destino_impressao": "COZINHA"},
        {"id": "cat-pratos-principais", "nome": "Pratos Principais", "destino_impressao": "COZINHA"},
        {"id": "cat-guarnicoes", "nome": "Guarnições", "destino_impressao": "COZINHA"},
        {"id": "cat-bebidas", "nome": "Bebidas", "destino_impressao": "NENHUM"},
        {"id": "cat-sobremesas", "nome": "Sobremesas", "destino_impressao": "NENHUM"},
    ),
}

_BEVERAGE_TERMS = (
    "bebida",
    "suco",
    "refri",
    "refrigerante",
    "cerveja",
    "agua",
    "drink",
    "cha",
    "cafe",
    "vinho",
    "energetico",
    "milkshake",
)


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def slugify_restaurant_name(name: str) -> str:
    ascii_clean = _strip_accents(name).lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_clean).strip("-")[:100].rstrip("-")
    return slug or "restaurante"


def slugify_category_id(name: str) -> str:
    ascii_clean = _strip_accents(name).lower().strip()
    slug = re.sub(r"[^a-z0-9-]+", "-", ascii_clean).strip("-")
    return f"cat-{slug or 'geral'}"


def infer_category_print_destination(category_name: str) -> str:
    lower = _strip_accents(category_name).lower()
    if any(term in lower for term in _BEVERAGE_TERMS):
        return "NENHUM"
    return "COZINHA"


def _fnv1a_32_base36(value: str) -> str:
    h = 2166136261
    for ch in value:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    if h == 0:
        return "0"
    out = []
    while h:
        h, rem = divmod(h, 36)
        out.append(chars[rem])
    return "".join(reversed(out))[:5]


def build_deterministic_import_product_id(name: str, category_id: str) -> str:
    ascii_clean = _strip_accents(name).lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_clean).strip("-")[:32] or "item"
    short_hash = _fnv1a_32_base36(f"{category_id}::{name.strip().lower()}")
    return f"imp-{slug}-{short_hash}"


def segment_categories_for(
    segment_preset: str | None,
    operation_profile: str | None,
) -> list[dict[str, str]]:
    key = str(segment_preset or "").strip().lower()
    if key in SEGMENT_CATEGORY_PRESETS:
        return [dict(item) for item in SEGMENT_CATEGORY_PRESETS[key]]
    profile_map = {
        "pizzaria": "pizzaria",
        "marmitaria": "marmitaria",
        "acai": "acaiteria",
        "churrasco": "restaurante",
    }
    mapped = profile_map.get(str(operation_profile or "").strip().lower())
    if mapped and mapped in SEGMENT_CATEGORY_PRESETS:
        return [dict(item) for item in SEGMENT_CATEGORY_PRESETS[mapped]]
    return [dict(item) for item in SEGMENT_CATEGORY_PRESETS["restaurante"]]


def format_socials_with_phone(phone: str | None) -> dict[str, Any] | None:
    digits = re.sub(r"\D+", "", str(phone or ""))
    if not digits:
        return None
    return {"whatsapp": digits}
