import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Cliente,
    Produto,
    PublicRateLimit,
    Restaurante,
    Usuario,
)
from app.services.public_orders.customer_auth import authenticated_customer

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token_var = current_restaurante_id.set(101)
    try:
        rest = db.query(Restaurante).filter(Restaurante.id == 101).first()
        if not rest:
            rest = Restaurante(
                id=101,
                nome="Bistrô Teste Auth",
                plano="pro",
                slug="bistro-teste-auth",
            )
            db.add(rest)
            db.commit()

        rest2 = db.query(Restaurante).filter(Restaurante.id == 102).first()
        if not rest2:
            rest2 = Restaurante(
                id=102,
                nome="Bistrô Dois Auth",
                plano="pro",
                slug="bistro-dois-auth",
            )
            db.add(rest2)
            db.commit()

        # Limpar clientes e rate limits de teste
        db.query(Cliente).filter(Cliente.restaurante_id.in_([101, 102])).delete(synchronize_session=False)
        db.query(PublicRateLimit).filter(PublicRateLimit.restaurante_id.in_([101, 102])).delete(synchronize_session=False)
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_customer_registration_and_login_flow():
    # 1. Cadastro bem sucedido (senha >= 8 caracteres)
    register_payload = {
        "restaurante_id": 101,
        "nome": "Maria Silva",
        "email": "maria@exemplo.com",
        "senha": "senhaSegura123",
        "telefone": "11988887777",
        "endereco": "Rua das Flores, 123",
    }
    res = client.post("/cardapio/clientes/cadastro", json=register_payload)
    assert res.status_code == 201, res.text
    data = res.json()
    assert "access_token" in data
    assert data["cliente"]["nome"] == "Maria Silva"
    assert data["cliente"]["email"] == "maria@exemplo.com"
    assert data["cliente"]["telefone"] == "11988887777"
    assert data["cliente"]["endereco"] == "Rua das Flores, 123"

    token = data["access_token"]

    # 2. Consultar perfil autenticado com o token
    res_me = client.get(
        "/cardapio/clientes/me",
        headers={"X-Koma-Customer-Token": token},
    )
    assert res_me.status_code == 200
    me_data = res_me.json()
    assert me_data["email"] == "maria@exemplo.com"
    assert me_data["nome"] == "Maria Silva"

    # 3. Tentativa de cadastro com mesmo e-mail deve dar 409
    res_dup = client.post("/cardapio/clientes/cadastro", json=register_payload)
    assert res_dup.status_code == 409
    assert "Já existe uma conta com este e-mail" in res_dup.json()["detail"]

    # 4. Login com senha errada deve dar 401 com erro genérico
    res_wrong_pw = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 101,
            "email": "maria@exemplo.com",
            "senha": "senhaErrada123",
        },
    )
    assert res_wrong_pw.status_code == 401
    assert res_wrong_pw.json()["detail"] == "E-mail ou senha incorretos."

    # 5. Login com e-mail inexistente deve dar o mesmo 401 genérico (não vazar se e-mail existe)
    res_nonexistent = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 101,
            "email": "naoexiste@exemplo.com",
            "senha": "senhaSegura123",
        },
    )
    assert res_nonexistent.status_code == 401
    assert res_nonexistent.json()["detail"] == "E-mail ou senha incorretos."

    # 6. Login com sucesso
    res_login = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 101,
            "email": "maria@exemplo.com",
            "senha": "senhaSegura123",
        },
    )
    assert res_login.status_code == 200
    login_data = res_login.json()
    assert "access_token" in login_data
    assert login_data["cliente"]["email"] == "maria@exemplo.com"


