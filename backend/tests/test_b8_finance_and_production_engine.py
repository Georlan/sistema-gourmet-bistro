"""Suíte de integração B8 Finance & Production Engine (Cenários A–F e Segurança Multitenant)."""

from __future__ import annotations

import datetime
import uuid

from fastapi.testclient import TestClient
import pytest

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    Distribuidor,
    GrupoModificador,
    Insumo,
    Item,
    ItemModificador,
    Lancamento,
    OpcaoModificador,
    Pagamento,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
    Usuario,
)
from app.security import create_access_token
from app.services.inventory import consumir_estoque_dos_itens, estornar_estoque_dos_itens


def _seed_tenant(rid: int, *, plano: str = "pro") -> dict:
    Base.metadata.create_all(bind=engine)
    suffix = uuid.uuid4().hex[:6]
    uid = f"u-b8-{rid}-{suffix}"
    token_var = current_restaurante_id.set(rid)
    try:
        with SessionLocal() as db:
            rest = db.query(Restaurante).filter(Restaurante.id == rid).first()
            if rest is None:
                rest = Restaurante(id=rid, nome=f"B8 Rest {rid}", slug=f"b8-rest-{rid}", plano=plano, saas_status="active")
                db.add(rest)
                db.flush()
            else:
                rest.plano = plano

            user = Usuario(
                id=uid,
                restaurante_id=rid,
                nome=f"Admin B8 {rid}",
                email=f"b8-{rid}-{suffix}@koma.test",
                cargo="admin",
                role="admin",
                status="ativo",
            )
            db.add(user)
            db.flush()

            cat = Categoria(id=f"cat-b8-{rid}-{suffix}", restaurante_id=rid, nome="Pratos")
            db.add(cat)
            db.flush()

            prod = Produto(
                id=f"prod-b8-{rid}-{suffix}",
                restaurante_id=rid,
                categoria_id=cat.id,
                nome="Burger B8",
                preco=40.0,
                ativo=True,
            )
            db.add(prod)

            grp = GrupoModificador(
                id=f"grp-b8-{rid}-{suffix}",
                restaurante_id=rid,
                nome="Adicionais",
                min_selecoes=0,
                max_selecoes=2,
                tipo="adicional",
            )
            db.add(grp)
            db.flush()

            opt = OpcaoModificador(
                id=f"opt-b8-{rid}-{suffix}",
                restaurante_id=rid,
                grupo_id=grp.id,
                nome="Bacon Extra",
                preco_adicional=6.0,
                ativo=True,
            )
            db.add(opt)
            db.add(ProdutoGrupoModificador(restaurante_id=rid, produto_id=prod.id, grupo_id=grp.id))

            ins_carne = Insumo(
                id=f"ins-carne-{rid}-{suffix}",
                restaurante_id=rid,
                nome="Carne Bovina",
                estoque_atual=0.0,
                estoque_minimo=2.0,
                unidade_medida="kg",
                preco_medio_custo=0.0,
            )
            ins_bacon = Insumo(
                id=f"ins-bacon-{rid}-{suffix}",
                restaurante_id=rid,
                nome="Bacon Fatiado",
                estoque_atual=0.0,
                estoque_minimo=1.0,
                unidade_medida="un",
                preco_medio_custo=0.0,
            )
            dist = Distribuidor(
                id=f"dist-b8-{rid}-{suffix}",
                restaurante_id=rid,
                nome_fantasia="Frigorífico Central",
                cnpj="11222333000181",
            )
            db.add_all([ins_carne, ins_bacon, dist])
            db.commit()

            token = create_access_token(subject=uid, restaurante_id=rid, role="admin")
            return {
                "rid": rid,
                "uid": uid,
                "headers": {"Authorization": f"Bearer {token}"},
                "prod_id": prod.id,
                "opt_id": opt.id,
                "ins_carne_id": ins_carne.id,
                "ins_bacon_id": ins_bacon.id,
                "dist_id": dist.id,
            }
    finally:
        current_restaurante_id.reset(token_var)


