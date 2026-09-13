from __future__ import annotations

import datetime
from typing import Any, Literal, Union
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update

from ..catalog_assistance import catalog_assistance_requests, utc_now
from ..database import SessionLocal, tenant_session_scope
from ..models import Restaurante, SuperAdminAuditLog
from .products import CardapioImportPayload, ProdutoImportItem, importar_cardapio
from .super_admin import _discover_restaurant_ids, get_current_admin


router = APIRouter(prefix="/catalog-assistance", tags=["SuperAdminCatalogAssistance"])


class CatalogAssistanceStatusRequest(BaseModel):
    status: Literal["processing", "completed", "cancelled"]
    reason: str = Field(min_length=3, max_length=1000)
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PublishAssistedCatalogRequest(BaseModel):
    catalog: Union[list[ProdutoImportItem], CardapioImportPayload]
    reason: str = Field(min_length=3, max_length=1000)
    confirm: bool = False
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _parse_tenant_id(raw: str) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="ID do restaurante inválido.") from exc
    if value <= 0:
        raise HTTPException(status_code=422, detail="ID do restaurante inválido.")
    return value


def _request_metadata(row: Any, restaurant_name: str) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "restaurant_id": str(row["restaurante_id"]),
        "restaurant_name": restaurant_name,
        "filename": str(row["original_filename"]),
        "content_type": str(row["content_type"]),
        "file_size": int(row["file_size"]),
        "status": str(row["status"]),
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
        "completed_at": row["completed_at"].isoformat() if row["completed_at"] else None,
        "operator_note": row["operator_note"],
    }


@router.get("")
def list_catalog_assistance_requests(admin: dict[str, Any] = Depends(get_current_admin)):
    del admin
    items: list[dict[str, Any]] = []
    with SessionLocal() as db:
        for tenant_id in _discover_restaurant_ids(db):
            with tenant_session_scope(db, tenant_id):
                restaurant = (
                    db.query(Restaurante)
                    .filter(Restaurante.id == tenant_id)
                    .one_or_none()
                )
                if restaurant is None:
                    continue
                rows = db.execute(
                    select(
                        catalog_assistance_requests.c.id,
                        catalog_assistance_requests.c.restaurante_id,
                        catalog_assistance_requests.c.original_filename,
                        catalog_assistance_requests.c.content_type,
                        catalog_assistance_requests.c.file_size,
                        catalog_assistance_requests.c.status,
                        catalog_assistance_requests.c.operator_note,
                        catalog_assistance_requests.c.created_at,
                        catalog_assistance_requests.c.updated_at,
                        catalog_assistance_requests.c.completed_at,
                    )
                    .where(
                        catalog_assistance_requests.c.restaurante_id == tenant_id,
                        catalog_assistance_requests.c.status.in_(("pending", "processing")),
                    )
                    .order_by(catalog_assistance_requests.c.created_at.desc())
                    .limit(10)
                ).mappings().all()
                items.extend(
                    _request_metadata(row, str(restaurant.nome or f"Restaurante #{tenant_id}"))
                    for row in rows
                )

    items.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return {"items": items[:100], "pending": len(items)}


