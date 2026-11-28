"""Tests preventing sellable products from having unfeasible required modifier groups."""

from fastapi.testclient import TestClient
import pytest

from app.catalog_addons import CategoriaGrupoModificador, CategoriaRelacao
from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    Cardapio,
    Categoria,
    GrupoModificador,
    OpcaoModificador,
    Produto,
    ProdutoFamilia,
    ProdutoGrupoModificador,
    Restaurante,
    Usuario,
)
from app.routes.auth import create_access_token

client = TestClient(app)
TENANT_ID = 942


@pytest.fixture(autouse=True)
def isolated_catalog_tenant():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token = current_restaurante_id.set(TENANT_ID)
    try:
        for model in (
            ProdutoGrupoModificador,
            CategoriaGrupoModificador,
            CategoriaRelacao,
            OpcaoModificador,
            Produto,
            ProdutoFamilia,
            GrupoModificador,
            Categoria,
            Cardapio,
            Usuario,
        ):
            db.query(model).filter(model.restaurante_id == TENANT_ID).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == TENANT_ID).delete(synchronize_session=False)
        db.commit()

        db.add(Restaurante(id=TENANT_ID, nome="Loja Prevencao QA", slug="loja-prevencao-942", plano="pro"))
        db.flush()
        db.add(
            Usuario(
                id="usr-prev-942",
                restaurante_id=TENANT_ID,
                nome="Admin Prevencao",
                email="prev942@koma.test",
                cargo="admin",
                status="ativo",
            )
        )
        db.add(Cardapio(id="card-942", restaurante_id=TENANT_ID, nome="Principal", identificador="principal-942"))
        db.add_all(
            [
                Categoria(id="cat-942-base", restaurante_id=TENANT_ID, nome="Bebidas"),
                Categoria(id="cat-942-pai", restaurante_id=TENANT_ID, nome="Combos Pai"),
                Categoria(id="cat-942-filha", restaurante_id=TENANT_ID, nome="Combos Filha"),
            ]
        )
        db.flush()
        db.add(CategoriaRelacao(restaurante_id=TENANT_ID, categoria_id="cat-942-filha", categoria_pai_id="cat-942-pai"))
        db.add_all(
            [
                Produto(
                    id="prod-agua-942",
                    restaurante_id=TENANT_ID,
                    cardapio_id="card-942",
                    categoria_id="cat-942-base",
                    nome="Agua Mineral 500ml",
                    preco=4.5,
                    ativo=True,
                ),
                Produto(
                    id="prod-suco-942",
                    restaurante_id=TENANT_ID,
                    cardapio_id="card-942",
                    categoria_id="cat-942-base",
                    nome="Suco 500ml",
                    preco=8.0,
                    ativo=True,
                ),
                Produto(
                    id="prod-inativo-942",
                    restaurante_id=TENANT_ID,
                    cardapio_id="card-942",
                    categoria_id="cat-942-base",
                    nome="Produto Pausado",
                    preco=10.0,
                    ativo=False,
                ),
            ]
        )
        db.commit()
        yield
    finally:
        current_restaurante_id.reset(token)
        db.close()


def _headers():
    token = create_access_token(subject="usr-prev-942", restaurante_id=TENANT_ID, role="admin")
    return {"Authorization": f"Bearer {token}"}


