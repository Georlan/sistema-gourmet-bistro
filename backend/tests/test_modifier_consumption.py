"""Consumo de complementos: dados reais de ItemModificador, por entrada do pedido."""
import datetime as dt

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.catalog_addons import CategoriaGrupoModificador
from app.database import Base
from app.models import (
    Categoria, Comanda, GrupoModificador, Item, ItemModificador, Lancamento, OpcaoModificador,
    Produto, ProdutoGrupoModificador, Restaurante, Usuario,
)
from app.services.modifier_consumption import UNCATALOGED_GROUP_ID, modifier_consumption

T, OTHER = 9921, 9922
DAY = dt.datetime(2026, 10, 2, 15)  # 12h local


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        for tenant in (T, OTHER):
            session.add(Restaurante(id=tenant, nome="R", plano="bistro"))
            session.flush()
            session.add(Usuario(id=f"u{tenant}", restaurante_id=tenant, nome="U", usuario=f"u{tenant}", senha_hash="x", role="admin", status="ativo"))
            session.add(Categoria(id=f"quent{tenant}", restaurante_id=tenant, nome="Quentinhas"))
            session.add(Categoria(id=f"beb{tenant}", restaurante_id=tenant, nome="Bebidas"))
            session.flush()
            session.add(Comanda(id=f"c{tenant}", restaurante_id=tenant, garcom_id=f"u{tenant}", tipo="Consumo no Local", numero_pedido=1))
        session.flush()
        session.add_all([
            Produto(id="qg", restaurante_id=T, nome="Quentinha G", categoria_id=f"quent{T}", preco=10),
            Produto(id="qp", restaurante_id=T, nome="Quentinha P", categoria_id=f"quent{T}", preco=7),
            Produto(id="suco", restaurante_id=T, nome="Suco", categoria_id=f"beb{T}", preco=6),
            Produto(id="qx", restaurante_id=OTHER, nome="Quentinha X", categoria_id=f"quent{OTHER}", preco=9),
        ])
        session.flush()
        session.add_all([
            GrupoModificador(id="prot", restaurante_id=T, nome="Proteínas", max_selecoes=1),
            GrupoModificador(id="guar", restaurante_id=T, nome="Guarnições", max_selecoes=4),
            GrupoModificador(id="sal", restaurante_id=T, nome="Saladas", max_selecoes=2),
            GrupoModificador(id="adic", restaurante_id=T, nome="Adicionais pagos", grupo_origem_id="prot", tipo="opcional"),
            GrupoModificador(id="xprot", restaurante_id=OTHER, nome="Proteínas", max_selecoes=1),
        ])
        session.flush()
        session.add_all([
            OpcaoModificador(id="frango", restaurante_id=T, grupo_id="prot", nome="Frango cozido"),
            OpcaoModificador(id="figado", restaurante_id=T, grupo_id="prot", nome="Fígado acebolado"),
            OpcaoModificador(id="acem", restaurante_id=T, grupo_id="prot", nome="Acém cozido", ativo=False),
            OpcaoModificador(id="ovo", restaurante_id=T, grupo_id="prot", nome="Ovo frito"),
            OpcaoModificador(id="arroz", restaurante_id=T, grupo_id="guar", nome="Arroz"),
            OpcaoModificador(id="feijao", restaurante_id=T, grupo_id="guar", nome="Feijão"),
            OpcaoModificador(id="farofa", restaurante_id=T, grupo_id="guar", nome="Farofa"),
            OpcaoModificador(id="vina", restaurante_id=T, grupo_id="sal", nome="Vinagrete"),
            OpcaoModificador(id="velha", restaurante_id=T, grupo_id="sal", nome="Salada antiga", ativo=False, arquivada=True),
            OpcaoModificador(id="frango-ad", restaurante_id=T, grupo_id="adic", nome="Frango adicional", opcao_origem_id="frango", preco_adicional=5),
            OpcaoModificador(id="xfrango", restaurante_id=OTHER, grupo_id="xprot", nome="Frango cozido"),
        ])
        session.flush()
        # Quentinha G vinculada diretamente; Quentinha P herda pela categoria.
        for gid in ("prot", "guar", "sal", "adic"):
            session.add(ProdutoGrupoModificador(restaurante_id=T, produto_id="qg", grupo_id=gid))
        session.add(CategoriaGrupoModificador(restaurante_id=T, categoria_id=f"quent{T}", grupo_id="prot"))
        session.commit()
        yield session
    engine.dispose()


