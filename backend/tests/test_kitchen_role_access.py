from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models import Usuario
from app.schemas import UsuarioAccessUpdate, UsuarioCreate
from app.security import ensure_permission


def _kitchen_user():
    return SimpleNamespace(status="ativo", role="cozinha", cargo="cozinha")


def test_team_schemas_accept_kitchen_role():
    assert UsuarioCreate(
        nome="Cozinha",
        telefone="85999990000",
        cargo="cozinha",
    ).cargo == "cozinha"
    assert UsuarioAccessUpdate(cargo="cozinha").cargo == "cozinha"


def test_user_model_constraint_accepts_kitchen_role():
    cargo_check = next(
        constraint
        for constraint in Usuario.__table__.constraints
        if constraint.name == "ck_usuarios_cargo"
    )
    assert "'cozinha'" in str(cargo_check.sqltext)


def test_kitchen_can_update_order_status_but_not_administer_team():
    user = _kitchen_user()

    assert ensure_permission(user, "pedidos:alterar_status") is user

    with pytest.raises(HTTPException) as exc_info:
        ensure_permission(user, "equipe:administrar")

    assert exc_info.value.status_code == 403
