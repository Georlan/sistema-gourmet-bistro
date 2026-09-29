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
        telefone="85999990000",
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


def test_attendant_has_quick_order_permissions_only():
    user = _attendant_user()

    assert ensure_permission(user, "pedidos:criar_rapido") is user
    assert ensure_permission(user, "pedidos:consultar_cliente") is user

    for denied_permission in (
        "caixa:operar",
        "equipe:administrar",
        "relatorios:consultar",
        "configuracoes:administrar",
        "pedidos:alterar_status",
    ):
        with pytest.raises(HTTPException) as exc_info:
            ensure_permission(user, denied_permission)
        assert exc_info.value.status_code == 403