def order(db, lid, lines, *, tenant=T, ts=DAY, status="pendente"):
    """lines: (produto, quantidade, [opções], item_status). Expande como OrderService: 1 Item por unidade."""
    cid = f"c{tenant}"
    db.add(Lancamento(id=lid, restaurante_id=tenant, comanda_id=cid, garcom_id=f"u{tenant}", timestamp=ts, status=status))
    db.flush()
    n = 0
    for pid, qty, mods, item_status in lines:
        for _ in range(qty):
            iid = f"{lid}-{n}"
            n += 1
            db.add(Item(id=iid, restaurante_id=tenant, comanda_id=cid, lancamento_id=lid, produto_id=pid, preco_unit=10, status=item_status))
            db.flush()
            for oid in mods:
                db.add(ItemModificador(restaurante_id=tenant, item_id=iid, opcao_modificador_id=oid, preco_aplicado=0))
    db.commit()


def report(db, product=None, start="2026-10-02", end="2026-10-02", tenant=T):
    return modifier_consumption(db, tenant, start, end, product)


def group(rep, gid):
    return next(g for g in rep["grupos"] if g["grupo_id"] == gid)


def qty(rep, gid, oid):
    return next(o for o in group(rep, gid)["opcoes"] if o["opcao_id"] == oid)["quantidade"]


def test_single_quentinha_counts_each_choice_once(db):
    order(db, "l1", [("qg", 1, ["frango", "arroz", "feijao", "vina"], "preparando")])
    rep = report(db)
    assert qty(rep, "prot", "frango") == 1
    assert qty(rep, "guar", "arroz") == qty(rep, "guar", "feijao") == 1
    assert qty(rep, "sal", "vina") == 1
    assert rep["total_selecoes"] == 4 and rep["unidades_produto"] == 1


def test_parent_quantity_and_two_side_dishes_and_shares(db):
    order(db, "l1", [("qg", 3, ["frango", "arroz", "feijao", "vina"], "pronto")])
    order(db, "l2", [("qg", 1, ["figado", "arroz", "vina"], "entregue")])
    rep = report(db)
    assert qty(rep, "prot", "frango") == 3 and qty(rep, "prot", "figado") == 1
    assert qty(rep, "guar", "arroz") == 4 and qty(rep, "guar", "feijao") == 3
    assert qty(rep, "sal", "vina") == 4
    prot = group(rep, "prot")
    assert prot["total_selecoes"] == 4
    shares = {o["opcao_id"]: o["participacao_pct"] for o in prot["opcoes"]}
    assert shares["frango"] == 75.0 and shares["figado"] == 25.0
    assert shares["ovo"] == 0.0  # ativa, sem saída, grupo com base -> 0 real
    assert prot["opcoes"][0]["opcao_id"] == "frango"  # ranking decrescente
    assert group(rep, "guar")["total_selecoes"] == 7  # participação dentro do grupo


def test_paid_addon_is_its_own_group(db):
    order(db, "l1", [("qg", 2, ["frango", "frango-ad", "arroz"], "pronto")])
    rep = report(db)
    adic = group(rep, "adic")
    assert adic["grupo_origem_id"] == "prot"
    assert qty(rep, "adic", "frango-ad") == 2
    assert group(rep, "adic")["opcoes"][0]["opcao_origem_id"] == "frango"


def test_cancellations_refusals_onboarding_and_period(db):
    order(db, "ok", [("qg", 1, ["frango"], "pronto"), ("qg", 1, ["figado"], "cancelado")])
    order(db, "cancel", [("qg", 2, ["frango"], "cancelado")], status="cancelado")
    order(db, "refused", [("qg", 1, ["frango"], "pronto")], status="recusado")
    order(db, "yesterday", [("qg", 5, ["frango"], "pronto")], ts=dt.datetime(2026, 10, 1, 15))
    db.add(Comanda(id="test-cmd", restaurante_id=T, garcom_id=f"u{T}", tipo="Consumo no Local", numero_pedido=2, onboarding_test=True))
    db.add(Lancamento(id="onb", restaurante_id=T, comanda_id="test-cmd", garcom_id=f"u{T}", timestamp=DAY, status="pendente"))
    db.add(Item(id="onb-0", restaurante_id=T, comanda_id="test-cmd", lancamento_id="onb", produto_id="qg", preco_unit=10, status="pronto"))
    db.flush()
    db.add(ItemModificador(restaurante_id=T, item_id="onb-0", opcao_modificador_id="frango", preco_aplicado=0))
    db.commit()
    rep = report(db)
    assert qty(rep, "prot", "frango") == 1
    assert qty(rep, "prot", "figado") == 0  # item cancelado não conta
    assert rep["unidades_produto"] == 1
    assert report(db, start="2026-10-01", end="2026-10-02")["grupos"][0]["total_selecoes"] == 6


