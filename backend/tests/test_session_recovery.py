import datetime
import os
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.database import SessionLocal, current_restaurante_id
from app.main import app
from app.models import Usuario
from app.routes.super_admin import get_current_admin
from app.config import settings
from app.security import create_access_token, revoke_user_sessions


def test_revocation_closes_existing_socket_only_after_commit():
    user_id = f"socket-{uuid.uuid4().hex[:10]}"
    ctx = current_restaurante_id.set(1)
    try:
        with SessionLocal(restaurante_id=1) as db:
            db.add(Usuario(id=user_id, restaurante_id=1, nome="Session test", cargo="caixa", status="ativo"))
            db.commit()
        token = create_access_token(user_id, 1, role="caixa", token_version=1)
        with TestClient(app).websocket_connect(f"/ws/{user_id}", headers={"Origin": "http://localhost:3000"},
                                             subprotocols=["koma-auth", token]) as socket:
            assert socket.receive_json()["event"] == "waiter_connected"
            with SessionLocal(restaurante_id=1) as db:
                revoke_user_sessions(db, user_id=user_id, restaurante_id=1)
                db.rollback()
            socket.send_json({"action": "draft_status", "mesa_id": 1, "ativo": True})
            assert socket.receive_json()["event"] == "draft_status"
            with SessionLocal(restaurante_id=1) as db:
                revoke_user_sessions(db, user_id=user_id, restaurante_id=1)
                db.commit()
            with pytest.raises(WebSocketDisconnect) as closed:
                socket.receive_json()
            assert closed.value.code == 1008
    finally:
        current_restaurante_id.reset(ctx)


def test_superadmin_credential_change_revokes_token_and_lifetime_is_bounded(monkeypatch):
    monkeypatch.setenv("SUPERADMIN_USERNAME", "audit-admin")
    monkeypatch.setenv("SUPERADMIN_PASSWORD_HASH", "test-old-hash")
    token = create_access_token("audit-admin", 0, role="superadmin", expires_delta=datetime.timedelta(days=30))
    claims = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    assert claims["exp"] - datetime.datetime.now(datetime.timezone.utc).timestamp() <= 3600
    assert "test-old-hash" not in str(claims)
    assert get_current_admin("Bearer " + token)["user"] == "audit-admin"
    monkeypatch.setenv("SUPERADMIN_PASSWORD_HASH", "test-new-hash")
    with pytest.raises(Exception) as rejected:
        get_current_admin("Bearer " + token)
    assert rejected.value.status_code == 401
