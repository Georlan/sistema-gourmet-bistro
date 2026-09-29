from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.security import ensure_permission


ROOT = Path(__file__).resolve().parents[2]


def _source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def _user(role: str):
    return SimpleNamespace(status="ativo", role=role, cargo=role)


def test_customer_crud_permission_is_separate_from_loyalty():
    for role in ("caixa", "gerente", "atendente"):
        user = _user(role)
        assert ensure_permission(user, "clientes:operar") is user

    for role in ("garcom", "cozinha", "motoboy"):
        with pytest.raises(HTTPException) as exc:
            ensure_permission(_user(role), "clientes:operar")
        assert exc.value.status_code == 403


def test_customer_routes_use_customer_permission_but_keep_loyalty_gated():
    source = _source("backend/app/routes/optimization.py")

    assert '@router.get("/fidelidade/clientes")' in source
    assert '@router.put("/fidelidade/clientes/{cliente_id}")' in source
    assert '@router.post("/fidelidade/clientes", status_code=201)' in source

    customer_blocks = [
        source[source.index('@router.get("/fidelidade/clientes")'):source.index('@router.get("/fidelidade/clientes/lookup")')],
        source[source.index('@router.put("/fidelidade/clientes/{cliente_id}")'):source.index('class ClientCreate')],
        source[source.index('@router.post("/fidelidade/clientes", status_code=201)'):],
    ]
    assert all('require_permission("clientes:operar")' in block for block in customer_blocks)

    assert 'require_permission("fidelidade:administrar")' in source
    assert "Saldo inicial de fidelidade não disponível no plano atual." in source


def test_staff_resend_uses_tenant_context_and_stable_snapshots():
    source = _source("backend/app/routes/auth.py")
    start = source.index('@router.post("/usuarios/{user_id}/reenviar-convite")')
    end = source.index("# SmartPOS is part of this authenticated namespace", start)
    block = source[start:end]

    assert "restaurante_id = require_tenant_id()" in block
    assert "current_user.restaurante_id" not in block
    assert "db.refresh(usuario)" not in block
    assert "token_convite = str(uuid.uuid4())" in block
    assert "db.query(Restaurante.nome)" in block
    assert "token_convite=token_convite" in block