def test_paused_archived_and_renamed_options_keep_history(db):
    order(db, "l1", [("qg", 2, ["acem", "velha"], "pronto")])
    db.query(OpcaoModificador).filter_by(id="acem").update({"nome": "Acém ao molho"})
    db.commit()
    rep = report(db)
    acem = next(o for o in group(rep, "prot")["opcoes"] if o["opcao_id"] == "acem")
    assert acem["quantidade"] == 2 and acem["ativa"] is False and acem["opcao_nome"] == "Acém ao molho"
    velha = next(o for o in group(rep, "sal")["opcoes"] if o["opcao_id"] == "velha")
    assert velha["quantidade"] == 2 and velha["arquivada"] is True
    # Pausada sem saída não vira "zero" listado; ativa sem saída sim.
    rep_empty_prot = report(db, start="2026-10-03", end="2026-10-03")
    ids = {o["opcao_id"] for o in group(rep_empty_prot, "prot")["opcoes"]}
    assert "acem" not in ids and "frango" in ids


def test_empty_period_and_group_without_output(db):
    rep = report(db)
    assert rep["total_selecoes"] == 0 and rep["unidades_produto"] == 0 and rep["produtos"] == []
    prot = group(rep, "prot")
    assert prot["total_selecoes"] == 0
    assert all(o["participacao_pct"] is None for o in prot["opcoes"])  # não calculável, não 0%
    order(db, "l1", [("qg", 1, ["frango"], "pronto")])
    rep = report(db)
    assert group(rep, "sal")["total_selecoes"] == 0
    assert all(o["participacao_pct"] is None for o in group(rep, "sal")["opcoes"])


def test_product_filter_and_mix_dimension(db):
    order(db, "l1", [("qg", 3, ["frango", "arroz"], "pronto"), ("qp", 2, ["frango"], "pronto"), ("qp", 1, ["figado"], "pronto"), ("suco", 1, [], "pronto")])
    rep = report(db)
    assert qty(rep, "prot", "frango") == 5
    mix = {(m["produto_id"], m["grupo_id"], m["opcao_id"]): m["quantidade"] for m in rep["mix_por_produto"]}
    assert mix[("qg", "prot", "frango")] == 3 and mix[("qp", "prot", "frango")] == 2 and mix[("qp", "prot", "figado")] == 1
    assert {p["produto_id"]: p["unidades"] for p in rep["produtos"]} == {"qg": 3, "qp": 3, "suco": 1}
    qp = report(db, product="qp")
    assert qp["unidades_produto"] == 3 and qp["produto_nome"] == "Quentinha P"
    assert qty(qp, "prot", "frango") == 2 and qty(qp, "prot", "figado") == 1
    assert {g["grupo_id"] for g in qp["grupos"]} == {"prot"}  # só grupos da categoria/escolhas do produto
    assert all(m["produto_id"] == "qp" for m in qp["mix_por_produto"])
    assert report(db, product="suco")["grupos"] == []


def test_tenant_isolation(db):
    order(db, "mine", [("qg", 1, ["frango"], "pronto")])
    order(db, "theirs", [("qx", 4, ["xfrango"], "pronto")], tenant=OTHER)
    rep = report(db)
    assert qty(rep, "prot", "frango") == 1
    assert all(m["opcao_id"] != "xfrango" for m in rep["mix_por_produto"])
    assert {p["produto_id"] for p in rep["produtos"]} == {"qg"}
    assert report(db, product="qx")["total_selecoes"] == 0
    assert qty(report(db, tenant=OTHER), "xprot", "xfrango") == 4


def test_legacy_rows_without_catalog_and_items_without_modifiers(db):
    # Pedido legado sem composição registrada: conta unidade, não inventa seleção.
    order(db, "legacy", [("qg", 2, [], "pronto")])
    # Seleção cujo ID não existe mais no cadastro (sem FK no SQLite legado).
    order(db, "orphan", [("qg", 1, ["sumiu"], "pronto")])
    rep = report(db)
    assert rep["unidades_produto"] == 3
    assert rep["selecoes_sem_cadastro"] == 1
    orphan = group(rep, UNCATALOGED_GROUP_ID)
    assert orphan["opcoes"][0]["cadastrada"] is False and orphan["opcoes"][0]["quantidade"] == 1
    assert orphan["arquivado"] is True


