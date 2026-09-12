from pathlib import Path

from app.security import PERMISSION_ROLES


def test_caixa_chat_requires_cashier_permission_on_every_route():
    source = Path("backend/app/routes/caixa_chat.py").read_text(encoding="utf-8")

    assert "get_current_user" not in source
    assert source.count('Depends(require_permission("caixa:operar"))') == 6


def test_waiter_role_cannot_use_cashier_permission():
    allowed_roles = PERMISSION_ROLES["caixa:operar"]

    assert "garcom" not in allowed_roles
    assert {"admin", "gerente", "caixa"}.issubset(allowed_roles)
