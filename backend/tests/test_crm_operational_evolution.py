"""Testes de ponta a ponta para a evolução operacional do CRM do KÔMA."""

from __future__ import annotations

import datetime
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, current_restaurante_id, get_db
from app.financial_models import PagamentoEstorno
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Cliente,
    Comanda,
    ConfigFidelizacao,
    Cupom,
    Item,
    Lancamento,
    Mesa,
    Pagamento,
    Produto,
    Restaurante,
    Usuario,
)
from app.security import get_password_hash

SQLALCHEMY_DATABASE_URL = "sqlite://"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_database():
    token_var = current_restaurante_id.set(1)
    try:
        app.dependency_overrides[get_db] = override_get_db
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        db = TestingSessionLocal()

        r1 = db.query(Restaurante).filter(Restaurante.id == 1).first()
        if not r1:
            r1 = Restaurante(id=1, nome="Bistrô Kôma", plano="enterprise")
            db.add(r1)
        else:
            r1.plano = "enterprise"

        r2 = db.query(Restaurante).filter(Restaurante.id == 2).first()
        if not r2:
            r2 = Restaurante(id=2, nome="Outro Restaurante", plano="enterprise")
            db.add(r2)
        else:
            r2.plano = "enterprise"

        db.add_all(
            [
                Usuario(
                    id="user-caixa-1",
                    restaurante_id=1,
                    nome="Operador Caixa R1",
                    usuario="caixa_r1",
                    senha_hash=get_password_hash("senha123"),
                    role="caixa",
                    status="ativo",
                ),
                Usuario(
                    id="user-caixa-2",
                    restaurante_id=2,
                    nome="Operador Caixa R2",
                    usuario="caixa_r2",
                    senha_hash=get_password_hash("senha123"),
                    role="caixa",
                    status="ativo",
                ),
                Mesa(id=1, restaurante_id=1, capacidade=4),
                Mesa(id=2, restaurante_id=2, capacidade=4),
                CaixaTurno(
                    id=1,
                    restaurante_id=1,
                    aberto_por_id="user-caixa-1",
                    saldo_inicial=100.0,
                    status="aberto",
                ),
                ConfigFidelizacao(
                    restaurante_id=1,
                    ativo=True,
                    tipo_recompensa="PONTOS",
                    taxa_conversao=1.0,
                    valor_ponto_em_dinheiro=0.05,  # 20 pontos = R$ 1,00 (mínimo resgatável)
                ),
                ConfigFidelizacao(
                    restaurante_id=2,
                    ativo=True,
                    tipo_recompensa="PONTOS",
                    taxa_conversao=1.0,
                    valor_ponto_em_dinheiro=0.05,
                ),
                Categoria(id="cat-1", restaurante_id=1, nome="Pratos Principais"),
                Produto(
                    id="prod-risoto",
                    restaurante_id=1,
                    categoria_id="cat-1",
                    nome="Risoto de Camarão",
                    preco=68.0,
                ),
                Produto(
                    id="prod-nhoque",
                    restaurante_id=1,
                    categoria_id="cat-1",
                    nome="Nhoque Artesanal",
                    preco=54.0,
                ),
            ]
        )
        db.commit()
        db.close()
        yield
    finally:
        current_restaurante_id.reset(token_var)


