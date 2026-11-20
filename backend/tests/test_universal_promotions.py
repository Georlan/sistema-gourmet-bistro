"""Testes da engine universal de promoções (combo 2..4, compre_ganhe, desconto_item)."""
from __future__ import annotations

from decimal import Decimal
import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal, current_restaurante_id
from app.domain.orders.errors import OrderValidationError
from app.domain.orders.types import FulfillmentType
from app.domain.orders.validation import ValidatedModifier, ValidatedOrderInput, ValidatedOrderItem
from app.main import app
from app.models import Categoria, ConfiguracaoRestaurante, Item, Produto, Restaurante, Usuario
from app.promotions import active_promotions, apply_promotion_to_validated
from app.routes.auth import create_access_token
from test_online_order_server_authority import (
    CATEGORIA_ID,
    PRODUTO_ID,
    RESTAURANTE_ID,
    _payload,
    setup_restaurant_authority,
)

client = TestClient(app)
ADMIN_USER_ID = "usr-admin-universal-promo"


def _item(product_id: str, price: str, *, extra: str = "0", notes: str | None = None) -> ValidatedOrderItem:
    return ValidatedOrderItem(
        product_id=product_id,
        name=product_id,
        base_price=Decimal(price),
        quantity=Decimal("1"),
        modifiers=(
            (ValidatedModifier(id="extra", name="Adicional", price=Decimal(extra)),)
            if extra != "0"
            else ()
        ),
        notes=notes,
    )


def _validated(*items: ValidatedOrderItem) -> ValidatedOrderInput:
    return ValidatedOrderInput(
        restaurant_id=RESTAURANTE_ID,
        fulfillment=FulfillmentType.PICKUP,
        items=tuple(items),
    )


def _admin_headers() -> dict[str, str]:
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        user = db.query(Usuario).filter(Usuario.id == ADMIN_USER_ID).first()
        if user is None:
            user = Usuario(
                id=ADMIN_USER_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Admin Promoções",
                email="admin-promos@koma.com",
                cargo="admin",
                status="ativo",
            )
            db.add(user)
            db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()

    jwt_token = create_access_token(
        subject=ADMIN_USER_ID,
        restaurante_id=RESTAURANTE_ID,
        role="admin",
    )
    return {"Authorization": f"Bearer {jwt_token}"}


@pytest.fixture
def universal_promo_catalog(setup_restaurant_authority):
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RESTAURANTE_ID).one()
    previous = (config.promocoes, config.pedido_minimo)
    extra_ids = ("univ-burger", "univ-batata", "univ-refri", "univ-sobremesa")
    try:
        for pid, nome, preco in (
            ("univ-burger", "X-Bacon Artesanal", 28.0),
            ("univ-batata", "Batata Frita M", 12.0),
            ("univ-refri", "Refrigerante Lata", 7.0),
            ("univ-sobremesa", "Pudim da Casa", 10.0),
        ):
            existing = db.query(Produto).filter_by(restaurante_id=RESTAURANTE_ID, id=pid).first()
            if existing is None:
                db.add(
                    Produto(
                        id=pid,
                        restaurante_id=RESTAURANTE_ID,
                        nome=nome,
                        categoria_id=CATEGORIA_ID,
                        preco=preco,
                        ativo=True,
                        somente_promocao=False,
                    )
                )
            else:
                existing.preco = preco
                existing.ativo = True
                existing.somente_promocao = False
        config.pedido_minimo = 0
        config.promocoes = []
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()

    try:
        yield extra_ids
    finally:
        db = SessionLocal()
        token = current_restaurante_id.set(RESTAURANTE_ID)
        try:
            config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RESTAURANTE_ID).one()
            config.promocoes, config.pedido_minimo = previous
            db.commit()
        finally:
            current_restaurante_id.reset(token)
            db.close()


# ---------------------------------------------------------------------------
# 1. Pure domain tests (apply_promotion_to_validated & active_promotions)
# ---------------------------------------------------------------------------


