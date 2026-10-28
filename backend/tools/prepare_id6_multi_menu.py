"""Ferramenta idempotente de preparação dos múltiplos cardápios operacionais do Restaurante ID 6 (Quentinhas Caseiras).

Uso:
  python -m tools.prepare_id6_multi_menu --tenant-id 6
  python -m tools.prepare_id6_multi_menu --tenant-id 6 --apply

Sem --apply, todas as alterações são revertidas (dry-run).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

try:
    import dotenv

    dotenv.load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    dotenv.load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except ImportError:
    pass

if os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").startswith("sb_publishable_"):
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = ""

import app.models  # noqa: F401
import app.financial_models  # noqa: F401
import app.print_job_invariants  # noqa: F401
import app.services.product_image_lifecycle  # noqa: F401
from app.database import SessionLocal, current_restaurante_id
from app.models import (
    Cardapio,
    Categoria,
    ConfiguracaoRestaurante,
    GrupoModificador,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
    SuperAdminAuditLog,
)


class MultiMenuPrepError(RuntimeError):
    pass


MORNING_CATALOG_SPEC = [
    {
        "categoria": "Bolos",
        "ordem": 1,
        "produtos": [
            {"nome": "Bolo fofo", "preco": Decimal("5.00"), "descricao": "Fatia de bolo fofo caseiro tradicional"},
            {"nome": "Bolo liso", "preco": Decimal("5.00"), "descricao": "Fatia de bolo liso caseiro"},
            {"nome": "Bolo de chocolate", "preco": Decimal("8.00"), "descricao": "Fatia de bolo de chocolate caseiro"},
        ],
    },
    {
        "categoria": "Cuscuz",
        "ordem": 2,
        "produtos": [
            {
                "nome": "Cuscuz recheado",
                "preco": Decimal("10.00"),
                "descricao": "Cuscuz quentinho recheado (Ovo, calabresa, frango, carne moída)",
            },
            {
                "nome": "Cuscuz paulista com molho branco",
                "preco": Decimal("12.00"),
                "descricao": "Cuscuz paulista servido com molho branco especial",
            },
            {
                "nome": "Cuscuz de cupim",
                "preco": Decimal("15.00"),
                "descricao": "Cuscuz quentinho recheado com cupim desfiado",
            },
            {
                "nome": "Cuscuz de carne moída",
                "preco": Decimal("13.00"),
                "descricao": "Cuscuz quentinho recheado com carne moída temperada",
            },
            {
                "nome": "Cuscuz de frango",
                "preco": Decimal("10.00"),
                "descricao": "Cuscuz quentinho recheado com frango desfiado",
            },
        ],
    },
    {
        "categoria": "Tapiocas",
        "ordem": 3,
        "produtos": [
            {"nome": "Tapioca amanteigada", "preco": Decimal("4.00"), "descricao": "Tapioca fina e crocante na manteiga"},
            {"nome": "Tapioca com nata", "preco": Decimal("5.00"), "descricao": "Tapioca recheada com nata fresca"},
            {
                "nome": "Tapioca recheada (Monte a sua)",
                "preco": Decimal("4.00"),
                "descricao": "Escolha seus recheios favoritos (ovo, carne de sol, cupim, frango, carne moída, calabresa, bacon, queijo coalho, mussarela, presunto, cream cheese, catupiry)",
            },
        ],
    },
    {
        "categoria": "Pastéis",
        "ordem": 4,
        "produtos": [
            {"nome": "Pastel de queijo", "preco": Decimal("5.00"), "descricao": "Pastel crocante de queijo frito na hora"},
            {"nome": "Pastel de frango", "preco": Decimal("7.00"), "descricao": "Pastel crocante de frango frito na hora"},
            {"nome": "Pastel de carne", "preco": Decimal("9.00"), "descricao": "Pastel crocante de carne moída frito na hora"},
            {"nome": "Pastel misto", "preco": Decimal("10.00"), "descricao": "Pastel crocante misto de queijo e presunto"},
            {"nome": "Pastel carne com bacon", "preco": Decimal("10.00"), "descricao": "Pastel crocante de carne com pedacinhos de bacon"},
        ],
    },
    {
        "categoria": "Sanduíches",
        "ordem": 5,
        "produtos": [
            {
                "nome": "Sanduíche Misto",
                "preco": Decimal("6.00"),
                "descricao": "Salada opcional. Pão hambúrguer ou pão carioca.",
            },
            {
                "nome": "Sanduíche Carne e queijo",
                "preco": Decimal("8.00"),
                "descricao": "Salada opcional. Pão hambúrguer ou pão carioca.",
            },
            {
                "nome": "Sanduíche Carne, queijo e ovo",
                "preco": Decimal("10.00"),
                "descricao": "Salada opcional. Pão hambúrguer ou pão carioca.",
            },
        ],
    },
    {
        "categoria": "Caldo",
        "ordem": 6,
        "produtos": [
            {"nome": "Caldo", "preco": Decimal("8.00"), "descricao": "Caldo quentinho caseiro reconfortante"},
        ],
    },
    {
        "categoria": "Panelada",
        "ordem": 7,
        "produtos": [
            {"nome": "Panelada", "preco": Decimal("15.00"), "descricao": "Panelada tradicional. Acompanha arroz e cuscuz."},
        ],
    },
    {
        "categoria": "Bebidas Quentes",
        "ordem": 8,
        "produtos": [
            {"nome": "Café", "preco": Decimal("0.00"), "descricao": "Café passado quente na hora (Preço pendente de conferência)"},
            {"nome": "Café com leite", "preco": Decimal("0.00"), "descricao": "Café com leite quentinho (Preço pendente de conferência)"},
            {"nome": "Capuccino", "preco": Decimal("0.00"), "descricao": "Capuccino cremoso (Preço pendente de conferência)"},
            {"nome": "Chocolate quente", "preco": Decimal("0.00"), "descricao": "Chocolate quente cremoso (Preço pendente de conferência)"},
        ],
    },
    {
        "categoria": "Sucos",
        "ordem": 9,
        "produtos": [
            {"nome": "Suco de Laranja", "preco": Decimal("7.00"), "descricao": "Suco natural de laranja gelado"},
            {"nome": "Suco de Morango", "preco": Decimal("7.00"), "descricao": "Suco natural de morango gelado"},
            {"nome": "Suco de Abacaxi", "preco": Decimal("7.00"), "descricao": "Suco natural de abacaxi gelado"},
            {"nome": "Suco de Maracujá", "preco": Decimal("7.00"), "descricao": "Suco natural de maracujá gelado"},
        ],
    },
]


def prepare_id6_multi_menu(
    *,
    tenant_id: int,
    apply: bool = False,
    reason: str = "Preparação idempotente de cardápios independentes: Manhã e Meio-Dia",
) -> dict[str, Any]:
    if tenant_id != 6:
        raise MultiMenuPrepError(
            f"Esta ferramenta foi desenhada estritamente para o tenant 6 (recebido: {tenant_id}). "
            "Para outros tenants, utilize a API administrativa."
        )

    db = SessionLocal()
    token = current_restaurante_id.set(tenant_id)
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == tenant_id).first()
        if not restaurante:
            raise MultiMenuPrepError(f"Restaurante ID {tenant_id} não encontrado no banco de dados.")

        config = (
            db.query(ConfiguracaoRestaurante)
            .filter(ConfiguracaoRestaurante.restaurante_id == tenant_id)
            .first()
        )
        if not config:
            config = ConfiguracaoRestaurante(restaurante_id=tenant_id)
            db.add(config)
            db.flush()

        # 1. Obter ou criar os 2 cardápios
        cardapio_manha = (
            db.query(Cardapio)
            .filter(
                Cardapio.restaurante_id == tenant_id,
                Cardapio.identificador == "manha",
            )
            .first()
        )
        created_manha = False
        if not cardapio_manha:
            cardapio_manha = Cardapio(
                id=str(uuid.uuid4()),
                restaurante_id=tenant_id,
                nome="Manhã",
                identificador="manha",
                descricao="Cardápio matinal: cuscuz, tapiocas, bolos, pastéis, sanduíches e bebidas",
                ordem_exibicao=1,
            )
            db.add(cardapio_manha)
            db.flush()
            created_manha = True

        cardapio_meio_dia = (
            db.query(Cardapio)
            .filter(
                Cardapio.restaurante_id == tenant_id,
                Cardapio.identificador == "meio-dia",
            )
            .first()
        )
        created_meio_dia = False
        if not cardapio_meio_dia:
            cardapio_meio_dia = Cardapio(
                id=str(uuid.uuid4()),
                restaurante_id=tenant_id,
                nome="Meio-Dia",
                identificador="meio-dia",
                descricao="Cardápio do almoço: quentinhas, marmitas e refeições",
                ordem_exibicao=2,
            )
            db.add(cardapio_meio_dia)
            db.flush()
            created_meio_dia = True

        # 2. Migrar produtos existentes sem cardapio_id para "Meio-Dia"
        existing_products = (
            db.query(Produto)
            .filter(Produto.restaurante_id == tenant_id)
            .all()
        )
        migrated_to_meio_dia = 0
        for prod in existing_products:
            if prod.cardapio_id is None:
                prod.cardapio_id = cardapio_meio_dia.id
                migrated_to_meio_dia += 1

        # 3. Definir cardapio_ativo_id como "Meio-Dia" se não definido
        active_menu_changed = False
        if not config.cardapio_ativo_id:
            config.cardapio_ativo_id = cardapio_meio_dia.id
            active_menu_changed = True

        # 4. Cadastrar categorias e produtos do Cardápio da Manhã
        created_categories = []
        created_products = []
        existing_morning_products = []

        existing_categories = (
            db.query(Categoria)
            .filter(Categoria.restaurante_id == tenant_id)
            .all()
        )
        cat_map = {c.nome.strip().lower(): c for c in existing_categories}

        for cat_spec in MORNING_CATALOG_SPEC:
            cat_name = cat_spec["categoria"]
            cat_norm = cat_name.strip().lower()
            categoria = cat_map.get(cat_norm)
            if not categoria:
                categoria = Categoria(
                    id=str(uuid.uuid4()),
                    restaurante_id=tenant_id,
                    nome=cat_name,
                    ordem_exibicao=cat_spec["ordem"],
                )
                db.add(categoria)
                db.flush()
                cat_map[cat_norm] = categoria
                created_categories.append(cat_name)

            for prod_spec in cat_spec["produtos"]:
                prod_name = prod_spec["nome"]
                existing_prod = (
                    db.query(Produto)
                    .filter(
                        Produto.restaurante_id == tenant_id,
                        Produto.nome == prod_name,
                    )
                    .first()
                )
                if not existing_prod:
                    new_prod = Produto(
                        id=str(uuid.uuid4()),
                        restaurante_id=tenant_id,
                        categoria_id=categoria.id,
                        cardapio_id=cardapio_manha.id,
                        nome=prod_name,
                        preco=prod_spec["preco"],
                        descricao=prod_spec["descricao"],
                        ativo=(cat_norm in {"cuscuz", "bolos", "panelada", "sanduíches", "sanduiches"}),
                    )
                    db.add(new_prod)
                    created_products.append(prod_name)
                else:
                    # Garantir que pertence a "Manhã"
                    if existing_prod.cardapio_id != cardapio_manha.id:
                        existing_prod.cardapio_id = cardapio_manha.id
                    existing_morning_products.append(prod_name)

        db.flush()

        # 4. Modificadores e Adicionais Matinais
        grupo_tapioca = (
            db.query(GrupoModificador)
            .filter(GrupoModificador.restaurante_id == tenant_id, GrupoModificador.nome == "Recheios da Tapioca")
            .first()
        )
        if not grupo_tapioca:
            grupo_tapioca = GrupoModificador(
                id=str(uuid.uuid4()),
                restaurante_id=tenant_id,
                nome="Recheios da Tapioca",
                tipo="obrigatorio",
                min_selecoes=1,
                max_selecoes=12,
            )
            db.add(grupo_tapioca)
            db.flush()
        else:
            grupo_tapioca.tipo = "obrigatorio"
            grupo_tapioca.min_selecoes = 1
            grupo_tapioca.max_selecoes = 12

        recheios_spec = [
            ("Ovo", Decimal("3.00")),
            ("Carne de sol", Decimal("8.00")),
            ("Cupim", Decimal("10.00")),
            ("Frango", Decimal("5.00")),
            ("Carne moída", Decimal("7.00")),
            ("Calabresa", Decimal("4.00")),
            ("Bacon", Decimal("4.00")),
            ("Queijo coalho", Decimal("4.00")),
            ("Mussarela", Decimal("6.00")),
            ("Presunto", Decimal("4.00")),
            ("Cream cheese", Decimal("6.00")),
            ("Catupiry", Decimal("6.00")),
        ]
        for nome, preco in recheios_spec:
            op = (
                db.query(OpcaoModificador)
                .filter(
                    OpcaoModificador.restaurante_id == tenant_id,
                    OpcaoModificador.grupo_id == grupo_tapioca.id,
                    OpcaoModificador.nome == nome,
                )
                .first()
            )
            if not op:
                db.add(
                    OpcaoModificador(
                        id=str(uuid.uuid4()),
                        restaurante_id=tenant_id,
                        grupo_id=grupo_tapioca.id,
                        nome=nome,
                        preco_adicional=preco,
                        ativo=True,
                    )
                )

        p_tapioca = (
            db.query(Produto)
            .filter(Produto.restaurante_id == tenant_id, Produto.nome == "Tapioca recheada (Monte a sua)")
            .first()
        )
        if p_tapioca:
            link_tap = (
                db.query(ProdutoGrupoModificador)
                .filter(
                    ProdutoGrupoModificador.restaurante_id == tenant_id,
                    ProdutoGrupoModificador.produto_id == p_tapioca.id,
                    ProdutoGrupoModificador.grupo_id == grupo_tapioca.id,
                )
                .first()
            )
            if not link_tap:
                db.add(
                    ProdutoGrupoModificador(
                        restaurante_id=tenant_id,
                        produto_id=p_tapioca.id,
                        grupo_id=grupo_tapioca.id,
                        min_selecoes=1,
                        max_selecoes=12,
                        modo_selecao="tipos",
                    )
                )
            else:
                link_tap.min_selecoes = 1
                link_tap.max_selecoes = 12
                link_tap.modo_selecao = "tipos"

        grupo_pao = (
            db.query(GrupoModificador)
            .filter(GrupoModificador.restaurante_id == tenant_id, GrupoModificador.nome == "Escolha o Pão")
            .first()
        )
        if not grupo_pao:
            grupo_pao = GrupoModificador(
                id=str(uuid.uuid4()),
                restaurante_id=tenant_id,
                nome="Escolha o Pão",
                tipo="obrigatorio",
                min_selecoes=1,
                max_selecoes=1,
            )
            db.add(grupo_pao)
            db.flush()

        for p_nome in ["Pão de Hambúrguer", "Pão Carioca"]:
            op = (
                db.query(OpcaoModificador)
                .filter(
                    OpcaoModificador.restaurante_id == tenant_id,
                    OpcaoModificador.grupo_id == grupo_pao.id,
                    OpcaoModificador.nome == p_nome,
                )
                .first()
            )
            if not op:
                db.add(
                    OpcaoModificador(
                        id=str(uuid.uuid4()),
                        restaurante_id=tenant_id,
                        grupo_id=grupo_pao.id,
                        nome=p_nome,
                        preco_adicional=Decimal("0.00"),
                        ativo=True,
                    )
                )

        grupo_salada = (
            db.query(GrupoModificador)
            .filter(GrupoModificador.restaurante_id == tenant_id, GrupoModificador.nome == "Salada")
            .first()
        )
        if not grupo_salada:
            grupo_salada = GrupoModificador(
                id=str(uuid.uuid4()),
                restaurante_id=tenant_id,
                nome="Salada",
                tipo="opcional",
                min_selecoes=0,
                max_selecoes=1,
            )
            db.add(grupo_salada)
            db.flush()

        for s_nome in ["Com salada", "Sem salada"]:
            op = (
                db.query(OpcaoModificador)
                .filter(
                    OpcaoModificador.restaurante_id == tenant_id,
                    OpcaoModificador.grupo_id == grupo_salada.id,
                    OpcaoModificador.nome == s_nome,
                )
                .first()
            )
            if not op:
                db.add(
                    OpcaoModificador(
                        id=str(uuid.uuid4()),
                        restaurante_id=tenant_id,
                        grupo_id=grupo_salada.id,
                        nome=s_nome,
                        preco_adicional=Decimal("0.00"),
                        ativo=True,
                    )
                )

        db.flush()

        sanduiches = (
            db.query(Produto)
            .filter(Produto.restaurante_id == tenant_id, Produto.nome.ilike("Sanduíche%"))
            .all()
        )
        for sand in sanduiches:
            for grp, min_s, max_s in [(grupo_pao, 1, 1), (grupo_salada, 0, 1)]:
                link_sand = (
                    db.query(ProdutoGrupoModificador)
                    .filter(
                        ProdutoGrupoModificador.restaurante_id == tenant_id,
                        ProdutoGrupoModificador.produto_id == sand.id,
                        ProdutoGrupoModificador.grupo_id == grp.id,
                    )
                    .first()
                )
                if not link_sand:
                    db.add(
                        ProdutoGrupoModificador(
                            restaurante_id=tenant_id,
                            produto_id=sand.id,
                            grupo_id=grp.id,
                            min_selecoes=min_s,
                            max_selecoes=max_s,
                            modo_selecao="tipos",
                        )
                    )
                else:
                    link_sand.min_selecoes = min_s
                    link_sand.max_selecoes = max_s
                    link_sand.modo_selecao = "tipos"

        summary = {
            "tenant_id": tenant_id,
            "cardapio_manha": {
                "id": cardapio_manha.id,
                "nome": cardapio_manha.nome,
                "created": created_manha,
            },
            "cardapio_meio_dia": {
                "id": cardapio_meio_dia.id,
                "nome": cardapio_meio_dia.nome,
                "created": created_meio_dia,
            },
            "active_menu_id": config.cardapio_ativo_id,
            "active_menu_changed": active_menu_changed,
            "existing_products_migrated_to_meio_dia": migrated_to_meio_dia,
            "categories_created": created_categories,
            "products_created_morning": created_products,
            "existing_morning_products_reconciled": existing_morning_products,
            "apply": apply,
        }

        if apply:
            db.add(
                SuperAdminAuditLog(
                    actor="prepare-id6-multi-menu-tool",
                    action="MULTI_MENU_PREPARE_TENANT6",
                    reason=reason,
                    before_data={},
                    after_data=summary,
                )
            )
            db.commit()
        else:
            db.rollback()

        return summary
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        current_restaurante_id.reset(token)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepara os dois cardápios operacionais independentes para o Restaurante ID 6."
    )
    parser.add_argument(
        "--tenant-id",
        type=int,
        required=True,
        help="ID do tenant (deve ser 6 obrigatoriamente).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Aplica as modificações no banco de dados. Sem esta flag, executa dry-run.",
    )
    parser.add_argument(
        "--reason",
        default="Ativação do multi-cardápio: Manhã e Meio-Dia para o restaurante ID 6",
        help="Motivo registrado no log de auditoria do Super Admin.",
    )
    args = parser.parse_args()

    try:
        result = prepare_id6_multi_menu(
            tenant_id=args.tenant_id,
            apply=args.apply,
            reason=args.reason,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except MultiMenuPrepError as e:
        print(f"ERRO: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