def test_aggregates_in_database_with_constant_queries(db):
    for i in range(30):
        order(db, f"l{i}", [("qg", 2, ["frango", "arroz", "feijao", "vina"], "pronto")])
    selects = []
    listener = lambda _c, _cur, stmt, *_a: selects.append(stmt) if stmt.lstrip().upper().startswith("SELECT") else None
    event.listen(db.bind, "before_cursor_execute", listener)
    try:
        rep = report(db)
    finally:
        event.remove(db.bind, "before_cursor_execute", listener)
    assert qty(rep, "prot", "frango") == 60
    assert len(selects) <= 7  # independente do número de pedidos


def test_product_units_and_selection_averages_for_future_cmv(db):
    # 2 Quentinha G, cada uma com Arroz + Feijão (2 guarnições por unidade)
    order(db, "l1", [("qg", 2, ["arroz", "feijao"], "pronto")])
    rep = report(db, product="qg")
    assert rep["unidades_produto"] == 2
    guar = group(rep, "guar")
    assert guar["total_selecoes"] == 4
    # Média: 4 seleções / 2 unidades = 2.0 por unidade
    assert guar["media_selecoes_por_unidade"] == 2.0

    # Verifica estrutura do mix_resumo e mix_por_produto
    resumo_guar = next(r for r in rep["mix_resumo"] if r["produto_id"] == "qg" and r["grupo_id"] == "guar")
    assert resumo_guar["product_units"] == 2
    assert resumo_guar["group_total_selections"] == 4
    assert resumo_guar["avg_selections_per_product_unit"] == 2.0

    arroz_mix = next(m for m in rep["mix_por_produto"] if m["produto_id"] == "qg" and m["opcao_id"] == "arroz")
    assert arroz_mix["product_units"] == 2
    assert arroz_mix["group_total_selections"] == 4
    assert arroz_mix["avg_selections_per_product_unit"] == 2.0


def test_generic_restaurant_catalog_without_marmitaria_mode(db):
    BURGER_TENANT = 9923
    db.add(Restaurante(id=BURGER_TENANT, nome="Hamburgueria Koma", plano="bistro"))
    db.flush()
    db.add(Usuario(id=f"u{BURGER_TENANT}", restaurante_id=BURGER_TENANT, nome="Chef", usuario=f"u{BURGER_TENANT}", senha_hash="x", role="admin", status="ativo"))
    db.add(Categoria(id=f"burgers{BURGER_TENANT}", restaurante_id=BURGER_TENANT, nome="Burgers"))
    db.flush()
    db.add(Comanda(id=f"c{BURGER_TENANT}", restaurante_id=BURGER_TENANT, garcom_id=f"u{BURGER_TENANT}", tipo="Consumo no Local", numero_pedido=1))
    db.add(Produto(id="smash", restaurante_id=BURGER_TENANT, nome="Smash Burger", categoria_id=f"burgers{BURGER_TENANT}", preco=25))
    db.flush()
    db.add_all([
        GrupoModificador(id="ponto", restaurante_id=BURGER_TENANT, nome="Ponto da Carne", max_selecoes=1),
        GrupoModificador(id="molho", restaurante_id=BURGER_TENANT, nome="Molho Especial", max_selecoes=2),
    ])
    db.flush()
    db.add_all([
        OpcaoModificador(id="ao_ponto", restaurante_id=BURGER_TENANT, grupo_id="ponto", nome="Ao ponto"),
        OpcaoModificador(id="bem_passado", restaurante_id=BURGER_TENANT, grupo_id="ponto", nome="Bem passado"),
        OpcaoModificador(id="barbecue", restaurante_id=BURGER_TENANT, grupo_id="molho", nome="Barbecue"),
        OpcaoModificador(id="maionese", restaurante_id=BURGER_TENANT, grupo_id="molho", nome="Maionese da casa"),
    ])
    db.flush()
    db.add_all([
        ProdutoGrupoModificador(restaurante_id=BURGER_TENANT, produto_id="smash", grupo_id="ponto"),
        ProdutoGrupoModificador(restaurante_id=BURGER_TENANT, produto_id="smash", grupo_id="molho"),
    ])
    db.commit()

    order(db, "burger_order", [("smash", 3, ["ao_ponto", "barbecue", "maionese"], "pronto")], tenant=BURGER_TENANT)

    rep = report(db, tenant=BURGER_TENANT)
    assert rep["total_selecoes"] == 9  # 3 x (1 ponto + 2 molhos)
    assert rep["unidades_produto"] == 3
    ponto_g = group(rep, "ponto")
    assert ponto_g["total_selecoes"] == 3
    assert qty(rep, "ponto", "ao_ponto") == 3
    assert qty(rep, "ponto", "bem_passado") == 0
    molho_g = group(rep, "molho")
    assert molho_g["total_selecoes"] == 6
    assert qty(rep, "molho", "barbecue") == 3
    assert qty(rep, "molho", "maionese") == 3

