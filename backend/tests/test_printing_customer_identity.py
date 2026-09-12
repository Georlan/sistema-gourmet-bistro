from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.application.printing.service import PrintingApplicationService


def test_printing_customer_identity_prefers_canonical_cliente_id():
    db = Mock()
    comanda = SimpleNamespace(
        cliente_id="cliente-canonico-123",
        delivery_telefone="(88) 99999-0000",
    )

    with patch(
        "app.application.printing.service.buscar_cliente_por_telefone"
    ) as buscar_por_telefone:
        resolved = PrintingApplicationService._resolve_registered_customer_id(
            db,
            restaurant_id=1,
            comanda=comanda,
        )

    assert resolved == "cliente-canonico-123"
    buscar_por_telefone.assert_not_called()


def test_printing_customer_identity_uses_normalized_phone_only_as_lookup_fallback():
    db = Mock()
    comanda = SimpleNamespace(
        cliente_id=None,
        delivery_telefone="(88) 9 9999-0000",
    )
    cliente = SimpleNamespace(id="cliente-resolvido-telefone")

    with patch(
        "app.application.printing.service.buscar_cliente_por_telefone",
        return_value=cliente,
    ) as buscar_por_telefone:
        resolved = PrintingApplicationService._resolve_registered_customer_id(
            db,
            restaurant_id=77,
            comanda=comanda,
        )

    assert resolved == "cliente-resolvido-telefone"
    buscar_por_telefone.assert_called_once_with(
        db,
        restaurante_id=77,
        telefone="(88) 9 9999-0000",
    )


def test_printing_customer_identity_ignores_invalid_or_unregistered_phone():
    db = Mock()
    comanda = SimpleNamespace(cliente_id=None, delivery_telefone="SEM TELEFONE")

    with patch(
        "app.application.printing.service.buscar_cliente_por_telefone",
        side_effect=ValueError("telefone inválido"),
    ):
        resolved = PrintingApplicationService._resolve_registered_customer_id(
            db,
            restaurant_id=1,
            comanda=comanda,
        )

    assert resolved is None
