"""Adapter canônico para Ingress de Marketplaces e Canais Externos (iFood, 99Food, Keeta, etc).

Regra Fundamental:
'O marketplace não cria pedido. O marketplace pede ao KÔMA para criar um pedido.'
"""

from __future__ import annotations

import abc
import datetime
from typing import Any, Optional
import uuid
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...application.orders.commands import CreateOrderCommand
from ...application.orders.dto import OrderDTO
from ...application.orders.service import OrderApplicationService
from ...domain.orders.types import OrderChannel
from ...models import ExternalOrderReference


def resolve_external_reference(
    db: Session,
    restaurant_id: int,
    provider: str,
    external_order_id: str,
) -> Optional[ExternalOrderReference]:
    """Busca se uma referência externa já foi processada anteriormente."""
    return (
        db.query(ExternalOrderReference)
        .filter(
            ExternalOrderReference.restaurante_id == restaurant_id,
            ExternalOrderReference.provider == provider.lower().strip(),
            ExternalOrderReference.external_order_id == str(external_order_id).strip(),
        )
        .first()
    )


def record_external_reference(
    db: Session,
    restaurant_id: int,
    provider: str,
    external_order_id: str,
    internal_order_id: str,
    raw_payload: Optional[dict[str, Any]] = None,
) -> ExternalOrderReference:
    """Registra o vínculo unívoco entre o pedido do marketplace e o ID interno do KÔMA."""
    ref = ExternalOrderReference(
        id=str(uuid.uuid4()),
        restaurante_id=restaurant_id,
        provider=provider.lower().strip(),
        external_order_id=str(external_order_id).strip(),
        internal_order_id=str(internal_order_id),
        raw_payload=raw_payload,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(ref)
    db.flush()
    return ref


class MarketplaceProviderAdapter(abc.ABC):
    """Contrato base obrigatório para adapters de parceiros e marketplaces externos."""

    @property
    @abc.abstractmethod
    def provider_name(self) -> str:
        """Nome do provedor externo (ex: 'ifood', '99food', 'keeta')."""
        pass

    @abc.abstractmethod
    def translate_to_command(
        self,
        restaurant_id: int,
        raw_payload: dict[str, Any],
    ) -> tuple[str, CreateOrderCommand]:
        """Converte o payload bruto do provedor em (external_order_id, CreateOrderCommand)."""
        pass

    def handle_external_order(
        self,
        db: Session,
        restaurant_id: int,
        raw_payload: dict[str, Any],
    ) -> OrderDTO:
        """Processa a chegada de um pedido externo com garantia de idempotência estrita."""
        external_order_id, cmd = self.translate_to_command(restaurant_id, raw_payload)
        external_order_id_clean = str(external_order_id).strip()
        provider_clean = self.provider_name.lower().strip()

        # 1. Verifica se já foi recebido anteriormente (Idempotência externa)
        existing_ref = resolve_external_reference(
            db=db,
            restaurant_id=restaurant_id,
            provider=provider_clean,
            external_order_id=external_order_id_clean,
        )
        if existing_ref:
            # Retorna o pedido já existente sem re-executar validações ou estoque
            order_dto = OrderApplicationService.get_order(
                db=db,
                restaurant_id=restaurant_id,
                order_id=existing_ref.internal_order_id,
            )
            if order_dto:
                return order_dto

        # 2. Executa a criação pelo OrderApplicationService do KÔMA
        try:
            order_dto = OrderApplicationService.create_order(db=db, cmd=cmd, commit=False)
            
            # 3. Registra a referência externa na mesma transação
            record_external_reference(
                db=db,
                restaurant_id=restaurant_id,
                provider=provider_clean,
                external_order_id=external_order_id_clean,
                internal_order_id=str(order_dto.order_id),
                raw_payload=raw_payload,
            )
            db.commit()
            return order_dto

        except IntegrityError:
            db.rollback()
            # Em caso de corrida concorrente de webhook: busca a referência recém-gravada
            existing_ref = resolve_external_reference(
                db=db,
                restaurant_id=restaurant_id,
                provider=provider_clean,
                external_order_id=external_order_id_clean,
            )
            if existing_ref:
                order_dto = OrderApplicationService.get_order(
                    db=db,
                    restaurant_id=restaurant_id,
                    order_id=existing_ref.internal_order_id,
                )
                if order_dto:
                    return order_dto
            raise
