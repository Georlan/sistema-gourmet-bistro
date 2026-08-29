import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.models import (
    Restaurante,
    Categoria,
    Produto,
    Usuario,
    Mesa,
    PrintJob,
    Comanda,
    Cliente,
    OtpChallenge,
    CaixaTurno,
    Item,
    ActivityLog,
)
from app.security import create_access_token
from app.services.customer_auth import create_customer_access_token

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_cardapio_data():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token_var = current_restaurante_id.set(100)
    try:
        # Create test restaurant 100
        rest = db.query(Restaurante).filter(Restaurante.id == 100).first()
        if not rest:
            rest = Restaurante(
                id=100,
                nome="Bistro Teste Cardapio",
                plano="pro",
                slug="bistro-teste-cardapio",
                subtitulo="O melhor sabor da cidade",
                cor_primaria="#ff9900",
                cor_fundo="#111111",
                endereco="Rua Teste 100"
            )
            db.add(rest)
            db.commit()
        elif rest.plano != "pro":
            rest.plano = "pro"
            db.commit()

        # Create Mesa 1 for restaurant 100
        mesa = db.query(Mesa).filter(Mesa.restaurante_id == 100, Mesa.id == 1).first()
        if not mesa:
            mesa = Mesa(id=1, capacidade=4, nome="Mesa 1", restaurante_id=100)
            db.add(mesa)
            db.commit()

        # Create user for restaurant 100
        user = db.query(Usuario).filter(Usuario.email == "cardapio100@koma.com").first()
        if not user:
            user = Usuario(
                id="usr_cardapio_100",
                nome="Garcom Cardapio 100",
                email="cardapio100@koma.com",
                cargo="admin",
                role="admin",
                status="ativo",
                restaurante_id=100
            )
            db.add(user)
            db.commit()

        turno_aberto = db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == 100,
            CaixaTurno.status == "aberto",
        ).first()
        if turno_aberto is None:
            db.add(CaixaTurno(
                restaurante_id=100,
                aberto_por_id="usr_cardapio_100",
                saldo_inicial=0,
                status="aberto",
            ))
            db.commit()

        # Create category for restaurant 100
        cat = db.query(Categoria).filter(Categoria.restaurante_id == 100, Categoria.nome == "Hambúrgueres Teste").first()
        if not cat:
            cat = Categoria(
                id="cat-cardapio-test",
                nome="Hambúrgueres Teste",
                restaurante_id=100
            )
            db.add(cat)
            db.commit()

        # Create active product for restaurant 100
        prod = db.query(Produto).filter(Produto.restaurante_id == 100, Produto.nome == "Burguer Especial Teste").first()
        if not prod:
            prod = Produto(
                id="prod-cardapio-test",
                nome="Burguer Especial Teste",
                preco=25.0,
                descricao="Ingredientes selecionados",
                ativo=True,
                categoria_id="cat-cardapio-test",
                restaurante_id=100
            )
            db.add(prod)
            db.commit()

        yield
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_cardapio_digital_config_loading():
    """1. Cardápio Digital: Carregar configurações whitelabel do restaurante."""
    response = client.get("/api/cardapio-digital/config?restaurante_id=100")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 100
    assert data["nome"] == "Bistro Teste Cardapio"
    assert data["cor_primaria"] == "#ff9900"
    assert data["endereco"] == "Rua Teste 100"


def test_cardapio_digital_categorias_listing():
    """2. Cardápio Digital: Listar categorias ativas do restaurante."""
    response = client.get("/api/cardapio-digital/categorias?restaurante_id=100")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert any(c["nome"] == "Hambúrgueres Teste" for c in data)


def test_cardapio_digital_produtos_listing():
    """3. Cardápio Digital: Listar produtos ativos do restaurante."""
    response = client.get("/api/cardapio-digital/produtos?restaurante_id=100")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert any(p["nome"] == "Burguer Especial Teste" for p in data)
    for p in data:
        assert p["ativo"] is True


