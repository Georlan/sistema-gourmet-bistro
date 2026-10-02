import itertools

import pytest

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.models import (
    Categoria,
    GrupoModificador,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
    SuperAdminAuditLog,
)
from app.restaurant_profile_models import RestauranteOperationProfile
from tools.reconcile_marmitaria_catalog import ReconcileError, reconcile


TENANTS = itertools.count(99870)


def _seed_catalog():
    Base.metadata.create_all(bind=engine)
    tenant_id = next(TENANTS)
    token = current_restaurante_id.set(tenant_id)
    db = SessionLocal(restaurante_id=tenant_id)
    try:
        db.add(Restaurante(id=tenant_id, nome="Quentinha Teste", slug=f"quentinha-teste-{tenant_id}"))
        db.commit()
        db.add(RestauranteOperationProfile(restaurante_id=tenant_id, profile_key="marmitaria"))
        db.commit()

        categories = [
            Categoria(
                id="cat-quentinhas",
                restaurante_id=tenant_id,
                nome="Quentinhas",
                destino_impressao="COZINHA",
                marmitaria_tamanho=True,
            ),
            Categoria(
                id="cat-sobremesas",
                restaurante_id=tenant_id,
                nome="Sobremesas",
                destino_impressao="COZINHA",
            ),
            Categoria(
                id="cat-bebidas",
                restaurante_id=tenant_id,
                nome="Bebidas",
                destino_impressao="NENHUM",
            ),
        ]
        db.add_all(categories)

        groups = [
            GrupoModificador(
                id=f"proteinas-{tenant_id}",
                restaurante_id=tenant_id,
                nome="Proteínas",
                tipo="opcional",
                min_selecoes=0,
                max_selecoes=3,
            ),
            GrupoModificador(
                id=f"guarnicoes-{tenant_id}",
                restaurante_id=tenant_id,
                nome="Guarnições",
                tipo="opcional",
                min_selecoes=0,
                max_selecoes=3,
            ),
            GrupoModificador(
                id=f"saladas-{tenant_id}",
                restaurante_id=tenant_id,
                nome="Saladas",
                tipo="opcional",
                min_selecoes=0,
                max_selecoes=2,
            ),
        ]
        db.add_all(groups)
        db.flush()

        db.add_all([
            OpcaoModificador(
                id=f"frango-{tenant_id}",
                restaurante_id=tenant_id,
                grupo_id=groups[0].id,
                nome="Frango cozido",
                preco_adicional=0,
                ativo=False,
            ),
            OpcaoModificador(
                id=f"acem-{tenant_id}",
                restaurante_id=tenant_id,
                grupo_id=groups[0].id,
                nome="Acém cozido",
                preco_adicional=0,
                ativo=True,
            ),
            OpcaoModificador(
                id=f"arroz-refogado-{tenant_id}",
                restaurante_id=tenant_id,
                grupo_id=groups[1].id,
                nome="Arroz branco refogado",
                preco_adicional=0,
                ativo=True,
            ),
            OpcaoModificador(
                id=f"feijoada-{tenant_id}",
                restaurante_id=tenant_id,
                grupo_id=groups[1].id,
                nome="Feijoada",
                preco_adicional=0,
                ativo=True,
            ),
            OpcaoModificador(
                id=f"batata-doce-{tenant_id}",
                restaurante_id=tenant_id,
                grupo_id=groups[2].id,
                nome="Batata doce",
                preco_adicional=0,
                ativo=False,
            ),
            OpcaoModificador(
                id=f"salada-verde-{tenant_id}",
                restaurante_id=tenant_id,
                grupo_id=groups[2].id,
                nome="Salada verde",
                preco_adicional=0,
                ativo=True,
            ),
        ])

        products = [
            Produto(
                id=f"quentinha-p-{tenant_id}",
                restaurante_id=tenant_id,
                categoria_id="cat-quentinhas",
                nome="Quentinha P",
                preco=8,
                ativo=False,
                marmitaria_tamanho="p",
            ),
            Produto(
                id=f"quentinha-g-{tenant_id}",
                restaurante_id=tenant_id,
                categoria_id="cat-quentinhas",
                nome="Quentinha G",
                preco=10,
                ativo=True,
                marmitaria_tamanho="g",
            ),
            Produto(
                id=f"quentinha-m-{tenant_id}",
                restaurante_id=tenant_id,
                categoria_id="cat-quentinhas",
                nome="Quentinha M",
                preco=9,
                ativo=True,
                marmitaria_tamanho="m",
            ),
            Produto(
                id=f"mousse-{tenant_id}",
                restaurante_id=tenant_id,
                categoria_id="cat-sobremesas",
                nome="Mousse de maracujá",
                preco=5,
                ativo=False,
            ),
            Produto(
                id=f"pudim-{tenant_id}",
                restaurante_id=tenant_id,
                categoria_id="cat-sobremesas",
                nome="Pudim",
                preco=8,
                ativo=True,
            ),
            Produto(
                id=f"acerola-{tenant_id}",
                restaurante_id=tenant_id,
                categoria_id="cat-bebidas",
                nome="Suco de acerola",
                preco=7,
                ativo=False,
            ),
            Produto(
                id=f"goiaba-{tenant_id}",
                restaurante_id=tenant_id,
                categoria_id="cat-bebidas",
                nome="Suco de goiaba",
                preco=7,
                ativo=True,
            ),
            Produto(
                id=f"uva-{tenant_id}",
                restaurante_id=tenant_id,
                categoria_id="cat-bebidas",
                nome="Suco de uva",
                preco=7,
                ativo=True,
            ),
        ]
        db.add_all(products)
        db.flush()

        for product, limits in ((products[0], (1, 2)), (products[1], (2, 3))):
            for group, maximum in zip(groups, (limits[0], limits[1], 1)):
                db.add(
                    ProdutoGrupoModificador(
                        restaurante_id=tenant_id,
                        produto_id=product.id,
                        grupo_id=group.id,
                        min_selecoes=0,
                        max_selecoes=maximum,
                        modo_selecao="tipos",
                    )
                )
        db.commit()
        return tenant_id
    finally:
        db.close()
        current_restaurante_id.reset(token)