def test_customer_registration_cannot_claim_existing_guest_by_phone():
    """Anti-Account Takeover: NUNCA adotar cliente guest silenciosamente pelo telefone.

    Conhecer o telefone de outra pessoa NÃO pode conceder acesso ao histórico,
    saldo de pontos ou cashback de outro cliente sem canal verificado.
    """
    # Pre-cria um cliente guest com histórico e saldo
    db = SessionLocal()
    token_var = current_restaurante_id.set(101)
    try:
        guest = Cliente(
            id="guest-uuid-1234",
            restaurante_id=101,
            telefone="11977776666",
            nome="Cliente Balcao Original",
            saldo_pontos=50,
            saldo_cashback=12.5,
            senha_hash=None,
            email=None,
        )
        db.add(guest)
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    # Um atacante tenta se cadastrar com o mesmo telefone para tentar roubar os pontos
    register_payload = {
        "restaurante_id": 101,
        "nome": "Atacante Invasor",
        "email": "invasor@evil.com",
        "senha": "senhaInvasor123",
        "telefone": "11977776666",
    }
    res = client.post("/cardapio/clientes/cadastro", json=register_payload)
    assert res.status_code == 409
    assert res.json()["detail"] == "Este telefone já está associado a um cadastro neste restaurante."

    # Verificar no banco que a conta guest original está 100% intacta
    db = SessionLocal()
    try:
        original = db.query(Cliente).filter(
            Cliente.restaurante_id == 101,
            Cliente.id == "guest-uuid-1234",
        ).one()
        assert original.nome == "Cliente Balcao Original"
        assert original.saldo_pontos == 50
        assert original.saldo_cashback == 12.5
        assert original.senha_hash is None
        assert original.email is None
    finally:
        db.close()


def test_customer_registration_rejects_password_under_8_chars():
    """Senha mínima deve ser de 8 caracteres."""
    res = client.post(
        "/cardapio/clientes/cadastro",
        json={
            "restaurante_id": 101,
            "nome": "Usuario Teste",
            "email": "curta@exemplo.com",
            "senha": "1234567",  # 7 caracteres
            "telefone": "11966665555",
        },
    )
    assert res.status_code in (400, 422)


def test_customer_multi_tenant_isolation():
    """Mesmo e-mail em restaurantes distintos é permitido, mas tokens são isolados por tenant."""
    # 1. Cadastrar mesmo e-mail no restaurante 101 e 102 com senhas diferentes
    payload_101 = {
        "restaurante_id": 101,
        "nome": "Cliente Multi",
        "email": "multi@exemplo.com",
        "senha": "senhaRestaurante101",
        "telefone": "11955551111",
    }
    res_101 = client.post("/cardapio/clientes/cadastro", json=payload_101)
    assert res_101.status_code == 201
    token_101 = res_101.json()["access_token"]

    payload_102 = {
        "restaurante_id": 102,
        "nome": "Cliente Multi",
        "email": "multi@exemplo.com",
        "senha": "senhaRestaurante102",
        "telefone": "11955552222",
    }
    res_102 = client.post("/cardapio/clientes/cadastro", json=payload_102)
    assert res_102.status_code == 201
    token_102 = res_102.json()["access_token"]

    # 2. Login com senha de um restaurante no outro é rejeitado
    cross_login = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 102,
            "email": "multi@exemplo.com",
            "senha": "senhaRestaurante101",  # Senha do 101 enviada ao 102
        },
    )
    assert cross_login.status_code == 401
    assert cross_login.json()["detail"] == "E-mail ou senha incorretos."

    # 3. Token do 101 não é aceito no restaurante 102
    db = SessionLocal()
    try:
        with pytest.raises(HTTPException) as exc_info:
            authenticated_customer(
                db,
                raw_token=token_101,
                expected_restaurante_id=102,
            )
        assert exc_info.value.status_code == 401
        assert "Sessão não pertence a este restaurante." in exc_info.value.detail
    finally:
        db.close()


