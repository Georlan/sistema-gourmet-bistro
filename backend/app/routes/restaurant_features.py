from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id, tenant_session_scope
from ..models import Usuario
from ..security import get_current_user, require_permission
from ..services.capabilities import has_capability
from ..services.public_orders import resolve_restaurant_id
from ..smartpos_models import RestauranteCapability
from .websocket import manager


router = APIRouter(
    prefix="/api/restaurant-features",
    tags=["Restaurant Features"],
)

SCHEDULED_ORDERS_CAPABILITY = "scheduled_orders"


class FeatureToggleResponse(BaseModel):
    enabled: bool


class FeatureToggleUpdate(BaseModel):
    enabled: bool

    model_config = ConfigDict(extra="forbid")


@router.get("/public/scheduled-orders", response_model=FeatureToggleResponse)
def get_public_scheduled_orders_feature(
    restaurante_id: int,
    db: Session = Depends(get_db),
):
    resolved_id = resolve_restaurant_id(str(restaurante_id), None, db)
    with tenant_session_scope(db, resolved_id):
        return {
            "enabled": has_capability(
                db,
                resolved_id,
                SCHEDULED_ORDERS_CAPABILITY,
            )
        }


@router.get("/scheduled-orders", response_model=FeatureToggleResponse)
def get_scheduled_orders_feature(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    del current_user
    restaurante_id = require_tenant_id()
    return {
        "enabled": has_capability(
            db,
            restaurante_id,
            SCHEDULED_ORDERS_CAPABILITY,
        )
    }


@router.put("/scheduled-orders", response_model=FeatureToggleResponse)
def update_scheduled_orders_feature(
    payload: FeatureToggleUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(
        require_permission("configuracoes:administrar")
    ),
):
    del current_user
    restaurante_id = require_tenant_id()
    feature = db.query(RestauranteCapability).filter(
        RestauranteCapability.restaurante_id == restaurante_id,
        RestauranteCapability.capability == SCHEDULED_ORDERS_CAPABILITY,
    ).first()

    if feature is None:
        feature = RestauranteCapability(
            restaurante_id=restaurante_id,
            capability=SCHEDULED_ORDERS_CAPABILITY,
            enabled=payload.enabled,
            source="manual",
        )
        db.add(feature)
    else:
        feature.enabled = payload.enabled
        feature.source = "manual"

    db.commit()
    db.refresh(feature)

    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "config_updated",
            "detail": {
                "feature": SCHEDULED_ORDERS_CAPABILITY,
                "enabled": bool(feature.enabled),
            },
        },
        restaurante_id,
    )

    return {"enabled": bool(feature.enabled)}