def _friday_spec():
    return {
        "expected": {
            "restaurant_name": "Quentinha Teste",
            "product_name": "Quentinha G",
            "product_price": 10,
            "groups": ["Proteínas", "Guarnições", "Saladas"],
        },
        "groups": {
            "Proteínas": {
                "sync_active": True,
                "options": ["Frango cozido"],
            },
            "Guarnições": {
                "sync_active": True,
                "options": [
                    {"name": "Arroz refogado", "aliases": ["Arroz branco refogado"]},
                    "Farofa",
                ],
            },
            "Saladas": {
                "sync_active": True,
                "options": [
                    {"name": "Batata-doce", "aliases": ["Batata doce"]},
                    "Salada verde",
                ],
            },
        },
        "products": [
            {
                "name": "Mousse de maracujá",
                "category": "Sobremesas",
                "price": 6,
                "active": True,
            },
            {
                "name": "Suco de acerola",
                "aliases": ["Acerola"],
                "category": "Bebidas",
                "category_destination": "NENHUM",
                "price": 7,
                "active": True,
            },
            {
                "name": "Suco de goiaba",
                "aliases": ["Goiaba"],
                "category": "Bebidas",
                "category_destination": "NENHUM",
                "price": 7,
                "active": True,
            },
        ],
        "sync_product_categories": ["Sobremesas", "Bebidas"],
        "size_availability": {
            "sync_active": True,
            "items": {
                "P": {"name": "Quentinha P", "price": 7, "active": True},
                "G": {"name": "Quentinha G", "price": 10, "active": True},
            },
        },
    }


