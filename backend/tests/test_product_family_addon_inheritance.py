"""Real variant prices and shared family choices reach the canonical Order Core."""
from decimal import Decimal

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.application.orders.validation_loader import ValidationDataLoader
from app.catalog_addons import effective_modifier_payloads_by_product
from app.database import Base, current_restaurante_id
from app.domain.orders.validation import OrderValidationService
from app.models import (
    Categoria, GrupoModificador, OpcaoModificador, Produto, ProdutoFamiliaGrupoModificador,
    ProdutoGrupoModificador, Restaurante,
)
from app.routes.product_families import (
    FamilyPersonalizationsUpdate, FamilyWrite, _write_family,
    update_family_personalizations, get_family_personalizations,
)


@pytest.fixture
def menu():
    engine = create_engine("sqlite://")
    token = current_restaurante_id.set(91)
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add_all([
                Restaurante(id=91, nome="Loja 91", plano="pocket"),
                Restaurante(id=92, nome="Loja 92", plano="pocket"),
            ])
            db.flush()
            db.add_all([
                Categoria(id="pasteis-91", restaurante_id=91, nome="Pastéis"),
                Categoria(id="pasteis-92", restaurante_id=92, nome="Pastéis"),
            ])
            db.flush()
            db.add_all([
                Produto(id="pastel-carne", restaurante_id=91, categoria_id="pasteis-91",
                        nome="Pastel Médio Carne de Sol", preco=7),
                Produto(id="pastel-queijo", restaurante_id=91, categoria_id="pasteis-91",
                        nome="Pastel Médio Queijo", preco=8),
                Produto(id="pastel-outra-loja", restaurante_id=92, categoria_id="pasteis-92",
                        nome="Pastel de outra loja", preco=20),
                GrupoModificador(id="molhos", restaurante_id=91, nome="Molhos", tipo="opcional",
                                 min_selecoes=0, max_selecoes=1),
                GrupoModificador(id="outro-tenant", restaurante_id=92, nome="Outro", tipo="opcional",
                                 min_selecoes=0, max_selecoes=1),
            ])
            db.flush()
            db.add(OpcaoModificador(
                id="molho-rose", restaurante_id=91, grupo_id="molhos",
                nome="Molho Rosé", preco_adicional=1, ativo=True,
            ))
            db.commit()
            saved = _write_family(
                db, 91,
                FamilyWrite(nome="Pastel Médio", categoria_id="pasteis-91", eixo="sabor",
                            variantes=[
                                {"produto_id": "pastel-carne", "rotulo": "Carne de Sol", "preco": "7.00"},
                                {"produto_id": "pastel-queijo", "rotulo": "Queijo", "preco": "8.00"},
                            ]), None,
            )
            yield db, saved["id"]
    finally:
        current_restaurante_id.reset(token)
        engine.dispose()


def save_groups(db, family_id, groups, before=()):
    return update_family_personalizations(
        family_id,
        FamilyPersonalizationsUpdate(grupo_ids=list(groups), grupos_anteriores=list(before)),
        BackgroundTasks(), db=db, current_user=object(),
    )


def test_pastel_flavor_selects_real_product_price_and_family_addon(menu):
    db, family_id = menu
    assigned = save_groups(db, family_id, ["molhos"])
    assert assigned == {"familia_id": family_id, "grupo_ids": ["molhos"]}
    assert get_family_personalizations(family_id, db=db, current_user=object()) == assigned
    # Group is stored ONCE on the family, not duplicated into each SKU.
    assert db.query(ProdutoFamiliaGrupoModificador).filter_by(restaurante_id=91).count() == 1
    assert db.query(ProdutoGrupoModificador).filter_by(restaurante_id=91).count() == 0
    products = db.query(Produto).filter(Produto.id.in_(["pastel-carne", "pastel-queijo"])).all()
    groups = effective_modifier_payloads_by_product(db, 91, products)
    assert {g["id"] for g in groups["pastel-carne"]} == {"molhos"}
    assert {g["id"] for g in groups["pastel-queijo"]} == {"molhos"}

    context = ValidationDataLoader.build_validation_context(
        db, restaurante_id=91, fulfillment="retirada",
        itens_solicitados=[
            {"produto_id": "pastel-carne", "quantidade": 1, "modificador_ids": ["molho-rose"]},
            {"produto_id": "pastel-queijo", "quantidade": 1, "modificador_ids": []},
        ],
    )
    validated = OrderValidationService.validate(context)
    assert [item.product_id for item in validated.items] == ["pastel-carne", "pastel-queijo"]
    assert [item.base_price for item in validated.items] == [Decimal("7.00"), Decimal("8.00")]
    assert validated.items[0].modifiers[0].price == Decimal("1.00")
    assert validated.items[1].modifiers == ()


