import datetime

import pytest

from app.database import Base, SessionLocal, engine, tenant_session_scope
from app.models import (
    Categoria,
    Comanda,
    GrupoModificador,
    Item,
    ItemModificador,
    Lancamento,
    OpcaoModificador,
    Produto,
    Restaurante,
    Usuario,
)
from app.services.order_read_projection import project_check_details


TENANT = 709
USER = "order-read-modifiers-user-709"
CATEGORY = "order-read-modifiers-cat-709"
PRODUCT = "order-read-modifiers-product-709"
GROUP = "order-read-modifiers-group-709"
EGG = "order-read-modifiers-egg-709"
BACON = "order-read-modifiers-bacon-709"
ORDER = "order-read-modifiers-order-709"
LAUNCH = "order-read-modifiers-launch-709"
ITEM = "order-read-modifiers-item-709"


def _cleanup(db) -> None:
    db.query(ItemModificador).filter(ItemModificador.restaurante_id == TENANT).delete(
        synchronize_session=False
    )
    db.query(Item).filter(Item.restaurante_id == TENANT).delete(synchronize_session=False)
    db.query(Lancamento).filter(Lancamento.restaurante_id == TENANT).delete(
        synchronize_session=False
    )
    db.query(Comanda).filter(Comanda.restaurante_id == TENANT).delete(synchronize_session=False)
    db.query(OpcaoModificador).filter(
        OpcaoModificador.restaurante_id == TENANT
    ).delete(synchronize_session=False)
    db.query(GrupoModificador).filter(
        GrupoModificador.restaurante_id == TENANT
    ).delete(synchronize_session=False)
    db.query(Produto).filter(Produto.restaurante_id == TENANT).delete(synchronize_session=False)
    db.query(Categoria).filter(Categoria.restaurante_id == TENANT).delete(synchronize_session=False)
    db.query(Usuario).filter(Usuario.restaurante_id == TENANT).delete(synchronize_session=False)
    db.commit()


@pytest.fixture()
def seeded_order():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if not db.query(Restaurante).filter(Restaurante.id == TENANT).first():
            db.add(Restaurante(id=TENANT, nome="Order Read Modifiers", plano="pro"))
            db.commit()

        with tenant_session_scope(db, TENANT):
            _cleanup(db)
            db.add(
                Usuario(
                    id=USER,
                    restaurante_id=TENANT,
                    nome="Garçom Modificadores",
                    email="order-read-modifiers-709@koma.test",
                    cargo="garcom",
                    status="ativo",
                )
            )
            db.add(
                Categoria(
                    id=CATEGORY,
                    restaurante_id=TENANT,
                    nome="Lanches",
                )
            )
            db.add(
                Produto(
                    id=PRODUCT,
                    restaurante_id=TENANT,
                    categoria_id=CATEGORY,
                    nome="Hambúrguer",
                    preco=19.0,
                    ativo=True,
                )
            )
            db.add(
                GrupoModificador(
                    id=GROUP,
                    restaurante_id=TENANT,
                    nome="Extras",
                    min_selecoes=0,
                    max_selecoes=4,
                    tipo="opcional",
                )
            )
            db.add_all(
                [
                    OpcaoModificador(
                        id=EGG,
                        restaurante_id=TENANT,
                        grupo_id=GROUP,
                        nome="Ovo",
                        preco_adicional=2.0,
                        ativo=True,
                    ),
                    OpcaoModificador(
                        id=BACON,
                        restaurante_id=TENANT,
                        grupo_id=GROUP,
                        nome="Bacon",
                        preco_adicional=4.0,
                        ativo=True,
                    ),
                ]
            )
            order = Comanda(
                id=ORDER,
                restaurante_id=TENANT,
                garcom_id=USER,
                mesa_id=None,
                tipo="Consumo no Local",
                numero_pedido=709,
                fechada=False,
                criado_em=datetime.datetime(2026, 9, 15, 11, 0, 0),
            )
            launch = Lancamento(
                id=LAUNCH,
                restaurante_id=TENANT,
                comanda_id=ORDER,
                garcom_id=USER,
                origem="garcom",
                status="producao",
                timestamp=datetime.datetime(2026, 9, 15, 11, 0, 0),
            )
            item = Item(
                id=ITEM,
                restaurante_id=TENANT,
                comanda_id=ORDER,
                lancamento_id=LAUNCH,
                produto_id=PRODUCT,
                preco_unit=29.0,
                observacao="",
                cliente_nome="Consumo Geral",
                status="preparando",
                pago=False,
            )
            db.add_all([order, launch, item])
            db.flush()
            db.add_all(
                [
                    ItemModificador(
                        restaurante_id=TENANT,
                        item_id=ITEM,
                        opcao_modificador_id=EGG,
                        preco_aplicado=2.0,
                    ),
                    ItemModificador(
                        restaurante_id=TENANT,
                        item_id=ITEM,
                        opcao_modificador_id=EGG,
                        preco_aplicado=2.0,
                    ),
                    ItemModificador(
                        restaurante_id=TENANT,
                        item_id=ITEM,
                        opcao_modificador_id=BACON,
                        preco_aplicado=4.0,
                    ),
                ]
            )
            db.commit()
            db.expire_all()
            yield db.query(Comanda).filter(Comanda.id == ORDER).one(), db
    finally:
        with tenant_session_scope(db, TENANT):
            _cleanup(db)
        db.close()


