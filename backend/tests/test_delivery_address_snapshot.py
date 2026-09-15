from decimal import Decimal
import uuid

import pytest

from app.application.orders.commands import (
    CreateOrderCommand,
    CustomerInput,
    DeliveryAddressInput,
    DeliveryInput,
    OrderItemInput,
)
from app.application.orders.service import OrderApplicationService
from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.delivery_address_snapshot import (
    ComandaDeliveryAddressSnapshot,
    load_delivery_address_snapshot,
    persist_delivery_address_snapshot,
)
from app.domain.orders.errors import OrderValidationError
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.models import Comanda, Restaurante, Usuario
from tests.characterization.orders.fixtures import CHAR_RESTAURANT_ID, char_client, char_setup


def _address(**overrides) -> DeliveryAddressInput:
    values = {
        "street": "  Rua José de Alencar  ",
        "number": " 124 ",
        "complement": "  Apto 302 ",
        "neighborhood": "  Centro ",
        "city": " Fortaleza ",
        "state": " ce ",
        "postal_code": "60.010-000",
        "reference": "  próximo à praça  ",
        "latitude": -3.7319,
        "longitude": -38.5267,
    }
    values.update(overrides)
    return DeliveryAddressInput(**values)


def _service_address() -> DeliveryAddressInput:
    return DeliveryAddressInput(
        street="Rua Padre Valdevino",
        number="1500",
        complement="Sala 2",
        neighborhood="Aldeota",
        city="Fortaleza",
        state="CE",
        postal_code="60135-041",
        reference="ao lado da praça",
        latitude=-3.7357,
        longitude=-38.5016,
    )


def _service_command(*, structured: bool = True) -> CreateOrderCommand:
    snapshot = _service_address() if structured else None
    return CreateOrderCommand(
        restaurant_id=CHAR_RESTAURANT_ID,
        channel=OrderChannel.WEB_CARDAPIO,
        fulfillment=FulfillmentType.DELIVERY,
        items=(
            OrderItemInput(
                product_id="prod-char-simples",
                quantity=Decimal("1.00"),
            ),
        ),
        customer=CustomerInput(name="Cliente Endereço", phone="11999990001"),
        delivery=DeliveryInput(
            address=None if structured else "Endereço legado informado pelo cliente",
            neighborhood=None if structured else "Bairro legado",
            address_snapshot=snapshot,
        ),
    )


def test_structured_delivery_address_normalizes_and_formats_legacy_compatibility():
    address = _address()

    assert address.to_snapshot() == {
        "logradouro": "Rua José de Alencar",
        "numero": "124",
        "complemento": "Apto 302",
        "bairro": "Centro",
        "cidade": "Fortaleza",
        "uf": "CE",
        "cep": "60010000",
        "referencia": "próximo à praça",
        "latitude": -3.7319,
        "longitude": -38.5267,
    }
    assert address.to_legacy_address() == (
        "Rua José de Alencar, 124, Apto 302, Centro, Fortaleza - CE, "
        "CEP 60010-000, Ref.: próximo à praça"
    )


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"number": "   "}, "Número"),
        ({"state": "Ceará"}, "UF"),
        ({"postal_code": "60010"}, "CEP"),
        ({"latitude": -91}, "Latitude"),
        ({"longitude": 181}, "Longitude"),
        ({"longitude": None}, "Latitude e longitude"),
    ],
)
def test_structured_delivery_address_rejects_invalid_components(overrides, message):
    with pytest.raises(OrderValidationError, match=message):
        _address(**overrides)