def test_specific_variant_limits_override_family_without_copying_group(menu):
    db, family_id = menu
    save_groups(db, family_id, ["molhos"])
    db.add(ProdutoGrupoModificador(
        restaurante_id=91, produto_id="pastel-queijo", grupo_id="molhos",
        min_selecoes=0, max_selecoes=2, modo_selecao="porcoes",
    ))
    db.commit()
    products = db.query(Produto).filter(Produto.id.in_(["pastel-carne", "pastel-queijo"])).all()
    groups = effective_modifier_payloads_by_product(db, 91, products)
    assert groups["pastel-carne"][0]["max_selecoes"] == 1
    assert groups["pastel-queijo"][0]["max_selecoes"] == 2
    assert groups["pastel-queijo"][0]["modo_selecao"] == "porcoes"


def test_stale_edits_and_foreign_groups_cannot_change_family_links(menu):
    db, family_id = menu
    save_groups(db, family_id, ["molhos"])
    with pytest.raises(HTTPException) as stale:
        save_groups(db, family_id, [], before=[])
    assert stale.value.status_code == 409
    with pytest.raises(HTTPException) as foreign:
        save_groups(db, family_id, ["outro-tenant"], before=["molhos"])
    assert foreign.value.status_code == 422
    assert get_family_personalizations(family_id, db=db, current_user=object())["grupo_ids"] == ["molhos"]
    assert db.query(ProdutoFamiliaGrupoModificador).filter_by(restaurante_id=92).count() == 0


def test_one_save_creates_family_skus_and_shared_groups_atomically(menu):
    db, _ = menu
    original_count = db.query(ProdutoFamiliaGrupoModificador).filter_by(restaurante_id=91).count()
    response = _write_family(db, 91, FamilyWrite(
        nome="Batatas", categoria_id="pasteis-91", eixo="tamanho",
        variantes=[{"rotulo": "300 g", "preco": "15.00"}, {"rotulo": "400 g", "preco": "18.00"}],
        grupo_ids=["molhos"], grupos_anteriores=[],
    ), None)
    assert response["grupo_ids"] == ["molhos"]
    assert {variant["preco"] for variant in response["variantes"]} == {15, 18}
    assert db.query(ProdutoFamiliaGrupoModificador).filter_by(restaurante_id=91).count() == original_count + 1

    with pytest.raises(HTTPException) as invalid:
        _write_family(db, 91, FamilyWrite(
            nome="Pastel inválido", categoria_id="pasteis-91", eixo="sabor",
            variantes=[{"rotulo": "Carne", "preco": "7.00"}],
            grupo_ids=["outro-tenant"], grupos_anteriores=[],
        ), None)
    assert invalid.value.status_code == 422
    # Validation precedes the family insert; no partial new records exist.
    assert db.query(Produto).filter_by(restaurante_id=91).count() == 4


def test_atomic_family_edit_checks_shared_group_snapshot(menu):
    db, family_id = menu
    save_groups(db, family_id, ["molhos"])
    from app.models import ProdutoFamilia
    family_record = db.query(ProdutoFamilia).filter_by(id=family_id, restaurante_id=91).one()
    with pytest.raises(HTTPException) as stale:
        _write_family(db, 91, FamilyWrite(
            nome="Pastel renomeado", categoria_id="pasteis-91", eixo="sabor",
            variantes=[
                {"produto_id": "pastel-carne", "rotulo": "Carne de Sol", "preco": "9.00"},
                {"produto_id": "pastel-queijo", "rotulo": "Queijo", "preco": "8.00"},
            ],
            grupo_ids=[], grupos_anteriores=[],
        ), family_record)
    assert stale.value.status_code == 409
    assert db.query(Produto).filter_by(id="pastel-carne").one().preco == 7
    assert db.query(ProdutoFamilia).filter_by(id=family_id).one().nome == "Pastel Médio"
