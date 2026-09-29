"""Production PostgreSQL has a UUID token column; legacy SQLite uses strings."""
from types import SimpleNamespace
from uuid import UUID

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.signup_models import SignupBase
from app.services.team_invitations import delivery_id, with_delivery_status


@pytest.mark.parametrize('token', [UUID('3b8014af-6fe0-4c93-bf65-2f649a1179d8'), '3b8014af-6fe0-4c93-bf65-2f649a1179d8'])
def test_team_list_handles_uuid_and_string_invite_tokens(token):
    user = SimpleNamespace(id='test-member', restaurante_id=2, token_convite=token, email=None)
    expected = delivery_id(SimpleNamespace(id=user.id, restaurante_id=2, token_convite=str(token)))
    assert delivery_id(user) == expected
    engine = create_engine('sqlite:///:memory:')
    SignupBase.metadata.create_all(engine)
    with Session(engine) as db:
        assert with_delivery_status(db, [user], 2) == [user]
        assert user.convite_email_status == 'email_ausente'
    engine.dispose()
