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


def _item(
    product_id: str,
    price: str,
    *,
    extra: str = "0",
    notes: str | None = None,
    quantity: int | str = 1,
) -> ValidatedOrderItem:
    return ValidatedOrderItem(
        product_id=product_id,
        name=product_id,
        base_price=Decimal(price),
        quantity=Decimal(str(quantity)),
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
    assert admin_entry["quantidades"] == [1, 1]

    pub_entry = client.get(f"/api/cardapio-digital/public?restaurante_id={RESTAURANTE_ID}").json()["promocoes"][0]
    assert pub_entry["id"] == "legacy-2-slot"
    assert pub_entry["tipo"] == "combo"
    assert pub_entry["brinde_nome"] is None
    assert pub_entry["quantidades"] == [1, 1]


# ---------------------------------------------------------------------------
# 4. Multi-quantity slots (e.g. "Compre 5 Quentinhas G, ganhe 1 M")
# ---------------------------------------------------------------------------


def test_compre_ganhe_multi_qty_item_agrupado_e_itens_customizados_exato_centavo():
    promo = {
        "id": "promo-5g-1m",
        "nome": "Compre 5 Quentinhas G e ganhe 1 M",
        "tipo": "compre_ganhe",
        "brinde_nome": None,
        "preco": 50.0,
        "componentes": [["quentinha-g"], ["quentinha-m"]],
        "quantidades": [5, 1],
        "ativo": True,
    }

    # Caso A: 1 item com qty=5 (5x14 = 70) + 1 brinde qty=1 (10) -> base 80 -> promo 50.00
    res_grouped = apply_promotion_to_validated(
        _validated(
            _item("quentinha-g", "14.00", extra="2.00", quantity=5),
            _item("quentinha-m", "10.00", quantity=1),
        ),
        promo,
        expected_price=Decimal("50.00"),
    )
    base_sum_a = sum(it.base_price * it.quantity for it in res_grouped.items)
    assert base_sum_a == Decimal("50.00")
    assert all(it.base_price >= Decimal("0.00") for it in res_grouped.items)
    # Adicionais (5 * 2.00 = 10.00) preservados sobre a base promocional
    total_with_mods_a = sum(
        (it.base_price + sum(m.price for m in it.modifiers)) * it.quantity
        for it in res_grouped.items
    )
    assert total_with_mods_a == Decimal("60.00")

    # Caso B: 5 itens customizados de qty=1 + 1 brinde qty=1 (implícito e explícito)
    custom_items = [
        _item("quentinha-g", "14.00", notes=f"marmita {i + 1}") for i in range(5)
    ] + [_item("quentinha-m", "10.00", notes="brinde sem salada")]

    for indices in (None, (0, 1, 2, 3, 4, 5)):
        res_split = apply_promotion_to_validated(
            _validated(*custom_items),
            promo,
            item_indices=indices,
        )
        assert sum(it.base_price * it.quantity for it in res_split.items) == Decimal("50.00")
        assert all(it.base_price >= Decimal("0.00") for it in res_split.items)
        assert [it.notes for it in res_split.items] == [
            "marmita 1", "marmita 2", "marmita 3", "marmita 4", "marmita 5", "brinde sem salada",
        ]

    # Caso C: carrinho misto com 1 Quentinha G avulsa no índice 0 + promoção nos índices 1..6
    avulsa = _item("quentinha-g", "14.00", notes="avulsa")
    res_mixed = apply_promotion_to_validated(
        _validated(avulsa, *custom_items),
        promo,
        item_indices=(1, 2, 3, 4, 5, 6),
    )
    assert res_mixed.items[0] == avulsa
    assert sum(it.base_price * it.quantity for it in res_mixed.items) == Decimal("64.00")


def test_multi_qty_desconto_e_acrescimo_nao_divisiveis_mantem_centavo_exato_sem_negativo():
    # Desconto R$ 11.00 sobre qty=3 (base 3*14 + 1*10 = 52 -> promo 41.00)
    promo_discount = {
        "id": "promo-3g-1m",
        "nome": "3 G + 1 M",
        "tipo": "compre_ganhe",
        "preco": 41.0,
        "componentes": [["quentinha-g"], ["quentinha-m"]],
        "quantidades": [3, 1],
        "ativo": True,
    }
    res_disc = apply_promotion_to_validated(
        _validated(_item("quentinha-g", "14.00", quantity=3), _item("quentinha-m", "10.00", quantity=1)),
        promo_discount,
    )
    assert sum(it.base_price * it.quantity for it in res_disc.items) == Decimal("41.00")
    assert sum(it.quantity for it in res_disc.items if it.product_id == "quentinha-g") == Decimal("3")
    assert all(it.base_price >= Decimal("0.00") for it in res_disc.items)

    # Caso extremo: base 3*1.00 = 3.00 -> promo 0.01 (desconto 2.99 não divisível por 3)
    promo_extreme = {
        "id": "promo-extreme",
        "nome": "3 itens por 1 centavo",
        "tipo": "desconto_item",
        "preco": 0.01,
        "componentes": [["item-barato"]],
        "quantidades": [3],
        "ativo": True,
    }
    res_ext = apply_promotion_to_validated(
        _validated(_item("item-barato", "1.00", quantity=3)),
        promo_extreme,
    )
    assert sum(it.base_price * it.quantity for it in res_ext.items) == Decimal("0.01")
    assert sum(it.quantity for it in res_ext.items) == Decimal("3")
    assert all(it.base_price >= Decimal("0.00") for it in res_ext.items)

    # Acréscimo (promo_price > base_total) não divisível por 3: base 3*10 = 30 -> promo 31.00
    promo_surcharge = {
        "id": "promo-surcharge",
        "nome": "3 itens preço próprio",
        "tipo": "desconto_item",
        "preco": 31.0,
        "componentes": [["item-base"]],
        "quantidades": [3],
        "ativo": True,
    }
    res_sur = apply_promotion_to_validated(
        _validated(_item("item-base", "10.00", quantity=3)),
        promo_surcharge,
    )
    assert sum(it.base_price * it.quantity for it in res_sur.items) == Decimal("31.00")
    assert sum(it.quantity for it in res_sur.items) == Decimal("3")
    assert all(it.base_price >= Decimal("0.00") for it in res_sur.items)


@pytest.mark.parametrize(
    "items,indices",
    [
        # Apenas 4xG agrupado em vez de 5xG
        ([_item("quentinha-g", "14.00", quantity=4), _item("quentinha-m", "10.00", quantity=1)], None),
        ([_item("quentinha-g", "14.00", quantity=4), _item("quentinha-m", "10.00", quantity=1)], (0, 1)),
        # Apenas 4xG separados em vez de 5xG
        ([_item("quentinha-g", "14.00") for _ in range(4)] + [_item("quentinha-m", "10.00")], (0, 1, 2, 3, 4)),
        # Excesso: 6xG em vez de 5xG
        ([_item("quentinha-g", "14.00", quantity=6), _item("quentinha-m", "10.00", quantity=1)], (0, 1)),
        # Brinde com quantidade errada (2xM em vez de 1xM)
        ([_item("quentinha-g", "14.00", quantity=5), _item("quentinha-m", "10.00", quantity=2)], (0, 1)),
    ],
)
def test_multi_qty_rejeita_quantidade_incorreta(items, indices):
    promo = {
        "id": "promo-5g-1m",
        "nome": "Compre 5 G ganhe 1 M",
        "tipo": "compre_ganhe",
        "preco": 50.0,
        "componentes": [["quentinha-g"], ["quentinha-m"]],
        "quantidades": [5, 1],
        "ativo": True,
    }
    with pytest.raises(OrderValidationError):
        apply_promotion_to_validated(_validated(*items), promo, item_indices=indices)


@pytest.mark.parametrize(
    "bad_quantidades",
    [
        [5],          # tamanho diferente de componentes (2 slots)
        [5, 1, 1],    # tamanho maior que componentes
        [0, 1],       # quantidade zero
        [-2, 1],      # quantidade negativa
        [21, 1],      # excede limite por etapa (20)
        [20, 6],      # soma (26) excede limite total (25)
        [True, 1],    # booleano não é inteiro válido
    ],
)
def test_admin_promocoes_rejeita_quantidades_invalidas(universal_promo_catalog, bad_quantidades):
    headers = _admin_headers()
    res = client.post(
        "/api/cardapio-digital/promocoes",
        headers=headers,
        json={
            "nome": "Promo Quantidade Inválida",
            "tipo": "compre_ganhe",
            "preco": 50.0,
            "componentes": [["univ-burger"], ["univ-refri"]],
            "quantidades": bad_quantidades,
            "ativo": True,
        },
    )
    assert res.status_code == 422, res.text


def test_e2e_compre_ganhe_multi_qty_5_mais_1_agrupado_e_customizado(universal_promo_catalog):
    headers = _admin_headers()
    create_res = client.post(
        "/api/cardapio-digital/promocoes",
        headers=headers,
        json={
            "nome": "Compre 5 X-Bacon, ganhe 1 Refri",
            "descricao": "5 lanches + 1 refrigerante grátis",
            "tipo": "compre_ganhe",
            "preco": 100.0,
            "componentes": [["univ-burger"], ["univ-refri"]],
            "quantidades": [5, 1],
            "ativo": True,
        },
    )
    assert create_res.status_code == 201, create_res.text
    created = create_res.json()
    promo_id = created["id"]
    assert created["quantidades"] == [5, 1]

    # Admin e público expõem quantidades=[5, 1]
    admin_entry = next(
        p for p in client.get("/api/cardapio-digital/promocoes", headers=headers).json()["promocoes"]
        if p["id"] == promo_id
    )
    assert admin_entry["quantidades"] == [5, 1]

    pub_entry = next(
        p for p in client.get(f"/api/cardapio-digital/public?restaurante_id={RESTAURANTE_ID}").json()["promocoes"]
        if p["id"] == promo_id
    )
    assert pub_entry["quantidades"] == [5, 1]

    # 1. Checkout agrupado: 1 item qty=5 + 1 item qty=1
    grouped_payload = _payload("multi-grouped-" + uuid.uuid4().hex)
    grouped_payload.update(
        promocao_id=promo_id,
        promocao_preco_esperado=100.0,
        promocao_item_indices=[0, 1],
    )
    grouped_payload["itens"] = [
        {"produto_id": "univ-burger", "quantidade": 5},
        {"produto_id": "univ-refri", "quantidade": 1},
    ]
    res_grouped = client.post("/cardapio/pedidos", json=grouped_payload)
    assert res_grouped.status_code == 201, res_grouped.text
    assert res_grouped.json()["total"] == 107  # 100 + frete 7

    # 2. Checkout customizado: 5 itens separados de qty=1 + 1 brinde qty=1 (6 índices!)
    custom_payload = _payload("multi-custom-" + uuid.uuid4().hex)
    custom_payload.update(
        promocao_id=promo_id,
        promocao_preco_esperado=100.0,
        promocao_item_indices=[0, 1, 2, 3, 4, 5],
    )
    custom_payload["itens"] = [
        {"produto_id": "univ-burger", "quantidade": 1, "observacao": f"lanche {i + 1}"}
        for i in range(5)
    ] + [{"produto_id": "univ-refri", "quantidade": 1, "observacao": "gelado"}]
    res_custom = client.post("/cardapio/pedidos", json=custom_payload)
    assert res_custom.status_code == 201, res_custom.text
    assert res_custom.json()["total"] == 107  # 100 + frete 7

    # Verifica 6 linhas Item persistidas no banco com observações preservadas
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        persisted = (
            db.query(Item)
            .filter_by(restaurante_id=RESTAURANTE_ID, comanda_id=res_custom.json()["comanda_id"])
            .all()
        )
        assert len(persisted) == 6
        assert sorted(it.observacao or "" for it in persisted) == [
            "gelado", "lanche 1", "lanche 2", "lanche 3", "lanche 4", "lanche 5",
        ]
    finally:
        current_restaurante_id.reset(token)
        db.close()

    # 3. Checkout com quantidade errada (apenas 4 X-Bacon) deve falhar
    wrong_payload = _payload("multi-wrong-" + uuid.uuid4().hex)
    wrong_payload.update(
        promocao_id=promo_id,
        promocao_preco_esperado=100.0,
        promocao_item_indices=[0, 1],
    )
    wrong_payload["itens"] = [
        {"produto_id": "univ-burger", "quantidade": 4},
        {"produto_id": "univ-refri", "quantidade": 1},
    ]
    res_wrong = client.post("/cardapio/pedidos", json=wrong_payload)
    assert res_wrong.status_code in (400, 422), res_wrong.text


def test_promotion_imagem_url_persisted_and_exposed():
    res = client.post(
        "/api/cardapio-digital/promocoes",
        headers=_admin_headers(),
        json={
            "nome": "Combo Foto Teste",
            "descricao": "Com imagem",
            "imagem_url": "  https://cdn.example.com/promo.webp  ",
            "tipo": "combo",
            "preco": 35.0,
            "componentes": [["univ-burger"], ["univ-refri"]],
            "ativo": True,
        },
    )
    assert res.status_code == 201, res.text
    promo_id = res.json()["id"]
    assert res.json()["imagem_url"] == "https://cdn.example.com/promo.webp"

    admin_list = client.get("/api/cardapio-digital/promocoes", headers=_admin_headers())
    assert admin_list.status_code == 200
    admin_entry = next(p for p in admin_list.json()["promocoes"] if p["id"] == promo_id)
    assert admin_entry["imagem_url"] == "https://cdn.example.com/promo.webp"

    pub_res = client.get(f"/api/cardapio-digital/public?restaurante_id={RESTAURANTE_ID}")
    assert pub_res.status_code == 200
    pub_entry = next(p for p in pub_res.json()["promocoes"] if p["id"] == promo_id)
    assert pub_entry["imagem_url"] == "https://cdn.example.com/promo.webp"

    # Whitespace-only imagem_url normalizes to None
    upd = client.put(
        f"/api/cardapio-digital/promocoes/{promo_id}",
        headers=_admin_headers(),
        json={
            "nome": "Combo Foto Teste",
            "descricao": "Sem imagem",
            "imagem_url": "   ",
            "tipo": "combo",
            "preco": 35.0,
            "componentes": [["univ-burger"], ["univ-refri"]],
            "ativo": True,
        },
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["imagem_url"] is None


def test_multiplas_instancias_da_mesma_promocao_aplicam_preco_por_instancia():
    promo_bf = {
        "id": "promo-bf",
        "nome": "Quentinha G - Black Friday",
        "tipo": "desconto_item",
        "preco": 10.0,
        "componentes": [["quentinha-g"]],
        "quantidades": [1],
        "ativo": True,
    }
    validated = _validated(
        _item("quentinha-g", "18.00"),
        _item("quentinha-g", "18.00"),
    )
    quoted = apply_promotion_to_validated(
        validated,
        promo_bf,
        expected_price=Decimal("10.00"),
        item_indices=(0, 1),
    )
    assert sum(it.base_price * it.quantity for it in quoted.items) == Decimal("20.00")

    promo_5g_1m = {
        "id": "promo-5g-1m",
        "nome": "Compre 5 G ganhe 1 M",
        "tipo": "compre_ganhe",
        "preco": 50.0,
        "componentes": [["quentinha-g"], ["quentinha-m"]],
        "quantidades": [5, 1],
        "brinde_nome": "Refrigerante Lata",
        "ativo": True,
    }
    two_combos = (
        [_item("quentinha-g", "18.00") for _ in range(5)]
        + [_item("quentinha-m", "14.00")]
        + [_item("quentinha-g", "18.00") for _ in range(5)]
        + [_item("quentinha-m", "14.00")]
    )
    quoted_combos = apply_promotion_to_validated(
        _validated(*two_combos),
        promo_5g_1m,
        expected_price=Decimal("50.00"),
        item_indices=tuple(range(12)),
    )
    assert sum(it.base_price * it.quantity for it in quoted_combos.items) == Decimal("100.00")
    assert sum(1 for it in quoted_combos.items if "Refrigerante Lata" in (it.notes or "")) == 2

    with pytest.raises(OrderValidationError):
        apply_promotion_to_validated(
            _validated(*two_combos[:7]),
            promo_5g_1m,
            item_indices=tuple(range(7)),
        )
