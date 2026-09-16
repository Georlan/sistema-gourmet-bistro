"""Aplica ilustrações visuais aos 30 produtos do KÔMA Demo (tenant 2).

Somente leitura por padrão. A escrita exige ``--apply`` e o nome exato do banco.
As imagens são SVGs embutidos como data URI para não depender de CDN, storage ou
internet externa durante a apresentação. O comando só toca em ``Produto.imagem``
dos produtos canônicos do tenant 2 e não altera usuários, preços ou o tenant 1.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from html import escape
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from tools.enrich_demo_restaurant import DEMO_PRODUCTS, _assert_demo_scope
from tools.provision_demo_restaurant import (
    DEMO_RESTAURANT_ID,
    _database_name,
    _database_url,
    _imports,
)

IMAGE_PREFIX = "data:image/svg+xml;base64,"

CATEGORY_LABELS = {
    "demo-lanches": "LANCHE",
    "demo-pratos": "PRATO",
    "demo-porcoes": "PORÇÃO",
    "demo-combos": "COMBO",
    "demo-bebidas": "BEBIDA",
    "demo-sobremesas": "SOBREMESA",
}


def _accent(product_id: str) -> tuple[str, str]:
    digest = hashlib.sha256(product_id.encode("utf-8")).digest()
    palettes = (
        ("#19D3A2", "#08775D"),
        ("#FFB454", "#A85B08"),
        ("#FF7A8A", "#8A2632"),
        ("#7DD3FC", "#176A8C"),
        ("#C4B5FD", "#6245A8"),
        ("#FDE68A", "#9A7210"),
    )
    return palettes[digest[0] % len(palettes)]


def _icon(category_id: str, accent: str, accent_dark: str) -> str:
    if category_id == "demo-lanches":
        return f"""
        <g transform="translate(214 86)">
          <ellipse cx="186" cy="70" rx="116" ry="47" fill="#E5A65A"/>
          <rect x="82" y="104" width="208" height="24" rx="12" fill="#74B84D"/>
          <path d="M90 135 L280 135 L258 170 L110 170 Z" fill="#F4C95D"/>
          <rect x="78" y="176" width="216" height="38" rx="19" fill="#5A2F20"/>
          <rect x="94" y="219" width="184" height="20" rx="10" fill="#C43B34"/>
          <ellipse cx="186" cy="266" rx="112" ry="39" fill="#D78C3D"/>
          <circle cx="145" cy="58" r="3" fill="#F9E4B7"/><circle cx="190" cy="43" r="3" fill="#F9E4B7"/><circle cx="228" cy="64" r="3" fill="#F9E4B7"/>
        </g>"""
    if category_id == "demo-pratos":
        return f"""
        <g transform="translate(205 86)">
          <ellipse cx="195" cy="180" rx="145" ry="112" fill="#E9EEF1"/>
          <ellipse cx="195" cy="180" rx="118" ry="88" fill="#F9FBFC" stroke="#D4DBDF" stroke-width="8"/>
          <ellipse cx="155" cy="170" rx="48" ry="34" fill="#8B4A32"/>
          <ellipse cx="238" cy="145" rx="38" ry="30" fill="#F4E1A2"/>
          <path d="M224 211 C257 185 292 196 302 227 C277 248 246 251 217 232 Z" fill="#69A85E"/>
          <circle cx="280" cy="198" r="12" fill="#EF6A5B"/>
        </g>"""
    if category_id == "demo-porcoes":
        return f"""
        <g transform="translate(235 80)">
          <path d="M70 128 L260 128 L238 278 L92 278 Z" fill="#C53C35"/>
          <path d="M100 42 L132 202" stroke="#F6C74B" stroke-width="24" stroke-linecap="round"/>
          <path d="M142 26 L160 202" stroke="#FFD95A" stroke-width="24" stroke-linecap="round"/>
          <path d="M186 34 L186 205" stroke="#F0B93B" stroke-width="24" stroke-linecap="round"/>
          <path d="M226 48 L210 202" stroke="#FFD95A" stroke-width="24" stroke-linecap="round"/>
          <circle cx="165" cy="212" r="35" fill="{accent}" opacity="0.22"/>
        </g>"""
    if category_id == "demo-combos":
        return f"""
        <g transform="translate(150 90)">
          <g transform="translate(0 42) scale(.72)">
            <ellipse cx="186" cy="70" rx="116" ry="47" fill="#E5A65A"/>
            <rect x="82" y="104" width="208" height="24" rx="12" fill="#74B84D"/>
            <path d="M90 135 L280 135 L258 170 L110 170 Z" fill="#F4C95D"/>
            <rect x="78" y="176" width="216" height="38" rx="19" fill="#5A2F20"/>
            <ellipse cx="186" cy="258" rx="112" ry="39" fill="#D78C3D"/>
          </g>
          <g transform="translate(310 40)">
            <path d="M28 24 H132 L115 218 H45 Z" fill="{accent}" opacity="0.86"/>
            <rect x="17" y="12" width="126" height="20" rx="10" fill="#DDE8EA"/>
            <path d="M92 -4 L116 -46" stroke="#DDE8EA" stroke-width="9" stroke-linecap="round"/>
          </g>
          <g transform="translate(218 175) scale(.52)">
            <path d="M70 128 L260 128 L238 278 L92 278 Z" fill="#C53C35"/>
            <path d="M110 40 L138 203 M158 25 L170 205 M205 36 L196 205" stroke="#FFD95A" stroke-width="23" stroke-linecap="round"/>
          </g>
        </g>"""
    if category_id == "demo-bebidas":
        return f"""
        <g transform="translate(260 58)">
          <path d="M70 68 H210 L190 315 H90 Z" fill="{accent}" opacity="0.86"/>
          <rect x="57" y="48" width="166" height="26" rx="13" fill="#E3EAED"/>
          <ellipse cx="140" cy="80" rx="47" ry="12" fill="#FFFFFF" opacity="0.16"/>
          <path d="M149 45 L190 -20" stroke="#E6EEF0" stroke-width="12" stroke-linecap="round"/>
          <circle cx="140" cy="190" r="44" fill="#FFFFFF" opacity="0.12"/>
          <path d="M120 188 C138 165 159 169 169 188 C157 210 136 216 118 201 Z" fill="#FFFFFF" opacity="0.72"/>
        </g>"""
    return f"""
        <g transform="translate(225 76)">
          <rect x="70" y="145" width="210" height="120" rx="24" fill="#6E3D2C"/>
          <path d="M78 145 C120 88 227 90 274 145 Z" fill="#F2D8B2"/>
          <ellipse cx="174" cy="112" rx="60" ry="42" fill="#F5F2E8"/>
          <path d="M116 195 C156 164 205 164 245 195" stroke="{accent}" stroke-width="18" stroke-linecap="round" opacity="0.72"/>
          <circle cx="132" cy="115" r="10" fill="{accent_dark}" opacity="0.7"/><circle cx="218" cy="104" r="8" fill="{accent_dark}" opacity="0.7"/>
        </g>"""


def _svg_data_uri(product_id: str, name: str, category_id: str) -> str:
    accent, accent_dark = _accent(product_id)
    category_label = CATEGORY_LABELS.get(category_id, "KÔMA DEMO")
    clean_name = escape(name)
    clean_category = escape(category_label)
    icon = _icon(category_id, accent, accent_dark)
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560" viewBox="0 0 800 560">
      <defs>
        <radialGradient id="bg" cx="70%" cy="20%" r="85%">
          <stop offset="0" stop-color="{accent_dark}" stop-opacity=".55"/>
          <stop offset=".48" stop-color="#111A18"/>
          <stop offset="1" stop-color="#070B0A"/>
        </radialGradient>
        <linearGradient id="shine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#FFFFFF" stop-opacity=".14"/>
          <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
        </linearGradient>
        <filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity=".48"/></filter>
      </defs>
      <rect width="800" height="560" rx="34" fill="url(#bg)"/>
      <circle cx="650" cy="80" r="180" fill="{accent}" opacity=".08"/>
      <circle cx="120" cy="500" r="210" fill="{accent}" opacity=".035"/>
      <rect x="34" y="30" width="732" height="500" rx="28" fill="none" stroke="#FFFFFF" stroke-opacity=".07"/>
      <g filter="url(#shadow)">{icon}</g>
      <rect x="38" y="390" width="724" height="140" rx="24" fill="#080D0C" fill-opacity=".88"/>
      <rect x="62" y="416" width="118" height="28" rx="14" fill="{accent}" fill-opacity=".14" stroke="{accent}" stroke-opacity=".45"/>
      <text x="121" y="436" text-anchor="middle" fill="{accent}" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="700" letter-spacing="1.8">{clean_category}</text>
      <text x="62" y="490" fill="#F4F8F6" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="750">{clean_name}</text>
      <text x="735" y="492" text-anchor="end" fill="{accent}" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="800">KÔMA</text>
      <path d="M62 508 H280" stroke="url(#shine)" stroke-width="2"/>
    </svg>"""
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return IMAGE_PREFIX + encoded