def test_caixa_venda_direta_mesa():
    """4. Caixa: criar pedido manual de mesa."""
    token = create_access_token(subject="usr_cardapio_100", restaurante_id=100, role="admin")
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "restaurante_id": 100,
        "mesa_id": 1,
        "garcom_id": "usr_cardapio_100",
        "tipo": "Consumo no Local",
        "itens": [
            {
                "produto_id": "prod-cardapio-test",
                "quantidade": 1,
                "preco_unitario": 25.0,
                "observacao": "Sem cebola"
            }
        ]
    }
    response = client.post("/comandas/venda-direta", json=payload, headers=headers)
    assert response.status_code in (200, 201)
    data = response.json()
    assert "id" in data or "numero_pedido" in data
    assert data["tipo"] == "Consumo no Local"
    assert data["mesa_id"] == 1
    assert data["delivery_status"] is None

    db = SessionLocal()
    try:
        print_job = db.query(PrintJob).filter(
            PrintJob.restaurante_id == 100,
            PrintJob.source_type == "pedido",
            PrintJob.source_id == data["id"],
        ).one()
        assert print_job.status == "pending"
    finally:
        db.close()


@pytest.mark.parametrize(
    ("tipo", "identificador", "telefone", "endereco"),
    [
        ("Entrega", "Cliente Delivery", "(81) 99999-0003", "Rua Manual, 123"),
        ("Retirada", "Cliente Retirada", "81999990004", None),
    ],
)
def test_caixa_venda_direta_nao_passa_pela_gaveta_online(
    tipo,
    identificador,
    telefone,
    endereco,
):
    """Delivery e retirada digitados pelo caixa já entram aceitos em produção."""
    token = create_access_token(subject="usr_cardapio_100", restaurante_id=100, role="admin")
    payload = {
        "mesa_id": None,
        "garcom_id": "usr_cardapio_100",
        "tipo": tipo,
        "identificador": identificador,
        "delivery_telefone": telefone,
        "delivery_endereco": endereco,
        "delivery_taxa": 8.0 if tipo == "Entrega" else 0.0,
        "itens": [
            {
                "produto_id": "prod-cardapio-test",
                "observacao": "",
                "cliente_nome": identificador,
            }
        ],
    }

    response = client.post(
        "/comandas/venda-direta",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    data = response.json()
    assert data["tipo"] == tipo
    assert data["mesa_id"] is None
    assert data["delivery_status"] == "producao"

    db = SessionLocal()
    token_var = current_restaurante_id.set(100)
    try:
        cliente = db.query(Cliente).filter(
            Cliente.restaurante_id == 100,
            Cliente.telefone == "".join(c for c in telefone if c.isdigit()),
        ).one()
        assert cliente.nome == identificador
        assert cliente.endereco == endereco
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_pedido_digital_sem_otp_nao_se_apropria_de_cadastro():
    telefone_formatado = "(81) 98888-7711"
    telefone_normalizado = "81988887711"

    primeiro = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": 100,
            "itens": [{
                "produto_id": "prod-cardapio-test",
                "quantidade": 1,
                "observacao": "Primeira compra",
            }],
            "cliente_nome": "Cliente Inicial",
            "cliente_telefone": telefone_formatado,
            "endereco_entrega": "Rua Inicial, 10",
            "taxa_entrega": 5,
            "forma_pagamento": "na_entrega",
            "tipo_pedido": "delivery",
            "idempotency_key": "cliente-auto-primeiro",
        },
    )
    assert primeiro.status_code == 201

    db = SessionLocal()
    token_var = current_restaurante_id.set(100)
    try:
        clientes = db.query(Cliente).filter(
            Cliente.restaurante_id == 100,
            Cliente.telefone == telefone_normalizado,
        ).all()
        assert clientes == []
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_cliente_do_caixa_faz_login_otp_e_pedido_vincula_mesmo_id(monkeypatch):
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    telefone = "81977776666"
    staff_token = create_access_token(
        subject="usr_cardapio_100",
        restaurante_id=100,
        role="admin",
    )
    staff_headers = {"Authorization": f"Bearer {staff_token}"}

    criado = client.post(
        "/fidelidade/clientes",
        json={
            "cliente": "Cliente do Caixa",
            "telefone": telefone,
            "saldo_pontos": 12,
        },
        headers=staff_headers,
    )
    assert criado.status_code == 201
    cliente_id = criado.json()["id"]

    monkeypatch.setattr(
        "app.routes.cardapio_clientes.generate_otp",
        lambda: "246810",
    )
    monkeypatch.setattr(
        "app.routes.cardapio_clientes.enviar_codigo_otp_whatsapp",
        lambda _telefone, _codigo: True,
    )

    solicitado = client.post(
        "/cardapio/clientes/otp/solicitar",
        json={"restaurante_id": 100, "telefone": "(81) 97777-6666"},
    )
    assert solicitado.status_code == 202

    login = client.post(
        "/cardapio/clientes/otp/verificar",
        json={
            "restaurante_id": 100,
            "telefone": telefone,
            "codigo": "246810",
            "nome": "Cliente do Caixa",
            "endereco": "",
        },
    )
    assert login.status_code == 200
    sessao = login.json()
    assert sessao["cliente"]["id"] == cliente_id
    assert sessao["cliente"]["saldo_pontos"] == 12

    pedido = client.post(
        "/cardapio/pedidos",
        headers={"X-Koma-Customer-Token": sessao["access_token"]},
        json={
            "restaurante_id": 100,
            "itens": [{
                "produto_id": "prod-cardapio-test",
                "quantidade": 1,
                "observacao": "Pedido autenticado",
            }],
            # O backend ignora snapshots manipulados e usa a ficha verificada.
            "cliente_nome": "Outro Nome",
            "cliente_telefone": "81911112222",
            "endereco_entrega": "Rua OTP, 20",
            "taxa_entrega": 6,
            "forma_pagamento": "na_entrega",
            "tipo_pedido": "delivery",
            "idempotency_key": "cliente-otp-vinculo-estavel",
        },
    )
    assert pedido.status_code == 201

    db = SessionLocal()
    token_var = current_restaurante_id.set(100)
    try:
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == 100,
            Comanda.id == pedido.json()["comanda_id"],
        ).one()
        assert comanda.cliente_id == cliente_id
        assert comanda.delivery_telefone == telefone
        assert db.query(Cliente).filter(
            Cliente.restaurante_id == 100,
            Cliente.telefone == telefone,
        ).count() == 1
        assert db.query(Cliente).filter(
            Cliente.restaurante_id == 100,
            Cliente.telefone == "81911112222",
        ).count() == 0
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    duplicado_manual = client.post(
        "/fidelidade/clientes",
        headers=staff_headers,
        json={
            "cliente": "Não deve duplicar",
            "telefone": "(81) 97777-6666",
            "saldo_pontos": 0,
            "saldo_cashback": 0,
        },
    )
    assert duplicado_manual.status_code == 400

    atualizado_manual = client.put(
        f"/fidelidade/clientes/{cliente_id}",
        headers=staff_headers,
        json={
            "cliente": "Cliente Editado no CRM",
            "telefone": "(81) 97777-6667",
        },
    )
    assert atualizado_manual.status_code == 200

    lista_atualizada = client.get(
        "/fidelidade/clientes",
        headers=staff_headers,
    )
    assert lista_atualizada.status_code == 200
    assert any(
        item["id"] == cliente_id
        and item["telefone"] == "81977776667"
        and item["cliente"] == "Cliente Editado no CRM"
        for item in lista_atualizada.json()
    )


