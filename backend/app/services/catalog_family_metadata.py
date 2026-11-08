"""Explicit product-family metadata used by cashier and public menu.

Products remain the only sellable SKUs. This module never synthesizes order IDs
and never infers a family from the tenant ID, product name or category.
"""
from sqlalchemy.orm import Session
from ..models import Produto, ProdutoFamilia


def family_metadata_for_products(db: Session, restaurante_id: int, products: list[Produto]) -> dict[str, dict]:
    ids = {product.familia_id for product in products if product.familia_id}
    if not ids:
        return {}
    families = db.query(ProdutoFamilia).filter(
        ProdutoFamilia.restaurante_id == restaurante_id,
        ProdutoFamilia.id.in_(ids),
    ).all()
    by_id = {family.id: family for family in families}
    metadata: dict[str, dict] = {}
    for product in products:
        family = by_id.get(product.familia_id)
        if family is None:
            continue
        metadata[str(product.id)] = {
            "familia_id": family.id,
            "familia_nome": family.nome,
            "familia_descricao": family.descricao,
            "familia_eixo": family.eixo,
            "familia_imagem": family.imagem,
            "variacao_rotulo": product.variacao_rotulo,
        }
    return metadata