def test_compre_ganhe_com_brinde_textual_aplica_preco_e_observacao_sem_duplicar():
    promo = {
        "id": "promo-cg-text",
        "nome": "Burger + Pitchulinha Grátis",
        "tipo": "compre_ganhe",
        "brinde_nome": "Pitchulinha 200ml",
        "preco": 25.0,
        "componentes": [["univ-burger"]],
        "ativo": True,
    }
    # Sem observação prévia
    res_empty = apply_promotion_to_validated(
        _validated(_item("univ-burger", "28.00", extra="3.00")),
        promo,
    )
    assert res_empty.items[0].base_price == Decimal("25.00")
    assert res_empty.items[0].modifiers[0].price == Decimal("3.00")
    assert res_empty.items[0].notes == "Brinde: Pitchulinha 200ml"

    # Preservando observação existente do cliente
    res_with_notes = apply_promotion_to_validated(
        _validated(_item("univ-burger", "28.00", notes="sem cebola")),
        promo,
    )
    assert res_with_notes.items[0].notes == "sem cebola | Brinde: Pitchulinha 200ml"

    # Sem duplicar se a tag já estiver presente
    res_already_tagged = apply_promotion_to_validated(
        _validated(_item("univ-burger", "28.00", notes="sem cebola | Brinde: Pitchulinha 200ml")),
        promo,
    )
    assert res_already_tagged.items[0].notes == "sem cebola | Brinde: Pitchulinha 200ml"

    # Preço promocional maior que base_total também anexa o brinde
    res_higher = apply_promotion_to_validated(
        _validated(_item("univ-burger", "20.00", notes="ponto mal passado")),
        {**promo, "preco": 22.0},
    )
    assert res_higher.items[0].base_price == Decimal("22.00")
    assert res_higher.items[0].notes == "ponto mal passado | Brinde: Pitchulinha 200ml"


def test_compre_ganhe_com_produto_do_catalogo_dois_slots_sem_nota_textual():
    promo = {
        "id": "promo-cg-catalog",
        "nome": "Burger + Refri Grátis",
        "tipo": "compre_ganhe",
        "brinde_nome": None,
        "preco": 28.0,
        "componentes": [["univ-burger"], ["univ-refri"]],
        "ativo": True,
    }
    res = apply_promotion_to_validated(
        _validated(_item("univ-burger", "28.00", notes="ponto médio"), _item("univ-refri", "7.00")),
        promo,
    )
    assert sum(it.base_price for it in res.items) == Decimal("28.00")
    assert res.items[0].notes == "ponto médio"
    assert res.items[1].notes is None


def test_desconto_item_unico_aplica_preco_programado():
    promo = {
        "id": "promo-item-1",
        "nome": "Quinta do X-Bacon",
        "tipo": "desconto_item",
        "brinde_nome": None,
        "preco": 19.90,
        "componentes": [["univ-burger"]],
        "ativo": True,
    }
    res = apply_promotion_to_validated(
        _validated(_item("univ-burger", "28.00", extra="4.00", notes="capricha no bacon")),
        promo,
        expected_price=Decimal("19.90"),
    )
    assert res.items[0].base_price == Decimal("19.90")
    assert res.items[0].modifiers[0].price == Decimal("4.00")
    assert res.items[0].notes == "capricha no bacon"


def test_combo_3_e_4_slots_distribui_desconto_sem_preco_negativo():
    promo_3 = {
        "id": "promo-combo-3",
        "nome": "Combo Triplo",
        "tipo": "combo",
        "brinde_nome": None,
        "preco": 35.0,
        "componentes": [["univ-burger"], ["univ-batata"], ["univ-refri"]],
        "ativo": True,
    }
    # Soma avulsa = 28 + 12 + 7 = 47; desconto = 12 <= 28
    res3 = apply_promotion_to_validated(
        _validated(
            _item("univ-burger", "28.00"),
            _item("univ-batata", "12.00"),
            _item("univ-refri", "7.00"),
        ),
        promo_3,
    )
    assert sum(it.base_price for it in res3.items) == Decimal("35.00")
    assert all(it.base_price >= Decimal("0.00") for it in res3.items)

    # Desconto grande que excede o primeiro item (28 + 12 + 7 + 10 = 57 -> promo 20, desconto 37 > 28)
    promo_4 = {
        "id": "promo-combo-4",
        "nome": "Combo Família",
        "tipo": "combo",
        "brinde_nome": None,
        "preco": 20.0,
        "componentes": [["univ-burger"], ["univ-batata"], ["univ-refri"], ["univ-sobremesa"]],
        "ativo": True,
    }
    res4 = apply_promotion_to_validated(
        _validated(
            _item("univ-burger", "28.00"),
            _item("univ-batata", "12.00"),
            _item("univ-refri", "7.00"),
            _item("univ-sobremesa", "10.00"),
        ),
        promo_4,
    )
    assert sum(it.base_price for it in res4.items) == Decimal("20.00")
    assert all(it.base_price >= Decimal("0.00") for it in res4.items)


def test_legacy_2_slot_combo_sem_tipo_e_brinde_nome_continua_funcional():
    legacy = {
        "id": "promo-legacy",
        "nome": "Combo Antigo",
        "preco": 32.0,
        "componentes": [["univ-burger"], ["univ-refri"]],
        "ativo": True,
    }
    products = [
        type("P", (), {"id": "univ-burger", "ativo": True})(),
        type("P", (), {"id": "univ-refri", "ativo": True})(),
    ]
    visible = active_promotions(type("C", (), {"promocoes": [legacy]})(), products)
    assert len(visible) == 1
    assert visible[0]["tipo"] == "combo"
    assert visible[0]["brinde_nome"] is None

    res = apply_promotion_to_validated(
        _validated(_item("univ-burger", "28.00"), _item("univ-refri", "7.00")),
        legacy,
    )
    assert sum(it.base_price for it in res.items) == Decimal("32.00")


