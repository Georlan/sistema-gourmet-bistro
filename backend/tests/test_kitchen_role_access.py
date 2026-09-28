from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.schemas import UsuarioAccessUpdate, UsuarioCreate
from app.security import PERMISSION_ROLES, ensure_item_status_permission


def test_kitchen_role_is_accepted_by_team_schemas():
    created = UsuarioCreate(
        nome="Cozinha",
        telefone="85999999999",
        cargo="cozinha",
    )
    updated = UsuarioAccessUpdate(cargo="cozinha")

    assert created.cargo == "cozinha"
    assert updated.cargo == "cozinha"


def test_kitchen_role_can_only_mark_items_ready():
    kitchen = SimpleNamespace(status="ativo", role="cozinha", cargo="cozinha")
    cashier = SimpleNamespace(status="ativo", role="caixa", cargo="caixa")

    assert "cozinha" in PERMISSION_ROLES["itens:alterar_status"]
    assert "cozinha" not in PERMISSION_ROLES["pedidos:alterar_status"]
    assert ensure_item_status_permission(kitchen, "pronto") is kitchen
    assert ensure_item_status_permission(cashier, "entregue") is cashier

    with pytest.raises(HTTPException) as exc_info:
        ensure_item_status_permission(kitchen, "entregue")

    assert exc_info.value.status_code == 403
