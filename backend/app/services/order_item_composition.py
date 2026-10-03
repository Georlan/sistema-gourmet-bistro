"""Tenant-scoped batch lookup shared by operational reads and printing."""
from collections import defaultdict

from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..domain.orders.composition import SelectedModifier
from ..models import GrupoModificador, ItemModificador, OpcaoModificador
from ..restaurant_profile_models import RestauranteOperationProfile


def uses_grouped_composition(db: Session, restaurant_id: int) -> bool:
    profile = db.query(RestauranteOperationProfile.profile_key).filter(
        RestauranteOperationProfile.restaurante_id == restaurant_id,
    ).scalar()
    return profile == "marmitaria"


def load_item_modifiers(db: Session, restaurant_id: int, item_ids: list[str]) -> dict[str, list[SelectedModifier]]:
    if not item_ids:
        return {}
    rows = db.query(ItemModificador, OpcaoModificador, GrupoModificador).join(
        OpcaoModificador, and_(
            OpcaoModificador.restaurante_id == ItemModificador.restaurante_id,
            OpcaoModificador.id == ItemModificador.opcao_modificador_id,
        ),
    ).outerjoin(
        GrupoModificador, and_(
            GrupoModificador.restaurante_id == OpcaoModificador.restaurante_id,
            GrupoModificador.id == OpcaoModificador.grupo_id,
        ),
    ).filter(
        ItemModificador.restaurante_id == restaurant_id,
        ItemModificador.item_id.in_(item_ids),
    ).order_by(ItemModificador.item_id.asc(), ItemModificador.id.asc()).all()
    by_item: dict[str, list[SelectedModifier]] = defaultdict(list)
    for selected, option, group in rows:
        by_item[str(selected.item_id)].append(SelectedModifier(
            id=str(option.id), nome=option.nome, preco=float(selected.preco_aplicado or 0),
            grupo_id=str(option.grupo_id) if option.grupo_id else None,
            grupo_nome=group.nome if group else None,
        ))
    return dict(by_item)
