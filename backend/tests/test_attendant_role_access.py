from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models import Usuario
from app.schemas import UsuarioAccessUpdate, UsuarioCreate
from app.security import ensure_permission


def _attendant_user():
    return SimpleNamespace(status="ativo", role="atendente", cargo="atendente")


def test_team_schemas_accept_attendant_role():
    assert UsuarioCreate(
        nome="Atendente",
        telefone="85999990001",
        cargo="atendente",
    ).cargo == "atendente"
    assert UsuarioAccessUpdate(cargo="atendente").cargo == "atendente"


def test_user_model_constraint_accepts_attendant_role():
    cargo_check = next(
        constraint
        for constraint in Usuario.__table__.constraints
        if constraint.name == "ck_usuarios_cargo"
    )
    assert "'atendente'" in str(cargo_check.sqltext)


@pytest.mark.parametrize(
    "permission",
    ["caixa:operar", "equipe:administrar", "relatorios:consultar", "pedidos:alterar_status"],
)
def test_attendant_does_not_inherit_cashier_or_management_permissions(permission):
    with pytest.raises(HTTPException) as exc_info:
        ensure_permission(_attendant_user(), permission)

    assert exc_info.value.status_code == 403
