"""Read-only preparation: the commercial catalog remains the source of name/price.

Missing fiscal profiles are virtual drafts, never writes in the product/sale path.
This projection does not certify tax classification or authorize issuance.
"""
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from ..fiscal_models import ProductFiscalProfile
from ..models import Produto


def fiscal_catalog_page(db: Session, *, restaurante_id: int, offset: int = 0, limit: int = 50):
    if type(restaurante_id) is not int or restaurante_id <= 0 or offset < 0 or not 1 <= limit <= 100:
        raise ValueError("Consulta de preparação fiscal inválida.")
    products_query = db.query(Produto).filter(Produto.restaurante_id == restaurante_id)
    total = products_query.count()
    products = products_query.order_by(Produto.nome, Produto.id).offset(offset).limit(limit).all()
    profiles = []
    if products:
        latest_revisions = db.query(
            ProductFiscalProfile.produto_id.label("product_id"),
            func.max(ProductFiscalProfile.revision).label("revision"),
        ).filter(
            ProductFiscalProfile.restaurante_id == restaurante_id,
            ProductFiscalProfile.produto_id.in_([product.id for product in products]),
        ).group_by(ProductFiscalProfile.produto_id).subquery()
        profiles = db.query(ProductFiscalProfile).join(latest_revisions, and_(
            ProductFiscalProfile.produto_id == latest_revisions.c.product_id,
            ProductFiscalProfile.revision == latest_revisions.c.revision,
        )).filter(ProductFiscalProfile.restaurante_id == restaurante_id).all()
    latest = {}
    for profile in profiles:
        latest.setdefault(profile.produto_id, profile)
    today = datetime.now(ZoneInfo("America/Fortaleza")).date()
    items = []
    for product in products:
        profile = latest.get(product.id)
        state = "pending"
        if profile:
            if profile.status == "blocked":
                state = "blocked"
            elif profile.valid_from and profile.valid_from > today:
                state = "scheduled"
            elif profile.valid_until and profile.valid_until < today:
                state = "expired"
            elif profile.status == "ready":
                state = "reviewed"
        items.append({
            "productId": product.id,
            "name": product.nome,
            "currentPrice": format(Decimal(str(product.preco)).quantize(Decimal("0.01")), "f"),
            "active": bool(product.ativo),
            "preparationStatus": state,
            "fiscalProfileId": profile.id if profile else None,
            "revision": profile.revision if profile else None,
            "ncm": profile.ncm if profile else None,
            "commercialUnit": profile.commercial_unit if profile else None,
        })
    return {"items": items, "total": total, "offset": offset, "limit": limit,
            "hasMore": offset + len(items) < total, "issuanceReady": False}
