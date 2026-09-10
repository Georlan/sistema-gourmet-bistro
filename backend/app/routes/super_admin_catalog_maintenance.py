from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..catalog_addons import CategoriaGrupoModificador
from ..database import SessionLocal, tenant_session_scope
from ..models import (
    Categoria,
    GrupoModificador,
    ItemModificador,
    ObservacaoPredefinida,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
    SuperAdminAuditLog,
)
from .super_admin import get_current_admin

logger = logging.getLogger("koma.super_admin.catalog_maintenance")
router = APIRouter(prefix="/maintenance/catalog", tags=["SuperAdminCatalogMaintenance"])


class OrphanPresetPreviewRequest(BaseModel):
    categoria_id: str = Field(min_length=1, max_length=160)
    grupo_ids: list[str] = Field(min_length=1, max_length=30)

    model_config = ConfigDict(extra="forbid")

    @field_validator("categoria_id")
    @classmethod
    def normalize_category(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Categoria obrigatória.")
        return normalized

    @field_validator("grupo_ids")
    @classmethod
    def normalize_groups(cls, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))
        if not normalized:
            raise ValueError("Informe ao menos um grupo.")
        return normalized


class OrphanPresetExecuteRequest(OrphanPresetPreviewRequest):
    preview_fingerprint: str = Field(min_length=64, max_length=64)
    reason: str = Field(min_length=10, max_length=1000)
    confirm: bool = False


class _UnsafeCleanup(RuntimeError):
    pass


def _parse_tenant_id(raw: str) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="ID do restaurante inválido.") from exc
    if value <= 0:
        raise HTTPException(status_code=422, detail="ID do restaurante inválido.")
    return value