def _seed_group(
    group_id: str,
    nome: str,
    *,
    min_sel: int = 1,
    max_sel: int = 1,
    tipo: str = "obrigatorio",
    options: list[tuple[str, str, bool, bool]] | None = None,
):
    db = SessionLocal()
    token = current_restaurante_id.set(TENANT_ID)
    try:
        db.add(
            GrupoModificador(
                id=group_id,
                restaurante_id=TENANT_ID,
                nome=nome,
                min_selecoes=min_sel,
                max_selecoes=max_sel,
                tipo=tipo,
            )
        )
        db.flush()
        for opt_id, opt_name, ativo, arquivada in options or []:
            db.add(
                OpcaoModificador(
                    id=opt_id,
                    restaurante_id=TENANT_ID,
                    grupo_id=group_id,
                    nome=opt_name,
                    preco_adicional=0.0,
                    ativo=ativo,
                    arquivada=arquivada,
                )
            )
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_blocks_creating_and_linking_unfeasible_required_group_without_auto_converting():
    headers = _headers()

    # 1) Criar grupo obrigatório sem opções ativas vinculado a produto ativo => 422
    res_create = client.post(
        "/cardapio/modificadores/grupos",
        headers=headers,
        json={
            "nome": "Gelo e Limao QA",
            "min_selecoes": 1,
            "max_selecoes": 1,
            "tipo": "obrigatorio",
            "opcoes": [{"nome": "Com Gelo", "preco_adicional": 0.0, "ativo": False}],
            "produto_ids": ["prod-agua-942"],
        },
    )
    assert res_create.status_code == 422
    detail = res_create.json()["detail"]
    assert "Gelo e Limao QA" in detail
    assert "Ative" in detail or "opção" in detail

    # Fluxo válido preservado: criar grupo obrigatório sem opções SEM vincular produto ativo (ou só em produto inativo)
    res_unlinked = client.post(
        "/cardapio/modificadores/grupos",
        headers=headers,
        json={
            "nome": "Gelo Sem Produto",
            "min_selecoes": 1,
            "max_selecoes": 1,
            "tipo": "obrigatorio",
            "opcoes": [],
            "produto_ids": ["prod-inativo-942"],
        },
    )
    assert res_unlinked.status_code == 201
    created_gid = res_unlinked.json()["id"]
    # Garante que NÃO converteu min_selecoes para 0 (opcional)
    assert res_unlinked.json()["min_selecoes"] == 1

    # 2) Edição individual do produto tentando vincular esse grupo inviável => 422
    res_indiv = client.put(
        "/produtos/prod-agua-942/personalizacoes",
        headers=headers,
        json={"grupo_ids": [created_gid], "grupos_diretos_anteriores": []},
    )
    assert res_indiv.status_code == 422
    assert "Gelo Sem Produto" in res_indiv.json()["detail"]

    # Verifica que min_selecoes no banco permaneceu 1 (nunca virou opcional) e vínculo não foi gravado
    db = SessionLocal()
    try:
        grp = db.query(GrupoModificador).filter(GrupoModificador.id == created_gid).one()
        assert grp.min_selecoes == 1
        assert (
            db.query(ProdutoGrupoModificador)
            .filter(ProdutoGrupoModificador.restaurante_id == TENANT_ID, ProdutoGrupoModificador.produto_id == "prod-agua-942")
            .count()
            == 0
        )
    finally:
        db.close()

    # 3) Edição em lote tentando vincular grupo obrigatório inviável => 422
    res_lote = client.patch(
        "/produtos/edicao-lote",
        headers=headers,
        json={
            "produto_ids": ["prod-agua-942", "prod-suco-942"],
            "adicionar_grupos_modificadores_ids": [created_gid],
        },
    )
    assert res_lote.status_code == 422
    assert "Gelo Sem Produto" in res_lote.json()["detail"]