def test_daily_reconcile_activates_creates_and_pauses_without_deleting_or_rewriting_size_rules():
    tenant_id = _seed_catalog()
    token = current_restaurante_id.set(tenant_id)
    db = SessionLocal(restaurante_id=tenant_id)
    try:
        before_options = {
            option.id
            for option in db.query(OpcaoModificador).filter_by(restaurante_id=tenant_id).all()
        }
        before_rules = sorted(
            (
                row.produto_id,
                row.grupo_id,
                row.min_selecoes,
                row.max_selecoes,
                row.modo_selecao,
            )
            for row in db.query(ProdutoGrupoModificador).filter_by(restaurante_id=tenant_id).all()
        )
    finally:
        db.close()
        current_restaurante_id.reset(token)

    result = reconcile(
        tenant_id=tenant_id,
        spec=_friday_spec(),
        apply=True,
        reason="Teste de sincronização diária segura.",
    )

    assert result["mode"] == "apply"
    assert result["changes"]["options_created"] == ["Guarnições: Farofa"]
    assert set(result["changes"]["options_activated"]) == {
        "Proteínas: Frango cozido",
        "Saladas: Batata doce",
    }
    assert set(result["changes"]["options_paused"]) == {
        "Proteínas: Acém cozido",
        "Guarnições: Feijoada",
    }
    assert set(result["changes"]["products_paused"]) == {"Pudim", "Suco de uva"}
    assert set(result["changes"]["sizes_availability_updated"]) == {"P"}
    assert result["changes"]["sizes_paused"] == ["M"]

    token = current_restaurante_id.set(tenant_id)
    db = SessionLocal(restaurante_id=tenant_id)
    try:
        groups = {
            group.nome: group
            for group in db.query(GrupoModificador).filter_by(restaurante_id=tenant_id).all()
        }
        options = db.query(OpcaoModificador).filter_by(restaurante_id=tenant_id).all()
        by_name = {option.nome: option for option in options}

        assert by_name["Frango cozido"].ativo is True
        assert by_name["Acém cozido"].ativo is False
        assert by_name["Arroz branco refogado"].ativo is True
        assert by_name["Feijoada"].ativo is False
        assert by_name["Batata doce"].ativo is True
        assert by_name["Salada verde"].ativo is True
        assert by_name["Farofa"].ativo is True
        assert by_name["Farofa"].grupo_id == groups["Guarnições"].id
        assert before_options <= {option.id for option in options}

        products = {
            product.nome: product
            for product in db.query(Produto).filter_by(restaurante_id=tenant_id).all()
        }
        assert products["Mousse de maracujá"].ativo is True
        assert products["Mousse de maracujá"].preco == 6
        assert products["Pudim"].ativo is False
        assert products["Suco de acerola"].ativo is True
        assert products["Suco de goiaba"].ativo is True
        assert products["Suco de uva"].ativo is False
        assert products["Quentinha P"].ativo is True
        assert products["Quentinha P"].preco == 7
        assert products["Quentinha G"].ativo is True
        assert products["Quentinha G"].preco == 10
        assert products["Quentinha M"].ativo is False

        after_rules = sorted(
            (
                row.produto_id,
                row.grupo_id,
                row.min_selecoes,
                row.max_selecoes,
                row.modo_selecao,
            )
            for row in db.query(ProdutoGrupoModificador).filter_by(restaurante_id=tenant_id).all()
        )
        assert after_rules == before_rules
        assert db.query(SuperAdminAuditLog).filter_by(
            restaurante_id=tenant_id,
            action="CATALOG_RECONCILE",
        ).count() == 1
    finally:
        db.close()
        current_restaurante_id.reset(token)


def test_guard_can_use_restaurant_name_but_rejects_wrong_target_before_changes():
    tenant_id = _seed_catalog()
    spec = _friday_spec()
    spec["expected"]["restaurant_name"] = "Restaurante errado"

    with pytest.raises(ReconcileError, match="Restaurante divergente"):
        reconcile(
            tenant_id=tenant_id,
            spec=spec,
            apply=False,
            reason="Não deve aplicar.",
        )

    token = current_restaurante_id.set(tenant_id)
    db = SessionLocal(restaurante_id=tenant_id)
    try:
        assert db.query(OpcaoModificador).filter_by(
            restaurante_id=tenant_id,
            nome="Farofa",
        ).first() is None
        assert db.query(Produto).filter_by(
            restaurante_id=tenant_id,
            nome="Pudim",
        ).one().ativo is True
    finally:
        db.close()
        current_restaurante_id.reset(token)
