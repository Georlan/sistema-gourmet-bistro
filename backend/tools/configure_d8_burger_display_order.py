"""Script operacional determinístico para configurar a ordenação canônica de categorias e produtos do D8 Burger (tenant 8).

Categorias canônicas:
  1. BURGERS (10)
  2. COMBOS (20)
  3. PORÇÕES (30)
  4. BEBIDAS (40)
  5. SOBREMESAS (50)

Produtos canônicos:
  - BURGERS: D8 Clássico (10), D8 Bacon (20), Smash Duplo (30), Sertão Burger (40), Frango Crocante (50), Veggie D8 (60)
  - COMBOS: Combo Clássico (10), Combo Bacon (20), Combo Sertão (30)
  - PORÇÕES: Fritas Individual (10), Fritas Grande (20), Fritas Cheddar & Bacon (30), Onion Rings (40)
  - BEBIDAS: Refrigerante Lata (10), Refrigerante Zero (20), Suco Acerola (30), Suco Caju (40), Água (50)
  - SOBREMESAS: Brownie D8 (10), Milk-shake Chocolate (20), Milk-shake Paçoca (30)
"""
import os
import sys

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import Categoria, Produto

TENANT_ID = 8

CATEGORY_ORDERS = {
    "burgers": 10,
    "combos": 20,
    "porcoes": 30,
    "bebidas": 40,
    "sobremesas": 50,
}

PRODUCT_CONFIG = {
    # Burgers
    "d8-classico": {"ordem": 10, "ativo": True},
    "d8-bacon": {"ordem": 20, "ativo": True},
    "smash-duplo": {"ordem": 30, "ativo": True},
    "sertao-burger": {"ordem": 40, "ativo": True},
    "frango-crocante": {"ordem": 50, "ativo": True},
    "veggie-d8": {"ordem": 60, "ativo": True},
    "x-bacon": {"ordem": 70, "ativo": False},
    "x-burger": {"ordem": 80, "ativo": False},
    # Combos
    "combo-classico": {"ordem": 10, "ativo": True},
    "combo-bacon": {"ordem": 20, "ativo": True},
    "combo-sertao": {"ordem": 30, "ativo": True},
    # Porções
    "fritas-individual": {"ordem": 10, "ativo": True},
    "fritas-grande": {"ordem": 20, "ativo": True},
    "fritas-cheddar-bacon": {"ordem": 30, "ativo": True},
    "onion-rings": {"ordem": 40, "ativo": True},
    # Bebidas
    "refrigerante-lata-350ml": {"ordem": 10, "ativo": True},
    "refrigerante-zero-lata-350ml": {"ordem": 20, "ativo": True},
    "suco-acerola-500ml": {"ordem": 30, "ativo": True},
    "suco-caju-500ml": {"ordem": 40, "ativo": True},
    "agua-mineral-500ml": {"ordem": 50, "ativo": True},
    # Sobremesas
    "brownie-d8": {"ordem": 10, "ativo": True},
    "milkshake-chocolate-400ml": {"ordem": 20, "ativo": True},
    "milkshake-pacoca-400ml": {"ordem": 30, "ativo": True},
}


def ensure_columns(db: Session) -> None:
    from sqlalchemy import text
    for ddl in [
        "ALTER TABLE categorias ADD COLUMN ordem_exibicao INTEGER",
        "ALTER TABLE produtos ADD COLUMN ordem_exibicao INTEGER",
    ]:
        try:
            db.execute(text(ddl))
            db.commit()
        except Exception:
            db.rollback()


def configure_d8_burger(db: Session) -> None:
    ensure_columns(db)
    print(f"Configurando ordenação canônica para o tenant {TENANT_ID} (D8 Burger)...")

    # Categorias
    categorias = db.query(Categoria).filter_by(restaurante_id=TENANT_ID).all()
    for cat in categorias:
        if cat.id in CATEGORY_ORDERS:
            cat.ordem_exibicao = CATEGORY_ORDERS[cat.id]
            print(f"  [Categoria] {cat.nome} ({cat.id}) -> ordem_exibicao={cat.ordem_exibicao}")

    # Produtos
    produtos = db.query(Produto).filter_by(restaurante_id=TENANT_ID).all()
    for prod in produtos:
        if prod.id in PRODUCT_CONFIG:
            cfg = PRODUCT_CONFIG[prod.id]
            prod.ordem_exibicao = cfg["ordem"]
            prod.ativo = cfg["ativo"]
            print(f"  [Produto] {prod.nome} ({prod.id}) -> ordem={prod.ordem_exibicao}, ativo={prod.ativo}")

    db.commit()
    print("Configuração do D8 Burger salva com sucesso!")


if __name__ == "__main__":
    db = SessionLocal()
    try:
        configure_d8_burger(db)
    finally:
        db.close()