def _fingerprint(snapshot: dict[str, Any]) -> str:
    stable = {
        "restaurante_id": snapshot["restaurante_id"],
        "categoria": snapshot["categoria"],
        "categoria_produtos": snapshot["categoria_produtos"],
        "categoria_observacoes": snapshot["categoria_observacoes"],
        "categoria_grupos": snapshot["categoria_grupos"],
        "grupos": snapshot["grupos"],
    }
    raw = json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _snapshot(
    db,
    restaurante_id: int,
    categoria_id: str,
    grupo_ids: list[str],
    *,
    lock: bool = False,
) -> dict[str, Any]:
    category_query = db.query(Categoria).filter(
        Categoria.restaurante_id == restaurante_id,
        Categoria.id == categoria_id,
    )
    if lock:
        category_query = category_query.with_for_update()
    categoria = category_query.one_or_none()
    if categoria is None:
        raise HTTPException(status_code=404, detail="Categoria não encontrada no restaurante informado.")

    requested_group_ids = sorted(set(grupo_ids))
    groups_query = db.query(GrupoModificador).filter(
        GrupoModificador.restaurante_id == restaurante_id,
        GrupoModificador.id.in_(requested_group_ids),
    )
    if lock:
        groups_query = groups_query.with_for_update()
    grupos = groups_query.order_by(GrupoModificador.id).all()

    found_ids = {str(group.id) for group in grupos}
    missing = sorted(set(requested_group_ids) - found_ids)

    linked_group_ids = sorted(
        str(row[0])
        for row in db.query(CategoriaGrupoModificador.grupo_id).filter(
            CategoriaGrupoModificador.restaurante_id == restaurante_id,
            CategoriaGrupoModificador.categoria_id == categoria_id,
        ).all()
    )

    category_product_count = db.query(Produto).filter(
        Produto.restaurante_id == restaurante_id,
        Produto.categoria_id == categoria_id,
    ).count()
    category_observation_count = db.query(ObservacaoPredefinida).filter(
        ObservacaoPredefinida.restaurante_id == restaurante_id,
        ObservacaoPredefinida.categoria_id == categoria_id,
    ).count()

    group_payloads: list[dict[str, Any]] = []
    unsafe_reasons: list[str] = []

    if missing:
        unsafe_reasons.append(f"Grupos não encontrados: {', '.join(missing)}.")
    if category_product_count:
        unsafe_reasons.append(
            f"A categoria ainda possui {category_product_count} produto(s); a limpeza foi bloqueada."
        )
    if category_observation_count:
        unsafe_reasons.append(
            f"A categoria ainda possui {category_observation_count} observação(ões) predefinida(s)."
        )
    if linked_group_ids != requested_group_ids:
        unsafe_reasons.append(
            "Os grupos informados não correspondem exatamente aos grupos ligados à categoria."
        )

    for grupo in grupos:
        direct_product_count = db.query(ProdutoGrupoModificador).filter(
            ProdutoGrupoModificador.restaurante_id == restaurante_id,
            ProdutoGrupoModificador.grupo_id == grupo.id,
        ).count()
        category_ids = sorted(
            str(row[0])
            for row in db.query(CategoriaGrupoModificador.categoria_id).filter(
                CategoriaGrupoModificador.restaurante_id == restaurante_id,
                CategoriaGrupoModificador.grupo_id == grupo.id,
            ).all()
        )
        option_ids = sorted(
            str(row[0])
            for row in db.query(OpcaoModificador.id).filter(
                OpcaoModificador.restaurante_id == restaurante_id,
                OpcaoModificador.grupo_id == grupo.id,
            ).all()
        )
        historical_uses = 0
        if option_ids:
            historical_uses = db.query(ItemModificador).filter(
                ItemModificador.restaurante_id == restaurante_id,
                ItemModificador.opcao_modificador_id.in_(option_ids),
            ).count()

        if direct_product_count:
            unsafe_reasons.append(
                f"O grupo {grupo.nome!r} possui {direct_product_count} vínculo(s) direto(s) com produto."
            )
        if category_ids != [categoria_id]:
            unsafe_reasons.append(
                f"O grupo {grupo.nome!r} não está ligado exclusivamente à categoria alvo."
            )
        if historical_uses:
            unsafe_reasons.append(
                f"O grupo {grupo.nome!r} possui {historical_uses} uso(s) em itens históricos."
            )

        group_payloads.append(
            {
                "id": str(grupo.id),
                "nome": str(grupo.nome),
                "produto_links": direct_product_count,
                "categoria_ids": category_ids,
                "opcao_ids": option_ids,
                "usos_historicos": historical_uses,
            }
        )

    snapshot = {
        "restaurante_id": restaurante_id,
        "categoria": {"id": str(categoria.id), "nome": str(categoria.nome)},
        "categoria_produtos": category_product_count,
        "categoria_observacoes": category_observation_count,
        "categoria_grupos": linked_group_ids,
        "grupos": group_payloads,
        "safe_to_remove": not unsafe_reasons,
        "unsafe_reasons": unsafe_reasons,
    }
    snapshot["fingerprint"] = _fingerprint(snapshot)
    return snapshot


