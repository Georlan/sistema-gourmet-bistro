import datetime

from app.application.printing.comanda_renderer import (
    ComandaVariant,
    render_canonical_comanda,
)
from app.domain.printing import PrintItem
from app.printer_service import ESC_FONT_A, ESC_RECEIPT_LINE, printer_service


def _render(items, variant, *, order_type="Retirada"):
    old_width = printer_service.width
    printer_service.width = 40
    try:
        return render_canonical_comanda(
            restaurant_name="Bagueteria e Pastelaria Por do Sol",
            restaurant_name_position="cabecalho",
            print_footer=None,
            order_number=93,
            order_type=order_type,
            operator_name="Admin",
            items=items,
            variant=variant,
        )
    finally:
        printer_service.width = old_width


def test_online_pickup_uses_table_base_with_online_origin():
    ticket = _render(
        [
            PrintItem(
                codigo="ref-01",
                nome="REFRIGERANTE 1L",
                preco_unit=12.0,
                destino_impressao="NENHUM",
            )
        ],
        ComandaVariant(
            origin_label="CARDÁPIO ONLINE",
            location_label="BALCÃO",
            operator_label="OPERADOR",
            customer_name="GEORLAN",
            event_at=datetime.datetime(2026, 8, 31, 22, 15),
        ),
    )

    assert ticket.startswith(ESC_RECEIPT_LINE + ESC_FONT_A)
    assert "BAGUETERIA E PASTELARIA POR DO SOL" in ticket
    assert "RETIRADA" in ticket
    assert "ORIGEM: CARDÁPIO ONLINE" in ticket
    assert "BALCÃO" in ticket
    assert "DATA: 31/08/2026" in ticket
    assert "HORA: 22:15" in ticket
    assert "OPERADOR: Admin" in ticket
    assert "CLIENTE: GEORLAN" in ticket
    assert "1x REFRIGERANTE 1L" in ticket
    assert "R$ 12,00" in ticket
    assert "TOTAL DO PEDIDO:" in ticket
    assert "TOTAL GERAL DA MESA:" not in ticket
    assert "Gerenciado por Kôma" in ticket
    assert "Documento não fiscal" in ticket


def test_online_reprint_is_same_base_plus_reprint_marker():
    ticket = _render(
        [PrintItem(codigo="202", nome="COMBO AMIZADE", preco_unit=59.90)],
        ComandaVariant(
            origin_label="CARDÁPIO ONLINE",
            location_label="BALCÃO",
            customer_name="GEORLAN",
            is_reprint=True,
        ),
    )

    assert ticket.count("REIMPRESSÃO") == 1
    assert "ORIGEM: CARDÁPIO ONLINE" in ticket
    assert "TOTAL DO PEDIDO:" in ticket


def test_delivery_keeps_same_base_and_adds_delivery_context():
    ticket = _render(
        [
            PrintItem(codigo="001", nome="HAMBÚRGUER", preco_unit=27.0),
            PrintItem(codigo="010", nome="REFRIGERANTE", preco_unit=8.0),
        ],
        ComandaVariant(
            origin_label="CARDÁPIO ONLINE",
            location_label="ENTREGA",
            operator_label="OPERADOR",
            customer_name="MARIA",
            event_at=datetime.datetime(2026, 8, 31, 22, 20),
            delivery_phone="88999991234",
            delivery_address="Rua José de Alencar, 124, Apto 302",
            delivery_neighborhood="Centro",
            payment_method="dinheiro",
            change_for=50.0,
            delivery_fee=5.0,
        ),
        order_type="Delivery",
    )

    assert ticket.startswith(ESC_RECEIPT_LINE + ESC_FONT_A)
    assert "DELIVERY" in ticket
    assert "ORIGEM: CARDÁPIO ONLINE" in ticket
    assert "ENTREGA" in ticket
    assert "CLIENTE: MARIA" in ticket
    assert "DADOS DA ENTREGA" in ticket
    assert "TELEFONE: (88) 9XXXX-XX34" in ticket
    assert "ENDEREÇO: Rua José de Alencar, 124," in ticket
    assert "BAIRRO: Centro" in ticket
    assert "PAGAMENTO: DINHEIRO" in ticket
    assert "TROCO PARA: R$ 50,00" in ticket
    assert "SUBTOTAL ITENS:" in ticket
    assert "R$ 35,00" in ticket
    assert "TAXA DE ENTREGA:" in ticket
    assert "R$ 5,00" in ticket
    assert "TOTAL DO PEDIDO:" in ticket
    assert "R$ 40,00" in ticket


def test_secondary_sector_still_uses_same_visual_base():
    ticket = _render(
        [PrintItem(codigo="B01", nome="DRINK DA CASA", preco_unit=18.0)],
        ComandaVariant(
            origin_label="CARDÁPIO ONLINE",
            location_label="BALCÃO",
            via_label="BAR",
        ),
    )

    assert ticket.startswith(ESC_RECEIPT_LINE + ESC_FONT_A)
    assert "VIA: BAR" in ticket
    assert "ITENS" in ticket
    assert "Gerenciado por Kôma" in ticket
