from __future__ import annotations

import datetime
import os
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.application.orders.idempotency import (
    build_order_intent_canonical_dict,
    compute_fingerprint_for_public_payload,
    compute_order_intent_fingerprint,
)
from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.domain.orders.errors import IdempotencyConflictError
from app.main import app
from app.models import (
    Categoria,
    Comanda,
    Cupom,
    GrupoModificador,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    PublicRateLimit,
    Restaurante,
    Usuario,
)
from app.smartpos_models import RestauranteCapability

RESTAURANTE_ID = 950100
CATEGORIA_ID = "cat-fingerprint-test"
PRODUTO_1_ID = "prod-fingerprint-1"
PRODUTO_2_ID = "prod-fingerprint-2"
GRUPO_MOD_ID = "grp-fingerprint-test"
MOD_BACON_ID = "mod-fingerprint-bacon"
MOD_QUEIJO_ID = "mod-fingerprint-queijo"
USUARIO_ID = "usr-fingerprint-admin"
CUPOM_1_COD = "DESC10"
CUPOM_2_COD = "DESC20"

client = TestClient(app)

POSTGRES_URL = os.getenv("KOMA_CONCURRENCY_DATABASE_URL", os.getenv("POSTGRES_URL", "")).strip()


@pytest.fixture(autouse=True)
def setup_fingerprint_test_environment():
    """Semeia o banco com restaurante, produtos, modificadores, cupons e capabilities."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        # Limpa rate limits para isolar os testes
        db.query(PublicRateLimit).filter(PublicRateLimit.restaurante_id == RESTAURANTE_ID).delete()
        db.commit()

        # Restaurante
        rest = db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).first()
        if rest is None:
            rest = Restaurante(
                id=RESTAURANTE_ID,
                nome="Koma Fingerprint Bistro",
                slug="koma-fingerprint-bistro",
                plano="premium",
                status_override="Automático",
            )
            db.add(rest)
        else:
            rest.status_override = "Automático"
        db.commit()

        # Capability para pedidos agendados
        cap = (
            db.query(RestauranteCapability)
            .filter(
                RestauranteCapability.restaurante_id == RESTAURANTE_ID,
                RestauranteCapability.capability == "scheduled_orders",
            )
            .first()
        )
        if cap is None:
            db.add(
                RestauranteCapability(
                    restaurante_id=RESTAURANTE_ID,
                    capability="scheduled_orders",
                    enabled=True,
                )
            )
            db.commit()

        # Categoria
        cat = (
            db.query(Categoria)
            .filter(
                Categoria.restaurante_id == RESTAURANTE_ID,
                Categoria.id == CATEGORIA_ID,
            )
            .first()
        )
        if cat is None:
            db.add(
                Categoria(
                    id=CATEGORIA_ID,
                    restaurante_id=RESTAURANTE_ID,
                    nome="Fingerprint Categoria",
                )
            )
            db.commit()

        # Produtos
        p1 = (
            db.query(Produto)
            .filter(
                Produto.restaurante_id == RESTAURANTE_ID,
                Produto.id == PRODUTO_1_ID,
            )
            .first()
        )
        if p1 is None:
            db.add(
                Produto(
                    id=PRODUTO_1_ID,
                    restaurante_id=RESTAURANTE_ID,
                    nome="Burger Alfa",
                    categoria_id=CATEGORIA_ID,
                    preco=30.0,
                    ativo=True,
                )
            )
        else:
            p1.preco = 30.0
            p1.ativo = True

        p2 = (
            db.query(Produto)
            .filter(
                Produto.restaurante_id == RESTAURANTE_ID,
                Produto.id == PRODUTO_2_ID,
            )
            .first()
        )
        if p2 is None:
            db.add(
                Produto(
                    id=PRODUTO_2_ID,
                    restaurante_id=RESTAURANTE_ID,
                    nome="Burger Beta",
                    categoria_id=CATEGORIA_ID,
                    preco=35.0,
                    ativo=True,
                )
            )
        else:
            p2.preco = 35.0
            p2.ativo = True
        db.commit()

        # Grupo de modificadores e opções
        grp = (
            db.query(GrupoModificador)
            .filter(
                GrupoModificador.restaurante_id == RESTAURANTE_ID,
                GrupoModificador.id == GRUPO_MOD_ID,
            )
            .first()
        )
        if grp is None:
            db.add(
                GrupoModificador(
                    id=GRUPO_MOD_ID,
                    restaurante_id=RESTAURANTE_ID,
                    nome="Extras Fingerprint",
                    min_selecoes=0,
                    max_selecoes=5,
                    tipo="opcional",
                )
            )
            db.commit()

        for mod_id, mod_nome, mod_preco in [
            (MOD_BACON_ID, "Bacon Crocante", 5.0),
            (MOD_QUEIJO_ID, "Queijo Cheddar", 4.0),
        ]:
            opc = (
                db.query(OpcaoModificador)
                .filter(
                    OpcaoModificador.restaurante_id == RESTAURANTE_ID,
                    OpcaoModificador.id == mod_id,
                )
                .first()
            )
            if opc is None:
                db.add(
                    OpcaoModificador(
                        id=mod_id,
                        restaurante_id=RESTAURANTE_ID,
                        grupo_id=GRUPO_MOD_ID,
                        nome=mod_nome,
                        preco_adicional=mod_preco,
                        ativo=True,
                    )
                )
        db.commit()

        # Associação produto-grupo
        pg = (
            db.query(ProdutoGrupoModificador)
            .filter(
                ProdutoGrupoModificador.restaurante_id == RESTAURANTE_ID,
                ProdutoGrupoModificador.produto_id == PRODUTO_1_ID,
                ProdutoGrupoModificador.grupo_id == GRUPO_MOD_ID,
            )
            .first()
        )
        if pg is None:
            db.add(
                ProdutoGrupoModificador(
                    restaurante_id=RESTAURANTE_ID,
                    produto_id=PRODUTO_1_ID,
                    grupo_id=GRUPO_MOD_ID,
                )
            )
            db.commit()

        # Cupons
        for cupom_cod, valor_desc in [(CUPOM_1_COD, 10.0), (CUPOM_2_COD, 20.0)]:
            cupom = (
                db.query(Cupom)
                .filter(
                    Cupom.restaurante_id == RESTAURANTE_ID,
                    Cupom.codigo == cupom_cod,
                )
                .first()
            )
            if cupom is None:
                db.add(
                    Cupom(
                        restaurante_id=RESTAURANTE_ID,
                        codigo=cupom_cod,
                        tipo_desconto="porcentagem",
                        valor_desconto=valor_desc,
                        valor_minimo_pedido=0.0,
                        ativo=True,
                    )
                )
        db.commit()

        # Usuário operador
        usr = (
            db.query(Usuario)
            .filter(
                Usuario.restaurante_id == RESTAURANTE_ID,
                Usuario.id == USUARIO_ID,
            )
            .first()
        )
        if usr is None:
            db.add(
                Usuario(
                    id=USUARIO_ID,
                    restaurante_id=RESTAURANTE_ID,
                    nome="Operador Fingerprint",
                    email="fingerprint@koma.test",
                    cargo="admin",
                    role="admin",
                    status="ativo",
                )
            )
            db.commit()

        yield
    finally:
        db.rollback()
        current_restaurante_id.reset(token)
        db.close()


def _base_payload(*, key: str = "idemp-key-base-0001", phone: str = "81988887777", **overrides) -> dict:
    payload = {
        "restaurante_id": RESTAURANTE_ID,
        "itens": [
            {
                "produto_id": PRODUTO_1_ID,
                "quantidade": 1,
                "observacao": "Sem picles",
                "modificador_ids": [MOD_BACON_ID],
            }
        ],
        "cliente_nome": "Cliente Teste Idempotência",
        "cliente_telefone": phone,
        "endereco_entrega": "Rua das Flores, 123",
        "bairro": "Espinheiro",
        "taxa_entrega": 7.0,
        "forma_pagamento": "na_entrega",
        "forma_pagamento_detalhe": "dinheiro",
        "troco_para": 50.0,
        "cliente_email": "cliente.idemp@koma.test",
        "cupom_codigo": None,
        "usar_cashback": False,
        "tipo_pedido": "delivery",
        "idempotency_key": key,
    }
    payload.update(overrides)
    return payload


# ─── TESTES UNITÁRIOS DE FINGERPRINT ──────────────────────────────────────────


def test_unit_canonical_fingerprint_format_and_version():
    """Valida formato sha256 de 64 chars hex e versão 1."""
    fp_res = compute_order_intent_fingerprint(
        restaurante_id=RESTAURANTE_ID,
        tipo_pedido="delivery",
        itens=[
            {
                "produto_id": PRODUTO_1_ID,
                "quantidade": 1,
                "observacao": "Sem cebola",
                "modificador_ids": [MOD_BACON_ID],
            }
        ],
        endereco_entrega="Rua A, 1",
        bairro="Centro",
        forma_pagamento="na_entrega",
        forma_pagamento_detalhe="dinheiro",
        troco_para=50.0,
        cliente_nome="Ana",
        cliente_telefone="81999990000",
        cliente_email="ana@koma.test",
    )
    assert len(fp_res.fingerprint) == 64
    assert fp_res.version == 1
    assert all(c in "0123456789abcdef" for c in fp_res.fingerprint)


def test_unit_json_keys_and_items_ordering_are_deterministic():
    """Dicionários com chaves em ordem diferente produzem o mesmo fingerprint."""
    d1 = build_order_intent_canonical_dict(
        restaurante_id=RESTAURANTE_ID,
        tipo_pedido="delivery",
        itens=[
            {
                "produto_id": PRODUTO_1_ID,
                "quantidade": 2,
                "observacao": "X",
                "modificador_ids": [MOD_QUEIJO_ID, MOD_BACON_ID],
            }
        ],
        endereco_entrega="Rua B, 2",
    )
    d2 = build_order_intent_canonical_dict(
        restaurante_id=RESTAURANTE_ID,
        tipo_pedido="delivery",
        endereco_entrega="Rua B, 2",
        itens=[
            {
                "modificador_ids": [MOD_BACON_ID, MOD_QUEIJO_ID],  # Ordem trocada
                "observacao": "X",
                "quantidade": 2,
                "produto_id": PRODUTO_1_ID,
            }
        ],
    )
    fp1 = compute_order_intent_fingerprint(
        restaurante_id=RESTAURANTE_ID,
        tipo_pedido="delivery",
        itens=[
            {
                "produto_id": PRODUTO_1_ID,
                "quantidade": 2,
                "observacao": "X",
                "modificador_ids": [MOD_QUEIJO_ID, MOD_BACON_ID],
            }
        ],
        endereco_entrega="Rua B, 2",
    )
    fp2 = compute_order_intent_fingerprint(
        restaurante_id=RESTAURANTE_ID,
        tipo_pedido="delivery",
        endereco_entrega="Rua B, 2",
        itens=[
            {
                "modificador_ids": [MOD_BACON_ID, MOD_QUEIJO_ID],  # Ordem trocada
                "observacao": "X",
                "quantidade": 2,
                "produto_id": PRODUTO_1_ID,
            }
        ],
    )
    assert d1 == d2
    assert fp1.fingerprint == fp2.fingerprint


def test_unit_normalization_phone_coupon_address():
    """Valida normalização de telefone, cupom maiúsculo e espaços."""
    fp1 = compute_order_intent_fingerprint(
        restaurante_id=RESTAURANTE_ID,
        tipo_pedido="delivery",
        itens=[{"produto_id": PRODUTO_1_ID, "quantidade": 1}],
        endereco_entrega="  Rua Exemplo, 100  ",
        cliente_telefone="(81) 98888-7777",
        cupom_codigo="  desc10  ",
        cliente_email="  TESTE@Koma.Test ",
    )
    fp2 = compute_order_intent_fingerprint(
        restaurante_id=RESTAURANTE_ID,
        tipo_pedido="delivery",
        itens=[{"produto_id": PRODUTO_1_ID, "quantidade": 1}],
        endereco_entrega="Rua Exemplo, 100",
        cliente_telefone="81988887777",
        cupom_codigo="DESC10",
        cliente_email="teste@koma.test",
    )
    assert fp1.fingerprint == fp2.fingerprint


# ─── TESTES DE INTEGRAÇÃO API (/cardapio/pedidos) ──────────────────────────────


def test_1_mesma_chave_payload_identico_reusa_pedido_e_persiste_fingerprint():
    """1. Mesma chave + payload idêntico -> mesmo pedido (idêntico número/total/comanda_id)."""
    key = "idemp-test-identico-0001"
    payload = _base_payload(key=key, phone="81999990001")
    headers = {"X-Idempotency-Key": key}

    res1 = client.post("/cardapio/pedidos", json=payload, headers=headers)
    assert res1.status_code == 201, res1.text
    data1 = res1.json()

    res2 = client.post("/cardapio/pedidos", json=payload, headers=headers)
    assert res2.status_code == 201, res2.text
    data2 = res2.json()

    assert data1["comanda_id"] == data2["comanda_id"]
    assert data1["numero_pedido"] == data2["numero_pedido"]
    assert data1["total"] == data2["total"]

    # Verifica persistência no banco
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == RESTAURANTE_ID,
            Comanda.id == data1["comanda_id"],
        ).first()
        assert comanda is not None
        assert comanda.idempotency_key == key
        assert comanda.idempotency_fingerprint is not None
        assert len(comanda.idempotency_fingerprint) == 64
        assert comanda.idempotency_fingerprint_version == 1
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_2_mesma_chave_quantidade_diferente_retorna_409():
    """2. Mesma chave + quantidade diferente -> 409."""
    key = "idemp-test-qty-diff-0002"
    p1 = _base_payload(key=key, phone="81999990002")
    p2 = _base_payload(key=key, phone="81999990002")
    p2["itens"] = [{
        "produto_id": PRODUTO_1_ID,
        "quantidade": 2,  # Alterado
        "observacao": "Sem picles",
        "modificador_ids": [MOD_BACON_ID],
    }]

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


def test_3_mesma_chave_modalidade_diferente_retorna_409():
    """3. Mesma chave + modalidade diferente (delivery vs retirada) -> 409."""
    key = "idemp-test-modalidade-0003"
    p1 = _base_payload(key=key, phone="81999990003", tipo_pedido="delivery")
    p2 = _base_payload(key=key, phone="81999990003", tipo_pedido="retirada", endereco_entrega="", taxa_entrega=0.0)

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


def test_4_mesma_chave_complemento_diferente_retorna_409():
    """4. Mesma chave + complemento diferente -> 409."""
    key = "idemp-test-mod-diff-0004"
    p1 = _base_payload(key=key, phone="81999990004")
    p1["itens"][0]["modificador_ids"] = [MOD_BACON_ID]

    p2 = _base_payload(key=key, phone="81999990004")
    p2["itens"][0]["modificador_ids"] = [MOD_QUEIJO_ID]  # Alterado

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


def test_5_mesma_chave_observacao_diferente_retorna_409():
    """5. Mesma chave + observação diferente -> 409."""
    key = "idemp-test-obs-diff-0005"
    p1 = _base_payload(key=key, phone="81999990005")
    p1["itens"][0]["observacao"] = "Sem cebola"

    p2 = _base_payload(key=key, phone="81999990005")
    p2["itens"][0]["observacao"] = "Com bastante cebola"

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


def test_6_mesma_chave_endereco_diferente_retorna_409():
    """6. Mesma chave + endereço diferente -> 409."""
    key = "idemp-test-addr-diff-0006"
    p1 = _base_payload(key=key, phone="81999990006", endereco_entrega="Rua Alfa, 10")
    p2 = _base_payload(key=key, phone="81999990006", endereco_entrega="Rua Beta, 20")

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


def test_7_mesma_chave_bairro_diferente_retorna_409():
    """7. Mesma chave + bairro diferente -> 409."""
    key = "idemp-test-bairro-diff-0007"
    p1 = _base_payload(key=key, phone="81999990007", bairro="Boa Viagem")
    p2 = _base_payload(key=key, phone="81999990007", bairro="Graças")

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


def test_8_mesma_chave_forma_pagamento_detalhe_diferente_retorna_409():
    """8. Mesma chave + forma_pagamento_detalhe diferente -> 409."""
    key = "idemp-test-pay-diff-0008"
    p1 = _base_payload(key=key, phone="81999990008", forma_pagamento_detalhe="dinheiro")
    p2 = _base_payload(key=key, phone="81999990008", forma_pagamento_detalhe="cartao_credito")

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


def test_9_mesma_chave_troco_diferente_retorna_409():
    """9. Mesma chave + troco_para diferente -> 409."""
    key = "idemp-test-troco-diff-0009"
    p1 = _base_payload(key=key, phone="81999990009", troco_para=50.0)
    p2 = _base_payload(key=key, phone="81999990009", troco_para=100.0)

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


def test_10_mesma_chave_cupom_diferente_retorna_409():
    """10. Mesma chave + cupom diferente -> 409."""
    key = "idemp-test-cupom-diff-0010"
    p1 = _base_payload(key=key, phone="81999990010", cupom_codigo=CUPOM_1_COD)
    p2 = _base_payload(key=key, phone="81999990010", cupom_codigo=CUPOM_2_COD)

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


def test_11_mesma_chave_cashback_diferente_retorna_409():
    """11. Mesma chave + cashback diferente -> 409."""
    key = "idemp-test-cashback-diff-0011"
    p1 = _base_payload(key=key, phone="81999990011", usar_cashback=False)
    p2 = _base_payload(key=key, phone="81999990011", usar_cashback=True)

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


def test_12_mesma_chave_cliente_email_diferente_retorna_409():
    """12. Mesma chave + cliente_email diferente -> 409."""
    key = "idemp-test-email-diff-0012"
    p1 = _base_payload(key=key, phone="81999990012", cliente_email="user1@koma.test")
    p2 = _base_payload(key=key, phone="81999990012", cliente_email="user2@koma.test")

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


def test_13_mesma_chave_scheduled_for_diferente_retorna_409():
    """13. Mesma chave + scheduled_for diferente -> 409."""
    key = "idemp-test-sched-diff-0013"
    future_time_1 = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2)).isoformat()
    future_time_2 = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=4)).isoformat()

    p1 = _base_payload(key=key, phone="81999990013", scheduled_for=future_time_1)
    p2 = _base_payload(key=key, phone="81999990013", scheduled_for=future_time_2)

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


def test_14_mesma_chave_json_reordenado_retorna_mesmo_pedido():
    """14. Mesma chave + campos em ordem diferente no JSON -> mesmo fingerprint, 201 com mesmo pedido."""
    key = "idemp-test-reorder-0014"
    # Payload 1 com ordem padrão
    p1 = _base_payload(key=key, phone="81999990014")
    # Payload 2 com chaves invertidas
    p2 = {
        "idempotency_key": key,
        "tipo_pedido": p1["tipo_pedido"],
        "cliente_nome": p1["cliente_nome"],
        "restaurante_id": p1["restaurante_id"],
        "taxa_entrega": p1["taxa_entrega"],
        "endereco_entrega": p1["endereco_entrega"],
        "bairro": p1["bairro"],
        "cliente_telefone": p1["cliente_telefone"],
        "cliente_email": p1["cliente_email"],
        "forma_pagamento": p1["forma_pagamento"],
        "forma_pagamento_detalhe": p1["forma_pagamento_detalhe"],
        "troco_para": p1["troco_para"],
        "cupom_codigo": p1["cupom_codigo"],
        "usar_cashback": p1["usar_cashback"],
        "itens": [
            {
                "observacao": p1["itens"][0]["observacao"],
                "quantidade": p1["itens"][0]["quantidade"],
                "produto_id": p1["itens"][0]["produto_id"],
                "modificador_ids": p1["itens"][0]["modificador_ids"],
            }
        ],
    }

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 201, r2.text
    assert r2.json()["comanda_id"] == r1.json()["comanda_id"]


def test_15_mesma_chave_modificadores_reordenados_retorna_mesmo_pedido():
    """15. Mesma chave + lista de complementos com IDs reordenados -> mesmo fingerprint, 201 com mesmo pedido."""
    key = "idemp-test-mod-order-0015"
    p1 = _base_payload(key=key, phone="81999990015")
    p1["itens"][0]["modificador_ids"] = [MOD_BACON_ID, MOD_QUEIJO_ID]

    p2 = _base_payload(key=key, phone="81999990015")
    p2["itens"][0]["modificador_ids"] = [MOD_QUEIJO_ID, MOD_BACON_ID]  # Ordem invertida

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 201, r2.text
    assert r2.json()["comanda_id"] == r1.json()["comanda_id"]


def test_16_normalizacao_whitespace_case_retorna_mesmo_pedido():
    """16. Normalização de whitespaces/case onde especificado -> mesmo fingerprint, 201 com mesmo pedido."""
    key = "idemp-test-normalization-0016"
    p1 = _base_payload(
        key=key,
        phone="81999990016",
        cliente_telefone="81999990016",
        cupom_codigo="DESC10",
        cliente_email="cliente@koma.test",
        endereco_entrega="Rua das Flores, 123",
    )
    p2 = _base_payload(
        key=key,
        phone="81999990016",
        cliente_telefone="(81) 99999-0016",
        cupom_codigo=" desc10 ",
        cliente_email=" CLIENTE@KOMA.TEST ",
        endereco_entrega="  Rua das Flores, 123  ",
    )

    r1 = client.post("/cardapio/pedidos", json=p1, headers={"X-Idempotency-Key": key})
    assert r1.status_code == 201, r1.text

    r2 = client.post("/cardapio/pedidos", json=p2, headers={"X-Idempotency-Key": key})
    assert r2.status_code == 201, r2.text
    assert r2.json()["comanda_id"] == r1.json()["comanda_id"]


def test_17_pedido_legado_sem_fingerprint_fallback():
    """17. Pedido legado com fingerprint=NULL:
    - reenvio compatível funciona (fallback legado preservado)
    - reenvio conflitante falha com 409
    """
    key = "idemp-test-legacy-0017"
    p_compativel = _base_payload(key=key, phone="81999990017")

    # 1. Cria pedido normalmente para ter a estrutura completa gerada
    r_init = client.post("/cardapio/pedidos", json=p_compativel, headers={"X-Idempotency-Key": key})
    assert r_init.status_code == 201, r_init.text
    legacy_comanda_id = r_init.json()["comanda_id"]

    # 2. Força no banco que o pedido seja legado (fingerprint=None)
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        comanda = db.query(Comanda).filter(Comanda.id == legacy_comanda_id).one()
        comanda.idempotency_fingerprint = None
        comanda.idempotency_fingerprint_version = None
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()

    # 3. Reenvio compatível deve ter sucesso e reusar o pedido legado
    r_compat = client.post("/cardapio/pedidos", json=p_compativel, headers={"X-Idempotency-Key": key})
    assert r_compat.status_code == 201, r_compat.text
    assert r_compat.json()["comanda_id"] == legacy_comanda_id

    # 4. Reenvio conflitante (quantidade alterada) deve falhar com 409
    p_conflito = _base_payload(key=key, phone="81999990017")
    p_conflito["itens"][0]["quantidade"] = 5
    r_conflict = client.post("/cardapio/pedidos", json=p_conflito, headers={"X-Idempotency-Key": key})
    assert r_conflict.status_code == 409, r_conflict.text
    assert r_conflict.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."


# ─── TESTES DE CONCORRÊNCIA COM THREADS ────────────────────────────────────────


@pytest.mark.skipif(
    not POSTGRES_URL or "sqlite" in POSTGRES_URL.lower(),
    reason="Requer PostgreSQL para teste de concorrência real com multi-threading",
)
def test_18_concorrencia_mesma_chave_mesmo_payload_um_vencedor_outro_reusa():
    """18. Mesma chave + mesmo payload concorrente: 1 grava, outro reusa (ambos 201 com mesmo comanda_id)."""
    key = "idemp-test-conc-same-0018"
    payload = _base_payload(key=key, phone="81999990018")
    headers = {"X-Idempotency-Key": key}

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(client.post, "/cardapio/pedidos", json=payload, headers=headers)
        f2 = executor.submit(client.post, "/cardapio/pedidos", json=payload, headers=headers)
        r1 = f1.result()
        r2 = f2.result()

    assert r1.status_code == 201, r1.text
    assert r2.status_code == 201, r2.text
    assert r1.json()["comanda_id"] == r2.json()["comanda_id"]


@pytest.mark.skipif(
    not POSTGRES_URL or "sqlite" in POSTGRES_URL.lower(),
    reason="Requer PostgreSQL para teste de concorrência real com multi-threading",
)
def test_19_concorrencia_mesma_chave_payloads_conflitantes_um_vencedor_outro_409():
    """19. Mesma chave + payloads conflitantes concorrentes: 1 grava (201), outro é 409."""
    key = "idemp-test-conc-conflict-0019"
    p1 = _base_payload(key=key, phone="81999990019")
    p1["itens"][0]["quantidade"] = 1

    p2 = _base_payload(key=key, phone="81999990019")
    p2["itens"][0]["quantidade"] = 2

    headers = {"X-Idempotency-Key": key}

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(client.post, "/cardapio/pedidos", json=p1, headers=headers)
        f2 = executor.submit(client.post, "/cardapio/pedidos", json=p2, headers=headers)
        r1 = f1.result()
        r2 = f2.result()

    statuses = {r1.status_code, r2.status_code}
    assert statuses == {201, 409}, f"Status inesperados: {r1.status_code}, {r2.status_code}"

    loser = r1 if r1.status_code == 409 else r2
    assert loser.json()["detail"] == "A chave idempotente já foi usada com outro conteúdo de pedido."
