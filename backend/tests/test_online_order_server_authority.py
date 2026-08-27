import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    Categoria,
    Comanda,
    ConfiguracaoRestaurante,
    Produto,
    PublicRateLimit,
    Restaurante,
    Usuario,
)
from app.services.online_order_policy import (
    DEFAULT_DELIVERY_FEE,
    evaluate_online_order_policy,
    schedule_is_open,
)


RESTAURANTE_ID = 910200
PRODUTO_ID = "produto-authority-online"
CATEGORIA_ID = "categoria-authority-online"
USUARIO_ID = "usuario-authority-online"
client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_restaurant_authority():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    tenant = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).first()
        if restaurante is None:
            restaurante = Restaurante(
                id=RESTAURANTE_ID,
                nome="Koma Authority",
                slug="koma-authority",
                plano="premium",
                status_override="Automático",
            )
            db.add(restaurante)
        restaurante.status_override = "Automático"
        restaurante.horarios_funcionamento = None
        db.commit()

        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == RESTAURANTE_ID,
        ).first()
        if config is None:
            config = ConfiguracaoRestaurante(
                restaurante_id=RESTAURANTE_ID,
                delivery_ativo=True,
            )
            db.add(config)
        config.delivery_ativo = True
        db.query(PublicRateLimit).filter(
            PublicRateLimit.restaurante_id == RESTAURANTE_ID,
        ).delete(synchronize_session=False)
        db.commit()

        categoria = db.query(Categoria).filter(
            Categoria.restaurante_id == RESTAURANTE_ID,
            Categoria.id == CATEGORIA_ID,
        ).first()
        if categoria is None:
            db.add(Categoria(
                id=CATEGORIA_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Authority",
            ))
            db.commit()

        produto = db.query(Produto).filter(
            Produto.restaurante_id == RESTAURANTE_ID,
            Produto.id == PRODUTO_ID,
        ).first()
        if produto is None:
            produto = Produto(
                id=PRODUTO_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Produto Authority",
                categoria_id=CATEGORIA_ID,
                preco=25.0,
                ativo=True,
            )
            db.add(produto)
        produto.preco = 25.0
        produto.ativo = True
        db.commit()

        usuario = db.query(Usuario).filter(
            Usuario.restaurante_id == RESTAURANTE_ID,
            Usuario.id == USUARIO_ID,
        ).first()
        if usuario is None:
            usuario = Usuario(
                id=USUARIO_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Operador Authority",
                email="authority@koma.test",
                cargo="admin",
                role="admin",
                status="ativo",
            )
            db.add(usuario)
        usuario.status = "ativo"
        usuario.role = "admin"
        usuario.cargo = "admin"
        db.commit()
        yield
    finally:
        db.rollback()
        current_restaurante_id.reset(tenant)
        db.close()


def _payload(key: str, *, phone: str = "81944440000", fee: float = 0.0):
    return {
        "restaurante_id": RESTAURANTE_ID,
        "itens": [{
            "produto_id": PRODUTO_ID,
            "quantidade": 1,
            "observacao": "",
        }],
        "cliente_nome": "Cliente Authority",
        "cliente_telefone": phone,
        "endereco_entrega": "Rua do Servidor, 7",
        "taxa_entrega": fee,
        "forma_pagamento": "na_entrega",
        "tipo_pedido": "delivery",
        "idempotency_key": key,
    }


def test_parser_de_horarios_entende_faixa_e_virada_da_meia_noite():
    tz = ZoneInfo("America/Fortaleza")
    schedule = {"segunda_a_sexta": "18:00 - 02:00"}

    segunda_noite = datetime.datetime(2026, 8, 24, 23, 30, tzinfo=tz)
    terca_madrugada = datetime.datetime(2026, 8, 25, 1, 30, tzinfo=tz)
    sabado_meio_dia = datetime.datetime(2026, 8, 29, 12, 0, tzinfo=tz)

    assert schedule_is_open(schedule, now=segunda_noite) is True
    assert schedule_is_open(schedule, now=terca_madrugada) is True
    assert schedule_is_open(schedule, now=sabado_meio_dia) is False


