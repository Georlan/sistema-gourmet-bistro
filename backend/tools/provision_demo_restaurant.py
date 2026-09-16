"""Provisiona de forma idempotente o tenant 2 usado na demo presencial.

O comando é somente leitura por padrão. A escrita exige ``--apply`` e o nome
exato do banco. Nenhuma tabela, migration ou tenant diferente do 2 é removido.
Senhas nunca ficam no repositório: são lidas de variáveis de ambiente e apenas
o hash é persistido no banco.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from typing import Any

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import sessionmaker


DEMO_RESTAURANT_ID = 2
DEMO_NAME = "KÔMA Demo"
DEMO_SLUG = "demo"
DEMO_PUBLIC_URL = f"https://{DEMO_SLUG}.komafood.com.br/"
DEMO_OPERATIONAL_URL = "https://app.komafood.com.br/"

DEMO_USERS = (
    {
        "id": "demo-admin-2",
        "nome": "Administrador Demo",
        "email": "demo.admin@komafood.com.br",
        "telefone": "84999992001",
        "cargo": "admin",
        "password_env": "KOMA_DEMO_ADMIN_PASSWORD",
    },
    {
        "id": "demo-caixa-2",
        "nome": "Caixa Demo",
        "email": "demo.caixa@komafood.com.br",
        "telefone": "84999992002",
        "cargo": "caixa",
        "password_env": "KOMA_DEMO_CAIXA_PASSWORD",
    },
    {
        "id": "demo-garcom-2",
        "nome": "Garçom Demo",
        "email": "demo.garcom@komafood.com.br",
        "telefone": "84999992003",
        "cargo": "garcom",
        "password_env": "KOMA_DEMO_GARCOM_PASSWORD",
    },
)

DEMO_CATEGORIES = (
    ("demo-lanches", "Lanches", "COZINHA"),
    ("demo-pratos", "Pratos", "COZINHA"),
    ("demo-bebidas", "Bebidas", "BAR"),
    ("demo-sobremesas", "Sobremesas", "COZINHA"),
)

DEMO_PRODUCTS = (
    ("demo-smash", "KÔMA Smash", "demo-lanches", 24.90, "Pão brioche, carne, queijo e molho da casa."),
    ("demo-bacon", "Bacon Prime", "demo-lanches", 29.90, "Burger com queijo, bacon crocante e molho especial."),
    ("demo-chicken", "Chicken Crispy", "demo-lanches", 25.90, "Frango crocante, queijo e salada fresca."),
    ("demo-executivo", "Executivo da Casa", "demo-pratos", 32.90, "Arroz, feijão, fritas, salada e proteína."),
    ("demo-parmegiana", "Parmegiana Demo", "demo-pratos", 39.90, "Parmegiana, arroz e fritas."),
    ("demo-batata", "Batata KÔMA", "demo-pratos", 16.90, "Batata frita crocante para compartilhar."),
    ("demo-coca", "Coca-Cola Lata", "demo-bebidas", 6.00, "350 ml, servida gelada."),
    ("demo-suco", "Suco de Laranja", "demo-bebidas", 9.00, "Suco natural, 400 ml."),
    ("demo-agua", "Água Mineral", "demo-bebidas", 4.00, "500 ml."),
    ("demo-brownie", "Brownie com Sorvete", "demo-sobremesas", 14.90, "Brownie quente com sorvete de creme."),
    ("demo-pudim", "Pudim da Casa", "demo-sobremesas", 10.90, "Fatia de pudim artesanal."),
)

DEMO_OBSERVATIONS = {
    "demo-lanches": ("Sem cebola", "Molho à parte", "Sem salada"),
    "demo-pratos": ("Sem sal", "Molho à parte"),
    "demo-bebidas": ("Sem gelo", "Com gelo"),
    "demo-sobremesas": ("Sem calda",),
}


def _database_url() -> str:
    value = os.getenv("DEMO_DATABASE_URL", "").strip() or os.getenv("MIGRATION_DATABASE_URL", "").strip()
    if not value:
        raise SystemExit("Defina DEMO_DATABASE_URL ou MIGRATION_DATABASE_URL com credencial administrativa.")
    return value


def _database_name(engine) -> str:
    with engine.connect() as connection:
        if connection.dialect.name == "postgresql":
            return str(connection.execute(text("SELECT current_database()")).scalar_one()).strip()
        return str(engine.url.database or ":memory:")


def _passwords(*, required: bool) -> dict[str, str]:
    result: dict[str, str] = {}
    missing: list[str] = []
    for spec in DEMO_USERS:
        env_name = str(spec["password_env"])
        value = os.getenv(env_name, "")
        if required and (len(value) < 12 or len(value.encode("utf-8")) > 72):
            missing.append(env_name)
        if value:
            result[env_name] = value
    if missing:
        raise RuntimeError(
            "Senhas da demo ausentes ou fora do intervalo de 12 a 72 bytes: " + ", ".join(missing)
        )
    return result


def _imports():
    # app.models importa app.database no carregamento. Para este CLI operacional,
    # fazemos o engine global apontar para o mesmo banco administrativo em vez de
    # cair silenciosamente no SQLite padrão quando o runner só possui MIGRATION_DATABASE_URL.
    os.environ.setdefault("DATABASE_URL", _database_url())
    from app.models import (
        Categoria,
        ConfiguracaoRestaurante,
        GrupoModificador,
        Mesa,
        ObservacaoPredefinida,
        OpcaoModificador,
        Produto,
        ProdutoGrupoModificador,
        Restaurante,
        Usuario,
    )
    from app.security import get_password_hash

    return {
        "Categoria": Categoria,
        "ConfiguracaoRestaurante": ConfiguracaoRestaurante,
        "GrupoModificador": GrupoModificador,
        "Mesa": Mesa,
        "ObservacaoPredefinida": ObservacaoPredefinida,
        "OpcaoModificador": OpcaoModificador,
        "Produto": Produto,
        "ProdutoGrupoModificador": ProdutoGrupoModificador,
        "Restaurante": Restaurante,
        "Usuario": Usuario,
        "get_password_hash": get_password_hash,
    }


def _upsert(db, model, filters: dict[str, Any], values: dict[str, Any]):
    instance = db.query(model).filter_by(**filters).one_or_none()
    if instance is None:
        instance = model(**filters, **values)
        db.add(instance)
    else:
        for key, value in values.items():
            setattr(instance, key, value)
    return instance


def build_plan(engine) -> dict[str, Any]:
    m = _imports()
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with Session() as db:
        restaurant_ids = [int(value) for value in db.execute(select(m["Restaurante"].id).order_by(m["Restaurante"].id)).scalars()]
        existing_demo = db.query(m["Restaurante"]).filter(m["Restaurante"].id == DEMO_RESTAURANT_ID).one_or_none()
        if existing_demo is not None and existing_demo.slug not in {None, DEMO_SLUG}:
            raise RuntimeError(
                f"Trava de segurança: restaurante id=2 já existe com slug {existing_demo.slug!r}; não será alterado."
            )
        return {
            "mode": "dry-run",
            "database": _database_name(engine),
            "existing_restaurant_ids": restaurant_ids,
            "demo_restaurant": {"id": DEMO_RESTAURANT_ID, "name": DEMO_NAME, "slug": DEMO_SLUG},
            "will_create_or_update": {
                "users": len(DEMO_USERS),
                "tables": 6,
                "categories": len(DEMO_CATEGORIES),
                "products": len(DEMO_PRODUCTS),
                "modifier_groups": 1,
                "modifier_options": 3,
            },
            "public_url": DEMO_PUBLIC_URL,
            "operational_url": DEMO_OPERATIONAL_URL,
        }


def apply_demo(engine, *, expected_database: str, passwords: dict[str, str]) -> dict[str, Any]:
    m = _imports()
    database = _database_name(engine)
    if database != expected_database:
        raise RuntimeError(f"Banco atual {database!r} diverge do banco confirmado {expected_database!r}.")

    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with Session.begin() as db:
        ids = [int(value) for value in db.execute(select(m["Restaurante"].id).order_by(m["Restaurante"].id)).scalars()]
        unexpected = [rid for rid in ids if rid not in {1, DEMO_RESTAURANT_ID}]
        if unexpected:
            raise RuntimeError(
                "Trava de segurança: existem tenants inesperados antes da demo: " + ", ".join(map(str, unexpected))
            )
        if 1 not in ids:
            raise RuntimeError("Trava de segurança: restaurante id=1 não existe.")

        existing_demo = db.query(m["Restaurante"]).filter(m["Restaurante"].id == DEMO_RESTAURANT_ID).one_or_none()
        if existing_demo is not None and existing_demo.slug not in {None, DEMO_SLUG}:
            raise RuntimeError("Trava de segurança: id=2 pertence a outro restaurante.")

        restaurant = _upsert(
            db,
            m["Restaurante"],
            {"id": DEMO_RESTAURANT_ID},
            {
                "nome": DEMO_NAME,
                "slug": DEMO_SLUG,
                "plano": "premium",
                "billing_mode": "legacy",
                "saas_status": "active",
                "subtitulo": "Uma operação ao vivo, do QR à cozinha.",
                "sobre_nos": "Ambiente exclusivo para demonstrações presenciais do KÔMA.",
                "status_override": "Forçado Aberto",
                "formas_pagamento_aceitas": ["Dinheiro", "Pix", "Cartão"],
                "cor_primaria": "#00b894",
                "cor_fundo": "#090a0f",
            },
        )
        db.flush()

        config_values = {
            "nicho": "hamburgueria",
            "mapa_mesas_ativo": True,
            "delivery_ativo": True,
            "taxa_servico_ativa": False,
            "taxa_servico_padrao": 10.0,
            "unificar_vias_delivery": False,
            "modo_exclusivo_salao": False,
            "perm_garcom_delivery": True,
            "perm_garcom_editar": True,
            "perm_garcom_taxas": True,
            "perm_garcom_cancelar": True,
            "perm_garcom_status": True,
            "perm_garcom_abrir_vazia": True,
            "perm_garcom_print": True,
            "perm_garcom_fechar": True,
            "perm_garcom_desconto": True,
            "perm_garcom_acrescimo": True,
            "perm_garcom_pessoas": True,
            "perm_garcom_transferir_mesa": True,
            "perm_garcom_transferir_item": True,
            "perm_garcom_chamar": True,
            "perm_garcom_ociosas": True,
            "impressao_nome_restaurante": DEMO_NAME,
            "impressao_nome_posicao": "cabecalho",
            "impressao_mensagem_rodape": "DEMO KÔMA — obrigado por participar!",
            "impressao_mostrar_descricao": True,
        }
        _upsert(db, m["ConfiguracaoRestaurante"], {"restaurante_id": DEMO_RESTAURANT_ID}, config_values)

        for spec in DEMO_USERS:
            env_name = str(spec["password_env"])
            _upsert(
                db,
                m["Usuario"],
                {"id": spec["id"]},
                {
                    "restaurante_id": DEMO_RESTAURANT_ID,
                    "nome": spec["nome"],
                    "email": spec["email"],
                    "telefone": spec["telefone"],
                    "cargo": spec["cargo"],
                    "status": "ativo",
                    "senha_hash": m["get_password_hash"](passwords[env_name]),
                    "token_convite": None,
                    "token_expira_em": None,
                },
            )

        for table_id in range(1, 7):
            _upsert(
                db,
                m["Mesa"],
                {"restaurante_id": DEMO_RESTAURANT_ID, "id": table_id},
                {"capacidade": 4, "nome": f"Mesa {table_id}"},
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
                    {
                        "restaurante_id": DEMO_RESTAURANT_ID,
                        "categoria_id": category_id,
                        "texto": observation,
                    },
                    {},
                )

        group = _upsert(
            db,
            m["GrupoModificador"],
            {"restaurante_id": DEMO_RESTAURANT_ID, "id": "demo-adicionais-burger"},
            {"nome": "Adicionais", "min_selecoes": 0, "max_selecoes": 3, "tipo": "opcional"},
        )
        db.flush()
        for option_id, name, price in (
            ("demo-add-queijo", "Queijo extra", 3.0),
            ("demo-add-bacon", "Bacon extra", 5.0),
            ("demo-add-ovo", "Ovo", 3.0),
        ):
            _upsert(
                db,
                m["OpcaoModificador"],
                {"restaurante_id": DEMO_RESTAURANT_ID, "id": option_id},
                {"grupo_id": group.id, "nome": name, "preco_adicional": price, "ativo": True},
            )

        for product_id in ("demo-smash", "demo-bacon"):
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
            "users": db.query(m["Usuario"]).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count(),
            "tables": db.query(m["Mesa"]).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count(),
            "categories": db.query(m["Categoria"]).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count(),
            "products": db.query(m["Produto"]).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count(),
            "modifier_groups": db.query(m["GrupoModificador"]).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count(),
            "modifier_options": db.query(m["OpcaoModificador"]).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count(),
        }
        expected_minimum = {
            "users": 3,
            "tables": 6,
            "categories": 4,
            "products": 11,
            "modifier_groups": 1,
            "modifier_options": 3,
        }
        failed = {name: (counts[name], minimum) for name, minimum in expected_minimum.items() if counts[name] < minimum}
        if failed:
            raise RuntimeError(f"Validação final da demo falhou: {failed}")

    return {
        "mode": "apply",
        "validation": "passed",
        "database": database,
        "restaurant": {"id": DEMO_RESTAURANT_ID, "name": DEMO_NAME, "slug": DEMO_SLUG},
        "counts": counts,
        "logins": {spec["cargo"]: spec["email"] for spec in DEMO_USERS},
        "passwords": "stored_only_as_hashes; source values remain only in Railway variables",
        "public_url": DEMO_PUBLIC_URL,
        "operational_url": DEMO_OPERATIONAL_URL,
        "printer_pairing_required": True,
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
            result = apply_demo(
                engine,
                expected_database=args.expected_database,
                passwords=_passwords(required=True),
            )
        else:
            result = build_plan(engine)
            result["apply_command_template"] = (
                "python -m tools.provision_demo_restaurant --apply "
                f"--expected-database {result['database']}"
            )
        rendered = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True, default=str)
        print(rendered)
        if args.report_json:
            with open(args.report_json, "w", encoding="utf-8") as handle:
                handle.write(rendered + "\n")
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