@router.get("/{tenant_id}/{request_id}/file")
def download_catalog_source(
    tenant_id: str,
    request_id: str,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    del admin
    restaurante_id = _parse_tenant_id(tenant_id)
    with SessionLocal() as db:
        with tenant_session_scope(db, restaurante_id):
            row = db.execute(
                select(
                    catalog_assistance_requests.c.original_filename,
                    catalog_assistance_requests.c.content_type,
                    catalog_assistance_requests.c.file_content,
                ).where(
                    catalog_assistance_requests.c.restaurante_id == restaurante_id,
                    catalog_assistance_requests.c.id == request_id,
                )
            ).mappings().one_or_none()
            if row is None:
                raise HTTPException(status_code=404, detail="Solicitação de cardápio não encontrada.")
            filename = str(row["original_filename"])
            encoded = quote(filename, safe="")
            return Response(
                content=bytes(row["file_content"]),
                media_type=str(row["content_type"]),
                headers={
                    "Content-Disposition": f"attachment; filename*=UTF-8''{encoded}",
                    "Cache-Control": "private, no-store",
                    "X-Content-Type-Options": "nosniff",
                },
            )


@router.post("/{tenant_id}/{request_id}/status")
def update_catalog_assistance_status(
    tenant_id: str,
    request_id: str,
    payload: CatalogAssistanceStatusRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    restaurante_id = _parse_tenant_id(tenant_id)
    actor = str(admin.get("user") or "superadmin")
    now = utc_now()

    with SessionLocal() as db:
        with tenant_session_scope(db, restaurante_id):
            row = db.execute(
                select(catalog_assistance_requests)
                .where(
                    catalog_assistance_requests.c.restaurante_id == restaurante_id,
                    catalog_assistance_requests.c.id == request_id,
                )
                .with_for_update()
            ).mappings().one_or_none()
            if row is None:
                raise HTTPException(status_code=404, detail="Solicitação de cardápio não encontrada.")
            if row["status"] in {"completed", "cancelled", "superseded"}:
                raise HTTPException(status_code=409, detail="Esta solicitação já foi encerrada.")

            completed_at = now if payload.status == "completed" else None
            db.execute(
                update(catalog_assistance_requests)
                .where(
                    catalog_assistance_requests.c.restaurante_id == restaurante_id,
                    catalog_assistance_requests.c.id == request_id,
                )
                .values(
                    status=payload.status,
                    operator_note=payload.reason,
                    updated_at=now,
                    completed_at=completed_at,
                )
            )
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=restaurante_id,
                    actor=f"superadmin:{actor}",
                    action="SUPERADMIN_CATALOG_ASSISTANCE_STATUS",
                    reason=payload.reason,
                    before_data={"request_id": request_id, "status": row["status"]},
                    after_data={"request_id": request_id, "status": payload.status},
                )
            )
            db.commit()

    return {"success": True, "id": request_id, "status": payload.status}


@router.post("/{tenant_id}/{request_id}/publish")
def publish_assisted_catalog(
    tenant_id: str,
    request_id: str,
    payload: PublishAssistedCatalogRequest,
    background_tasks: BackgroundTasks,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    if payload.confirm is not True:
        raise HTTPException(status_code=422, detail="Confirmação explícita obrigatória antes de publicar o cardápio.")

    restaurante_id = _parse_tenant_id(tenant_id)
    actor = str(admin.get("user") or "superadmin")

    with SessionLocal() as db:
        with tenant_session_scope(db, restaurante_id):
            request_row = db.execute(
                select(catalog_assistance_requests)
                .where(
                    catalog_assistance_requests.c.restaurante_id == restaurante_id,
                    catalog_assistance_requests.c.id == request_id,
                )
                .with_for_update()
            ).mappings().one_or_none()
            if request_row is None:
                raise HTTPException(status_code=404, detail="Solicitação de cardápio não encontrada.")
            if request_row["status"] not in {"pending", "processing"}:
                raise HTTPException(status_code=409, detail="Esta solicitação não está disponível para publicação.")

            imported = importar_cardapio(
                payload.catalog,
                background_tasks,
                db,
                None,  # autorização já foi feita pelo SuperAdmin; o escopo tenant continua obrigatório.
            )

            now = utc_now()
            db.execute(
                update(catalog_assistance_requests)
                .where(
                    catalog_assistance_requests.c.restaurante_id == restaurante_id,
                    catalog_assistance_requests.c.id == request_id,
                )
                .values(
                    status="completed",
                    operator_note=payload.reason,
                    updated_at=now,
                    completed_at=now,
                )
            )
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=restaurante_id,
                    actor=f"superadmin:{actor}",
                    action="SUPERADMIN_ASSISTED_CATALOG_PUBLISH",
                    reason=payload.reason,
                    before_data={
                        "request_id": request_id,
                        "source_filename": request_row["original_filename"],
                        "source_sha256": request_row["file_sha256"],
                    },
                    after_data={
                        "request_id": request_id,
                        "products_imported": len(imported),
                        "completed_at": now.isoformat(),
                    },
                )
            )
            db.commit()

    return {
        "success": True,
        "request_id": request_id,
        "restaurant_id": str(restaurante_id),
        "products_imported": len(imported),
        "status": "completed",
    }
