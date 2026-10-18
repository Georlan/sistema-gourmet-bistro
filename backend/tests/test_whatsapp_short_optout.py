"""Real HTTP confirmation flow, opaque storage and legacy capabilities."""
import base64
import datetime as dt
import hashlib
import hmac
import struct

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base, get_db
from app.models import Restaurante, WhatsAppContactOptOut, WhatsAppOptOutCapability
from app.routes import whatsapp_opt_out as routes
from app.services.central_whatsapp import recipient_fingerprint
from app.services import whatsapp_opt_out as optout


@pytest.fixture
def flow(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path}/optout.db')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add_all([Restaurante(id=701, nome='Kôma', slug='d8-burger'), Restaurante(id=702, nome='Outra loja')])
        db.commit()
    app = FastAPI()
    app.include_router(routes.router)
    def database():
        with Session(engine) as db:
            yield db
    app.dependency_overrides[get_db] = database
    routes._buckets.clear()
    with TestClient(app) as client:
        yield engine, client
    engine.dispose()


def issue(engine, rid=701):
    with Session(engine) as db:
        token = optout.create_opt_out_token(rid, '5511999999999', db)
        db.commit()
    return token


def test_opaque_random_short_storage_and_expiry(flow, monkeypatch):
    engine, client = flow
    token = issue(engine)
    another = issue(engine)
    assert len(token) == 32 and token != another
    assert len(base64.urlsafe_b64decode(token)) == 24  # 192 random bits
    with Session(engine) as db:
        row = db.get(WhatsAppOptOutCapability, hashlib.sha256(token.encode()).hexdigest())
        assert row and row.restaurante_id == 701
        assert token not in str(row.__dict__)
        assert row.phone_hash == recipient_fingerprint(701, '5511999999999')
        assert optout.resolve_opt_out_token(token, db) == (701, row.phone_hash)
    for invalid in (token + 'a', token[:-1], 'B' * 32, token[:-1] + ('A' if token[-1] != 'A' else 'B')):
        response = client.post('/api/cardapio/whatsapp/opt-out', json={'token': invalid})
        assert response.status_code == 404
        assert invalid not in response.text
    monkeypatch.setattr(optout, '_now', lambda: dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=91))
    assert client.post('/api/cardapio/whatsapp/opt-out/preview', json={'token': token}).status_code == 404


def test_preview_does_not_unsubscribe_confirmation_is_scoped_idempotent(flow):
    engine, client = flow
    token = issue(engine)
    other = issue(engine, 702)
    for _ in range(2):
        preview = client.post('/api/cardapio/whatsapp/opt-out/preview', json={'token': token})
        assert preview.status_code == 200 and preview.json() == {'restaurant_name': 'D8 Burger'}
        assert preview.headers['cache-control'] == 'no-store'
    with Session(engine) as db:
        assert db.query(WhatsAppContactOptOut).count() == 0
    assert client.get('/api/cardapio/whatsapp/opt-out').status_code == 405
    # A caller cannot select another tenant/contact alongside a capability.
    assert client.post('/api/cardapio/whatsapp/opt-out', json={'token': token, 'restaurante_id': 702}).status_code == 404
    for _ in range(2):
        result = client.post('/api/cardapio/whatsapp/opt-out', json={'token': token})
        assert result.status_code == 200 and result.json() == {'disabled': True}
        assert result.headers['cache-control'] == 'no-store'
    with Session(engine) as db:
        rows = db.query(WhatsAppContactOptOut).all()
        assert [(r.restaurante_id, r.phone_hash) for r in rows] == [(701, recipient_fingerprint(701, '5511999999999'))]
    assert client.post('/api/cardapio/whatsapp/opt-out/preview', json={'token': other}).json() == {'restaurant_name': 'Outra loja'}


def legacy_tokens():
    digest = recipient_fingerprint(701, '5511999999999')
    exp = int((dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).timestamp())
    body = struct.pack('!BII32s', 1, 701, exp, bytes.fromhex(digest))
    tag = hmac.new(settings.SECRET_KEY.encode(), b'koma:whatsapp:opt-out:v1\x00' + body, hashlib.sha256).digest()[:16]
    compact = base64.urlsafe_b64encode(body + tag).decode()
    legacy = jwt.encode({'type': 'whatsapp_opt_out', 'rid': 701, 'contact': digest, 'exp': exp}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return compact, legacy


@pytest.mark.parametrize('index', [0, 1])
def test_legacy_links_still_preview_and_confirm(flow, index):
    engine, client = flow
    token = legacy_tokens()[index]
    assert client.post('/api/cardapio/whatsapp/opt-out/preview', json={'token': token}).json() == {'restaurant_name': 'D8 Burger'}
    assert client.post('/api/cardapio/whatsapp/opt-out', json={'token': token}).json() == {'disabled': True}
    with Session(engine) as db:
        assert db.query(WhatsAppContactOptOut).count() == 1


def test_abuse_and_validation_never_echo_capability(flow):
    engine, client = flow
    token = issue(engine)
    for body in ({'token': token * 100}, {'token': {'secret': token}}, [token], {'token': token, 'phone': 'private'}):
        result = client.post('/api/cardapio/whatsapp/opt-out', json=body)
        assert result.status_code == 404 and token not in result.text
    for _ in range(16):
        assert client.post('/api/cardapio/whatsapp/opt-out/preview', json={'token': token}).status_code == 200
    limited = client.post('/api/cardapio/whatsapp/opt-out', json={'token': token})
    assert limited.status_code == 429 and limited.headers['retry-after'] == '60'
    with Session(engine) as db:
        assert db.query(WhatsAppContactOptOut).count() == 0


def test_legacy_rejects_other_types_and_expiry():
    for kind, exp in [('customer', dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)), ('whatsapp_opt_out', dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1))]:
        token = jwt.encode({'type': kind, 'rid': 701, 'contact': 'a' * 64, 'exp': exp}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
        with pytest.raises(ValueError):
            optout.resolve_opt_out_token(token)
