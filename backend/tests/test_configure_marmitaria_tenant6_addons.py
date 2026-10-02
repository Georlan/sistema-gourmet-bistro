"""Testes do ajuste operacional P0 de adicionais pagos e guarnições do tenant 6."""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import (
    Base,
    Categoria,
    GrupoModificador,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
    SuperAdminAuditLog,
)
from app.restaurant_profile_models import RestauranteOperationProfile
from tools.configure_marmitaria_tenant6_addons import (
    MarmitariaTenant6ConfigError,
    configure_tenant6_addons,
)


@pytest.fixture
def db_factory(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine)
    monkeypatch.setattr(
        "tools.configure_marmitaria_tenant6_addons.SessionLocal",
        lambda restaurante_id=None: TestingSession(),
    )

    db = TestingSession()
    db.add_all([
        Restaurante(id=6, nome="Quentinha Caseira", slug="quentinha-caseira"),
        Restaurante(id=7, nome="Outro Restaurante", slug="outro"),
    ])
    db.flush()
    db.add_all([
        RestauranteOperationProfile(restaurante_id=6, profile_key="marmitaria"),
        RestauranteOperationProfile(restaurante_id=7, profile_key="generic"),
    ])

    db.add_all([
        Categoria(id="quentinhas", restaurante_id=6, nome="Quentinhas", marmitaria_tamanho=True),
        Categoria(id="cat7", restaurante_id=7, nome="Pizzas", marmitaria_tamanho=False),
    ])

    proteinas = GrupoModificador(
        id="g-prot",
        restaurante_id=6,
        nome="Proteínas",
        min_selecoes=0,
        max_selecoes=2,
        tipo="opcional",
    )
    guarnicoes = GrupoModificador(
        id="g-guar",
        restaurante_id=6,
        nome="Guarnições",
        min_selecoes=0,
        max_selecoes=3,
        tipo="opcional",
    )
    saladas = GrupoModificador(
        id="g-sal",
        restaurante_id=6,
        nome="Saladas",
        min_selecoes=0,
        max_selecoes=3,
        tipo="opcional",
    )
    other_group = GrupoModificador(
        id="g7",
        restaurante_id=7,
        nome="Adicionais",
        min_selecoes=0,
        max_selecoes=1,
        tipo="opcional",
    )
    db.add_all([proteinas, guarnicoes, saladas, other_group])
    db.flush()

    db.add_all([
        OpcaoModificador(
            id="op-costela",
            restaurante_id=6,
            grupo_id=proteinas.id,
            nome="Costela suína cozida",
            preco_adicional=0,
            ativo=True,
        ),
        OpcaoModificador(
            id="op-ovo",
            restaurante_id=6,
            grupo_id=proteinas.id,
            nome="Ovo frito",
            preco_adicional=0,
            ativo=True,
        ),
        OpcaoModificador(
            id="op-bisteca",
            restaurante_id=6,
            grupo_id=proteinas.id,
            nome="Bisteca",
            preco_adicional=0,
            ativo=False,
        ),
        OpcaoModificador(
            id="op7",
            restaurante_id=7,
            grupo_id=other_group.id,
            nome="Bacon",
            preco_adicional=8,
            ativo=True,
        ),
    ])

    g = Produto(
        id="quentinha-g",
        restaurante_id=6,
        categoria_id="quentinhas",
        nome="Quentinha G",
        preco=10,
        ativo=True,
        marmitaria_tamanho="g",
    )
    db.add(g)
    db.flush()
    db.add_all([
        ProdutoGrupoModificador(
            restaurante_id=6,
            produto_id=g.id,
            grupo_id=proteinas.id,
            min_selecoes=0,
            max_selecoes=2,
            modo_selecao="porcoes",
        ),
        ProdutoGrupoModificador(
            restaurante_id=6,
            produto_id=g.id,
            grupo_id=guarnicoes.id,
            min_selecoes=0,
            max_selecoes=3,
            modo_selecao="porcoes",
        ),
        ProdutoGrupoModificador(
            restaurante_id=6,
            produto_id=g.id,
            grupo_id=saladas.id,
            min_selecoes=0,
            max_selecoes=3,
            modo_selecao="tipos",
        ),
    ])
    db.commit()
    db.close()
    return TestingSession


def _paid_group(db):
    return db.query(GrupoModificador).filter(
        GrupoModificador.restaurante_id == 6,
        GrupoModificador.nome == "Adicionais pagos",
    ).one_or_none()


