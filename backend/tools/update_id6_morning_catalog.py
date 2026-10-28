"""Script operacional seguro para atualizar preços, ativação e adicionais dos itens matinais do Restaurante ID 6.

Uso:
  python -m tools.update_id6_morning_catalog --tenant-id 6
  python -m tools.update_id6_morning_catalog --tenant-id 6 --apply
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
    GrupoModificador,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
)


def update_id6_morning_catalog(*, tenant_id: int, apply: bool = False) -> dict[str, Any]:
    if tenant_id != 6:
        raise ValueError("Script restrito ao tenant 6.")

    token = current_restaurante_id.set(tenant_id)
    db = SessionLocal(restaurante_id=tenant_id)
    try:
        m = (
            db.query(Cardapio)
            .filter(Cardapio.restaurante_id == tenant_id, Cardapio.identificador == "manha")
            .first()
        )
        if not m:
            raise RuntimeError("Cardápio 'manha' não encontrado no tenant 6.")

        # 1. Ativar categorias: Cuscuz, Bolos, Panelada, Sanduíches
        cats_to_activate = {"cuscuz", "bolos", "panelada", "sanduíches", "sanduiches"}
        morning_prods = (
            db.query(Produto)
            .filter(Produto.restaurante_id == tenant_id, Produto.cardapio_id == m.id)
            .all()
        )
        cats = {c.id: c.nome.lower() for c in db.query(Categoria).filter(Categoria.restaurante_id == tenant_id).all()}

        activated = []
        for p in morning_prods:
            cat_nome = cats.get(p.categoria_id, "")
            if cat_nome in cats_to_activate:
                p.ativo = True
                activated.append(p.nome)

        # 2. Atualizar Sucos para R$ 7.00
        sucos_updated = []
        for p in morning_prods:
            if "suco" in p.nome.lower():
                p.preco = Decimal("7.00")
                p.descricao = f"Suco natural de {p.nome.replace('Suco de ', '').lower()} gelado"
                sucos_updated.append(p.nome)

        # 3. Criar ou atualizar grupo 'Recheios da Tapioca'
        grupo_tapioca = (
            db.query(GrupoModificador)
            .filter(
                GrupoModificador.restaurante_id == tenant_id,
                GrupoModificador.nome == "Recheios da Tapioca",
            )
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
        recheios_created = []
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
                op = OpcaoModificador(
                    id=str(uuid.uuid4()),
                    restaurante_id=tenant_id,
                    grupo_id=grupo_tapioca.id,
                    nome=nome,
                    preco_adicional=preco,
                    ativo=True,
                )
                db.add(op)
                recheios_created.append(nome)
        db.flush()

        # Vincular à Tapioca recheada (Monte a sua)
        p_tapioca = (
            db.query(Produto)
            .filter(
                Produto.restaurante_id == tenant_id,
                Produto.nome == "Tapioca recheada (Monte a sua)",
            )
            .first()
        )
        if p_tapioca:
            link = (
                db.query(ProdutoGrupoModificador)
                .filter(
                    ProdutoGrupoModificador.restaurante_id == tenant_id,
                    ProdutoGrupoModificador.produto_id == p_tapioca.id,
                    ProdutoGrupoModificador.grupo_id == grupo_tapioca.id,
                )
                .first()
            )
            if not link:
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
                link.min_selecoes = 1
                link.max_selecoes = 12
                link.modo_selecao = "tipos"

        # 4. Grupos de Sanduíches: 'Escolha o Pão' e 'Salada'
        grupo_pao = (
            db.query(GrupoModificador)
            .filter(
                GrupoModificador.restaurante_id == tenant_id,
                GrupoModificador.nome == "Escolha o Pão",
            )
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
            .filter(
                GrupoModificador.restaurante_id == tenant_id,
                GrupoModificador.nome == "Salada",
            )
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

        # Vincular grupos aos 3 sanduíches
        sanduiches = (
            db.query(Produto)
            .filter(
                Produto.restaurante_id == tenant_id,
                Produto.nome.ilike("Sanduíche%"),
            )
            .all()
        )
        for sand in sanduiches:
            for grp, min_s, max_s in [(grupo_pao, 1, 1), (grupo_salada, 0, 1)]:
                link = (
                    db.query(ProdutoGrupoModificador)
                    .filter(
                        ProdutoGrupoModificador.restaurante_id == tenant_id,
                        ProdutoGrupoModificador.produto_id == sand.id,
                        ProdutoGrupoModificador.grupo_id == grp.id,
                    )
                    .first()
                )
                if not link:
                    db.add(
                        ProdutoGrupoModificador(
                            restaurante_id=tenant_id,
                            produto_id=sand.id,
                            grupo_id=grp.id,
                            min_selecoes=min_s,
                            max_selecoes=max_s,
                        )
                    )

        if apply:
            db.commit()
        else:
            db.rollback()

        return {
            "tenant_id": tenant_id,
            "activated": activated,
            "sucos_updated": sucos_updated,
            "recheios_created": recheios_created,
            "apply": apply,
        }
    finally:
        current_restaurante_id.reset(token)
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Atualiza itens matinais e complementos do ID 6.")
    parser.add_argument("--tenant-id", type=int, default=6, help="ID do restaurante (deve ser 6)")
    parser.add_argument("--apply", action="store_true", help="Aplica no banco de dados. Sem esta flag, é dry-run.")
    args = parser.parse_args()

    result = update_id6_morning_catalog(tenant_id=args.tenant_id, apply=args.apply)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