def _record_sale(
    db,
    *,
    rid: int,
    uid: str,
    prod_id: str,
    preco_unit: float = 46.0,
    opt_id: str | None = None,
    onboarding_test: bool = False,
) -> tuple[Comanda, Item]:
    now = datetime.datetime.now(datetime.timezone.utc)
    turno = db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == rid, CaixaTurno.status == "aberto").first()
    if turno is None:
        turno = CaixaTurno(restaurante_id=rid, aberto_por_id=uid, status="aberto", saldo_inicial=100.0)
        db.add(turno)
        db.flush()

    cmd = Comanda(
        id=f"cmd-b8-{uuid.uuid4().hex[:8]}",
        restaurante_id=rid,
        garcom_id=uid,
        numero_pedido=1,
        tipo="Retirada",
        delivery_status="producao",
        fechada=True,
        onboarding_test=onboarding_test,
        criado_em=now,
    )
    db.add(cmd)
    db.flush()
    lanc = Lancamento(
        id=f"lanc-b8-{uuid.uuid4().hex[:8]}",
        restaurante_id=rid,
        comanda_id=cmd.id,
        garcom_id=uid,
        status="producao",
        timestamp=now,
    )
    db.add(lanc)
    db.flush()
    item = Item(
        id=f"it-b8-{uuid.uuid4().hex[:8]}",
        restaurante_id=rid,
        lancamento_id=lanc.id,
        comanda_id=cmd.id,
        produto_id=prod_id,
        preco_unit=preco_unit,
        status="preparando",
    )
    db.add(item)
    db.flush()
    if opt_id:
        db.add(
            ItemModificador(
                restaurante_id=rid,
                item_id=item.id,
                opcao_modificador_id=opt_id,
                preco_aplicado=6.0,
            )
        )
        db.flush()

    db.add(
        Pagamento(
            id=f"pag-b8-{uuid.uuid4().hex[:8]}",
            restaurante_id=rid,
            comanda_id=cmd.id,
            turno_id=turno.id,
            valor=preco_unit,
            metodo="pix",
            status="aprovado",
            criado_em=now,
        )
    )
    db.flush()
    consumir_estoque_dos_itens(db, [item], usuario_id=uid)
    db.commit()
    return cmd, item