def test_delivery_address_snapshot_is_encrypted_tenant_scoped_and_immutable():
    Base.metadata.create_all(bind=engine)
    suffix = uuid.uuid4().hex[:8]
    restaurante_id = 93000 + int(uuid.uuid4().hex[:3], 16) % 5000
    foreign_restaurante_id = restaurante_id + 10000
    user_id = f"u-address-{suffix}"
    comanda_id = f"c-address-{suffix}"
    token = current_restaurante_id.set(restaurante_id)

    try:
        with SessionLocal() as db:
            db.add_all(
                [
                    Restaurante(
                        id=restaurante_id,
                        nome=f"Restaurante Address {suffix}",
                        slug=f"address-{suffix}",
                    ),
                    Restaurante(
                        id=foreign_restaurante_id,
                        nome=f"Restaurante Foreign {suffix}",
                        slug=f"address-foreign-{suffix}",
                    ),
                ]
            )
            db.flush()
            db.add(
                Usuario(
                    id=user_id,
                    restaurante_id=restaurante_id,
                    nome="Operador Address",
                    cargo="admin",
                    status="ativo",
                )
            )
            db.flush()
            db.add(
                Comanda(
                    id=comanda_id,
                    restaurante_id=restaurante_id,
                    garcom_id=user_id,
                    numero_pedido=998801,
                    identificador="Cliente Snapshot",
                    tipo="Delivery",
                    delivery_status="pendente",
                    delivery_endereco="Rua legada preservada, 1",
                    delivery_bairro="Centro",
                    fechada=False,
                )
            )
            db.flush()

            address = _address()
            snapshot = persist_delivery_address_snapshot(
                db,
                restaurante_id=restaurante_id,
                comanda_id=comanda_id,
                address=address,
            )
            db.commit()

            assert snapshot is not None
            assert snapshot.payload_encrypted.startswith("gAAAAA")
            assert "Rua José de Alencar" not in snapshot.payload_encrypted
            assert load_delivery_address_snapshot(
                db,
                restaurante_id=restaurante_id,
                comanda_id=comanda_id,
            ) == address.to_snapshot()

            # A representação legada continua intacta e independente do snapshot.
            order = db.query(Comanda).filter(Comanda.id == comanda_id).one()
            assert order.delivery_endereco == "Rua legada preservada, 1"

            # Repetir exatamente o mesmo snapshot é idempotente.
            same = persist_delivery_address_snapshot(
                db,
                restaurante_id=restaurante_id,
                comanda_id=comanda_id,
                address=address,
            )
            assert same.comanda_id == comanda_id

            with pytest.raises(OrderValidationError, match="imutável"):
                persist_delivery_address_snapshot(
                    db,
                    restaurante_id=restaurante_id,
                    comanda_id=comanda_id,
                    address=_address(number="999"),
                )

            assert load_delivery_address_snapshot(
                db,
                restaurante_id=foreign_restaurante_id,
                comanda_id=comanda_id,
            ) is None

            stored = db.query(ComandaDeliveryAddressSnapshot).filter(
                ComandaDeliveryAddressSnapshot.comanda_id == comanda_id,
            ).one()
            assert stored.restaurante_id == restaurante_id
    finally:
        current_restaurante_id.reset(token)


def test_order_service_persists_structured_address_and_keeps_legacy_projection(char_setup):
    db = SessionLocal()
    try:
        address = _service_address()
        dto = OrderApplicationService.create_order(db, _service_command(structured=True))

        order = db.query(Comanda).filter(Comanda.id == dto.comanda_id).one()
        assert order.delivery_endereco == address.to_legacy_address()
        assert order.delivery_bairro == "Aldeota"
        assert load_delivery_address_snapshot(
            db,
            restaurante_id=CHAR_RESTAURANT_ID,
            comanda_id=str(dto.comanda_id),
        ) == address.to_snapshot()
    finally:
        db.close()


def test_legacy_delivery_order_remains_supported_without_structured_snapshot(char_setup):
    db = SessionLocal()
    try:
        dto = OrderApplicationService.create_order(db, _service_command(structured=False))

        order = db.query(Comanda).filter(Comanda.id == dto.comanda_id).one()
        assert order.delivery_endereco == "Endereço legado informado pelo cliente"
        assert order.delivery_bairro == "Bairro legado"
        assert load_delivery_address_snapshot(
            db,
            restaurante_id=CHAR_RESTAURANT_ID,
            comanda_id=str(dto.comanda_id),
        ) is None
    finally:
        db.close()


def test_structured_address_snapshot_rolls_back_with_order_transaction(char_setup):
    db = SessionLocal()
    try:
        dto = OrderApplicationService.create_order(
            db,
            _service_command(structured=True),
            commit=False,
        )
        comanda_id = str(dto.comanda_id)

        assert load_delivery_address_snapshot(
            db,
            restaurante_id=CHAR_RESTAURANT_ID,
            comanda_id=comanda_id,
        ) is not None

        db.rollback()

        assert db.query(Comanda).filter(Comanda.id == comanda_id).first() is None
        assert load_delivery_address_snapshot(
            db,
            restaurante_id=CHAR_RESTAURANT_ID,
            comanda_id=comanda_id,
        ) is None
    finally:
        db.close()