def test_blocks_pausing_or_archiving_last_required_option_including_linked_sync():
    headers = _headers()
    _seed_group(
        "grp-src-942",
        "Complementos Base Origem",
        min_sel=1,
        max_sel=1,
        options=[("opt-src-1", "Gelo", True, False), ("opt-src-2", "Limao", True, False)],
    )
    _seed_group(
        "grp-2op-942",
        "Sabores Minimo Dois",
        min_sel=2,
        max_sel=2,
        options=[("opt-2op-1", "Morango", True, False), ("opt-2op-2", "Uva", True, False)],
    )

    # Cria grupo seguidor obrigatório vinculado ao produto ativo e sincronizado com grp-src-942
    res_follower = client.post(
        "/cardapio/modificadores/grupos",
        headers=headers,
        json={
            "nome": "Gelo e Limao Vinculado",
            "min_selecoes": 1,
            "max_selecoes": 1,
            "tipo": "obrigatorio",
            "grupo_origem_id": "grp-src-942",
            "preco_novo_adicional": 2.0,
            "preco_novo_ovo": 3.0,
            "produto_ids": ["prod-agua-942"],
        },
    )
    assert res_follower.status_code == 201
    follower_gid = res_follower.json()["id"]

    # Vincula grp-2op-942 a prod-suco-942
    res_link2 = client.put(
        "/produtos/prod-suco-942/personalizacoes",
        headers=headers,
        json={"grupo_ids": ["grp-2op-942"], "grupos_diretos_anteriores": []},
    )
    assert res_link2.status_code == 200

    # Pausar uma opção de origem ainda deixa 1 opção no seguidor => permitido
    res_pause_one = client.patch(
        "/cardapio/modificadores/opcoes/opt-src-1/disponibilidade",
        headers=headers,
        json={"ativo": False, "ativo_anterior": True},
    )
    assert res_pause_one.status_code == 200

    # Pausar a ÚLTIMA opção na origem quebraria o seguidor obrigatório vinculado à Água => 422 com rollback
    res_pause_last_sync = client.patch(
        "/cardapio/modificadores/opcoes/opt-src-2/disponibilidade",
        headers=headers,
        json={"ativo": False, "ativo_anterior": True},
    )
    assert res_pause_last_sync.status_code == 422
    assert "Gelo e Limao Vinculado" in res_pause_last_sync.json()["detail"]

    # Pausar no cardápio diário em lote também deve bloquear quando zera grupo seguidor
    res_daily = client.patch(
        "/cardapio/modificadores/cardapio-diario",
        headers=headers,
        json={"opcoes": [{"id": "opt-src-2", "ativo": False, "ativo_anterior": True}]},
    )
    assert res_daily.status_code == 422
    assert "Gelo e Limao Vinculado" in res_daily.json()["detail"]

    # Pausar uma das 2 opções de grupo tipos min=2 => 422 (exige 2 distintas)
    res_min2_pause = client.patch(
        "/cardapio/modificadores/opcoes/opt-2op-2/disponibilidade",
        headers=headers,
        json={"ativo": False, "ativo_anterior": True},
    )
    assert res_min2_pause.status_code == 422
    assert "Sabores Minimo Dois" in res_min2_pause.json()["detail"]

    # Arquivar/remover a última opção via PUT /grupos/{id} na origem também é bloqueado pela sincronização vinculada
    res_put_remove = client.put(
        "/cardapio/modificadores/grupos/grp-src-942",
        headers=headers,
        json={
            "nome": "Complementos Base Origem",
            "min_selecoes": 1,
            "max_selecoes": 1,
            "tipo": "obrigatorio",
            "opcoes": [{"id": "opt-src-1", "nome": "Gelo", "preco_adicional": 0.0, "ativo": False}],
        },
    )
    assert res_put_remove.status_code == 422
    assert follower_gid and "Gelo e Limao Vinculado" in res_put_remove.json()["detail"]

    # Rollback verificado: opt-src-2 permanece ativa na origem e no seguidor
    db = SessionLocal()
    try:
        opt2 = db.query(OpcaoModificador).filter(OpcaoModificador.id == "opt-src-2").one()
        assert opt2.ativo is True
        follower_active = (
            db.query(OpcaoModificador)
            .filter(
                OpcaoModificador.restaurante_id == TENANT_ID,
                OpcaoModificador.grupo_id == follower_gid,
                OpcaoModificador.ativo.is_(True),
                OpcaoModificador.arquivada.is_(False),
            )
            .count()
        )
        assert follower_active == 1
    finally:
        db.close()


