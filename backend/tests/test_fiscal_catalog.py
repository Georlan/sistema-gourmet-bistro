import datetime
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import event

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.fiscal_models import ProductFiscalProfile
from app.models import Categoria, Produto, Restaurante
from app.routes import fiscal_onboarding
from app.services.fiscal_catalog import fiscal_catalog_page


@pytest.fixture
def catalog_db():
    Base.metadata.create_all(bind=engine)
    tenant = 980000 + uuid.uuid4().int % 10000
    token = current_restaurante_id.set(tenant)
    db = SessionLocal(restaurante_id=tenant)
    db.add(Restaurante(id=tenant, nome="Fiscal Catalog", plano="pocket"))
    db.commit()
    db.add(Categoria(id="fiscal-cat", restaurante_id=tenant, nome="Produtos"))
    db.commit()
    try:
        yield db, tenant
    finally:
        db.rollback()
        db.query(ProductFiscalProfile).filter_by(restaurante_id=tenant).delete()
        db.query(Produto).filter_by(restaurante_id=tenant).delete()
        db.query(Categoria).filter_by(restaurante_id=tenant).delete()
        db.query(Restaurante).filter_by(id=tenant).delete()
        db.commit()
        db.close()
        current_restaurante_id.reset(token)


def product(db, tenant, product_id="burger", **kwargs):
    result = Produto(id=product_id, restaurante_id=tenant, categoria_id="fiscal-cat", nome=product_id, preco=25, ativo=True, **kwargs)
    db.add(result)
    db.commit()
    return result


def test_existing_and_new_products_have_virtual_drafts_without_writes(catalog_db):
    db, tenant = catalog_db
    product(db, tenant)
    statements = []
    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.strip().split()[0].upper())
    event.listen(engine, "before_cursor_execute", record)
    try:
        page = fiscal_catalog_page(db, restaurante_id=tenant)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert set(statements) == {"SELECT"}
    assert len(statements) == 3
    assert page["items"][0]["preparationStatus"] == "pending"
    assert page["items"][0]["fiscalProfileId"] is None
    assert not page["issuanceReady"]
    assert db.query(ProductFiscalProfile).filter_by(restaurante_id=tenant).count() == 0
    product(db, tenant, "new")
    assert fiscal_catalog_page(db, restaurante_id=tenant)["total"] == 2


def test_current_price_reads_catalog_without_modifying_fiscal_revision(catalog_db):
    db, tenant = catalog_db
    item = product(db, tenant)
    profile = ProductFiscalProfile(restaurante_id=tenant, produto_id=item.id, revision=1, status="ready", source="contador", ncm="21069090")
    db.add(profile)
    db.commit()
    before = fiscal_catalog_page(db, restaurante_id=tenant)["items"][0]
    item.preco = 28
    item.nome = "Novo nome"
    db.commit()
    after = fiscal_catalog_page(db, restaurante_id=tenant)["items"][0]
    assert before["currentPrice"] == "25.00"
    assert after["currentPrice"] == "28.00"
    assert after["name"] == "Novo nome"
    assert before["fiscalProfileId"] == after["fiscalProfileId"]
    assert after["revision"] == 1


@pytest.mark.parametrize("status,valid_from,valid_until,expected", [
    ("draft", None, None, "pending"), ("blocked", None, None, "blocked"),
    ("ready", None, None, "reviewed"),
    ("ready", datetime.date(2099, 1, 1), None, "scheduled"),
    ("ready", None, datetime.date(2000, 1, 1), "expired"),
])
def test_latest_revision_and_validity_are_visible_without_authorizing_issuance(catalog_db, status, valid_from, valid_until, expected):
    db, tenant = catalog_db
    item = product(db, tenant)
    db.add_all([
        ProductFiscalProfile(restaurante_id=tenant, produto_id=item.id, revision=1, status="ready", source="manual", ncm="11111111"),
        ProductFiscalProfile(restaurante_id=tenant, produto_id=item.id, revision=2, status=status, source="contador", ncm="22222222", valid_from=valid_from, valid_until=valid_until),
    ])
    db.commit()
    page = fiscal_catalog_page(db, restaurante_id=tenant)
    assert page["items"][0]["ncm"] == "22222222"
    assert page["items"][0]["preparationStatus"] == expected
    assert not page["issuanceReady"]


def test_pagination_and_inactive_products(catalog_db):
    db, tenant = catalog_db
    for code in ("a", "b", "c"):
        product(db, tenant, code)
    db.query(Produto).filter_by(restaurante_id=tenant, id="b").update({"ativo": False})
    db.commit()
    first = fiscal_catalog_page(db, restaurante_id=tenant, limit=2)
    second = fiscal_catalog_page(db, restaurante_id=tenant, offset=2, limit=2)
    assert first["hasMore"] and not second["hasMore"]
    assert [item["productId"] for item in first["items"]] == ["a", "b"]
    assert not first["items"][1]["active"]
    assert second["items"][0]["productId"] == "c"


def test_route_uses_authenticated_tenant_not_client_and_denies_operator(monkeypatch):
    calls = []
    monkeypatch.setattr(fiscal_onboarding, "require_tenant_id", lambda: 8)
    monkeypatch.setattr("app.services.fiscal_catalog.fiscal_catalog_page", lambda db, **kwargs: calls.append(kwargs) or {"items": []})
    fiscal_onboarding.get_fiscal_products(offset=0, limit=50, db=object(), current_user=SimpleNamespace(cargo="admin", role="admin"))
    assert calls == [{"restaurante_id": 8, "offset": 0, "limit": 50}]
    with pytest.raises(HTTPException) as error:
        fiscal_onboarding.get_fiscal_products(offset=0, limit=50, db=object(), current_user=SimpleNamespace(cargo="caixa", role="caixa"))
    assert error.value.status_code == 403
    assert len(calls) == 1


def test_other_tenant_cannot_read_same_product_id(catalog_db):
    db, tenant = catalog_db
    product(db, tenant)
    other = tenant + 20000
    # Synthetic local tenant only. No production tenant or connection is used.
    other_token = current_restaurante_id.set(other)
    try:
        other_db = SessionLocal(restaurante_id=other)
        assert fiscal_catalog_page(other_db, restaurante_id=other)["items"] == []
        other_db.close()
    finally:
        current_restaurante_id.reset(other_token)
