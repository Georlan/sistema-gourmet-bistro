"""Enriquece o tenant KÔMA Demo (id=2) para apresentação presencial.

Somente leitura por padrão. A escrita exige ``--apply`` e o nome exato do banco.
Não cria nem remove tenants, não altera usuários/senhas e não toca no restaurante 1.
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from tools.provision_demo_restaurant import (
    DEMO_RESTAURANT_ID,
    DEMO_SLUG,
    _database_name,
    _database_url,
    _imports,
    _upsert,
)

DEMO_TABLE_COUNT = 30

DEMO_CATEGORIES = (
    ("demo-lanches", "Lanches", "COZINHA"),
    ("demo-pratos", "Pratos", "COZINHA"),
    ("demo-porcoes", "Porções", "COZINHA"),
    ("demo-combos", "Combos", "COZINHA"),
    ("demo-bebidas", "Bebidas", "BAR"),
    ("demo-sobremesas", "Sobremesas", "COZINHA"),
)

DEMO_PRODUCTS = (
    ("demo-smash", "KÔMA Smash", "demo-lanches", 24.90, "Pão brioche, carne, queijo e molho da casa."),
    ("demo-bacon", "Bacon Prime", "demo-lanches", 29.90, "Burger com queijo, bacon crocante e molho especial."),
    ("demo-chicken", "Chicken Crispy", "demo-lanches", 25.90, "Frango crocante, queijo e salada fresca."),
    ("demo-cheddar", "Cheddar Melt", "demo-lanches", 27.90, "Burger, cheddar cremoso e cebola caramelizada."),
    ("demo-duplo", "Duplo Grill", "demo-lanches", 34.90, "Dois burgers, queijo duplo e molho da casa."),
    ("demo-salada", "Fresh Burger", "demo-lanches", 26.90, "Burger, queijo, alface, tomate e molho leve."),
    ("demo-veggie", "Veggie Crocante", "demo-lanches", 26.90, "Burger vegetal crocante, queijo e salada."),

    ("demo-executivo", "Executivo da Casa", "demo-pratos", 32.90, "Arroz, feijão, fritas, salada e proteína."),
    ("demo-parmegiana", "Parmegiana da Casa", "demo-pratos", 39.90, "Parmegiana, arroz e fritas."),
    ("demo-frango-grelhado", "Frango Grelhado", "demo-pratos", 31.90, "Filé de frango grelhado com arroz, feijão e salada."),
    ("demo-file-acebolado", "Filé Acebolado", "demo-pratos", 42.90, "Filé acebolado com arroz, feijão e fritas."),
    ("demo-peixe-crocante", "Peixe Crocante", "demo-pratos", 36.90, "Filé de peixe crocante com arroz e salada."),
    ("demo-arroz-brasa", "Arroz da Brasa", "demo-pratos", 34.90, "Arroz cremoso com carne grelhada e legumes."),

    ("demo-batata", "Batata KÔMA", "demo-porcoes", 16.90, "Batata frita crocante para compartilhar."),
    ("demo-batata-cheddar", "Fritas Cheddar & Bacon", "demo-porcoes", 24.90, "Fritas com cheddar cremoso e bacon."),
    ("demo-onion", "Onion Rings", "demo-porcoes", 19.90, "Anéis de cebola empanados e crocantes."),
    ("demo-iscas-frango", "Iscas de Frango", "demo-porcoes", 27.90, "Iscas de frango crocantes para compartilhar."),
    ("demo-calabresa", "Calabresa Acebolada", "demo-porcoes", 25.90, "Calabresa grelhada com cebola e pão da casa."),
    ("demo-mandioca", "Mandioca Crocante", "demo-porcoes", 18.90, "Mandioca frita sequinha com molho da casa."),

    ("demo-combo-classico", "Combo Clássico", "demo-combos", 34.90, "KÔMA Smash, fritas e bebida."),
    ("demo-combo-bacon", "Combo Bacon", "demo-combos", 39.90, "Bacon Prime, fritas e bebida."),
    ("demo-combo-crispy", "Combo Crispy", "demo-combos", 36.90, "Chicken Crispy, fritas e bebida."),

    ("demo-coca", "Coca-Cola Lata", "demo-bebidas", 6.00, "350 ml, servida gelada."),
    ("demo-guarana", "Guaraná Lata", "demo-bebidas", 6.00, "350 ml, servido gelado."),
    ("demo-suco", "Suco de Laranja", "demo-bebidas", 9.00, "Suco natural, 400 ml."),
    ("demo-soda", "Soda de Limão", "demo-bebidas", 8.00, "Soda cítrica com gelo e limão."),
    ("demo-agua", "Água Mineral", "demo-bebidas", 4.00, "500 ml."),

    ("demo-brownie", "Brownie com Sorvete", "demo-sobremesas", 14.90, "Brownie quente com sorvete de creme."),
    ("demo-pudim", "Pudim da Casa", "demo-sobremesas", 10.90, "Fatia de pudim artesanal."),
    ("demo-mousse", "Mousse de Chocolate", "demo-sobremesas", 11.90, "Mousse cremosa de chocolate."),
)

DEMO_OBSERVATIONS = {
    "demo-lanches": ("Sem cebola", "Sem tomate", "Sem salada", "Molho à parte", "Cortar ao meio"),
    "demo-pratos": ("Sem sal", "Sem feijão", "Sem salada", "Molho à parte", "Fritas bem crocantes"),
    "demo-porcoes": ("Pouco sal", "Sem cebola", "Molho à parte", "Bem crocante"),
    "demo-combos": ("Sem cebola", "Molho à parte", "Fritas sem sal"),
    "demo-bebidas": ("Sem gelo", "Pouco gelo", "Com gelo", "Com limão"),
    "demo-sobremesas": ("Sem calda", "Calda à parte"),
}

MODIFIER_GROUPS = (
    {
        "id": "demo-adicionais-burger",
        "name": "Adicionais do lanche",
        "min": 0,
        "max": 5,
        "options": (
            ("demo-add-queijo", "Queijo extra", 3.0),
            ("demo-add-bacon", "Bacon extra", 5.0),
            ("demo-add-ovo", "Ovo", 3.0),
            ("demo-add-carne", "Burger extra", 8.0),
            ("demo-add-cheddar", "Cheddar cremoso", 4.0),
            ("demo-add-cebola", "Cebola caramelizada", 3.0),
            ("demo-add-picles", "Picles", 2.0),
            ("demo-add-molho", "Molho especial", 2.0),
        ),
        "products": (
            "demo-smash", "demo-bacon", "demo-chicken", "demo-cheddar",
            "demo-duplo", "demo-salada", "demo-veggie",
        ),
    },
    {
        "id": "demo-ponto-carne",
        "name": "Preferência da carne",
        "min": 0,
        "max": 1,
        "options": (
            ("demo-carne-mal", "Mal passada", 0.0),
            ("demo-carne-ponto", "Ao ponto", 0.0),
            ("demo-carne-bem", "Bem passada", 0.0),
        ),
        "products": ("demo-smash", "demo-bacon", "demo-cheddar", "demo-duplo", "demo-salada"),
    },
    {
        "id": "demo-molhos",
        "name": "Molhos extras",
        "min": 0,
        "max": 3,
        "options": (
            ("demo-molho-maionese", "Maionese da casa", 2.0),
            ("demo-molho-barbecue", "Barbecue", 2.0),
            ("demo-molho-picante", "Molho picante", 2.0),
            ("demo-molho-alho", "Alho cremoso", 2.0),
            ("demo-molho-ketchup", "Ketchup", 0.0),
            ("demo-molho-mostarda", "Mostarda", 0.0),
        ),
        "products": (
            "demo-smash", "demo-bacon", "demo-chicken", "demo-cheddar", "demo-duplo", "demo-salada",
            "demo-batata", "demo-batata-cheddar", "demo-onion", "demo-iscas-frango", "demo-mandioca",
        ),
    },
    {
        "id": "demo-complementos-porcao",
        "name": "Incrementar porção",
        "min": 0,
        "max": 4,
        "options": (
            ("demo-porcao-cheddar", "Cheddar", 4.0),
            ("demo-porcao-bacon", "Bacon", 5.0),
            ("demo-porcao-calabresa", "Calabresa", 6.0),
            ("demo-porcao-catupiry", "Catupiry", 4.0),
            ("demo-porcao-parmesao", "Parmesão", 3.0),
        ),
        "products": (
            "demo-batata", "demo-batata-cheddar", "demo-onion",
            "demo-iscas-frango", "demo-calabresa", "demo-mandioca",
        ),
    },
    {
        "id": "demo-bebida-combo",
        "name": "Bebida do combo",
        "min": 1,
        "max": 1,
        "options": (
            ("demo-combo-coca", "Coca-Cola Lata", 0.0),
            ("demo-combo-guarana", "Guaraná Lata", 0.0),
            ("demo-combo-agua", "Água Mineral", 0.0),
            ("demo-combo-suco", "Suco de Laranja", 3.0),
        ),
        "products": ("demo-combo-classico", "demo-combo-bacon", "demo-combo-crispy"),
    },
    {
        "id": "demo-acompanhamentos-prato",
        "name": "Acompanhamento extra",
        "min": 0,
        "max": 2,
        "options": (
            ("demo-prato-fritas", "Fritas", 6.0),
            ("demo-prato-salada", "Salada", 5.0),
            ("demo-prato-arroz", "Arroz", 4.0),
            ("demo-prato-feijao", "Feijão", 4.0),
        ),
        "products": (
            "demo-executivo", "demo-parmegiana", "demo-frango-grelhado",
            "demo-file-acebolado", "demo-peixe-crocante", "demo-arroz-brasa",
        ),
    },
)


def _assert_demo_scope(db, m) -> None:
    ids = [int(value) for value in db.execute(select(m["Restaurante"].id).order_by(m["Restaurante"].id)).scalars()]
    if 1 not in ids:
        raise RuntimeError("Trava de segurança: restaurante id=1 não existe.")
    unexpected = [rid for rid in ids if rid not in {1, DEMO_RESTAURANT_ID}]
    if unexpected:
        raise RuntimeError("Trava de segurança: tenants inesperados: " + ", ".join(map(str, unexpected)))
    demo = db.query(m["Restaurante"]).filter_by(id=DEMO_RESTAURANT_ID).one_or_none()
    if demo is None or demo.slug != DEMO_SLUG:
        raise RuntimeError("Trava de segurança: KÔMA Demo id=2/slug=demo não está provisionado corretamente.")


def build_plan(engine) -> dict[str, Any]:
    m = _imports()
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with Session() as db:
        _assert_demo_scope(db, m)
        return {
            "mode": "dry-run",
            "database": _database_name(engine),
            "restaurant_id": DEMO_RESTAURANT_ID,
            "will_create_or_update": {
                "tables": DEMO_TABLE_COUNT,
                "categories": len(DEMO_CATEGORIES),
                "products": len(DEMO_PRODUCTS),
                "modifier_groups": len(MODIFIER_GROUPS),
                "modifier_options": sum(len(group["options"]) for group in MODIFIER_GROUPS),
                "observations": sum(len(values) for values in DEMO_OBSERVATIONS.values()),
            },
        }


def apply_enrichment(engine, *, expected_database: str) -> dict[str, Any]:
    m = _imports()
    database = _database_name(engine)
    if database != expected_database:
        raise RuntimeError(f"Banco atual {database!r} diverge do banco confirmado {expected_database!r}.")

    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with Session.begin() as db:
        _assert_demo_scope(db, m)

        for table_id in range(1, DEMO_TABLE_COUNT + 1):
            capacity = 6 if table_id % 10 == 0 else 4 if table_id % 3 else 2
            _upsert(
                db,
                m["Mesa"],
                {"restaurante_id": DEMO_RESTAURANT_ID, "id": table_id},
                {"capacidade": capacity, "nome": f"Mesa {table_id:02d}"},
            )

        for category_id, name, destination in DEMO_CATEGORIES:
            _upsert(
                db,
                m["Categoria"],
                {"restaurante_id": DEMO_RESTAURANT_ID, "id": category_id},
                {"nome": name, "destino_impressao": destination},
            )
        db.flush()

        for product_id, name, category_id, price, description in DEMO_PRODUCTS:
            _upsert(
                db,
                m["Produto"],
                {"restaurante_id": DEMO_RESTAURANT_ID, "id": product_id},
                {
                    "nome": name,
                    "categoria_id": category_id,
                    "preco": price,
                    "descricao": description,
                    "imagem": "",
                    "imagens_galeria": [],
                    "ativo": True,
                },
            )
        db.flush()

        for category_id, observations in DEMO_OBSERVATIONS.items():
            for observation in observations:
                _upsert(
                    db,
                    m["ObservacaoPredefinida"],
                    {"restaurante_id": DEMO_RESTAURANT_ID, "categoria_id": category_id, "texto": observation},
                    {},
                )

        for group_spec in MODIFIER_GROUPS:
            group = _upsert(
                db,
                m["GrupoModificador"],
                {"restaurante_id": DEMO_RESTAURANT_ID, "id": group_spec["id"]},
                {
                    "nome": group_spec["name"],
                    "min_selecoes": group_spec["min"],
                    "max_selecoes": group_spec["max"],
                    "tipo": "opcional" if group_spec["min"] == 0 else "obrigatorio",
                },
            )
            db.flush()
            for option_id, name, price in group_spec["options"]:
                _upsert(
                    db,
                    m["OpcaoModificador"],
                    {"restaurante_id": DEMO_RESTAURANT_ID, "id": option_id},
                    {"grupo_id": group.id, "nome": name, "preco_adicional": price, "ativo": True},
                )
            for product_id in group_spec["products"]:
                _upsert(
                    db,
                    m["ProdutoGrupoModificador"],
                    {
                        "restaurante_id": DEMO_RESTAURANT_ID,
                        "produto_id": product_id,
                        "grupo_id": group.id,
                    },
                    {},
                )

        db.flush()
        counts = {
            "tables": db.query(m["Mesa"]).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count(),
            "categories": db.query(m["Categoria"]).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count(),
            "products": db.query(m["Produto"]).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count(),
            "modifier_groups": db.query(m["GrupoModificador"]).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count(),
            "modifier_options": db.query(m["OpcaoModificador"]).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count(),
            "observations": db.query(m["ObservacaoPredefinida"]).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count(),
        }
        expected_minimum = {
            "tables": DEMO_TABLE_COUNT,
            "categories": len(DEMO_CATEGORIES),
            "products": len(DEMO_PRODUCTS),
            "modifier_groups": len(MODIFIER_GROUPS),
            "modifier_options": sum(len(group["options"]) for group in MODIFIER_GROUPS),
            "observations": sum(len(values) for values in DEMO_OBSERVATIONS.values()),
        }
        failed = {name: (counts[name], minimum) for name, minimum in expected_minimum.items() if counts[name] < minimum}
        if failed:
            raise RuntimeError(f"Validação final do enriquecimento falhou: {failed}")

    return {
        "mode": "apply",
        "validation": "passed",
        "database": database,
        "restaurant_id": DEMO_RESTAURANT_ID,
        "counts": counts,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--report-json")
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
            result = apply_enrichment(engine, expected_database=args.expected_database)
        else:
            result = build_plan(engine)
            result["apply_command_template"] = (
                "python -m tools.enrich_demo_restaurant --apply "
                f"--expected-database {result['database']}"
            )
        rendered = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True)
        print(rendered)
        if args.report_json:
            with open(args.report_json, "w", encoding="utf-8") as handle:
                handle.write(rendered + "\n")
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