def test_dry_run_nao_persiste_mudancas(db_factory):
    result = configure_tenant6_addons(
        tenant_id=6,
        apply=False,
        reason="dry-run",
    )
    assert result["mode"] == "dry-run"
    assert result["rules"]["guarnicoes"]["maximo"] == 20
    assert result["rules"]["adicionais_pagos"]["maximo"] == 20

    db = db_factory()
    try:
        assert _paid_group(db) is None
        guar = db.query(ProdutoGrupoModificador).filter_by(
            restaurante_id=6,
            produto_id="quentinha-g",
            grupo_id="g-guar",
        ).one()
        assert guar.max_selecoes == 3
        assert db.query(SuperAdminAuditLog).filter_by(restaurante_id=6).count() == 0
    finally:
        db.close()


def test_apply_cria_adicionais_e_deixa_guarnicoes_livres_sem_tocar_outro_tenant(db_factory):
    result = configure_tenant6_addons(
        tenant_id=6,
        apply=True,
        reason="go-live",
    )
    assert result["mode"] == "apply"
    assert result["confirmacao_nenhuma_exclusao"] is True
    assert result["confirmacao_outros_tenants_intactos"] is True

    db = db_factory()
    try:
        paid = _paid_group(db)
        assert paid is not None
        assert paid.tipo == "opcional"
        assert paid.min_selecoes == 0
        assert paid.max_selecoes == 20

        options = {
            option.nome: option
            for option in db.query(OpcaoModificador).filter_by(
                restaurante_id=6,
                grupo_id=paid.id,
            ).all()
        }
        assert set(options) == {"Costela suína cozida", "Ovo frito", "Bisteca"}
        assert Decimal(str(options["Costela suína cozida"].preco_adicional)) == Decimal("5.00")
        assert Decimal(str(options["Ovo frito"].preco_adicional)) == Decimal("2.00")
        assert Decimal(str(options["Bisteca"].preco_adicional)) == Decimal("5.00")
        assert options["Costela suína cozida"].ativo is True
        assert options["Ovo frito"].ativo is True
        assert options["Bisteca"].ativo is False

        links = {
            link.grupo_id: link
            for link in db.query(ProdutoGrupoModificador).filter_by(
                restaurante_id=6,
                produto_id="quentinha-g",
            ).all()
        }
        assert links["g-guar"].min_selecoes == 0
        assert links["g-guar"].max_selecoes == 20
        assert links["g-guar"].modo_selecao == "porcoes"
        assert links[paid.id].min_selecoes == 0
        assert links[paid.id].max_selecoes == 20
        assert links[paid.id].modo_selecao == "porcoes"

        # Proteínas e Saladas permanecem com as regras originais.
        assert links["g-prot"].max_selecoes == 2
        assert links["g-sal"].max_selecoes == 3

        other = db.query(OpcaoModificador).filter_by(
            restaurante_id=7,
            id="op7",
        ).one()
        assert other.nome == "Bacon"
        assert Decimal(str(other.preco_adicional)) == Decimal("8.00")
        assert other.ativo is True

        audit = db.query(SuperAdminAuditLog).filter_by(
            restaurante_id=6,
            action="MARMITARIA_PAID_ADDONS_CONFIG",
        ).one()
        assert audit.reason == "go-live"
    finally:
        db.close()


def test_apply_e_idempotente_e_sincroniza_disponibilidade(db_factory):
    configure_tenant6_addons(tenant_id=6, apply=True, reason="primeira")

    db = db_factory()
    try:
        paid = _paid_group(db)
        assert paid is not None
        first_paid_group_id = paid.id
        paid_count = db.query(OpcaoModificador).filter_by(
            restaurante_id=6,
            grupo_id=paid.id,
        ).count()

        source_ovo = db.query(OpcaoModificador).filter_by(
            restaurante_id=6,
            id="op-ovo",
        ).one()
        source_ovo.ativo = False
        db.commit()
    finally:
        db.close()

    configure_tenant6_addons(tenant_id=6, apply=True, reason="segunda")

    db = db_factory()
    try:
        paid = _paid_group(db)
        assert paid is not None
        assert paid.id == first_paid_group_id
        assert db.query(OpcaoModificador).filter_by(
            restaurante_id=6,
            grupo_id=paid.id,
        ).count() == paid_count

        ovo_pago = db.query(OpcaoModificador).filter_by(
            restaurante_id=6,
            grupo_id=paid.id,
            nome="Ovo frito",
        ).one()
        assert ovo_pago.ativo is False

        links = db.query(ProdutoGrupoModificador).filter_by(
            restaurante_id=6,
            produto_id="quentinha-g",
            grupo_id=paid.id,
        ).all()
        assert len(links) == 1
        assert db.query(SuperAdminAuditLog).filter_by(
            restaurante_id=6,
            action="MARMITARIA_PAID_ADDONS_CONFIG",
        ).count() == 2
    finally:
        db.close()


def test_rejeita_tenant_diferente_de_6(db_factory):
    with pytest.raises(MarmitariaTenant6ConfigError):
        configure_tenant6_addons(
            tenant_id=7,
            apply=True,
            reason="não pode",
        )