def test_cenario_a_restaurante_convencional_xml_cp_venda_dre_fluxo():
    ctx = _seed_tenant(98801)
    client = TestClient(app)
    hoje = datetime.date.today().isoformat()

    # 1. Configura ficha técnica do produto e do modificador
    r_ft1 = client.put(
        f"/b8/supply/fichas/produto/{ctx['prod_id']}",
        headers=ctx["headers"],
        json={"componentes": [{"insumo_id": ctx["ins_carne_id"], "quantidade": 0.2, "unidade_medida": "kg"}]},
    )
    assert r_ft1.status_code == 200, r_ft1.text
    r_ft2 = client.put(
        f"/b8/supply/fichas/opcao_modificador/{ctx['opt_id']}",
        headers=ctx["headers"],
        json={"componentes": [{"insumo_id": ctx["ins_bacon_id"], "quantidade": 2.0, "unidade_medida": "un", "papel": "complemento"}]},
    )
    assert r_ft2.status_code == 200, r_ft2.text

    # 2. Preview + Confirmação de XML NF-e com fator de conversão (1 caixa = 10 un) + Conta a Pagar
    xml_bytes = f"""<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
      <NFe><infNFe Id="NFe23261111222333000181550010000001231000001234">
        <ide><nNF>123</nNF><dhEmi>{hoje}T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>11222333000181</CNPJ><xNome>Frigorífico Central</xNome></emit>
        <det nItem="1"><prod><cProd>CARNE-01</cProd><xProd>Carne Bovina KG</xProd><uCom>KG</uCom><qCom>10.00</qCom><vUnCom>30.00</vUnCom></prod></det>
        <det nItem="2"><prod><cProd>BACON-CX</cProd><xProd>Bacon Caixa 10un</xProd><uCom>CX</uCom><qCom>2.00</qCom><vUnCom>15.00</vUnCom></prod></det>
      </infNFe></NFe>
    </nfeProc>""".encode("utf-8")

    prev = client.post(
        "/b8/supply/xml/preview",
        headers=ctx["headers"],
        files={"file": ("nfe.xml", xml_bytes, "application/xml")},
    )
    assert prev.status_code == 200, prev.text
    assert prev.json()["duplicada"] is False
    assert prev.json()["valor_total"] == 330.0

    conf = client.post(
        "/b8/supply/xml/confirmar",
        headers=ctx["headers"],
        json={
            "chave_acesso": "23261111222333000181550010000001231000001234",
            "numero_nota": "123",
            "fornecedor_nome": "Frigorífico Central",
            "fornecedor_cnpj": "11222333000181",
            "data_emissao": hoje,
            "gerar_conta_pagar": True,
            "itens": [
                {
                    "codigo_fornecedor": "CARNE-01",
                    "descricao_fornecedor": "Carne Bovina KG",
                    "unidade_compra": "KG",
                    "insumo_id": ctx["ins_carne_id"],
                    "quantidade_compra": 10.0,
                    "fator_conversao": 1.0,
                    "valor_unitario_compra": 30.0,
                    "data_validade": (datetime.date.today() + datetime.timedelta(days=5)).isoformat(),
                },
                {
                    "codigo_fornecedor": "BACON-CX",
                    "descricao_fornecedor": "Bacon Caixa 10un",
                    "unidade_compra": "CX",
                    "insumo_id": ctx["ins_bacon_id"],
                    "quantidade_compra": 2.0,
                    "fator_conversao": 10.0,
                    "valor_unitario_compra": 15.0,
                    "data_validade": (datetime.date.today() + datetime.timedelta(days=10)).isoformat(),
                },
            ],
        },
    )
    assert conf.status_code == 201, conf.text
    assert conf.json()["conta_pagar_id"] is not None

    # Bloqueia XML duplicado
    prev_dup = client.post(
        "/b8/supply/xml/preview",
        headers=ctx["headers"],
        files={"file": ("nfe.xml", xml_bytes, "application/xml")},
    )
    assert prev_dup.json()["duplicada"] is True

    # 3. Setup financeiro (via POST explícito), despesa operacional (aluguel) e pagamento de conta
    setup = client.post("/b8/financeiro/setup/inicializar", headers=ctx["headers"]).json()
    cat_aluguel = next(c for c in setup["categorias"] if c["codigo"] == "aluguel")
    conta_banco = next(a for a in setup["contas"] if a["tipo"] == "conta_bancaria")

    cp_aluguel = client.post(
        "/b8/financeiro/contas-pagar",
        headers=ctx["headers"],
        json={
            "categoria_id": cat_aluguel["id"],
            "favorecido_nome": "Imobiliária Centro",
            "descricao": "Aluguel Novembro",
            "valor_original": 100.0,
            "data_emissao": hoje,
            "data_competencia": hoje,
            "primeiro_vencimento": hoje,
            "total_parcelas": 1,
        },
    )
    assert cp_aluguel.status_code == 201, cp_aluguel.text
    parcela_id = cp_aluguel.json()["parcelas"][0]["id"]

    baixa = client.post(
        f"/b8/financeiro/contas-pagar/parcelas/{parcela_id}/baixar",
        headers=ctx["headers"],
        json={
            "conta_financeira_id": conta_banco["id"],
            "valor_principal": 100.0,
            "data_pagamento": hoje,
            "idempotency_key": f"baixa-{parcela_id}",
        },
    )
    assert baixa.status_code == 200 and baixa.json()["replay"] is False
    # Replay idempotente
    baixa_replay = client.post(
        f"/b8/financeiro/contas-pagar/parcelas/{parcela_id}/baixar",
        headers=ctx["headers"],
        json={
            "conta_financeira_id": conta_banco["id"],
            "valor_principal": 100.0,
            "data_pagamento": hoje,
            "idempotency_key": f"baixa-{parcela_id}",
        },
    )
    assert baixa_replay.status_code == 200 and baixa_replay.json()["replay"] is True

    # 4. Realiza 1 venda real com modificador (custo = 0.2*30 + 2*1.5 = 6.00 + 3.00 = 9.00)
    #    e 1 venda QA (onboarding_test=True, que NÃO pode entrar na DRE nem no Fluxo de Caixa!)
    token_var = current_restaurante_id.set(ctx["rid"])
    try:
        with SessionLocal() as db:
            _record_sale(db, rid=ctx["rid"], uid=ctx["uid"], prod_id=ctx["prod_id"], preco_unit=46.0, opt_id=ctx["opt_id"])
            _record_sale(db, rid=ctx["rid"], uid=ctx["uid"], prod_id=ctx["prod_id"], preco_unit=99.0, onboarding_test=True)
    finally:
        current_restaurante_id.reset(token_var)

    # 5. Consulta DRE Gerencial: compra de estoque (R$ 330) NÃO entra como despesa nem CMV;
    #    CMV = R$ 9,00; Receita = R$ 46,00; Despesa Aluguel = R$ 100,00.
    dre = client.get(f"/b8/financeiro/dre?data_inicio={hoje}&data_fim={hoje}", headers=ctx["headers"]).json()
    assert dre["linhas"]["receita_liquida"] == 46.0
    assert dre["linhas"]["cmv"] == 9.0
    assert dre["linhas"]["lucro_bruto"] == 37.0
    assert dre["linhas"]["despesas_operacionais"] == 100.0
    assert dre["cobertura_cmv"]["itens_com_custo"] == 1

    # 6. Consulta Fluxo de Caixa: entradas operacionais R$ 46,00, saídas realizadas R$ 100,00,
    #    saídas previstas R$ 330,00 (compra XML não paga ainda).
    fc = client.get(f"/b8/financeiro/fluxo-caixa?data_inicio={hoje}&data_fim={hoje}", headers=ctx["headers"]).json()
    assert fc["entradas_realizadas"] == 46.0
    assert fc["saidas_realizadas"] == 100.0
    assert fc["saldo_final_realizado"] == -54.0