def get_auth_headers(client: TestClient, username: str = "caixa_r1") -> dict[str, str]:
    resp = client.post(
        "/auth/login", json={"username": username, "password": "senha123"}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _seed_six_crm_personas(db, now_utc: datetime.datetime):
    """Cria os 6 perfis exigidos para validação do CRM operacional."""
    # 1. Cliente com uma compra elegível para segunda compra (comprou há 10 dias)
    c_second = Cliente(
        id="c-segunda-compra",
        restaurante_id=1,
        nome="Beatriz Segunda Compra",
        telefone="85999991001",
        saldo_pontos=10,  # R$ 0,50 -> acumula mas não resgata
    )
    # 2. Recorrente fora do intervalo habitual (3 compras a cada 10 dias, mas 25 dias sem comprar)
    c_cadence = Cliente(
        id="c-fora-ritmo",
        restaurante_id=1,
        nome="Rodrigo Recorrente",
        telefone="85999991002",
        saldo_pontos=15,
    )
    # 3. Cliente com pontos que ainda não permitem resgate vs. cliente com benefício resgatável
    c_low_points = Cliente(
        id="c-pontos-insuficientes",
        restaurante_id=1,
        nome="Camila Pontos em Acúmulo",
        telefone="85999991003",
        saldo_pontos=12,  # 12 * 0,05 = R$ 0,60 < R$ 1,00 mínimo resgatável
    )
    c_redeemable = Cliente(
        id="c-beneficio-resgatavel",
        restaurante_id=1,
        nome="Daniel Benefício Disponível",
        telefone="85999991004",
        saldo_pontos=120,  # 120 * 0,05 = R$ 6,00 >= R$ 1,00 resgatável
    )
    # 4. Cliente sem compra identificada
    c_no_purchase = Cliente(
        id="c-sem-compra",
        restaurante_id=1,
        nome="Fernanda Sem Compra",
        telefone="85999991005",
        saldo_pontos=0,
    )
    # 5. Cliente já abordado recentemente (há 2 dias)
    c_recent_contact = Cliente(
        id="c-abordado-recente",
        restaurante_id=1,
        nome="Gustavo Abordado Recente",
        telefone="85999991006",
        saldo_pontos=0,
    )
    db.add_all(
        [
            c_second,
            c_cadence,
            c_low_points,
            c_redeemable,
            c_no_purchase,
            c_recent_contact,
        ]
    )
    db.commit()

    # Comanda de Beatriz (1 compra há 10 dias)
    db.add(
        Comanda(
            id="com-second-1",
            restaurante_id=1,
            cliente_id=c_second.id,
            garcom_id="user-caixa-1",
            numero_pedido=1001,
            fechada=True,
            fechado_em=now_utc - datetime.timedelta(days=10),
            valor_pago=68.0,
        )
    )
    db.add(
        Lancamento(
            id="lanc-second-1",
            restaurante_id=1,
            comanda_id="com-second-1",
            garcom_id="user-caixa-1",
            status="finalizado",
        )
    )
    db.add(
        Item(
            id="item-second-1",
            restaurante_id=1,
            comanda_id="com-second-1",
            lancamento_id="lanc-second-1",
            produto_id="prod-risoto",
            preco_unit=68.0,
            status="entregue",
        )
    )

    # Comandas de Rodrigo (3 compras: há 45d, 35d, 25d -> intervalo médio = (45-25)/2 = 10d, dias sem comprar = 25d)
    for idx, days_ago in enumerate((45, 35, 25), start=1):
        cid = f"com-cadence-{idx}"
        db.add(
            Comanda(
                id=cid,
                restaurante_id=1,
                cliente_id=c_cadence.id,
                garcom_id="user-caixa-1",
                numero_pedido=1010 + idx,
                fechada=True,
                fechado_em=now_utc - datetime.timedelta(days=days_ago),
                valor_pago=54.0,
            )
        )
        db.add(
            Lancamento(
                id=f"lanc-{cid}",
                restaurante_id=1,
                comanda_id=cid,
                garcom_id="user-caixa-1",
                status="finalizado",
            )
        )
        db.add(
            Item(
                id=f"item-{cid}",
                restaurante_id=1,
                comanda_id=cid,
                lancamento_id=f"lanc-{cid}",
                produto_id="prod-nhoque",
                preco_unit=54.0,
                status="entregue",
            )
        )

    # Comanda de Camila (comprou há 15 dias, 2 compras recentes, mas só 12 pontos = R$ 0,60)
    for idx, days_ago in enumerate((25, 15), start=1):
        db.add(
            Comanda(
                id=f"com-low-{idx}",
                restaurante_id=1,
                cliente_id=c_low_points.id,
                garcom_id="user-caixa-1",
                numero_pedido=1020 + idx,
                fechada=True,
                fechado_em=now_utc - datetime.timedelta(days=days_ago),
                valor_pago=35.0,
            )
        )

    # Comandas de Daniel (benefício resgatável R$ 6,00, última compra há 16 dias)
    for idx, days_ago in enumerate((28, 16), start=1):
        db.add(
            Comanda(
                id=f"com-redeem-{idx}",
                restaurante_id=1,
                cliente_id=c_redeemable.id,
                garcom_id="user-caixa-1",
                numero_pedido=1030 + idx,
                fechada=True,
                fechado_em=now_utc - datetime.timedelta(days=days_ago),
                valor_pago=60.0,
            )
        )

    # Comanda de Gustavo (1 compra há 8 dias, mas já abordado há 2 dias)
    db.add(
        Comanda(
            id="com-recent-1",
            restaurante_id=1,
            cliente_id=c_recent_contact.id,
            garcom_id="user-caixa-1",
            numero_pedido=1040,
            fechada=True,
            fechado_em=now_utc - datetime.timedelta(days=8),
            valor_pago=50.0,
        )
    )
    db.commit()


def test_opportunities_eligibility_and_accumulated_vs_redeemable_benefit():
    """Valida elegibilidade das 5 oportunidades, saldo acumulado vs. resgatável e proteção de contato recente."""
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa_r1")
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    db = TestingSessionLocal()
    _seed_six_crm_personas(db, now_utc)
    db.close()

    # Registrar contato recente para Gustavo
    resp_contact = client.post(
        "/fidelidade/crm/contatos",
        headers=headers,
        json={
            "cliente_id": "c-abordado-recente",
            "objetivo": "SECOND_PURCHASE",
            "abordagem_tipo": "SEM_DESCONTO",
            "canal": "WHATSAPP_MANUAL",
            "acao_executada": "CONTATO_MANUAL_CONFIRMADO",
            "mensagem_personalizada": "Oi Gustavo, tudo bem?",
        },
    )
    assert resp_contact.status_code == 201, resp_contact.text

    # Consultar clientes enriquecidos
    resp_clients = client.get("/fidelidade/clientes", headers=headers)
    assert resp_clients.status_code == 200, resp_clients.text
    by_id = {c["id"]: c for c in resp_clients.json()}

    # Camila tem 12 pontos (R$ 0,60) -> SALDO_EM_FORMACAO, não resgatável
    b_low = by_id["c-pontos-insuficientes"]["beneficio_disponivel"]
    assert b_low["saldo_acumulado_pontos"] == 12
    assert b_low["valor_equivalente_pontos_brl"] == 0.60
    assert b_low["valor_resgatavel_brl"] == 0.0
    assert b_low["elegivel_resgate"] is False
    assert b_low["status_beneficio"] == "SALDO_EM_FORMACAO"
    assert b_low["pontos_faltantes_resgate"] == 8  # faltam 8 pontos para atingir 20 (R$ 1,00)

    # Daniel tem 120 pontos (R$ 6,00) -> RESGATAVEL
    b_red = by_id["c-beneficio-resgatavel"]["beneficio_disponivel"]
    assert b_red["saldo_acumulado_pontos"] == 120
    assert b_red["valor_resgatavel_brl"] == 6.00
    assert b_red["elegivel_resgate"] is True
    assert b_red["status_beneficio"] == "RESGATAVEL"

    # Fernanda não tem compras -> SEM_COMPRA, nunca carrinho abandonado
    assert by_id["c-sem-compra"]["pedidos_concluidos"] == 0
    assert by_id["c-sem-compra"]["segmento_relacionamento"] == "SEM_COMPRA"

    # Gustavo está protegido por contato recente
    assert by_id["c-abordado-recente"]["contato_recente"] is True

    # Consultar oportunidades no resumo do CRM
    resp_summary = client.get("/fidelidade/crm/resumo", headers=headers)
    assert resp_summary.status_code == 200, resp_summary.text
    summary = resp_summary.json()
    opps = {o["id"]: o for o in summary["oportunidades"]}

    # 1. Segunda compra: Beatriz entra; Gustavo fica retido por contato recente; Fernanda (0 compras) não entra
    assert "c-segunda-compra" in opps["SECOND_PURCHASE"]["elegiveis_cliente_ids"]
    assert "c-abordado-recente" not in opps["SECOND_PURCHASE"]["elegiveis_cliente_ids"]
    assert opps["SECOND_PURCHASE"]["retidos_contato_recente_count"] >= 1
    assert "c-sem-compra" not in opps["SECOND_PURCHASE"]["elegiveis_cliente_ids"]

    # 2. Recuperação de recorrentes fora do ritmo: Rodrigo entra
    assert "c-fora-ritmo" in opps["CADENCE_RECOVERY"]["elegiveis_cliente_ids"]

    # 3. Lembrança de benefício: Daniel entra, Camila (abaixo do mínimo) NÃO entra
    assert "c-beneficio-resgatavel" in opps["BENEFIT_REMINDER"]["elegiveis_cliente_ids"]
    assert "c-pontos-insuficientes" not in opps["BENEFIT_REMINDER"]["elegiveis_cliente_ids"]

    # 4. Ocorrência: sem avaliações <= 2, disponível_com_dados_atuais é False (honesto)
    assert opps["OCCURRENCE_RECOVERY"]["elegiveis_count"] == 0
    assert opps["OCCURRENCE_RECOVERY"]["disponivel_com_dados_atuais"] is False


def test_cancellations_and_refunds_do_not_inflate_crm_or_campaign_results():
    """Pedidos cancelados ou 100% estornados não entram na elegibilidade nem nos resultados de campanha."""
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa_r1")
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    db = TestingSessionLocal()
    c = Cliente(
        id="c-estorno-teste",
        restaurante_id=1,
        nome="Marcos Estorno",
        telefone="85999992001",
    )
    cupom = Cupom(
        id="cup-volta10",
        restaurante_id=1,
        codigo="VOLTA10",
        tipo_desconto="fixo",
        valor_desconto=10.0,
        valor_minimo_pedido=40.0,
        ativo=True,
    )
    db.add_all([c, cupom])
    db.commit()

    # 1ª compra válida há 10 dias (R$ 80)
    db.add(
        Comanda(
            id="com-valida-1",
            restaurante_id=1,
            cliente_id=c.id,
            garcom_id="user-caixa-1",
            numero_pedido=2001,
            fechada=True,
            fechado_em=now_utc - datetime.timedelta(days=10),
            valor_pago=80.0,
        )
    )
    db.commit()
    db.close()

    # Criar campanha com cupom VOLTA10 e registrar abordagem
    resp_camp = client.post(
        "/fidelidade/crm/campanhas",
        headers=headers,
        json={
            "nome": "Segunda Compra Outubro",
            "objetivo": "SECOND_PURCHASE",
            "segmento_filtro": "SECOND_PURCHASE",
            "abordagem_tipo": "CUPOM",
            "cupom_id": "cup-volta10",
            "template_mensagem": "Oi {nome}, use o cupom VOLTA10 no seu próximo pedido!",
            "janela_atribuicao_dias": 14,
        },
    )
    assert resp_camp.status_code == 201, resp_camp.text
    camp_id = resp_camp.json()["id"]

    resp_ct = client.post(
        "/fidelidade/crm/contatos",
        headers=headers,
        json={
            "cliente_id": "c-estorno-teste",
            "campanha_id": camp_id,
            "objetivo": "SECOND_PURCHASE",
            "abordagem_tipo": "CUPOM",
            "cupom_id": "cup-volta10",
            "canal": "WHATSAPP_MANUAL",
            "acao_executada": "CONTATO_MANUAL_CONFIRMADO",
        },
    )
    assert resp_ct.status_code == 201, resp_ct.text

    # Agora simular:
    # Pedido A (após o contato): fechado, mas com lançamento CANCELADO (não deve contar no resultado!)
    # Pedido B (após o contato): fechado, mas 100% ESTORNADO (não deve contar no resultado!)
    db = TestingSessionLocal()
    db.add(
        Comanda(
            id="com-cancelada-pos-contato",
            restaurante_id=1,
            cliente_id="c-estorno-teste",
            garcom_id="user-caixa-1",
            numero_pedido=2002,
            fechada=True,
            fechado_em=now_utc + datetime.timedelta(minutes=10),
            valor_pago=90.0,
            cupom_id="cup-volta10",
            valor_desconto_cupom=10.0,
        )
    )
    db.add(
        Lancamento(
            id="lanc-cancelado-2002",
            restaurante_id=1,
            comanda_id="com-cancelada-pos-contato",
            garcom_id="user-caixa-1",
            status="cancelado",
        )
    )

    db.add(
        Comanda(
            id="com-estornada-pos-contato",
            restaurante_id=1,
            cliente_id="c-estorno-teste",
            garcom_id="user-caixa-1",
            numero_pedido=2003,
            fechada=True,
            fechado_em=now_utc + datetime.timedelta(minutes=20),
            valor_pago=75.0,
            cupom_id="cup-volta10",
            valor_desconto_cupom=10.0,
        )
    )
    db.add(
        Pagamento(
            id="pag-2003",
            restaurante_id=1,
            comanda_id="com-estornada-pos-contato",
            turno_id=1,
            cliente_id="c-estorno-teste",
            valor=75.0,
            metodo="pix",
        )
    )
    db.flush()
    db.add(
        PagamentoEstorno(
            id="est-2003",
            restaurante_id=1,
            pagamento_id="pag-2003",
            turno_id=1,
            valor=75.0,
            metodo="pix",
            motivo="Estorno integral solicitado",
            idempotency_key="idem-est-2003",
        )
    )
    db.commit()
    db.close()

    # Consultar resultados: pedidos cancelados/estornados NÃO entram como retorno comprovado
    resp_res = client.get("/fidelidade/crm/resumo", headers=headers)
    assert resp_res.status_code == 200
    res = resp_res.json()["resultados"]
    assert res["pedidos_associados"]["total"] == 0
    assert res["pedidos_associados"]["pedidos_cancelados_excluidos"] == 2
    assert res["retorno_apos_abordagem"]["clientes_que_voltaram"] == 0
    assert res["valor_pago_pedidos_associados"]["total_liquido_brl"] == 0.0

    # Consultar ficha individual: mostra claramente os pedidos excluídos e o motivo
    resp_prof = client.get(
        "/fidelidade/clientes/c-estorno-teste/perfil", headers=headers
    )
    assert resp_prof.status_code == 200
    prof = resp_prof.json()
    assert prof["comportamento_observado"]["pedidos_concluidos"] == 1
    assert prof["comportamento_observado"]["pedidos_cancelados_ou_estornados"] == 2

    # Agora adicionar um pedido VÁLIDO com estorno parcial (R$ 100 pago - R$ 20 estorno = R$ 80 líquido)
    db = TestingSessionLocal()
    db.add(
        Comanda(
            id="com-valida-pos-contato",
            restaurante_id=1,
            cliente_id="c-estorno-teste",
            garcom_id="user-caixa-1",
            numero_pedido=2004,
            fechada=True,
            fechado_em=now_utc + datetime.timedelta(minutes=30),
            valor_pago=100.0,
            cupom_id="cup-volta10",
            valor_desconto_cupom=10.0,
        )
    )
    db.add(
        Pagamento(
            id="pag-2004",
            restaurante_id=1,
            comanda_id="com-valida-pos-contato",
            turno_id=1,
            cliente_id="c-estorno-teste",
            valor=100.0,
            metodo="cartao_credito",
        )
    )
    db.flush()
    db.add(
        PagamentoEstorno(
            id="est-parcial-2004",
            restaurante_id=1,
            pagamento_id="pag-2004",
            turno_id=1,
            valor=20.0,
            metodo="cartao_credito",
            motivo="Estorno parcial de bebida",
            idempotency_key="idem-est-2004",
        )
    )
    db.commit()
    db.close()

    resp_res2 = client.get("/fidelidade/crm/resumo", headers=headers)
    res2 = resp_res2.json()["resultados"]
    assert res2["pedidos_associados"]["comprovados_por_cupom"] == 1
    assert res2["retorno_apos_abordagem"]["clientes_que_voltaram"] == 1
    assert res2["valor_pago_pedidos_associados"]["comprovado_cupom_brl"] == 80.0
    assert res2["descontos_efetivamente_utilizados"]["cupom_brl"] == 10.0


def test_safeguards_opt_out_recent_contact_invalid_phone_and_unavailable_coupon():
    """Testa bloqueios operacionais: cupom inativo/expirado, telefone inválido, opt-out e contato recente."""
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa_r1")
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    db = TestingSessionLocal()
    db.add_all(
        [
            Cliente(
                id="c-tel-invalido",
                restaurante_id=1,
                nome="Cliente Sem DDD",
                telefone="12345",
            ),
            Cliente(
                id="c-opt-out",
                restaurante_id=1,
                nome="Cliente OptOut",
                telefone="85988887777",
            ),
            Cupom(
                id="cup-inativo",
                restaurante_id=1,
                codigo="INATIVO10",
                tipo_desconto="porcentagem",
                valor_desconto=10.0,
                ativo=False,
            ),
            Cupom(
                id="cup-esgotado",
                restaurante_id=1,
                codigo="ESGOTADO",
                tipo_desconto="fixo",
                valor_desconto=15.0,
                ativo=True,
                limite_usos=5,
                usos_atuais=5,
            ),
            Cupom(
                id="cup-expirado",
                restaurante_id=1,
                codigo="EXPIRADO",
                tipo_desconto="fixo",
                valor_desconto=15.0,
                ativo=True,
                valido_ate=now_utc - datetime.timedelta(days=1),
            ),
        ]
    )
    db.commit()
    db.close()

    # 1. Cupom inativo/esgotado/expirado deve ser recusado ao criar campanha
    for bad_cupom_id in ("cup-inativo", "cup-esgotado", "cup-expirado"):
        r_bad = client.post(
            "/fidelidade/crm/campanhas",
            headers=headers,
            json={
                "nome": "Campanha Inválida",
                "objetivo": "SECOND_PURCHASE",
                "segmento_filtro": "SECOND_PURCHASE",
                "abordagem_tipo": "CUPOM",
                "cupom_id": bad_cupom_id,
                "template_mensagem": "Mensagem de teste válida para campanha.",
            },
        )
        assert r_bad.status_code == 409, r_bad.text

    # 2. Telefone inválido para abrir WhatsApp deve retornar 422
    r_phone = client.post(
        "/fidelidade/crm/contatos",
        headers=headers,
        json={
            "cliente_id": "c-tel-invalido",
            "objetivo": "SECOND_PURCHASE",
            "abordagem_tipo": "SEM_DESCONTO",
            "canal": "WHATSAPP_MANUAL",
            "acao_executada": "WHATSAPP_ABERTO",
        },
    )
    assert r_phone.status_code == 422

    # 3. Ativar opt-out para c-opt-out e tentar registrar abordagem -> 409
    r_pref = client.put(
        "/fidelidade/clientes/c-opt-out/preferencias",
        headers=headers,
        json={
            "opt_out_marketing": True,
            "motivo_opt_out": "Solicitou não receber mensagens no WhatsApp",
            "canal_preferido": "presencial",
            "observacoes_declaradas": "Prefere mesa próxima à janela",
        },
    )
    assert r_pref.status_code == 200
    assert r_pref.json()["opt_out_marketing"] is True

    r_blocked_optout = client.post(
        "/fidelidade/crm/contatos",
        headers=headers,
        json={
            "cliente_id": "c-opt-out",
            "objetivo": "SECOND_PURCHASE",
            "abordagem_tipo": "SEM_DESCONTO",
            "canal": "WHATSAPP_MANUAL",
            "acao_executada": "CONTATO_MANUAL_CONFIRMADO",
        },
    )
    assert r_blocked_optout.status_code == 409

    # 4. Cooldown de contato recente (7 dias): segundo contato seguido bloqueia com 409
    db = TestingSessionLocal()
    db.add(
        Cliente(
            id="c-cooldown",
            restaurante_id=1,
            nome="Cliente Cooldown",
            telefone="85988886666",
        )
    )
    db.commit()
    db.close()

    r_first = client.post(
        "/fidelidade/crm/contatos",
        headers=headers,
        json={
            "cliente_id": "c-cooldown",
            "objetivo": "SECOND_PURCHASE",
            "abordagem_tipo": "SEM_DESCONTO",
            "canal": "WHATSAPP_MANUAL",
            "acao_executada": "CONTATO_MANUAL_CONFIRMADO",
        },
    )
    assert r_first.status_code == 201

    r_second = client.post(
        "/fidelidade/crm/contatos",
        headers=headers,
        json={
            "cliente_id": "c-cooldown",
            "objetivo": "SECOND_PURCHASE",
            "abordagem_tipo": "SEM_DESCONTO",
            "canal": "WHATSAPP_MANUAL",
            "acao_executada": "CONTATO_MANUAL_CONFIRMADO",
        },
    )
    assert r_second.status_code == 409


def test_multitenant_isolation_and_unmeasured_results_honesty():
    """Garante isolamento estrito entre restaurantes e status NAO_MENSURADO quando não há histórico."""
    client = TestClient(app)
    headers_r2 = get_auth_headers(client, "caixa_r2")

    # Sem campanhas nem contatos no R2 -> resultados mostram NAO_MENSURADO (não zero falso)
    resp_r2_empty = client.get("/fidelidade/crm/resumo", headers=headers_r2)
    assert resp_r2_empty.status_code == 200
    res_r2 = resp_r2_empty.json()["resultados"]
    assert res_r2["retorno_apos_abordagem"]["status_mensuracao"] == "NAO_MENSURADO"
    assert res_r2["pedidos_associados"]["status_mensuracao"] == "NAO_MENSURADO"
    assert res_r2["retorno_apos_abordagem"]["clientes_que_voltaram"] is None
    assert res_r2["pedidos_associados"]["total"] is None

    # Criar cliente e campanha no R1 e verificar que R2 recebe 404 ao tentar acessar ou abordar
    db = TestingSessionLocal()
    db.add(
        Cliente(
            id="c-only-r1",
            restaurante_id=1,
            nome="Exclusivo R1",
            telefone="85988885555",
        )
    )
    db.commit()
    db.close()

    assert (
        client.get("/fidelidade/clientes/c-only-r1/perfil", headers=headers_r2).status_code
        == 404
    )
    assert (
        client.put(
            "/fidelidade/clientes/c-only-r1/preferencias",
            headers=headers_r2,
            json={"opt_out_marketing": True},
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/fidelidade/crm/contatos",
            headers=headers_r2,
            json={
                "cliente_id": "c-only-r1",
                "objetivo": "SECOND_PURCHASE",
                "abordagem_tipo": "SEM_DESCONTO",
                "canal": "WHATSAPP_MANUAL",
                "acao_executada": "CONTATO_MANUAL_CONFIRMADO",
            },
        ).status_code
        == 404
    )