@router.post("/{tenant_id}/orphan-preset/preview")
def preview_orphan_preset_cleanup(
    tenant_id: str,
    payload: OrphanPresetPreviewRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    del admin
    restaurante_id = _parse_tenant_id(tenant_id)
    with SessionLocal() as db:
        with tenant_session_scope(db, restaurante_id):
            restaurante = db.query(Restaurante).filter(Restaurante.id == restaurante_id).one_or_none()
            if restaurante is None:
                raise HTTPException(status_code=404, detail="Restaurante não encontrado.")
            snapshot = _snapshot(
                db,
                restaurante_id,
                payload.categoria_id,
                payload.grupo_ids,
            )
            snapshot["restaurante_nome"] = str(restaurante.nome)
            snapshot["mode"] = "preview"
            return snapshot


@router.post("/{tenant_id}/orphan-preset/execute")
def execute_orphan_preset_cleanup(
    tenant_id: str,
    payload: OrphanPresetExecuteRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    if payload.confirm is not True:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Confirmação explícita obrigatória.",
        )

    restaurante_id = _parse_tenant_id(tenant_id)
    operator = str(admin.get("user") or "superadmin")
    reason = payload.reason.strip()

    with SessionLocal() as db:
        try:
            with tenant_session_scope(db, restaurante_id):
                restaurante = (
                    db.query(Restaurante)
                    .filter(Restaurante.id == restaurante_id)
                    .with_for_update()
                    .one_or_none()
                )
                if restaurante is None:
                    raise HTTPException(status_code=404, detail="Restaurante não encontrado.")

                snapshot = _snapshot(
                    db,
                    restaurante_id,
                    payload.categoria_id,
                    payload.grupo_ids,
                    lock=True,
                )
                if snapshot["fingerprint"] != payload.preview_fingerprint:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            "O catálogo mudou desde o preview. Revise novamente antes de executar a limpeza."
                        ),
                    )
                if not snapshot["safe_to_remove"]:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail={
                            "message": "A limpeza deixou de ser segura e foi bloqueada.",
                            "reasons": snapshot["unsafe_reasons"],
                        },
                    )

                group_ids = sorted(set(payload.grupo_ids))
                option_ids = [
                    option_id
                    for group in snapshot["grupos"]
                    for option_id in group["opcao_ids"]
                ]

                db.query(ProdutoGrupoModificador).filter(
                    ProdutoGrupoModificador.restaurante_id == restaurante_id,
                    ProdutoGrupoModificador.grupo_id.in_(group_ids),
                ).delete(synchronize_session=False)
                db.query(CategoriaGrupoModificador).filter(
                    CategoriaGrupoModificador.restaurante_id == restaurante_id,
                    CategoriaGrupoModificador.grupo_id.in_(group_ids),
                ).delete(synchronize_session=False)
                if option_ids:
                    db.query(OpcaoModificador).filter(
                        OpcaoModificador.restaurante_id == restaurante_id,
                        OpcaoModificador.id.in_(option_ids),
                    ).delete(synchronize_session=False)
                db.query(GrupoModificador).filter(
                    GrupoModificador.restaurante_id == restaurante_id,
                    GrupoModificador.id.in_(group_ids),
                ).delete(synchronize_session=False)
                db.query(ObservacaoPredefinida).filter(
                    ObservacaoPredefinida.restaurante_id == restaurante_id,
                    ObservacaoPredefinida.categoria_id == payload.categoria_id,
                ).delete(synchronize_session=False)
                db.query(Categoria).filter(
                    Categoria.restaurante_id == restaurante_id,
                    Categoria.id == payload.categoria_id,
                ).delete(synchronize_session=False)

                db.add(
                    SuperAdminAuditLog(
                        restaurante_id=restaurante_id,
                        actor=operator,
                        action="SUPERADMIN_CATALOG_ORPHAN_PRESET_CLEANUP",
                        reason=reason,
                        before_data=snapshot,
                        after_data={
                            "categoria_removida": payload.categoria_id,
                            "grupos_removidos": group_ids,
                            "opcoes_removidas": option_ids,
                            "restaurante_nome": str(restaurante.nome),
                        },
                    )
                )
                db.commit()

                logger.warning(
                    "SUPERADMIN CATALOG ORPHAN PRESET CLEANUP tenant=%s actor=%s category=%s groups=%s",
                    restaurante_id,
                    operator,
                    payload.categoria_id,
                    group_ids,
                )

                return {
                    "message": "Preset órfão removido com segurança.",
                    "restaurante_id": restaurante_id,
                    "categoria_removida": payload.categoria_id,
                    "grupos_removidos": group_ids,
                    "opcoes_removidas": len(option_ids),
                }
        except HTTPException:
            if db.in_transaction():
                db.rollback()
            raise
        except Exception as exc:
            if db.in_transaction():
                db.rollback()
            logger.exception(
                "Falha na limpeza auditada de preset órfão tenant=%s actor=%s",
                restaurante_id,
                operator,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Falha ao executar a limpeza; nenhuma alteração parcial foi mantida.",
            ) from exc