def test_cenario_b_producao_interna_sem_duplicar_cmv():
    ctx = _seed_tenant(98802)
    client = TestClient(app)
    hoje = datetime.date.today().isoformat()

    # Dá entrada em Carne Bovina a R$ 20,00/kg (via compra/lote)
    token_var = current_restaurante_id.set(ctx["rid"])
    try:
        with SessionLocal() as db:
            from app.services.b8_supply import registrar_entrada_lote
            ins = db.get(Insumo, ctx["ins_carne_id"])
            registrar_entrada_lote(
                db,
                restaurante_id=ctx["rid"],
                insumo=ins,
                quantidade=10.0,
                custo_unitario=20.0,
                origem_tipo="entrada_manual",
            )
            db.commit()
    finally:
        current_restaurante_id.reset(token_var)

    # Cria Sub-receita: "Carne Preparada" (usa 2 kg de Carne Bovina -> rende 1.5 kg)
    r_sub = client.post(
        "/b8/supply/sub-receitas",
        headers=ctx["headers"],
        json={
            "nome": "Carne Preparada",
            "unidade_rendimento": "kg",
            "rendimento_esperado": 1.5,
            "ingredientes": [{"insumo_id": ctx["ins_carne_id"], "quantidade": 2.0, "unidade_medida": "kg"}],
        },
    )
    assert r_sub.status_code == 201, r_sub.text
    sub_id = r_sub.json()["id"]

    # Executa Ordem de Produção: 2 kg de carne (R$ 40,00) -> 1.6 kg produzidos (R$ 25,00/kg)
    r_op = client.post(
        "/b8/supply/ordens-producao",
        headers=ctx["headers"],
        json={
            "sub_receita_id": sub_id,
            "quantidade_planejada": 1.5,
            "quantidade_produzida": 1.6,
            "peso_inicial": 2.0,
            "perda_producao": 0.4,
        },
    )
    assert r_op.status_code == 201, r_op.text
    op_data = r_op.json()
    assert op_data["custo_total_insumos"] == 40.0
    assert op_data["custo_unitario_produzido"] == 25.0

    # Vincula a preparação produzida à ficha técnica do produto (0.2 kg por lanche = R$ 5,00)
    r_ft = client.put(
        f"/b8/supply/fichas/produto/{ctx['prod_id']}",
        headers=ctx["headers"],
        json={"componentes": [{"sub_receita_id": sub_id, "quantidade": 0.2, "unidade_medida": "kg"}]},
    )
    assert r_ft.status_code == 200, r_ft.text

    token_var = current_restaurante_id.set(ctx["rid"])
    try:
        with SessionLocal() as db:
            _record_sale(db, rid=ctx["rid"], uid=ctx["uid"], prod_id=ctx["prod_id"], preco_unit=30.0)
    finally:
        current_restaurante_id.reset(token_var)

    # DRE mostra CMV exato de R$ 5,00 (sem duplicar os R$ 40,00 da produção!)
    dre = client.get(f"/b8/financeiro/dre?data_inicio={hoje}&data_fim={hoje}", headers=ctx["headers"]).json()
    assert dre["linhas"]["cmv"] == 5.0


