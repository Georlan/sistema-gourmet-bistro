"""Testes de segurança e idempotência para atualização do cardápio de sexta da Marmitaria (tenant 6)."""
from __future__ import annotations

import os
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.catalog_addons import normalize_catalog_name
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
from tools.update_marmitaria_friday_menu import MenuUpdateError, update_friday_menu


@pytest.fixture
def test_db_session(monkeypatch):
    """Cria um banco SQLite em memória isolado para os testes unitários."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine)

    # Monkeypatch SessionLocal em update_marmitaria_friday_menu
    monkeypatch.setattr("tools.update_marmitaria_friday_menu.SessionLocal", lambda restaurante_id=None: TestingSession())

    session = TestingSession()

    # Seed restaurante 6 e restaurante 7
    r6 = Restaurante(id=6, nome="Quentinha Caseira", slug="quentinha-caseira")
    r7 = Restaurante(id=7, nome="Outro Restaurante", slug="outro")
    session.add_all([r6, r7])
    session.flush()

    prof6 = RestauranteOperationProfile(restaurante_id=6, profile_key="marmitaria")
    prof7 = RestauranteOperationProfile(restaurante_id=7, profile_key="generic")
    session.add_all([prof6, prof7])

    # Categorias
    cat_quent = Categoria(id="quentinhas", restaurante_id=6, nome="Quentinhas", marmitaria_tamanho=True)
    cat_sobre = Categoria(id="sobremesas", restaurante_id=6, nome="Sobremesas", marmitaria_tamanho=False)
    cat_bebidas = Categoria(id="bebidas", restaurante_id=6, nome="Bebidas", marmitaria_tamanho=False)
    cat_r7 = Categoria(id="cat7", restaurante_id=7, nome="Pizzas", marmitaria_tamanho=False)
    session.add_all([cat_quent, cat_sobre, cat_bebidas, cat_r7])
    session.flush()

    # Grupos de modificadores
    g_prot = GrupoModificador(id="g-prot", restaurante_id=6, nome="Proteínas")
    g_guar = GrupoModificador(id="g-guar", restaurante_id=6, nome="Guarnições")
    g_salad = GrupoModificador(id="g-salad", restaurante_id=6, nome="Saladas")
    session.add_all([g_prot, g_guar, g_salad])
    session.flush()

    # Opções existentes no grupo Guarnições
    session.add_all([
        OpcaoModificador(id="op-arr-grega", restaurante_id=6, grupo_id="g-guar", nome="Arroz à grega", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-arr-branco", restaurante_id=6, grupo_id="g-guar", nome="Arroz branco refogado", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-baiao", restaurante_id=6, grupo_id="g-guar", nome="Baião", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-mac", restaurante_id=6, grupo_id="g-guar", nome="Macarrão", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-feijao", restaurante_id=6, grupo_id="g-guar", nome="Feijão de corda", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-farofa", restaurante_id=6, grupo_id="g-guar", nome="Farofa", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-feijoada", restaurante_id=6, grupo_id="g-guar", nome="Feijoada", preco_adicional=0, ativo=False),
    ])

    # Opções existentes no grupo Proteínas
    session.add_all([
        OpcaoModificador(id="op-frango", restaurante_id=6, grupo_id="g-prot", nome="Frango cozido", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-file", restaurante_id=6, grupo_id="g-prot", nome="Filé de frango acebolado", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-coxa", restaurante_id=6, grupo_id="g-prot", nome="Coxa e sobrecoxa assada", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-ling", restaurante_id=6, grupo_id="g-prot", nome="Linguiça", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-ovo", restaurante_id=6, grupo_id="g-prot", nome="Ovo frito", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-acem", restaurante_id=6, grupo_id="g-prot", nome="Acém cozido", preco_adicional=0, ativo=False),
        OpcaoModificador(id="op-bisteca", restaurante_id=6, grupo_id="g-prot", nome="Bisteca", preco_adicional=0, ativo=False),
        OpcaoModificador(id="op-costela-old", restaurante_id=6, grupo_id="g-prot", nome="Costela cozida", preco_adicional=0, ativo=False),
        OpcaoModificador(id="op-figado", restaurante_id=6, grupo_id="g-prot", nome="Fígado de boi", preco_adicional=0, ativo=False),
        OpcaoModificador(id="op-porco", restaurante_id=6, grupo_id="g-prot", nome="Porco trinchado", preco_adicional=0, ativo=False),
    ])

    # Opções existentes no grupo Saladas
    session.add_all([
        OpcaoModificador(id="op-sal-trop", restaurante_id=6, grupo_id="g-salad", nome="Salada tropical", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-verd-maio", restaurante_id=6, grupo_id="g-salad", nome="Verdura de maionese", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-sal-verde", restaurante_id=6, grupo_id="g-salad", nome="Salada verde", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-vina", restaurante_id=6, grupo_id="g-salad", nome="Vinagrete", preco_adicional=0, ativo=True),
        OpcaoModificador(id="op-batata", restaurante_id=6, grupo_id="g-salad", nome="Batata doce", preco_adicional=0, ativo=True),
    ])

    # Opção em restaurante 7 para teste de contaminação
    session.add(
        OpcaoModificador(id="op-r7", restaurante_id=7, grupo_id="g-prot", nome="Item R7", preco_adicional=0, ativo=True)
    )

    # Produtos
    prod_qg = Produto(id="001", restaurante_id=6, categoria_id="quentinhas", nome="Quentinha G", preco=Decimal("10.00"), ativo=True, marmitaria_tamanho="g")
    prod_qp = Produto(id="prod-p", restaurante_id=6, categoria_id="quentinhas", nome="Quentinha P", preco=Decimal("7.00"), ativo=True, marmitaria_tamanho="p")
    prod_mousse = Produto(id="prod-mousse", restaurante_id=6, categoria_id="sobremesas", nome="Mousse de maracujá", preco=Decimal("6.00"), ativo=True)
    prod_pudim = Produto(id="prod-pudim", restaurante_id=6, categoria_id="sobremesas", nome="Pudim", preco=Decimal("8.00"), ativo=False)
    prod_limao = Produto(id="prod-limao", restaurante_id=6, categoria_id="sobremesas", nome="Mousse de limão", preco=Decimal("6.00"), ativo=False)
    prod_torta = Produto(id="prod-torta", restaurante_id=6, categoria_id="sobremesas", nome="Torta de abacaxi", preco=Decimal("8.00"), ativo=False)
    prod_ace = Produto(id="prod-ace", restaurante_id=6, categoria_id="bebidas", nome="Suco de acerola", preco=Decimal("7.00"), ativo=True)
    prod_goi = Produto(id="prod-goi", restaurante_id=6, categoria_id="bebidas", nome="Suco de goiaba", preco=Decimal("7.00"), ativo=True)
    prod_man = Produto(id="prod-man", restaurante_id=6, categoria_id="bebidas", nome="Suco de manga", preco=Decimal("7.00"), ativo=True)
    prod_r7 = Produto(id="prod-r7", restaurante_id=7, categoria_id="cat7", nome="Pizza R7", preco=Decimal("50.00"), ativo=True)
    session.add_all([prod_qg, prod_qp, prod_mousse, prod_pudim, prod_limao, prod_torta, prod_ace, prod_goi, prod_man, prod_r7])
    session.flush()

    # Vínculos de produto x grupo para marmitaria
    session.add_all([
        ProdutoGrupoModificador(restaurante_id=6, produto_id="prod-p", grupo_id="g-prot", min_selecoes=1, max_selecoes=1, modo_selecao="tipos"),
        ProdutoGrupoModificador(restaurante_id=6, produto_id="prod-p", grupo_id="g-guar", min_selecoes=2, max_selecoes=2, modo_selecao="porcoes"),
        ProdutoGrupoModificador(restaurante_id=6, produto_id="prod-p", grupo_id="g-salad", min_selecoes=1, max_selecoes=1, modo_selecao="tipos"),
        ProdutoGrupoModificador(restaurante_id=6, produto_id="001", grupo_id="g-prot", min_selecoes=0, max_selecoes=2, modo_selecao="porcoes"),
        ProdutoGrupoModificador(restaurante_id=6, produto_id="001", grupo_id="g-guar", min_selecoes=0, max_selecoes=3, modo_selecao="porcoes"),
        ProdutoGrupoModificador(restaurante_id=6, produto_id="001", grupo_id="g-salad", min_selecoes=0, max_selecoes=3, modo_selecao="porcoes"),
    ])

    session.commit()
    session.close()

    return TestingSession


def test_rejects_wrong_tenant_id(test_db_session):
    with pytest.raises(MenuUpdateError, match="estritamente restrito ao restaurante id=6"):
        update_friday_menu(tenant_id=7, apply=False, reason="teste")


def test_dry_run_leaves_database_unmodified(test_db_session):
    session = test_db_session()
    opts_before = session.query(OpcaoModificador).count()
    session.close()

    result = update_friday_menu(tenant_id=6, apply=False, reason="dry run test")

    assert result["mode"] == "dry-run"
    assert len(result["itens_novos_criados"]) == 2
    assert "Guarnições: Arroz refogado" in result["itens_novos_criados"][0] or "Guarnições: Arroz refogado" in result["itens_novos_criados"][1]
    assert "Proteínas: Costela suína cozida" in result["itens_novos_criados"][0] or "Proteínas: Costela suína cozida" in result["itens_novos_criados"][1]

    # Confirma que no dry-run nada foi persistido
    session = test_db_session()
    opts_after = session.query(OpcaoModificador).count()
    assert opts_after == opts_before
    session.close()


def test_apply_and_idempotency(test_db_session):
    result1 = update_friday_menu(tenant_id=6, apply=True, reason="apply test")

    assert result1["mode"] == "apply"
    assert len(result1["itens_novos_criados"]) == 2
    assert result1["confirmacao_nenhum_excluido"] is True
    assert result1["confirmacao_nenhum_outro_restaurante_alterado"] is True

    session = test_db_session()
    # Verifica que Arroz refogado e Costela suína cozida foram criados e estão ativos
    arr_ref = session.query(OpcaoModificador).filter_by(restaurante_id=6, nome="Arroz refogado").one()
    assert arr_ref.ativo is True

    cost_suina = session.query(OpcaoModificador).filter_by(restaurante_id=6, nome="Costela suína cozida").one()
    assert cost_suina.ativo is True

    # Verifica que Arroz branco refogado foi pausado
    arr_branco = session.query(OpcaoModificador).filter_by(restaurante_id=6, nome="Arroz branco refogado").one()
    assert arr_branco.ativo is False

    # Verifica que outros restaurantes não foram alterados
    r7_prod = session.query(Produto).filter_by(restaurante_id=7).one()
    assert r7_prod.nome == "Pizza R7"
    assert r7_prod.ativo is True

    # Verifica log de auditoria
    log = session.query(SuperAdminAuditLog).filter_by(restaurante_id=6).one()
    assert log.action == "CATALOG_FRIDAY_UPDATE"

    session.close()

    # Segunda execução (IDEMPOTÊNCIA)
    result2 = update_friday_menu(tenant_id=6, apply=True, reason="second apply test")

    assert len(result2["itens_novos_criados"]) == 0
    assert any("Arroz refogado" in x for x in result2["itens_encontrados_reutilizados"])
    assert any("Costela suína cozida" in x for x in result2["itens_encontrados_reutilizados"])