def test_agenda_ausente_preserva_compatibilidade_e_forcado_aberto_tem_precedencia():
    restaurant = SimpleNamespace(
        status_override="Automático",
        horarios_funcionamento=None,
    )
    config = SimpleNamespace(delivery_ativo=True)
    assert evaluate_online_order_policy(restaurant, config, modalidade="delivery").accepting_orders is True

    restaurant.status_override = "Forçado Aberto"
    restaurant.horarios_funcionamento = [
        {"days": "Segunda a Domingo", "hours": "Fechado"},
    ]
    assert evaluate_online_order_policy(restaurant, config, modalidade="delivery").accepting_orders is True


def test_cliente_nao_controla_taxa_de_delivery():
    payload = _payload("authority-fee-0001", fee=9999.0)
    response = client.post(
        "/cardapio/pedidos",
        json=payload,
        headers={"X-Idempotency-Key": payload["idempotency_key"]},
    )

    assert response.status_code == 201, response.text
    assert response.json()["total"] == 25.0 + DEFAULT_DELIVERY_FEE

    db = SessionLocal()
    tenant = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == RESTAURANTE_ID,
            Comanda.id == response.json()["comanda_id"],
        ).one()
        assert float(comanda.delivery_taxa) == DEFAULT_DELIVERY_FEE
    finally:
        current_restaurante_id.reset(tenant)
        db.close()


def test_delivery_desativado_e_bloqueado_no_backend():
    db = SessionLocal()
    tenant = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == RESTAURANTE_ID,
        ).one()
        config.delivery_ativo = False
        db.commit()
    finally:
        current_restaurante_id.reset(tenant)
        db.close()

    response = client.post(
        "/cardapio/pedidos",
        json=_payload("authority-delivery-off-0001"),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "O delivery está desativado para este restaurante."


def test_horario_automatico_fechado_e_bloqueado_no_backend():
    db = SessionLocal()
    tenant = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).one()
        restaurante.horarios_funcionamento = [
            {"days": "Segunda a Domingo", "hours": "Fechado"},
        ]
        db.commit()
    finally:
        current_restaurante_id.reset(tenant)
        db.close()

    response = client.post(
        "/cardapio/pedidos",
        json=_payload("authority-hours-off-0001"),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "O restaurante está fora do horário de pedidos online."


def test_replay_idempotente_nao_quebra_se_loja_fechar_depois():
    payload = _payload("authority-replay-closed-0001")
    first = client.post(
        "/cardapio/pedidos",
        json=payload,
        headers={"X-Idempotency-Key": payload["idempotency_key"]},
    )
    assert first.status_code == 201, first.text

    db = SessionLocal()
    tenant = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).one()
        restaurante.status_override = "Forçado Fechado"
        db.commit()
    finally:
        current_restaurante_id.reset(tenant)
        db.close()

    replay = client.post(
        "/cardapio/pedidos",
        json=payload,
        headers={"X-Idempotency-Key": payload["idempotency_key"]},
    )

    assert replay.status_code == 201, replay.text
    assert replay.json()["comanda_id"] == first.json()["comanda_id"]
    assert replay.json()["total"] == first.json()["total"]


def test_criacao_publica_tem_rate_limit_por_telefone(monkeypatch):
    monkeypatch.setattr("app.routes.cardapio.MAX_PUBLIC_ORDERS_PER_PHONE", 2)
    monkeypatch.setattr("app.routes.cardapio.MAX_PUBLIC_ORDERS_PER_IP", 999)

    statuses = []
    for index in range(3):
        response = client.post(
            "/cardapio/pedidos",
            json=_payload(
                f"authority-rate-{index:04d}",
                phone="81933330000",
            ),
        )
        statuses.append(response.status_code)

    assert statuses == [201, 201, 429]