def test_cenario_c_financeiro_incompleto_sinaliza_lacunas():
    ctx = _seed_tenant(98803)
    client = TestClient(app)
    hoje = datetime.date.today().isoformat()

    token_var = current_restaurante_id.set(ctx["rid"])
    try:
        with SessionLocal() as db:
            _record_sale(db, rid=ctx["rid"], uid=ctx["uid"], prod_id=ctx["prod_id"], preco_unit=40.0)
    finally:
        current_restaurante_id.reset(token_var)

    dre = client.get(f"/b8/financeiro/dre?data_inicio={hoje}&data_fim={hoje}", headers=ctx["headers"]).json()
    assert dre["status_completude"] == "parcial"
    assert dre["cobertura_cmv"]["itens_sem_custo"] == 1
    assert len(dre["lacunas"]) >= 2


def test_cenario_d_estorno_reverte_custo_historico_e_preserva_passado():
    ctx = _seed_tenant(98804)
    client = TestClient(app)
    hoje = datetime.date.today().isoformat()

    client.put(
        f"/b8/supply/fichas/produto/{ctx['prod_id']}",
        headers=ctx["headers"],
        json={"componentes": [{"insumo_id": ctx["ins_carne_id"], "quantidade": 1.0, "unidade_medida": "kg"}]},
    )

    token_var = current_restaurante_id.set(ctx["rid"])
    try:
        with SessionLocal() as db:
            from app.services.b8_supply import registrar_entrada_lote
            ins = db.get(Insumo, ctx["ins_carne_id"])
            registrar_entrada_lote(db, restaurante_id=ctx["rid"], insumo=ins, quantidade=5.0, custo_unitario=20.0, origem_tipo="entrada_manual")
            db.commit()

            _cmd1, item1 = _record_sale(db, rid=ctx["rid"], uid=ctx["uid"], prod_id=ctx["prod_id"], preco_unit=50.0)
            # Muda custo do insumo para 35.00 depois da venda 1 -> venda 1 deve manter custo histórico R$ 20,00!
            ins = db.get(Insumo, ctx["ins_carne_id"])
            registrar_entrada_lote(db, restaurante_id=ctx["rid"], insumo=ins, quantidade=10.0, custo_unitario=35.0, origem_tipo="entrada_manual")
            db.commit()

            # Estorna item1 -> devolve estoque e marca ItemCustoSnapshot.estornado = True
            estornar_estoque_dos_itens(db, [item1], usuario_id=ctx["uid"])
            db.commit()
    finally:
        current_restaurante_id.reset(token_var)

    dre = client.get(f"/b8/financeiro/dre?data_inicio={hoje}&data_fim={hoje}", headers=ctx["headers"]).json()
    assert dre["linhas"]["cmv"] == 0.0