def test_otp_nao_persiste_codigo_ou_telefone_e_bloqueia_forca_bruta(monkeypatch):
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    telefone = "81960000001"
    codigo = "135790"
    monkeypatch.setattr(
        "app.routes.cardapio_clientes.generate_otp",
        lambda: codigo,
    )
    monkeypatch.setattr(
        "app.routes.cardapio_clientes.enviar_codigo_otp_whatsapp",
        lambda _telefone, _codigo: True,
    )

    solicitado = client.post(
        "/cardapio/clientes/otp/solicitar",
        json={"restaurante_id": 100, "telefone": telefone},
    )
    assert solicitado.status_code == 202

    db = SessionLocal()
    token_var = current_restaurante_id.set(100)
    try:
        challenge = db.query(OtpChallenge).filter(
            OtpChallenge.restaurante_id == 100,
        ).order_by(OtpChallenge.id.desc()).first()
        assert challenge is not None
        assert challenge.telefone_hash != telefone
        assert challenge.otp_hash != codigo
        assert len(challenge.telefone_hash) == 64
        assert len(challenge.otp_hash) == 64
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    payload_invalido = {
        "restaurante_id": 100,
        "telefone": telefone,
        "codigo": "000000",
        "nome": "Cliente Protegido",
        "endereco": "",
    }
    for _ in range(5):
        resposta = client.post(
            "/cardapio/clientes/otp/verificar",
            json=payload_invalido,
        )
        assert resposta.status_code == 400
        assert resposta.json()["detail"] == (
            "Código inválido ou expirado. Solicite um novo código."
        )

    resposta_apos_bloqueio = client.post(
        "/cardapio/clientes/otp/verificar",
        json={**payload_invalido, "codigo": codigo},
    )
    assert resposta_apos_bloqueio.status_code == 400