def _product_specs() -> dict[str, tuple[str, str]]:
    return {
        str(product_id): (str(name), str(category_id))
        for product_id, name, category_id, _price, _description in DEMO_PRODUCTS
    }


def build_plan(engine) -> dict[str, Any]:
    m = _imports()
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with Session() as db:
        _assert_demo_scope(db, m)
        specs = _product_specs()
        products = db.query(m["Produto"]).filter(
            m["Produto"].restaurante_id == DEMO_RESTAURANT_ID,
            m["Produto"].id.in_(tuple(specs)),
        ).all()
        existing = sum(1 for product in products if str(product.imagem or "").startswith(IMAGE_PREFIX))
        return {
            "mode": "dry-run",
            "database": _database_name(engine),
            "restaurant_id": DEMO_RESTAURANT_ID,
            "target_products": len(specs),
            "found_products": len(products),
            "already_with_demo_image": existing,
            "will_update": len(products),
            "image_strategy": "embedded_svg_data_uri",
        }


def apply_images(engine, *, expected_database: str) -> dict[str, Any]:
    m = _imports()
    database = _database_name(engine)
    if database != expected_database:
        raise RuntimeError(f"Banco atual {database!r} diverge do banco confirmado {expected_database!r}.")

    specs = _product_specs()
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with Session.begin() as db:
        _assert_demo_scope(db, m)
        products = db.query(m["Produto"]).filter(
            m["Produto"].restaurante_id == DEMO_RESTAURANT_ID,
            m["Produto"].id.in_(tuple(specs)),
        ).all()
        by_id = {str(product.id): product for product in products}
        missing = sorted(set(specs) - set(by_id))
        if missing:
            raise RuntimeError("Produtos canônicos da demo ausentes: " + ", ".join(missing))

        for product_id, (name, category_id) in specs.items():
            product = by_id[product_id]
            if str(product.nome) != name or str(product.categoria_id) != category_id:
                raise RuntimeError(f"Produto demo divergente: {product_id}")
            product.imagem = _svg_data_uri(product_id, name, category_id)

        db.flush()
        validated = db.query(m["Produto"]).filter(
            m["Produto"].restaurante_id == DEMO_RESTAURANT_ID,
            m["Produto"].id.in_(tuple(specs)),
        ).all()
        valid_images = sum(
            1
            for product in validated
            if str(product.imagem or "").startswith(IMAGE_PREFIX)
            and len(str(product.imagem or "")) > 1000
        )
        if valid_images != len(specs):
            raise RuntimeError(
                f"Validação final das imagens falhou: {valid_images}/{len(specs)} produtos válidos."
            )

    return {
        "mode": "apply",
        "validation": "passed",
        "database": database,
        "restaurant_id": DEMO_RESTAURANT_ID,
        "products_with_images": valid_images,
        "image_strategy": "embedded_svg_data_uri",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    url = _database_url()
    os.environ.setdefault("DATABASE_URL", url)
    engine = create_engine(url, pool_pre_ping=True)
    try:
        if args.apply:
            if not args.expected_database:
                raise SystemExit("--expected-database é obrigatório com --apply.")
            result = apply_images(engine, expected_database=args.expected_database)
        else:
            result = build_plan(engine)
            result["apply_command_template"] = (
                "python -m tools.apply_demo_product_images --apply "
                f"--expected-database {result['database']}"
            )
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
