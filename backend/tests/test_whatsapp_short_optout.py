"""Signed short unsubscribe capability: security and tenant-scoped POST, no provider calls."""
import datetime as dt

import jwt
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base
from app.models import WhatsAppContactOptOut
from app.routes.whatsapp_opt_out import OptOutRequest, apply_opt_out
from app.services.central_whatsapp import recipient_fingerprint
from app.services import whatsapp_opt_out as optout


def test_compact_capability_short_signed_scoped_and_expiring(monkeypatch):
    phone = "5511999999999"
    token = optout.create_opt_out_token(701, phone)
    assert len(token) == 76
    assert "." not in token and "=" not in token
    assert optout.resolve_opt_out_token(token) == (701, recipient_fingerprint(701, phone))
    assert optout.create_opt_out_token(702, phone) != token
    assert optout.resolve_opt_out_token(optout.create_opt_out_token(702, phone))[0] == 702

    for forged in (token + "x", token[:-1], ("B" if token[0] == "A" else "A") + token[1:], token[:-1] + ("A" if token[-1] != "A" else "B"),
                   token.replace(token[0], ".", 1), "", "bogus"):
        with pytest.raises(ValueError):
            optout.resolve_opt_out_token(forged)

    future = optout._now() + dt.timedelta(days=91)
    monkeypatch.setattr(optout, "_now", lambda: future)
    with pytest.raises(ValueError):
        optout.resolve_opt_out_token(token)


def test_old_jwt_links_still_work_but_cannot_reuse_other_token_types():
    digest = recipient_fingerprint(701, "5511999999999")
    exp = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)
    legacy = jwt.encode({"type": "whatsapp_opt_out", "rid": 701, "contact": digest, "exp": exp},
                        settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    assert optout.resolve_opt_out_token(legacy) == (701, digest)
    other = jwt.encode({"type": "customer", "rid": 701, "contact": digest, "exp": exp},
                       settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    with pytest.raises(ValueError):
        optout.resolve_opt_out_token(other)
    expired = jwt.encode({"type": "whatsapp_opt_out", "rid": 701, "contact": digest,
                          "exp": dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)},
                         settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    with pytest.raises(ValueError):
        optout.resolve_opt_out_token(expired)


def test_confirming_compact_link_blocks_only_its_tenant_and_is_idempotent(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/short-optout.db")
    Base.metadata.create_all(engine)
    token = optout.create_opt_out_token(701, "5511999999999")
    with Session(engine) as db:
        assert db.query(WhatsAppContactOptOut).count() == 0
        with pytest.raises(HTTPException) as error:
            apply_opt_out(OptOutRequest(token="invalid-capability-here-with-length"), db)
        assert error.value.status_code == 404
        assert db.query(WhatsAppContactOptOut).count() == 0
        assert apply_opt_out(OptOutRequest(token=token), db) == {"disabled": True}
        assert apply_opt_out(OptOutRequest(token=token), db) == {"disabled": True}
        records = db.query(WhatsAppContactOptOut).all()
        assert len(records) == 1
        assert records[0].restaurante_id == 701
        assert records[0].phone_hash == recipient_fingerprint(701, "5511999999999")
    engine.dispose()
