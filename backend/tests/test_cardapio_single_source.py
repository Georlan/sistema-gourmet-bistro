from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import event

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import Restaurante, Usuario
from app.routes import cardapio_digital, products
from app.security import create_access_token


client = TestClient(app)
REPO_ROOT = Path(__file__).resolve().parents[2]
TEST_RESTAURANTE_ID = 9911
TEST_USER_ID = "usr-cardapio-single-source"


def _ensure_admin_and_restaurant():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token_var = current_restaurante_id.set(TEST_RESTAURANTE_ID)
    try:
        restaurante = db.query(Restaurante).filter(
            Restaurante.id == TEST_RESTAURANTE_ID
        ).first()
        if restaurante is None:
            restaurante = Restaurante(
                id=TEST_RESTAURANTE_ID,
                nome="Kôma Fonte Única",
                plano="pro",
                slug="koma-fonte-unica",
            )
            db.add(restaurante)
            db.commit()

        usuario = db.query(Usuario).filter(Usuario.id == TEST_USER_ID).first()
        if usuario is None:
            usuario = Usuario(
                id=TEST_USER_ID,
                nome="Admin Fonte Única",
                email="fonte-unica@koma.test",
                cargo="admin",
                status="ativo",
                restaurante_id=TEST_RESTAURANTE_ID,
            )
            db.add(usuario)
            db.commit()
        else:
            usuario.cargo = "admin"
            usuario.status = "ativo"
            db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    return create_access_token(
        subject=TEST_USER_ID,
        restaurante_id=TEST_RESTAURANTE_ID,
        role="admin",
    )


def test_public_and_internal_catalog_share_category_order_rule():
    assert cardapio_digital._ordered_categories is products.ordered_categories

    categories = [
        SimpleNamespace(nome="Sobremesas"),
        SimpleNamespace(nome="Pizzas Especiais"),
        SimpleNamespace(nome="Bebidas & Vinhos"),
        SimpleNamespace(nome="Pizzas Tradicionais"),
    ]
    ordered = cardapio_digital._ordered_categories(categories)

    assert [category.nome for category in ordered] == [
        "Pizzas Tradicionais",
        "Pizzas Especiais",
        "Bebidas & Vinhos",
        "Sobremesas",
    ]


def test_current_public_menu_loads_one_catalog_snapshot():
    source = (REPO_ROOT / "src/cardapio/CardapioPage.tsx").read_text(encoding="utf-8")

    assert "/api/cardapio-digital/public?" in source
    assert "/api/cardapio-digital/categorias" not in source
    assert "/api/cardapio-digital/produtos" not in source


def test_caixa_settings_round_trip_to_public_storefront():
    token = _ensure_admin_and_restaurant()
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "nome": "Kôma Fonte Única Atualizado",
        "subtitulo": "Configuração salva no Caixa",
        "sobre_nos": "Mesma configuração consumida pelo storefront público.",
        "endereco": "Rua da Fonte Única, 91",
        "google_maps_url": "https://maps.example.test/koma",
        "status_override": "Forçado Aberto",
        "socials": {
            "whatsapp": "5585999999999",
            "instagram": "@koma_fonte_unica",
        },
        "horarios_funcionamento": [
            {"days": "Segunda a Sexta", "hours": "18:00 - 23:00"}
        ],
        "formas_pagamento_aceitas": ["Pix", "Dinheiro"],
        "cor_primaria": "#00875f",
        "cor_fundo": "#0d0d10",
    }

    saved = client.put(
        "/api/cardapio-digital/config",
        headers=headers,
        json=payload,
    )
    assert saved.status_code == 200

    public = client.get(
        f"/api/cardapio-digital/public?restaurante_id={TEST_RESTAURANTE_ID}"
    )
    assert public.status_code == 200
    restaurante = public.json()["restaurante"]

    for field in (
        "nome",
        "subtitulo",
        "sobre_nos",
        "endereco",
        "google_maps_url",
        "status_override",
        "socials",
        "horarios_funcionamento",
        "formas_pagamento_aceitas",
        "cor_primaria",
        "cor_fundo",
    ):
        assert restaurante[field] == payload[field]


def test_hidden_caixa_bridge_does_not_query_database():
    token = _ensure_admin_and_restaurant()
    statements: list[str] = []

    def before_cursor_execute(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        response = client.get(
            "/caixa/config-cardapio",
            headers={"Authorization": f"Bearer {token}"},
        )
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)

    assert response.status_code == 200
    assert response.json()["id"] == TEST_RESTAURANTE_ID
    assert response.json()["deprecated_bridge"] is True
    assert statements == []
