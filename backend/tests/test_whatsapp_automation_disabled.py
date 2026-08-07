import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.models import Restaurante, Categoria, Produto
from app.services import whatsapp as whatsapp_service

client = TestClient(app)


def test_whatsapp_automation_flag_default_is_false():
    """Confirma que a flag de automação assume False por padrão quando não definida."""
    assert settings.KOMA_WHATSAPP_AUTOMATION_ENABLED is False


def test_get_webhook_returns_404_when_automation_disabled():
    """Confirma que o endpoint GET /api/whatsapp/webhook retorna 404 quando a automação está desativada."""
    response = client.get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=1505&hub.challenge=test")
    assert response.status_code == 404


def test_post_webhook_returns_404_when_automation_disabled():
    """Confirma que o endpoint POST /api/whatsapp/webhook retorna 404 quando a automação está desativada."""
    response = client.post("/api/whatsapp/webhook", json={"entry": []})
    assert response.status_code == 404


def test_get_diagnostic_returns_404_when_automation_disabled():
    """Confirma que o endpoint GET /api/whatsapp/diagnostico retorna 404 quando a automação está desativada."""
    response = client.get("/api/whatsapp/diagnostico")
    assert response.status_code == 404


def test_enviar_texto_whatsapp_returns_false_without_http_calls(monkeypatch):
    """Confirma que enviar_texto_whatsapp retorna False imediatamente sem fazer requisição HTTP externa."""
    called_http = False

    def mock_post(*args, **kwargs):
        nonlocal called_http
        called_http = True
        raise RuntimeError("HTTP request não deveria ser executada com automação desativada.")

    monkeypatch.setattr(whatsapp_service.httpx.Client, "post", mock_post)

    result = whatsapp_service.enviar_texto_whatsapp("5511999999999", "Mensagem de teste")
    assert result is False
    assert called_http is False


def test_enviar_otp_whatsapp_meta_returns_false_without_http_calls(monkeypatch):
    """Confirma que enviar_otp_whatsapp_meta retorna False imediatamente sem fazer requisição HTTP externa."""
    called_http = False

    def mock_post(*args, **kwargs):
        nonlocal called_http
        called_http = True
        raise RuntimeError("HTTP request não deveria ser executada com automação desativada.")

    monkeypatch.setattr(whatsapp_service.httpx.Client, "post", mock_post)

    result = whatsapp_service.enviar_otp_whatsapp_meta("5511999999999", "Restaurante Teste", "123456")
    assert result is False
    assert called_http is False


def test_enviar_codigo_otp_whatsapp_returns_false_when_automation_disabled():
    """Confirma que o wrapper de OTP retorna False quando a automação está desativada."""
    result = whatsapp_service.enviar_codigo_otp_whatsapp("5511999999999", "123456", "Restaurante Teste")
    assert result is False


def test_solicitar_otp_endpoint_returns_503_when_automation_disabled():
    """Confirma que o endpoint de solicitação de OTP do cliente retorna 503 quando a automação está desativada."""
    response = client.post("/cardapio/clientes/otp/solicitar", json={
        "restaurante_id": 1,
        "telefone": "11999999999"
    })
    assert response.status_code == 503
    assert "WhatsApp indisponível" in response.json()["detail"]


def test_ai_router_chat_waiter_is_registered_and_not_404():
    """Confirma que /api/chat-waiter está registrado no app FastAPI e desativação do WhatsApp não remove a IA."""
    # 1. Inspeção de rotas no OpenAPI do app
    assert "/api/chat-waiter" in app.openapi()["paths"], "A rota /api/chat-waiter deve estar registrada no app OpenAPI."

    # 2. Requisição sem corpo retorna erro de validação (422), atestando que a rota existe e não é 404
    response = client.post("/api/chat-waiter", json={})
    assert response.status_code == 422, f"Esperado status_code 422 sem payload, obtido: {response.status_code}"


@pytest.fixture
def cardapio_publico_setup():
    """Fixture isolada para popular restaurante, categoria e produto de teste para o cardápio público."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token = current_restaurante_id.set(999)
    try:
        rest = db.query(Restaurante).filter(Restaurante.id == 999).first()
        if not rest:
            rest = Restaurante(
                id=999,
                nome="Bistrô Publico Teste",
                plano="pro",
                slug="bistro-publico-teste",
                subtitulo="Sabor Autêntico",
                cor_primaria="#10b981",
                cor_fundo="#121214",
                endereco="Av. Principal, 999"
            )
            db.add(rest)
            db.flush()

        cat = db.query(Categoria).filter(Categoria.id == "cat-pub-999").first()
        if not cat:
            cat = Categoria(
                id="cat-pub-999",
                restaurante_id=999,
                nome="Pratos Principais"
            )
            db.add(cat)
            db.flush()

        prod = db.query(Produto).filter(Produto.id == "prod-pub-999").first()
        if not prod:
            prod = Produto(
                id="prod-pub-999",
                restaurante_id=999,
                categoria_id="cat-pub-999",
                nome="Risoto Gourmet",
                preco=65.0,
                descricao="Risoto especial com cogumelos",
                ativo=True
            )
            db.add(prod)
            db.flush()

        db.commit()
        yield rest, cat, prod
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_public_cardapio_digital_config_and_catalog_accessible_without_token(cardapio_publico_setup):
    """Confirma que os endpoints públicos do cardápio digital retornam HTTP 200 com os dados reais criados na fixture sem exigir token."""
    rest, cat, prod = cardapio_publico_setup

    # 1. Testar GET /api/cardapio-digital/config?restaurante_id=999
    config_res = client.get(f"/api/cardapio-digital/config?restaurante_id={rest.id}")
    assert config_res.status_code == 200, f"Endpoint /api/cardapio-digital/config deve retornar 200, obtido {config_res.status_code}"
    data_config = config_res.json()
    assert data_config["id"] == rest.id
    assert data_config["nome"] == rest.nome

    # 2. Testar GET /api/cardapio-digital/public?restaurante_id=999 (categorias e produtos)
    public_res = client.get(f"/api/cardapio-digital/public?restaurante_id={rest.id}")
    assert public_res.status_code == 200, f"Endpoint /api/cardapio-digital/public deve retornar 200, obtido {public_res.status_code}"
    data_public = public_res.json()
    assert any(c["id"] == cat.id and c["nome"] == cat.nome for c in data_public.get("categorias", []))
    assert any(p["id"] == prod.id and p["nome"] == prod.nome for p in data_public.get("produtos", []))


def test_pytest_database_safety_circuit():
    """Confirma que a suíte executa exclusivamente no banco SQLite isolado .pytest_koma.db e não no bistro.db de dev."""
    from pathlib import Path
    from app.database import engine

    assert engine.dialect.name == "sqlite"
    assert Path(engine.url.database).name == ".pytest_koma.db"
    assert Path("bistro.db").resolve() != Path(engine.url.database).resolve()