def test_projection_exposes_persisted_modifier_rows_including_repeated_units(seeded_order):
    order, db = seeded_order

    projected = project_check_details(db, [order], TENANT)[0]
    modifiers = projected.itens[0].modificadores

    assert [(modifier.id, modifier.nome, modifier.preco) for modifier in modifiers] == [
        (EGG, "Ovo", 2.0),
        (EGG, "Ovo", 2.0),
        (BACON, "Bacon", 4.0),
    ]
    payload = projected.model_dump()
    assert payload["itens"][0]["modificadores"][0]["nome"] == "Ovo"
    assert len(payload["itens"][0]["modificadores"]) == 3


def test_marmitaria_reads_and_printing_share_grouped_persisted_composition(seeded_order):
    from app.restaurant_profile_models import RestauranteOperationProfile
    from app.application.printing.service import PrintingApplicationService
    from app.domain.orders.composition import composition_presentation
    from app.services.order_item_composition import load_item_modifiers

    order, db = seeded_order
    db.add(RestauranteOperationProfile(restaurante_id=TENANT, profile_key="marmitaria"))
    db.flush()
    try:
        item = order.itens[0]
        item.observacao = "Sem cebola - Opções: 2x Ovo, Bacon"
        projected = project_check_details(db, [order], TENANT)[0].itens[0]
        assert projected.composicao_agrupada is True
        assert [(m.grupo_id, m.grupo_nome) for m in projected.modificadores] == [(GROUP, "Extras")] * 3
        print_item = PrintingApplicationService._to_print_items(db, TENANT, [item])[0]
        assert print_item.composicao == ("EXTRAS: 2x Ovo, Bacon",)
        assert print_item.observacao == "Sem cebola"
        assert print_item.preco_unit == 29.0
        from app.services.printing import _enrich_receipt_composition
        details = [{"itens": [{"id": item.id, "observacao": item.observacao}]}]
        _enrich_receipt_composition(db, TENANT, details)
        assert details[0]["itens"][0]["composicao"] == print_item.composicao
        assert details[0]["itens"][0]["observacao"] == print_item.observacao
        assert load_item_modifiers(db, TENANT + 1, [ITEM]) == {}
        modifiers = load_item_modifiers(db, TENANT, [ITEM])[ITEM]
        assert composition_presentation("Opções: 2x Ovo, Bacon", modifiers, grouped=False) == ((), "Opções: 2x Ovo, Bacon")
    finally:
        db.rollback()
