"""Testes das regras canônicas de entrega e autoridade do servidor.

Cobre:
- autoridade do servidor sobre a taxa de entrega
- validação de cobertura antes do frete grátis
- taxa fixa e taxa por bairro
- rejeição de bairro vazio ou fora da tabela
- pickup sempre zero
- persistência de taxa_entrega_fixa via GET/PUT
"""

from decimal import Decimal
import pytest
from sqlalchemy.orm import Session

from app.application.orders.service import OrderApplicationService
from app.database import SessionLocal
from app.domain.orders.errors import OrderValidationError
from app.domain.orders.types import FulfillmentType
from app.models import ConfiguracaoRestaurante, Restaurante
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


class TestDeliveryCanonicalRules:
    def _get_or_create_config(self, db: Session) -> ConfiguracaoRestaurante:
        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == CHAR_RESTAURANT_ID
        ).first()
        if not config:
            config = ConfiguracaoRestaurante(
                restaurante_id=CHAR_RESTAURANT_ID,
                delivery_ativo=True,
                tipo_taxa_entrega="fixa",
                taxa_entrega_fixa=7.0,
            )
            db.add(config)
            db.commit()
            db.refresh(config)
        return config

    def test_resolve_delivery_fee_pickup_sempre_zero(self, char_setup):
        """Para retiradas ou salão, taxa de entrega é sempre zero."""
        db: Session = SessionLocal()
        try:
            fee = OrderApplicationService.resolve_server_delivery_fee(
                db=db,
                restaurante_id=CHAR_RESTAURANT_ID,
                fulfillment=FulfillmentType.PICKUP,
                items_subtotal=Decimal("50.00"),
                neighborhood="Centro",
            )
            assert fee == Decimal("0.00")
        finally:
            db.close()

    def test_resolve_delivery_fee_fixa(self, char_setup):
        """Em modo taxa fixa, o servidor aplica estritamente taxa_entrega_fixa."""
        db: Session = SessionLocal()
        try:
            config = self._get_or_create_config(db)
            config.tipo_taxa_entrega = "fixa"
            config.taxa_entrega_fixa = 8.50
            config.frete_gratis_valor = 0.0
            db.commit()

            fee = OrderApplicationService.resolve_server_delivery_fee(
                db=db,
                restaurante_id=CHAR_RESTAURANT_ID,
                fulfillment=FulfillmentType.DELIVERY,
                items_subtotal=Decimal("30.00"),
                neighborhood="Qualquer Lugar",
            )
            assert fee == Decimal("8.50")
        finally:
            config.taxa_entrega_fixa = 7.0
            db.commit()
            db.close()

    def test_resolve_delivery_fee_bairro_cadastrado(self, char_setup):
        """Em modo bairro, aplica a taxa correspondente ao bairro cadastrado."""
        db: Session = SessionLocal()
        try:
            config = self._get_or_create_config(db)
            config.tipo_taxa_entrega = "bairro"
            config.tabela_taxas_bairros = [
                {"bairro": "Centro", "taxa": 6.0},
                {"bairro": "Jardins", "taxa": 12.0},
            ]
            config.frete_gratis_valor = 0.0
            db.commit()

            fee_centro = OrderApplicationService.resolve_server_delivery_fee(
                db=db,
                restaurante_id=CHAR_RESTAURANT_ID,
                fulfillment=FulfillmentType.DELIVERY,
                items_subtotal=Decimal("40.00"),
                neighborhood="centro",  # Case-insensitive
            )
            assert fee_centro == Decimal("6.00")

            fee_jardins = OrderApplicationService.resolve_server_delivery_fee(
                db=db,
                restaurante_id=CHAR_RESTAURANT_ID,
                fulfillment=FulfillmentType.DELIVERY,
                items_subtotal=Decimal("40.00"),
                neighborhood="  JARDINS  ",
            )
            assert fee_jardins == Decimal("12.00")
        finally:
            config.tipo_taxa_entrega = "fixa"
            config.tabela_taxas_bairros = []
            db.commit()
            db.close()

    def test_resolve_delivery_fee_bairro_vazio_rejeita(self, char_setup):
        """Em modo bairro, não informar o bairro resulta em OrderValidationError."""
        db: Session = SessionLocal()
        try:
            config = self._get_or_create_config(db)
            config.tipo_taxa_entrega = "bairro"
            config.tabela_taxas_bairros = [{"bairro": "Centro", "taxa": 5.0}]
            db.commit()

            with pytest.raises(OrderValidationError) as exc:
                OrderApplicationService.resolve_server_delivery_fee(
                    db=db,
                    restaurante_id=CHAR_RESTAURANT_ID,
                    fulfillment=FulfillmentType.DELIVERY,
                    items_subtotal=Decimal("40.00"),
                    neighborhood="",
                )
            assert "Bairro de entrega é obrigatório" in str(exc.value)
        finally:
            config.tipo_taxa_entrega = "fixa"
            db.commit()
            db.close()

    def test_resolve_delivery_fee_bairro_inexistente_rejeita(self, char_setup):
        """Bairro fora da tabela cadastrada deve ser rejeitado por falta de cobertura."""
        db: Session = SessionLocal()
        try:
            config = self._get_or_create_config(db)
            config.tipo_taxa_entrega = "bairro"
            config.tabela_taxas_bairros = [{"bairro": "Centro", "taxa": 5.0}]
            db.commit()

            with pytest.raises(OrderValidationError) as exc:
                OrderApplicationService.resolve_server_delivery_fee(
                    db=db,
                    restaurante_id=CHAR_RESTAURANT_ID,
                    fulfillment=FulfillmentType.DELIVERY,
                    items_subtotal=Decimal("40.00"),
                    neighborhood="Bairro Longe",
                )
            assert "não está na área de entrega" in str(exc.value)
        finally:
            config.tipo_taxa_entrega = "fixa"
            db.commit()
            db.close()

    def test_resolve_delivery_fee_cobertura_validada_antes_do_frete_gratis(self, char_setup):
        """Invariante crítica: frete grátis NÃO anula a checagem de cobertura.

        Se o bairro estiver fora da área atendida, o pedido deve falhar mesmo
        que o subtotal ultrapasse o limiar de frete grátis.
        """
        db: Session = SessionLocal()
        try:
            config = self._get_or_create_config(db)
            config.tipo_taxa_entrega = "bairro"
            config.tabela_taxas_bairros = [{"bairro": "Centro", "taxa": 5.0}]
            config.frete_gratis_valor = 50.0  # Frete grátis a partir de R$ 50
            db.commit()

            # Subtotal R$ 200,00 (acima de R$ 50), mas bairro não atendido:
            with pytest.raises(OrderValidationError) as exc:
                OrderApplicationService.resolve_server_delivery_fee(
                    db=db,
                    restaurante_id=CHAR_RESTAURANT_ID,
                    fulfillment=FulfillmentType.DELIVERY,
                    items_subtotal=Decimal("200.00"),
                    neighborhood="Fora da Cidade",
                )
            assert "não está na área de entrega" in str(exc.value)
        finally:
            config.tipo_taxa_entrega = "fixa"
            config.frete_gratis_valor = 0.0
            db.commit()
            db.close()

    def test_resolve_delivery_fee_frete_gratis_em_bairro_valido(self, char_setup):
        """Em bairro coberto, atingir o frete grátis zera a taxa."""
        db: Session = SessionLocal()
        try:
            config = self._get_or_create_config(db)
            config.tipo_taxa_entrega = "bairro"
            config.tabela_taxas_bairros = [{"bairro": "Centro", "taxa": 8.0}]
            config.frete_gratis_valor = 80.0
            db.commit()

            # Abaixo do frete grátis: taxa normal
            fee_paga = OrderApplicationService.resolve_server_delivery_fee(
                db=db,
                restaurante_id=CHAR_RESTAURANT_ID,
                fulfillment=FulfillmentType.DELIVERY,
                items_subtotal=Decimal("79.99"),
                neighborhood="Centro",
            )
            assert fee_paga == Decimal("8.00")

            # Atingiu o frete grátis: taxa 0
            fee_gratis = OrderApplicationService.resolve_server_delivery_fee(
                db=db,
                restaurante_id=CHAR_RESTAURANT_ID,
                fulfillment=FulfillmentType.DELIVERY,
                items_subtotal=Decimal("80.00"),
                neighborhood="Centro",
            )
            assert fee_gratis == Decimal("0.00")
        finally:
            config.tipo_taxa_entrega = "fixa"
            config.frete_gratis_valor = 0.0
            db.commit()
            db.close()

    def test_resolve_delivery_fee_tipo_invalido_rejeita(self, char_setup):
        """Tipo de taxa desconhecido gera erro explícito sem fallback silencioso."""
        db: Session = SessionLocal()
        try:
            config = self._get_or_create_config(db)
            config.tipo_taxa_entrega = "distancia_invalida"
            db.commit()

            with pytest.raises(OrderValidationError) as exc:
                OrderApplicationService.resolve_server_delivery_fee(
                    db=db,
                    restaurante_id=CHAR_RESTAURANT_ID,
                    fulfillment=FulfillmentType.DELIVERY,
                    items_subtotal=Decimal("30.00"),
                    neighborhood="Centro",
                )
            assert "inválido ou não suportado" in str(exc.value)
        finally:
            config.tipo_taxa_entrega = "fixa"
            db.commit()
            db.close()

    def test_configuracoes_get_and_put_taxa_entrega_fixa(self, char_client, char_setup):
        """Endpoints /caixa/configuracoes leem e persistem taxa_entrega_fixa."""
        headers = char_setup["headers"]

        # 1. GET
        get_res = char_client.get("/caixa/configuracoes", headers=headers)
        assert get_res.status_code == 200
        data = get_res.json()
        assert "taxa_entrega_fixa" in data
        assert "tipo_taxa_entrega" in data

        # 2. PUT atualizando taxa_entrega_fixa
        put_res = char_client.put(
            "/caixa/configuracoes",
            headers=headers,
            json={
                "taxa_entrega_fixa": 9.50,
                "tipo_taxa_entrega": "fixa",
            },
        )
        assert put_res.status_code == 200

        # 3. GET novamente confirmando persistência
        get_res2 = char_client.get("/caixa/configuracoes", headers=headers)
        assert get_res2.status_code == 200
        assert get_res2.json()["taxa_entrega_fixa"] == 9.50

        # Reset para R$ 7.00
        char_client.put(
            "/caixa/configuracoes",
            headers=headers,
            json={"taxa_entrega_fixa": 7.00},
        )

    def test_public_cardapio_order_rejects_unserved_neighborhood_even_with_high_subtotal(
        self, char_client, char_setup
    ):
        """No endpoint público /cardapio/pedidos, bairro fora da cobertura é rejeitado com 400 mesmo com subtotal alto."""
        db: Session = SessionLocal()
        try:
            config = self._get_or_create_config(db)
            config.tipo_taxa_entrega = "bairro"
            config.tabela_taxas_bairros = [{"bairro": "Centro", "taxa": 5.0}]
            config.frete_gratis_valor = 30.0
            db.commit()

            # Cliente envia pedido com bairro fora da área atendida
            payload = {
                "restaurante_id": CHAR_RESTAURANT_ID,
                "itens": [{
                    "produto_id": "prod-char-simples",
                    "quantidade": 3,  # 3 x 25.00 = 75.00 (acima dos R$ 30 de frete grátis)
                }],
                "cliente_nome": "Cliente Fora",
                "cliente_telefone": "11988880000",
                "endereco_entrega": "Rua Sem Cobertura, 123",
                "bairro": "Bairro Inexistente",
                "taxa_entrega": 0.0,
                "forma_pagamento": "na_entrega",
                "tipo_pedido": "delivery",
                "idempotency_key": "test-bairro-out-of-coverage-001",
            }

            res = char_client.post(
                "/cardapio/pedidos",
                json=payload,
                headers={"X-Idempotency-Key": payload["idempotency_key"]},
            )
            assert res.status_code == 400
            assert "não está na área de entrega" in res.json()["detail"]
        finally:
            config.tipo_taxa_entrega = "fixa"
            config.frete_gratis_valor = 0.0
            config.tabela_taxas_bairros = []
            db.commit()
            db.close()

    def test_public_cardapio_order_applies_authoritative_neighborhood_fee_and_ignores_tampering(
        self, char_client, char_setup
    ):
        """No endpoint público /cardapio/pedidos, taxa é calculada autoritativamente e adulteração é ignorada."""
        db: Session = SessionLocal()
        try:
            config = self._get_or_create_config(db)
            config.tipo_taxa_entrega = "bairro"
            config.tabela_taxas_bairros = [{"bairro": "Centro", "taxa": 8.0}]
            config.frete_gratis_valor = 100.0
            db.commit()

            # Cliente tenta burlar enviando taxa 0.01
            payload = {
                "restaurante_id": CHAR_RESTAURANT_ID,
                "itens": [{
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,  # 25.00
                }],
                "cliente_nome": "Cliente Centro",
                "cliente_telefone": "11988880001",
                "endereco_entrega": "Rua Central, 50",
                "bairro": "Centro",
                "taxa_entrega": 0.01,  # Tentativa de adulteração
                "forma_pagamento": "na_entrega",
                "tipo_pedido": "delivery",
                "idempotency_key": "test-bairro-authoritative-002",
            }

            res = char_client.post(
                "/cardapio/pedidos",
                json=payload,
                headers={"X-Idempotency-Key": payload["idempotency_key"]},
            )
            assert res.status_code == 201
            # Subtotal (25.00) + Taxa do bairro Centro (8.00) = 33.00
            assert res.json()["total"] == 33.00
        finally:
            config.tipo_taxa_entrega = "fixa"
            config.frete_gratis_valor = 0.0
            config.tabela_taxas_bairros = []
            db.commit()
            db.close()

