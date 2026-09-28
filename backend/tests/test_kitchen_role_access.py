from app.schemas import UsuarioAccessUpdate, UsuarioCreate
from app.security import PERMISSION_ROLES


def test_kitchen_role_is_accepted_by_team_schemas():
    created = UsuarioCreate(
        nome="Cozinha",
        telefone="85999999999",
        cargo="cozinha",
    )
    updated = UsuarioAccessUpdate(cargo="cozinha")

    assert created.cargo == "cozinha"
    assert updated.cargo == "cozinha"


def test_kitchen_role_can_change_order_status():
    assert "cozinha" in PERMISSION_ROLES["pedidos:alterar_status"]