# ---------------------------------------------------------------------------
# 2. HTTP Admin API validation & public payload exposure
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "invalid_payload",
    [
        # Combo precisa de 2..4 slots
        {
            "nome": "Combo 1 slot",
            "tipo": "combo",
            "preco": 20.0,
            "componentes": [["univ-burger"]],
        },
        # Combo não aceita brinde_nome
        {
            "nome": "Combo com brinde",
            "tipo": "combo",
            "brinde_nome": "Refri",
            "preco": 30.0,
            "componentes": [["univ-burger"], ["univ-batata"]],
        },
        # Compre e Ganhe 1 slot exige brinde_nome
        {
            "nome": "Compre Ganhe sem brinde",
            "tipo": "compre_ganhe",
            "brinde_nome": "   ",
            "preco": 25.0,
            "componentes": [["univ-burger"]],
        },
        # Compre e Ganhe 2 slots não aceita brinde_nome simultâneo
        {
            "nome": "Compre Ganhe duplicado",
            "tipo": "compre_ganhe",
            "brinde_nome": "Refri Extra",
            "preco": 28.0,
            "componentes": [["univ-burger"], ["univ-refri"]],
        },
        # Compre e Ganhe não aceita 3 slots
        {
            "nome": "Compre Ganhe 3 slots",
            "tipo": "compre_ganhe",
            "preco": 30.0,
            "componentes": [["univ-burger"], ["univ-batata"], ["univ-refri"]],
        },
        # Desconto em item exige exatamente 1 slot
        {
            "nome": "Desconto 2 slots",
            "tipo": "desconto_item",
            "preco": 25.0,
            "componentes": [["univ-burger"], ["univ-batata"]],
        },
        # Desconto em item não aceita brinde_nome
        {
            "nome": "Desconto com brinde",
            "tipo": "desconto_item",
            "brinde_nome": "Sobremesa",
            "preco": 22.0,
            "componentes": [["univ-burger"]],
        },
        # Tipo inválido
        {
            "nome": "Tipo Desconhecido",
            "tipo": "levar_3_pagar_2",
            "preco": 20.0,
            "componentes": [["univ-burger"]],
        },
    ],
)
def test_admin_promocoes_rejeita_combinacoes_invalidas_de_tipo_slots_e_brinde(
    universal_promo_catalog, invalid_payload
):
    headers = _admin_headers()
    res = client.post("/api/cardapio-digital/promocoes", headers=headers, json=invalid_payload)
    assert res.status_code == 422, res.text


# ---------------------------------------------------------------------------
# 3. End-to-end HTTP CRUD + Public Menu + Real Checkout (/cardapio/pedidos)
# ---------------------------------------------------------------------------