def test_sessao_de_funcionario_nao_e_sessao_de_cliente():
    staff_token = create_access_token(
        subject="usr_cardapio_100",
        restaurante_id=100,
        role="admin",
    )

    response = client.get(
        "/cardapio/clientes/me",
        headers={"X-Koma-Customer-Token": staff_token},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Tipo de sessão inválido."


def test_sessao_de_cliente_nao_cruza_restaurantes():
    outro_restaurante_id = 101
    db = SessionLocal()
    token_var = current_restaurante_id.set(outro_restaurante_id)
    try:
        if db.query(Restaurante).filter(
            Restaurante.id == outro_restaurante_id,
        ).first() is None:
            db.add(Restaurante(
                id=outro_restaurante_id,
                nome="Outro Restaurante",
                plano="pro",
                slug="outro-restaurante-customer-test",
            ))
            db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    customer_token = create_customer_access_token(
        cliente_id="cliente-do-restaurante-100",
        restaurante_id=100,
    )
    response = client.post(
        "/cardapio/pedidos",
        headers={"X-Koma-Customer-Token": customer_token},
        json={
            "restaurante_id": outro_restaurante_id,
            "itens": [{
                "produto_id": "produto-qualquer",
                "quantidade": 1,
                "observacao": "",
            }],
            "cliente_nome": "Cliente Manipulado",
            "cliente_telefone": "81960000002",
            "endereco_entrega": "",
            "taxa_entrega": 0,
            "forma_pagamento": "na_entrega",
            "tipo_pedido": "retirada",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == (
        "Sessão não pertence a este restaurante."
    )


def test_caixa_delivery_manual_exige_dados_de_entrega():
    token = create_access_token(subject="usr_cardapio_100", restaurante_id=100, role="admin")
    response = client.post(
        "/comandas/venda-direta",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "tipo": "Entrega",
            "identificador": "Cliente sem endereço",
            "delivery_telefone": "81999990005",
            "itens": [{"produto_id": "prod-cardapio-test"}],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Informe o endereço de entrega."


@pytest.mark.parametrize(
    (
        "tipo_pedido",
        "endereco",
        "forma_pagamento",
        "tipo_esperado",
        "endereco_esperado",
        "taxa_esperada",
    ),
    [
        ("delivery", "Rua das Flores, 123", "na_entrega", "Delivery", "Rua das Flores, 123", 7.0),
        ("retirada", "Retirada no Balcão", "na_entrega", "Retirada", None, 0.0),
    ],
)
def test_pedido_online_preserva_modalidade_no_kanban(
    tipo_pedido,
    endereco,
    forma_pagamento,
    tipo_esperado,
    endereco_esperado,
    taxa_esperada,
):
    """Pedidos digitais chegam à gaveta com a modalidade correta."""
    payload = {
        "restaurante_id": 100,
        "itens": [
            {
                "produto_id": "prod-cardapio-test",
                "quantidade": 2,
                "observacao": "Sem cebola",
            }
        ],
        "cliente_nome": f"Cliente {tipo_pedido}",
        "cliente_telefone": "81999990000" if tipo_pedido == "delivery" else "81999990001",
        "endereco_entrega": endereco,
        "taxa_entrega": 8.0,
        "forma_pagamento": forma_pagamento,
        "tipo_pedido": tipo_pedido,
    }

    response = client.post("/cardapio/pedidos", json=payload)
    assert response.status_code == 201
    assert response.json()["pagamento"] == {
        "status": "pendente_no_atendimento",
        "cobranca_online": False,
    }
    assert "pixCode" not in response.json()
    assert "orderId" not in response.json()
    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(Comanda.id == response.json()["comanda_id"]).one()
        assert comanda.tipo == tipo_esperado
        assert comanda.delivery_status == "pendente"
        assert comanda.delivery_endereco == endereco_esperado
        assert comanda.delivery_taxa == taxa_esperada
        assert comanda.status_comanda is None
        assert len(comanda.itens) == 2
    finally:
        db.close()


@pytest.mark.parametrize("forma_pagamento", ["Pix", "PIX", "Cartão de Crédito", "Dinheiro"])
def test_pedido_online_rejeita_cobranca_nao_integrada(forma_pagamento):
    """O cardápio não pode fingir que criou uma cobrança sem gateway homologado."""
    db = SessionLocal()
    try:
        comandas_antes = db.query(Comanda).filter(Comanda.restaurante_id == 100).count()
    finally:
        db.close()

    response = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": 100,
            "itens": [
                {
                    "produto_id": "prod-cardapio-test",
                    "quantidade": 1,
                    "observacao": "",
                }
            ],
            "cliente_nome": "Cliente pagamento",
            "cliente_telefone": "81999990006",
            "endereco_entrega": "",
            "taxa_entrega": 0,
            "forma_pagamento": forma_pagamento,
            "tipo_pedido": "retirada",
        },
    )

    assert response.status_code == 422

    db = SessionLocal()
    try:
        comandas_depois = db.query(Comanda).filter(Comanda.restaurante_id == 100).count()
        assert comandas_depois == comandas_antes
    finally:
        db.close()


def test_pedido_online_rejeita_restaurante_inexistente_sem_erro_500():
    response = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": 999999,
            "itens": [
                {
                    "produto_id": "produto-inexistente",
                    "quantidade": 1,
                    "observacao": "",
                }
            ],
            "cliente_nome": "Cliente inexistente",
            "cliente_telefone": "81999990007",
            "endereco_entrega": "",
            "taxa_entrega": 0,
            "forma_pagamento": "na_entrega",
            "tipo_pedido": "retirada",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Restaurante não encontrado."


def test_pedido_online_nao_inventa_usuario_para_tenant_sem_equipe():
    restaurant_id = 909001
    db = SessionLocal()
    token = current_restaurante_id.set(restaurant_id)
    try:
        restaurant = db.query(Restaurante).filter(
            Restaurante.id == restaurant_id
        ).first()
        if not restaurant:
            db.add(Restaurante(
                id=restaurant_id,
                nome="Restaurante sem equipe",
                plano="pocket",
                slug="restaurante-sem-equipe",
            ))
            db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(token)

    response = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": restaurant_id,
            "itens": [
                {
                    "produto_id": "produto-inexistente",
                    "quantidade": 1,
                    "observacao": "",
                }
            ],
            "cliente_nome": "Cliente sem equipe",
            "cliente_telefone": "81999990008",
            "endereco_entrega": "",
            "taxa_entrega": 0,
            "forma_pagamento": "na_entrega",
            "tipo_pedido": "retirada",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Restaurante ainda não está pronto para receber pedidos online."
    )


@pytest.mark.parametrize(
    "path",
    [
        "/cardapio/identificar",
        "/cardapio/enviar-otp",
        "/cardapio/verificar-otp",
    ],
)
def test_recuperacao_otp_simulada_nao_esta_publicada(path):
    response = client.post(
        path,
        json={
            "restaurante_id": 100,
            "telefone": "81999990000",
            "otp": "0000",
        },
    )

    assert response.status_code == 404


def test_caixa_pode_recusar_pedido_antes_da_producao():
    payload = {
        "restaurante_id": 100,
        "itens": [
            {
                "produto_id": "prod-cardapio-test",
                "quantidade": 1,
                "observacao": "",
            }
        ],
        "cliente_nome": "Cliente recusado",
        "cliente_telefone": "81999990002",
        "endereco_entrega": "",
        "taxa_entrega": 0,
        "forma_pagamento": "na_entrega",
        "tipo_pedido": "retirada",
    }
    created = client.post("/cardapio/pedidos", json=payload)
    assert created.status_code == 201

    token = create_access_token(subject="usr_cardapio_100", restaurante_id=100, role="admin")
    response = client.put(
        f"/comandas/{created.json()['comanda_id']}/delivery/status?status_novo=recusado",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(Comanda.id == created.json()["comanda_id"]).one()
        assert comanda.delivery_status == "recusado"
        assert comanda.fechada is True
        assert all(item.status == "cancelado" for item in comanda.itens)
    finally:
        db.close()


def _criar_pedido_de_mesa_para_cancelamento(mesa_id: int):
    db = SessionLocal()
    token_var = current_restaurante_id.set(100)
    try:
        db.add(Mesa(
            id=mesa_id,
            capacidade=4,
            nome=f"Mesa {mesa_id}",
            restaurante_id=100,
        ))
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    token = create_access_token(
        subject="usr_cardapio_100",
        restaurante_id=100,
        role="admin",
    )
    response = client.post(
        "/comandas/venda-direta",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "mesa_id": mesa_id,
            "garcom_id": "usr_cardapio_100",
            "tipo": "Consumo no Local",
            "itens": [{
                "produto_id": "prod-cardapio-test",
                "observacao": "Pedido lançado por engano",
                "cliente_nome": "Consumo Geral",
            }],
        },
    )
    assert response.status_code == 201
    return response.json()["id"], token


def test_cancelar_consumo_libera_mesa_sem_contabilizar_valor():
    mesa_id = 1000 + uuid.uuid4().int % 1_000_000
    comanda_id, token = _criar_pedido_de_mesa_para_cancelamento(mesa_id)

    response = client.post(
        f"/mesas/{mesa_id}/cancelar-consumo",
        headers={"Authorization": f"Bearer {token}"},
        json={"motivo": "Lançamento de teste"},
    )
    assert response.status_code == 200
    assert response.json()["mesa_id"] == mesa_id
    assert response.json()["comandas_canceladas"] == 1
    assert response.json()["itens_cancelados"] == 1
    assert response.json()["total_cancelado"] == 25.0

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        assert comanda.fechada is True
        assert float(comanda.valor_pago or 0) == 0
        assert all(item.status == "cancelado" for item in comanda.itens)
        assert all(item.cancelado_por == "usr_cardapio_100" for item in comanda.itens)
        audit = db.query(ActivityLog).filter(
            ActivityLog.restaurante_id == 100,
            ActivityLog.action == "CANCEL_TABLE_CONSUMPTION",
            ActivityLog.details.contains(f"Mesa {mesa_id}"),
        ).one()
        assert "Lançamento de teste" in audit.details
    finally:
        db.close()

    abertas = client.get(
        f"/comandas/?mesa_id={mesa_id}&fechada=false",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert abertas.status_code == 200
    assert abertas.json() == []


def test_cancelar_consumo_bloqueia_mesa_com_valor_pago():
    mesa_id = 1000 + uuid.uuid4().int % 1_000_000
    comanda_id, token = _criar_pedido_de_mesa_para_cancelamento(mesa_id)

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        comanda.valor_pago = 10
        db.commit()
    finally:
        db.close()

    response = client.post(
        f"/mesas/{mesa_id}/cancelar-consumo",
        headers={"Authorization": f"Bearer {token}"},
        json={"motivo": "Tentativa inválida"},
    )
    assert response.status_code == 409
    assert "pagamento registrado" in response.json()["detail"].lower()

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        assert comanda.fechada is False
        assert db.query(Item).filter(
            Item.comanda_id == comanda_id,
            Item.status != "cancelado",
        ).count() == 1
    finally:
        db.close()


def _criar_outro_pedido_na_mesa(mesa_id: int, token: str):
    response = client.post(
        "/comandas/venda-direta",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "mesa_id": mesa_id,
            "garcom_id": "usr_cardapio_100",
            "tipo": "Consumo no Local",
            "itens": [{
                "produto_id": "prod-cardapio-test",
                "observacao": "Outro card da mesma mesa",
                "cliente_nome": "Consumo Geral",
            }],
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_caixa_cancela_so_o_card_escolhido_e_preserva_outro_pedido_da_mesa():
    mesa_id = 1000 + uuid.uuid4().int % 1_000_000
    comanda_cancelada_id, token = _criar_pedido_de_mesa_para_cancelamento(mesa_id)
    comanda_preservada_id = _criar_outro_pedido_na_mesa(mesa_id, token)

    db = SessionLocal()
    try:
        item_id = db.query(Item.id).filter(Item.comanda_id == comanda_cancelada_id).scalar()
    finally:
        db.close()

    response = client.post(
        f"/mesas/{mesa_id}/cancelar-itens",
        headers={"Authorization": f"Bearer {token}"},
        json={"motivo": "Card lançado por engano", "item_ids": [item_id]},
    )
    assert response.status_code == 200
    assert response.json()["itens_cancelados"] == 1
    assert response.json()["comandas_fechadas"] == 1
    assert response.json()["mesa_liberada"] is False

    db = SessionLocal()
    try:
        cancelada = db.query(Comanda).filter(Comanda.id == comanda_cancelada_id).one()
        preservada = db.query(Comanda).filter(Comanda.id == comanda_preservada_id).one()
        assert cancelada.fechada is True
        assert all(item.status == "cancelado" for item in cancelada.itens)
        assert preservada.fechada is False
        assert all(item.status != "cancelado" for item in preservada.itens)
        audit = db.query(ActivityLog).filter(
            ActivityLog.restaurante_id == 100,
            ActivityLog.action == "CANCEL_CASHIER_ORDER_SCOPE",
            ActivityLog.details.contains(f"Mesa {mesa_id}"),
        ).one()
        assert "Card lançado por engano" in audit.details
    finally:
        db.close()


def test_transferir_mesa_move_todas_as_comandas_abertas_da_familia():
    mesa_origem_id = 1000 + uuid.uuid4().int % 1_000_000
    mesa_destino_id = 1000 + uuid.uuid4().int % 1_000_000
    comanda_principal_id, token = _criar_pedido_de_mesa_para_cancelamento(mesa_origem_id)
    comanda_irma_id = _criar_outro_pedido_na_mesa(mesa_origem_id, token)

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(100)
    try:
        db.add(Mesa(
            id=mesa_destino_id,
            capacidade=4,
            nome=f"Mesa {mesa_destino_id}",
            restaurante_id=100,
        ))
        db.commit()
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()

    response = client.post(
        f"/comandas/{comanda_principal_id}/transferir/{mesa_destino_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

    db = SessionLocal()
    try:
        comandas = db.query(Comanda).filter(
            Comanda.id.in_([comanda_principal_id, comanda_irma_id]),
        ).all()
        assert len(comandas) == 2
        assert all(comanda.mesa_id == mesa_destino_id for comanda in comandas)
        assert all(comanda.mesa_transferida_de == mesa_origem_id for comanda in comandas)
    finally:
        db.close()


def test_primeiro_aceite_online_imprime_uma_unica_vez():
    created = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": 100,
            "itens": [
                {
                    "produto_id": "prod-cardapio-test",
                    "quantidade": 1,
                    "observacao": "Sem cebola",
                }
            ],
            "cliente_nome": "Cliente aceite",
            "cliente_telefone": "81999990012",
            "endereco_entrega": "",
            "taxa_entrega": 0,
            "forma_pagamento": "na_entrega",
            "tipo_pedido": "retirada",
        },
    )
    assert created.status_code == 201
    comanda_id = created.json()["comanda_id"]

    db = SessionLocal()
    try:
        assert db.query(PrintJob).filter(
            PrintJob.restaurante_id == 100,
            PrintJob.source_id == comanda_id,
        ).count() == 0
    finally:
        db.close()

    token = create_access_token(
        subject="usr_cardapio_100",
        restaurante_id=100,
        role="admin",
    )
    headers = {"Authorization": f"Bearer {token}"}
    endpoint = f"/comandas/{comanda_id}/delivery/status?status_novo=producao"

    accepted = client.put(endpoint, headers=headers)
    assert accepted.status_code == 200
    assert accepted.json()["delivery_status"] == "producao"

    db = SessionLocal()
    try:
        first_jobs = db.query(PrintJob).filter(
            PrintJob.restaurante_id == 100,
            PrintJob.source_type == "pedido",
            PrintJob.source_id == comanda_id,
        ).all()
        assert len(first_jobs) == 1
        assert first_jobs[0].status == "pending"
        assert first_jobs[0].idempotency_key == (
            f"aceite:pedido:{comanda_id}:producao:cozinha"
        )
        first_job_id = first_jobs[0].id
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        assert all(item.impresso_em is not None for item in comanda.itens)
    finally:
        db.close()

    repeated = client.put(endpoint, headers=headers)
    assert repeated.status_code == 200

    db = SessionLocal()
    try:
        repeated_jobs = db.query(PrintJob).filter(
            PrintJob.restaurante_id == 100,
            PrintJob.source_type == "pedido",
            PrintJob.source_id == comanda_id,
        ).all()
        assert [job.id for job in repeated_jobs] == [first_job_id]
    finally:
        db.close()


def test_koma_pocket_nao_enfileira_impressao_automatica(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "KOMA_TEST_PREMIUM_RESTAURANTE_IDS", "")
    db = SessionLocal()
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == 100).one()
        restaurante.plano = "pocket"
        db.commit()
    finally:
        db.close()

    token = create_access_token(
        subject="usr_cardapio_100",
        restaurante_id=100,
        role="admin",
    )
    response = client.post(
        "/comandas/venda-direta",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "restaurante_id": 100,
            "mesa_id": 1,
            "garcom_id": "usr_cardapio_100",
            "tipo": "Consumo no Local",
            "itens": [
                {
                    "produto_id": "prod-cardapio-test",
                    "quantidade": 1,
                    "preco_unitario": 25.0,
                    "observacao": "",
                }
            ],
        },
    )
    assert response.status_code in (200, 201)

    db = SessionLocal()
    try:
        resp_data = response.json()
        lancamento_ids = [l["id"] for l in resp_data.get("lancamentos", [])]
        print_job = db.query(PrintJob).filter(
            PrintJob.restaurante_id == 100,
            PrintJob.source_id.in_([resp_data["id"], *lancamento_ids]),
        ).first()
        assert print_job is None
    finally:
        db.close()