def test_cenario_e_buffet_e_perdas_detalhadas():
    ctx = _seed_tenant(98805)
    client = TestClient(app)
    hoje = datetime.date.today().isoformat()

    r_buf = client.post(
        "/b8/supply/buffet-lotes",
        headers=ctx["headers"],
        json={
            "data_operacional": hoje,
            "nome_preparacao": "Feijoada Buffet",
            "unidade_medida": "kg",
            "quantidade_produzida": 20.0,
            "quantidade_reposicao": 5.0,
            "sobra": 2.0,
            "descarte": 1.0,
            "custo_lote": 250.0,
        },
    )
    assert r_buf.status_code == 201, r_buf.text
    assert r_buf.json()["custo_por_unidade"] == 10.0

    r_perda = client.post(
        "/b8/supply/perdas",
        headers=ctx["headers"],
        json={"insumo_id": ctx["ins_carne_id"], "quantidade": 1.5, "categoria_perda": "sobra_buffet"},
    )
    assert r_perda.status_code == 201, r_perda.text
    assert r_perda.json()["custo_desconhecido"] is True


def test_cenario_f_isolamento_multitenant_e_entitlements():
    ctx_a = _seed_tenant(98806, plano="pro")
    ctx_b = _seed_tenant(98807, plano="pro")
    ctx_pocket = _seed_tenant(98808, plano="pocket")
    client = TestClient(app)
    hoje = datetime.date.today().isoformat()

    # Pocket é bloqueado por entitlement (403)
    assert client.get("/b8/financeiro/dre", headers=ctx_pocket["headers"]).status_code == 403
    assert client.get("/b8/supply/lotes", headers=ctx_pocket["headers"]).status_code == 403

    # Tenant A cria Conta a Pagar; Tenant B não enxerga nem consegue baixar/cancelar
    setup_a = client.post("/b8/financeiro/setup/inicializar", headers=ctx_a["headers"]).json()
    cat_a = setup_a["categorias"][0]["id"]
    cp_a = client.post(
        "/b8/financeiro/contas-pagar",
        headers=ctx_a["headers"],
        json={
            "categoria_id": cat_a,
            "favorecido_nome": "Fornecedor A",
            "descricao": "Segredo Tenant A",
            "valor_original": 200.0,
            "data_emissao": hoje,
            "data_competencia": hoje,
            "primeiro_vencimento": hoje,
        },
    ).json()

    lista_b = client.get("/b8/financeiro/contas-pagar", headers=ctx_b["headers"]).json()
    assert all(item["id"] != cp_a["id"] for item in lista_b)

    cancel_cross = client.post(
        f"/b8/financeiro/contas-pagar/{cp_a['id']}/cancelar",
        headers=ctx_b["headers"],
        json={"motivo": "Invasão"},
    )
    assert cancel_cross.status_code == 400


