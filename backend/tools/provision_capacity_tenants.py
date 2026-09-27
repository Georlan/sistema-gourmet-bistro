"""Idempotent QA fixtures for the five-tenant capacity gate.

Run only inside the homologation backend container. The password is supplied
through CAPACITY_PASSWORD by the runner and is never printed or stored in code.
"""

from __future__ import annotations

import os
import json

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

HOMOLOGATION_PROJECT = "6aca32bc-4b1e-4499-a014-dd14791341bb"
SLUG_PREFIX = "capacity-qa-"


def provision(password: str) -> list[dict]:
    if os.getenv("RAILWAY_PROJECT_ID") != HOMOLOGATION_PROJECT:
        raise RuntimeError("Capacity fixtures are restricted to Koma Homologacao")
    if not 12 <= len(password.encode()) <= 72:
        raise RuntimeError("CAPACITY_PASSWORD must contain 12-72 bytes")

    url = os.getenv("MIGRATION_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("Administrative database URL is unavailable")

    from app.models import (
        Categoria, CaixaTurno, ConfiguracaoRestaurante, Insumo,
        Produto, ProdutoInsumo, Restaurante, Usuario,
    )
    from app.routes.super_admin_onboarding import _lock_onboarding_transaction, _reserve_restaurant_id
    from app.security import get_password_hash

    engine = create_engine(url, pool_pre_ping=True)
    result = []
    try:
        with engine.connect() as conn:
            database = conn.execute(text("SELECT current_database()")).scalar_one()
        if database != "koma_homolog":
            raise RuntimeError(f"Expected koma_homolog, got {database}")

        for number in range(1, 6):
            slug = f"{SLUG_PREFIX}{number}"
            email = f"{slug}@koma.test"
            with Session(engine) as db:
                rid = db.execute(
                    text("SELECT id FROM koma_internal.resolve_public_restaurant(:slug)"),
                    {"slug": slug},
                ).scalar_one_or_none()
                db.rollback()
                if rid is None:
                    rid = _reserve_restaurant_id(db)
                rid = int(rid)
                _lock_onboarding_transaction(db)
                restaurant = db.get(Restaurante, rid)
                if restaurant is not None and restaurant.slug != slug:
                    raise RuntimeError(f"Restaurant ID {rid} belongs to another slug")
                if restaurant is None:
                    restaurant = Restaurante(id=rid, nome=f"Capacity QA {number}", slug=slug)
                    db.add(restaurant)
                restaurant.plano = "premium"
                restaurant.billing_mode = "legacy"
                restaurant.saas_status = "active"
                restaurant.status_override = "Forçado Aberto"
                db.flush()

                user_id = f"capacity-qa-user-{number}"
                user = db.get(Usuario, user_id)
                if user is not None and user.restaurante_id != rid:
                    raise RuntimeError(f"QA user {user_id} belongs to another tenant")
                if user is None:
                    user = Usuario(id=user_id, restaurante_id=rid, nome=f"Caixa Capacity {number}", email=email)
                    db.add(user)
                user.cargo = "caixa"
                user.status = "ativo"
                user.senha_hash = get_password_hash(password)

                if not db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).first():
                    db.add(ConfiguracaoRestaurante(restaurante_id=rid, delivery_ativo=True, modo_exclusivo_salao=False))
                if not db.query(CaixaTurno).filter_by(restaurante_id=rid, status="aberto").first():
                    db.add(CaixaTurno(restaurante_id=rid, aberto_por_id=user_id, saldo_inicial=0, status="aberto"))
                category = db.query(Categoria).filter_by(restaurante_id=rid, id="capacity-category").first()
                if category is None:
                    db.add(Categoria(restaurante_id=rid, id="capacity-category", nome="Capacity QA", destino_impressao="COZINHA"))
                product = db.query(Produto).filter_by(restaurante_id=rid, id="capacity-product").first()
                if product is None:
                    db.add(Produto(restaurante_id=rid, id="capacity-product", categoria_id="capacity-category", nome="Capacity item", preco=10, ativo=True))
                stock_id = f"capacity-stock-{number}"
                stock = db.get(Insumo, stock_id)
                if stock is None:
                    db.add(Insumo(id=stock_id, restaurante_id=rid, nome="Capacity stock", estoque_atual=10000, unidade_medida="un"))
                elif stock.restaurante_id != rid:
                    raise RuntimeError(f"Stock {stock_id} belongs to another tenant")
                if not db.query(ProdutoInsumo).filter_by(restaurante_id=rid, produto_id="capacity-product", insumo_id=stock_id).first():
                    db.add(ProdutoInsumo(restaurante_id=rid, produto_id="capacity-product", insumo_id=stock_id, quantidade=1))
                db.commit()
                result.append({"restaurante_id": rid, "email": email, "slug": slug})
    finally:
        engine.dispose()
    return result


if __name__ == "__main__":
    password = globals().get("CAPACITY_PASSWORD") or os.getenv("CAPACITY_PASSWORD", "")
    print(json.dumps(provision(password)))