def test_category_family_activation_and_porcoes_valid_flows():
    headers = _headers()
    _seed_group("grp-cat-empty", "Obrigatorio Categoria Vazio", min_sel=1, max_sel=1, options=[])
    _seed_group(
        "grp-porcao-1op",
        "Bolinho Porcoes Min2",
        min_sel=1,
        max_sel=3,
        options=[("opt-p-1", "Calabresa", True, False)],
    )

    # Vincula grp-cat-empty na categoria pai (sem produtos ativos inicialmente => válido)
    res_cat = client.put(
        "/cardapio/modificadores/grupos/grp-cat-empty",
        headers=headers,
        json={
            "nome": "Obrigatorio Categoria Vazio",
            "min_selecoes": 1,
            "max_selecoes": 1,
            "tipo": "obrigatorio",
            "categoria_ids": ["cat-942-pai"],
            "incluir_subcategorias": True,
        },
    )
    assert res_cat.status_code == 200

    # Criar produto ativo em subcategoria herdando grupo inviável => 422
    res_create_prod = client.post(
        "/produtos/",
        headers=headers,
        json={
            "id": "prod-sub-ativo",
            "nome": "Burger Herdado",
            "categoria_id": "cat-942-filha",
            "preco": 29.9,
            "ativo": True,
        },
    )
    assert res_create_prod.status_code == 422
    assert "Obrigatorio Categoria Vazio" in res_create_prod.json()["detail"]

    # Criar produto INATIVO na subcategoria é permitido (não está vendável)
    res_create_inactive = client.post(
        "/produtos/",
        headers=headers,
        json={
            "id": "prod-sub-inativo",
            "nome": "Burger Em Rascunho",
            "categoria_id": "cat-942-filha",
            "preco": 29.9,
            "ativo": False,
        },
    )
    assert res_create_inactive.status_code == 201

    # Reativar produto individual ou em lote herdando grupo inviável => 422
    res_pub_one = client.put("/produtos/prod-sub-inativo", headers=headers, json={"ativo": True})
    assert res_pub_one.status_code == 422
    assert "Obrigatorio Categoria Vazio" in res_pub_one.json()["detail"]

    res_pub_lote = client.patch(
        "/produtos/disponibilidade",
        headers=headers,
        json={"produto_ids": ["prod-sub-inativo"], "ativo": True},
    )
    assert res_pub_lote.status_code == 422
    assert "Obrigatorio Categoria Vazio" in res_pub_lote.json()["detail"]

    # Família de produtos com variante ativa vinculada a grupo obrigatório inviável => 422
    res_fam = client.post(
        "/produto-familias",
        headers=headers,
        json={
            "nome": "Refrigerante Familia",
            "eixo": "tamanho",
            "categoria_id": "cat-942-base",
            "cardapio_id": "card-942",
            "variantes": [{"rotulo": "500ml", "preco": 6.0, "ativo": True}],
        },
    )
    assert res_fam.status_code == 201
    fam_id = res_fam.json()["id"]

    res_fam_pers = client.put(
        f"/produto-familias/{fam_id}/personalizacoes",
        headers=headers,
        json={"grupo_ids": ["grp-cat-empty"], "grupos_anteriores": []},
    )
    assert res_fam_pers.status_code == 422
    assert "Obrigatorio Categoria Vazio" in res_fam_pers.json()["detail"]

    # Fluxo porções válido: override min=2, max=3, modo='porcoes' com 1 opção ativa => PERMITIDO
    db = SessionLocal()
    token = current_restaurante_id.set(TENANT_ID)
    try:
        db.add(
            ProdutoGrupoModificador(
                restaurante_id=TENANT_ID,
                produto_id="prod-agua-942",
                grupo_id="grp-porcao-1op",
                min_selecoes=2,
                max_selecoes=3,
                modo_selecao="porcoes",
            )
        )
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()

    # Editar produto com modo='porcoes' válido continua 200
    res_ok = client.put("/produtos/prod-agua-942", headers=headers, json={"preco": 5.0})
    assert res_ok.status_code == 200

    # Pausar a última opção de grupo 'porcoes' (de 1 para 0) bloqueia => 422
    res_zero_porcoes = client.patch(
        "/cardapio/modificadores/opcoes/opt-p-1/disponibilidade",
        headers=headers,
        json={"ativo": False, "ativo_anterior": True},
    )
    assert res_zero_porcoes.status_code == 422
    assert "Bolinho Porcoes Min2" in res_zero_porcoes.json()["detail"]

    # Grupo opcional sem opções em produto ativo continua permitido
    res_optional = client.post(
        "/cardapio/modificadores/grupos",
        headers=headers,
        json={
            "nome": "Observacao Opcional Vazia",
            "min_selecoes": 0,
            "max_selecoes": 2,
            "tipo": "opcional",
            "opcoes": [],
            "produto_ids": ["prod-agua-942"],
        },
    )
    assert res_optional.status_code == 201