def test_premium_de_homologacao_enfileira_sem_alterar_plano(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(
        settings,
        "KOMA_TEST_PREMIUM_RESTAURANTE_IDS",
        "100",
    )

    db = SessionLocal()
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == 100).one()
        restaurante.plano = "pocket"
        db.commit()
    finally:
        db.close()

    token = create_access_token(
        subject="usr_cardapio_100",
        restaurante_id=100,
        role="admin",
    )
    response = client.post(
        "/comandas/venda-direta",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "restaurante_id": 100,
            "mesa_id": 1,
            "garcom_id": "usr_cardapio_100",
            "tipo": "Consumo no Local",
            "itens": [
                {
                    "produto_id": "prod-cardapio-test",
                    "quantidade": 1,
                    "preco_unitario": 25.0,
                    "observacao": "",
                }
            ],
        },
    )
    assert response.status_code in (200, 201)

    db = SessionLocal()
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == 100).one()
        assert restaurante.plano == "pocket"

        resp_data = response.json()
        lancamento_ids = [l["id"] for l in resp_data.get("lancamentos", [])]
        print_job = db.query(PrintJob).filter(
            PrintJob.restaurante_id == 100,
            PrintJob.source_id.in_([resp_data["id"], *lancamento_ids]),
        ).first()
        assert print_job is not None
    finally:
        db.close()