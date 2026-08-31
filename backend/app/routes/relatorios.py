from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Usuario, ConfiguracaoRestaurante
from ..security import require_permission

router = APIRouter(prefix="/relatorios", tags=["relatorios"])


@router.post("/meta-mensal")
def set_meta_mensal(
    payload: Dict[str, float],
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:administrar"))
):
    rest_id = require_tenant_id()
    meta_val = float(payload.get("meta_mensal", 0.0))
    if meta_val < 0:
        raise HTTPException(status_code=400, detail="A meta mensal deve ser maior ou igual a zero.")

    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == rest_id
    ).first()

    if not config:
        config = ConfiguracaoRestaurante(restaurante_id=rest_id, meta_mensal=meta_val)
        db.add(config)
    else:
        config.meta_mensal = meta_val

    db.commit()
    return {"status": "ok", "meta_mensal": meta_val}


# Papéis disponíveis no backoffice. Valores legados são normalizados antes de
# chegar à interface para que a mesma função nunca apareça duas vezes.
CARGO_PERMISSIONS: Dict[str, Dict[str, Any]] = {
    "admin": {"label": "Administrador", "pedidos": True, "caixa": True, "relatorios": True, "equipe": True, "admin": True},
    "gerente": {"label": "Gerente", "pedidos": True, "caixa": True, "relatorios": True, "equipe": True, "admin": False},
    "caixa": {"label": "Operador de caixa", "pedidos": True, "caixa": True, "relatorios": True, "equipe": True, "admin": False},
    "garcom": {"label": "Gar\u00e7om", "pedidos": True, "caixa": False, "relatorios": False, "equipe": False, "admin": False},
}
ROLE_ALIASES = {"operador_caixa": "caixa"}


@router.get("/cargos-permissoes")
def get_cargos_permissoes(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("equipe:administrar"))
):
    """Returns cargo permission matrix with real employee counts per role for this tenant."""
    rest_id = require_tenant_id()

    # Count employees per role (real DB data)
    membros = db.query(Usuario).filter(Usuario.restaurante_id == rest_id).all()
    counts_by_role: Dict[str, int] = {}
    for m in membros:
        raw_role = (m.role or m.cargo or "garcom").lower().strip()
        role = ROLE_ALIASES.get(raw_role, raw_role)
        counts_by_role[role] = counts_by_role.get(role, 0) + 1

    cargos = []
    for role_key in ["admin", "gerente", "caixa", "garcom"]:
        perm = CARGO_PERMISSIONS.get(role_key, {"label": role_key.capitalize(), "pedidos": False, "caixa": False, "relatorios": False, "equipe": False, "admin": False})
        total = counts_by_role.get(role_key, 0)
        if total > 0 or role_key in CARGO_PERMISSIONS:
            cargos.append({
                "slug": role_key,
                "label": perm["label"],
                "total_funcionarios": total,
                "permissoes": {
                    "pedidos": perm["pedidos"],
                    "caixa": perm["caixa"],
                    "relatorios": perm["relatorios"],
                    "equipe": perm["equipe"],
                    "admin": perm["admin"],
                }
            })

    # Also include any unknown roles actually present in the tenant
    for role_key, count in counts_by_role.items():
        if role_key not in CARGO_PERMISSIONS:
            cargos.append({
                "slug": role_key,
                "label": role_key.capitalize(),
                "total_funcionarios": count,
                "permissoes": {"pedidos": False, "caixa": False, "relatorios": False, "equipe": False, "admin": False}
            })

    return {"cargos": cargos}


# Each URL is registered once, directly against its effective implementation.
from .financial_read_routes import (
    get_relatorio_visao_geral_financeiro,
    get_vendas_detalhes_financeiro,
    get_equipe_desempenho_financeiro,
)
from .financial_product_routes import get_relatorio_produtos_operacional

router.add_api_route("/visao-geral", get_relatorio_visao_geral_financeiro, methods=["GET"])
router.add_api_route("/vendas-detalhes", get_vendas_detalhes_financeiro, methods=["GET"])
router.add_api_route("/equipe/desempenho", get_equipe_desempenho_financeiro, methods=["GET"])
router.add_api_route("/produtos", get_relatorio_produtos_operacional, methods=["GET"])
