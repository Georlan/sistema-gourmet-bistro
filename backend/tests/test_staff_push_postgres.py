"""Real PostgreSQL policy checks, only against an explicitly local test database."""
import os
import uuid
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.engine import make_url

URL = os.getenv("STAFF_PUSH_TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="Requires local PostgreSQL test database with migrations applied")


def test_staff_push_force_rls_and_operator_tenant_binding():
    url = make_url(URL)
    assert url.host in {"127.0.0.1", "localhost"} and "test" in (url.database or ""), "Local test DB required"
    engine = create_engine(URL)
    tenant_a = 100000 + int(uuid.uuid4().hex[:7], 16)
    tenant_b = tenant_a + 1
    suffix = uuid.uuid4().hex
    users = [f"push-a-{suffix}", f"push-b-{suffix}"]
    ids = [f"a-{suffix}", f"b-{suffix}"]
    try:
        with engine.begin() as conn:
            flags = conn.execute(text("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='staff_push_subscriptions'")).one()
            assert flags == (True, True)
            conn.execute(text("INSERT INTO restaurantes(id,nome,plano,slug) VALUES (:a,'Push A','pocket',:sa),(:b,'Push B','pocket',:sb)"), {"a": tenant_a, "b": tenant_b, "sa": users[0], "sb": users[1]})
            for tenant, user, row_id in zip([tenant_a, tenant_b], users, ids):
                conn.execute(text("INSERT INTO usuarios(id,nome,restaurante_id,cargo,status) VALUES (:u,'Push',:r,'caixa','ativo')"), {"u": user, "r": tenant})
                conn.execute(text("INSERT INTO staff_push_subscriptions(id,restaurante_id,usuario_id,endpoint_hash,endpoint_ciphertext,p256dh_ciphertext,auth_ciphertext) VALUES (:id,:r,:u,:h,'cipher','cipher','cipher')"), {"id": row_id, "r": tenant, "u": user, "h": uuid.uuid4().hex})
        with engine.begin() as conn:
            conn.execute(text("SET LOCAL ROLE koma_app"))
            assert conn.execute(text("SELECT count(*) FROM staff_push_subscriptions")).scalar() == 0
            conn.execute(text("SELECT set_config('app.current_restaurante_id',:r,true)"), {"r": str(tenant_a)})
            assert conn.execute(text("SELECT id FROM staff_push_subscriptions")).scalars().all() == [ids[0]]
            assert conn.execute(text("UPDATE staff_push_subscriptions SET enabled=true WHERE id=:id"), {"id": ids[1]}).rowcount == 0
        for tenant, user in [(tenant_b, users[1]), (tenant_a, users[1])]:
            with pytest.raises(DBAPIError):
                with engine.begin() as conn:
                    conn.execute(text("SET LOCAL ROLE koma_app"))
                    conn.execute(text("SELECT set_config('app.current_restaurante_id',:r,true)"), {"r": str(tenant_a)})
                    conn.execute(text("INSERT INTO staff_push_subscriptions(id,restaurante_id,usuario_id,endpoint_hash,endpoint_ciphertext,p256dh_ciphertext,auth_ciphertext) VALUES (:id,:r,:u,:h,'cipher','cipher','cipher')"), {"id": uuid.uuid4().hex, "r": tenant, "u": user, "h": uuid.uuid4().hex})
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM staff_push_subscriptions WHERE restaurante_id IN (:a,:b)"), {"a": tenant_a, "b": tenant_b})
            conn.execute(text("DELETE FROM usuarios WHERE restaurante_id IN (:a,:b)"), {"a": tenant_a, "b": tenant_b})
            conn.execute(text("DELETE FROM restaurantes WHERE id IN (:a,:b)"), {"a": tenant_a, "b": tenant_b})
        engine.dispose()
