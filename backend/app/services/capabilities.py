from sqlalchemy.orm import Session

from ..smartpos_models import RestauranteCapability


def has_capability(
    db: Session,
    restaurante_id: int,
    capability: str,
) -> bool:
    """Retorna o entitlement efetivo sem consultar o nome do plano."""
    normalized = (capability or "").strip().lower()
    if not normalized:
        return False

    entitlement = db.query(RestauranteCapability).filter(
        RestauranteCapability.restaurante_id == restaurante_id,
        RestauranteCapability.capability == normalized,
        RestauranteCapability.enabled == True,
    ).first()
    return entitlement is not None