def test_customer_login_rate_limiting():
    """Brute-force protection: rate limit por conta bloqueia após 5 tentativas."""
    email = "bruteforce@exemplo.com"
    # Cadastrar conta
    client.post(
        "/cardapio/clientes/cadastro",
        json={
            "restaurante_id": 101,
            "nome": "Vitima BF",
            "email": email,
            "senha": "senhaCorreta123",
            "telefone": "11944443333",
        },
    )

    # 5 tentativas erradas
    for _ in range(5):
        res = client.post(
            "/cardapio/clientes/login",
            json={
                "restaurante_id": 101,
                "email": email,
                "senha": "senhaErrada999",
            },
        )
        assert res.status_code == 401

    # 6ª tentativa deve estourar o rate limit (429)
    res_blocked = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 101,
            "email": email,
            "senha": "senhaCorreta123",
        },
    )
    assert res_blocked.status_code == 429
    assert "Muitas tentativas" in res_blocked.json()["detail"]


def test_guest_checkout_remains_unblocked_without_account():
    """Checkout como visitante sem senha continua 100% funcional."""
    db = SessionLocal()
    token_var = current_restaurante_id.set(101)
    try:
        # Garantir turno aberto e produto para pedido
        user = db.query(Usuario).filter(Usuario.email == "admin101@koma.com").first()
        if not user:
            user = Usuario(
                id="usr_101",
                nome="Admin 101",
                email="admin101@koma.com",
                cargo="admin",
                role="admin",
                status="ativo",
                restaurante_id=101,
            )
            db.add(user)
            db.commit()

        turno = db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == 101,
            CaixaTurno.status == "aberto",
        ).first()
        if not turno:
            db.add(CaixaTurno(
                restaurante_id=101,
                aberto_por_id=user.id,
                saldo_inicial=0,
                status="aberto",
            ))
            db.commit()

        cat = db.query(Categoria).filter(Categoria.restaurante_id == 101).first()
        if not cat:
            cat = Categoria(id="cat-auth-101", nome="Lanches", restaurante_id=101)
            db.add(cat)
            db.commit()

        prod = db.query(Produto).filter(Produto.restaurante_id == 101).first()
        if not prod:
            prod = Produto(
                id="prod-auth-101",
                nome="X-Burger Auth",
                preco=25.0,
                categoria_id=cat.id,
                restaurante_id=101,
                ativo=True,
            )
            db.add(prod)
            db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    # Pedido guest sem token nem senha
    order_payload = {
        "restaurante_id": 101,
        "cliente_nome": "Visitante Sem Conta",
        "cliente_telefone": "11933332222",
        "tipo_pedido": "retirada",
        "itens": [
            {
                "produto_id": "prod-auth-101",
                "quantidade": 1,
                "modificador_ids": [],
            }
        ],
    }
    res = client.post("/cardapio/pedidos", json=order_payload)
    assert res.status_code == 201
    data = res.json()
    assert "comanda_id" in data

    # Pedido criado com sucesso como guest sem credenciais
    db = SessionLocal()
    token_var = current_restaurante_id.set(101)
    try:
        from app.models import Comanda
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == 101,
            Comanda.id == data["comanda_id"],
        ).first()
        assert comanda is not None
        assert comanda.identificador == "Visitante Sem Conta"
        assert comanda.delivery_telefone == "11933332222"
        assert comanda.cliente_id is None
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_customer_registration_rate_limiting():
    """Rate limit de cadastro por conta/e-mail bloqueia após 5 tentativas."""
    email = "flood_reg@exemplo.com"
    phone = "11922223333"

    # 5 tentativas com e-mail duplicado
    for i in range(5):
        client.post(
            "/cardapio/clientes/cadastro",
            json={
                "restaurante_id": 101,
                "nome": f"Cadastro {i}",
                "email": email,
                "senha": "senhaSegura123",
                "telefone": f"1198888000{i}",
            },
        )

    # 6ª tentativa deve estourar o rate limit de account (429)
    res_blocked = client.post(
        "/cardapio/clientes/cadastro",
        json={
            "restaurante_id": 101,
            "nome": "Cadastro 6",
            "email": email,
            "senha": "senhaSegura123",
            "telefone": "11988880099",
        },
    )
    assert res_blocked.status_code == 429
    assert "Muitas tentativas de cadastro" in res_blocked.json()["detail"]