def test_setup_get_readonly_dre_competencia_e_ordem_producao_campos():
    ctx = _seed_tenant(98809)
    client = TestClient(app)

    # 1. GET /b8/financeiro/setup é estritamente read-only em tenant novo (não cria registros)
    setup_empty = client.get("/b8/financeiro/setup", headers=ctx["headers"])
    assert setup_empty.status_code == 200
    assert setup_empty.json() == {"categorias": [], "contas": []}

    # Somente POST /setup/inicializar provisiona o plano de contas padrão
    setup_init = client.post("/b8/financeiro/setup/inicializar", headers=ctx["headers"])
    assert setup_init.status_code == 200
    assert len(setup_init.json()["categorias"]) > 0
    assert len(setup_init.json()["contas"]) > 0

    # 2. DRE por competência não usa max() com pagamento recebido em outro período
    ontem = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    hoje = datetime.date.today().isoformat()
    # Venda feita ontem (competência ontem), pagamento liquidado hoje
    db = SessionLocal()
    try:
        turno = CaixaTurno(restaurante_id=ctx["rid"], aberto_por_id=ctx["uid"], status="aberto", saldo_inicial=0.0)
        db.add(turno)
        db.flush()
        now = datetime.datetime.now(datetime.timezone.utc)
        yesterday_utc = now - datetime.timedelta(days=1)
        cmd = Comanda(
            id=f"cmd-comp-{uuid.uuid4().hex[:8]}",
            restaurante_id=ctx["rid"],
            garcom_id=ctx["uid"],
            tipo="Consumo no Local",
            numero_pedido=77,
            fechada=True,
            criado_em=yesterday_utc,
        )
        db.add(cmd)
        db.flush()
        lanc = Lancamento(
            id=f"lanc-comp-{uuid.uuid4().hex[:8]}",
            restaurante_id=ctx["rid"],
            comanda_id=cmd.id,
            garcom_id=ctx["uid"],
            status="finalizado",
            timestamp=yesterday_utc,
        )
        db.add(lanc)
        db.flush()
        db.add(
            Item(
                id=f"it-comp-{uuid.uuid4().hex[:8]}",
                restaurante_id=ctx["rid"],
                lancamento_id=lanc.id,
                comanda_id=cmd.id,
                produto_id=ctx["prod_id"],
                preco_unit=55.0,
                status="preparando",
            )
        )
        db.add(
            Pagamento(
                id=f"pag-comp-{uuid.uuid4().hex[:8]}",
                restaurante_id=ctx["rid"],
                comanda_id=cmd.id,
                turno_id=turno.id,
                valor=55.0,
                metodo="pix",
                status="aprovado",
                criado_em=now,
            )
        )
        db.commit()
    finally:
        db.close()

    dre_hoje = client.get(f"/b8/financeiro/dre?data_inicio={hoje}&data_fim={hoje}", headers=ctx["headers"]).json()
    assert dre_hoje["linhas"]["receita_vendas_operacionais"] == 0.0
    dre_ontem = client.get(f"/b8/financeiro/dre?data_inicio={ontem}&data_fim={ontem}", headers=ctx["headers"]).json()
    assert dre_ontem["linhas"]["receita_vendas_operacionais"] == 55.0

    # 3. Ordem de produção retorna custo_total_insumos, custo_unitario_produzido e concluida_em reais
    sr = client.post(
        "/b8/supply/sub-receitas",
        headers=ctx["headers"],
        json={
            "nome": "Massa Teste",
            "unidade_rendimento": "kg",
            "rendimento_esperado": 2.0,
            "ingredientes": [{"insumo_id": ctx["ins_carne_id"], "quantidade": 1.0, "unidade_medida": "kg"}],
        },
    ).json()
    op = client.post(
        "/b8/supply/ordens-producao",
        headers=ctx["headers"],
        json={"sub_receita_id": sr["id"], "quantidade_planejada": 2.0, "quantidade_produzida": 2.0},
    )
    assert op.status_code == 201, op.text
    op_list = client.get("/b8/supply/ordens-producao", headers=ctx["headers"]).json()
    assert len(op_list) == 1
    assert "custo_total_insumos" in op_list[0]
    assert "custo_unitario_produzido" in op_list[0]
    assert op_list[0]["concluida_em"] is not None