def test_e2e_compre_ganhe_brinde_textual_checkout_e_replay(universal_promo_catalog):
    headers = _admin_headers()
    create_res = client.post(
        "/api/cardapio-digital/promocoes",
        headers=headers,
        json={
            "nome": "X-Bacon + Pitchulinha",
            "descricao": "Compre 1 X-Bacon e ganhe 1 Pitchulinha 200ml",
            "tipo": "compre_ganhe",
            "brinde_nome": "  Pitchulinha   200ml  ",
            "preco": 24.0,
            "componentes": [["univ-burger"]],
            "ativo": True,
        },
    )
    assert create_res.status_code == 201, create_res.text
    created = create_res.json()
    promo_id = created["id"]
    assert created["tipo"] == "compre_ganhe"
    assert created["brinde_nome"] == "Pitchulinha 200ml"

    # Admin list expõe tipo e brinde_nome
    admin_res = client.get("/api/cardapio-digital/promocoes", headers=headers)
    assert admin_res.status_code == 200
    admin_entry = next(p for p in admin_res.json()["promocoes"] if p["id"] == promo_id)
    assert admin_entry["tipo"] == "compre_ganhe"
    assert admin_entry["brinde_nome"] == "Pitchulinha 200ml"
    assert admin_entry["status"] == "ativa"

    # Cardápio público expõe tipo e brinde_nome
    pub_res = client.get(f"/api/cardapio-digital/public?restaurante_id={RESTAURANTE_ID}")
    assert pub_res.status_code == 200
    pub_entry = next(p for p in pub_res.json()["promocoes"] if p["id"] == promo_id)
    assert pub_entry["tipo"] == "compre_ganhe"
    assert pub_entry["brinde_nome"] == "Pitchulinha 200ml"

    # Checkout real com carrinho misto (1 avulso + 1 promocional via promocao_item_indices=[1])
    payload = _payload("cg-text-" + uuid.uuid4().hex)
    payload.update(
        promocao_id=promo_id,
        promocao_preco_esperado=24.0,
        promocao_item_indices=[1],
    )
    payload["itens"] = [
        {"produto_id": "univ-burger", "quantidade": 1, "observacao": "avulso"},
        {"produto_id": "univ-burger", "quantidade": 1, "observacao": "sem picles"},
    ]
    order_res = client.post("/cardapio/pedidos", json=payload)
    assert order_res.status_code == 201, order_res.text
    # 28 (avulso) + 24 (promo) + 7 (frete autoritativo) = 59
    assert order_res.json()["total"] == 59

    # Replay idempotente
    replay_res = client.post("/cardapio/pedidos", json=payload)
    assert replay_res.status_code in (200, 201)
    assert replay_res.json()["comanda_id"] == order_res.json()["comanda_id"]

    # Verifica observação persistida no banco (KDS / impressão / PDV)
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        items = (
            db.query(Item)
            .filter_by(restaurante_id=RESTAURANTE_ID, comanda_id=order_res.json()["comanda_id"])
            .all()
        )
        notes = sorted(it.observacao or "" for it in items)
        assert notes == ["avulso", "sem picles | Brinde: Pitchulinha 200ml"]
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_e2e_desconto_item_e_combo_3_slots_checkout(universal_promo_catalog):
    headers = _admin_headers()

    # 1. Desconto em item único
    disc_res = client.post(
        "/api/cardapio-digital/promocoes",
        headers=headers,
        json={
            "nome": "Happy Hour X-Bacon",
            "tipo": "desconto_item",
            "preco": 19.0,
            "componentes": [["univ-burger"]],
            "ativo": True,
        },
    )
    assert disc_res.status_code == 201, disc_res.text
    disc_id = disc_res.json()["id"]

    disc_payload = _payload("disc-item-" + uuid.uuid4().hex)
    disc_payload.update(
        promocao_id=disc_id,
        promocao_preco_esperado=19.0,
        promocao_item_indices=[0],
    )
    disc_payload["itens"] = [{"produto_id": "univ-burger", "quantidade": 1}]
    disc_order = client.post("/cardapio/pedidos", json=disc_payload)
    assert disc_order.status_code == 201, disc_order.text
    assert disc_order.json()["total"] == 26  # 19 + frete 7

    # 2. Combo de 3 slots
    combo3_res = client.post(
        "/api/cardapio-digital/promocoes",
        headers=headers,
        json={
            "nome": "Combo Triplo Completo",
            "tipo": "combo",
            "preco": 36.0,
            "componentes": [["univ-burger"], ["univ-batata"], ["univ-refri"]],
            "ativo": True,
        },
    )
    assert combo3_res.status_code == 201, combo3_res.text
    combo3_id = combo3_res.json()["id"]

    combo3_payload = _payload("combo3-" + uuid.uuid4().hex)
    combo3_payload.update(
        promocao_id=combo3_id,
        promocao_preco_esperado=36.0,
        promocao_item_indices=[0, 1, 2],
    )
    combo3_payload["itens"] = [
        {"produto_id": "univ-burger", "quantidade": 1},
        {"produto_id": "univ-batata", "quantidade": 1},
        {"produto_id": "univ-refri", "quantidade": 1},
    ]
    combo3_order = client.post("/cardapio/pedidos", json=combo3_payload)
    assert combo3_order.status_code == 201, combo3_order.text
    assert combo3_order.json()["total"] == 43  # 36 + frete 7


def test_e2e_legacy_2_slot_combo_em_banco_retorna_tipo_combo_no_admin_e_publico(universal_promo_catalog):
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RESTAURANTE_ID).one()
        config.promocoes = [
            {
                "id": "legacy-2-slot",
                "nome": "Combo Clássico",
                "preco": 30.0,
                "componentes": [[PRODUTO_ID], ["univ-refri"]],
                "ativo": True,
            }
        ]
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()

    headers = _admin_headers()
    admin_entry = client.get("/api/cardapio-digital/promocoes", headers=headers).json()["promocoes"][0]
    assert admin_entry["id"] == "legacy-2-slot"
    assert admin_entry["tipo"] == "combo"
    assert admin_entry["brinde_nome"] is None

    pub_entry = client.get(f"/api/cardapio-digital/public?restaurante_id={RESTAURANTE_ID}").json()["promocoes"][0]
    assert pub_entry["id"] == "legacy-2-slot"
    assert pub_entry["tipo"] == "combo"
    assert pub_entry["brinde_nome"] is None
