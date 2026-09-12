import datetime

from app.application.printing.comanda_renderer import (
    ComandaVariant,
    render_canonical_comanda,
)
from app.domain.printing import PrintItem
from app.printer_service import (
    ESC_BOLD_OFF,
    ESC_BOLD_ON,
    ESC_DOUBLE_HEIGHT_ON,
    ESC_FONT_A,
    ESC_NORMAL_SIZE,
    ESC_RECEIPT_LINE,
    printer_service,
)


LOCAL_TIMEZONE = datetime.timezone(datetime.timedelta(hours=-3))


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


def test_online_pickup_hides_operator_and_prints_customer_payment_and_paid_warning():
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
            location_label=None,
            operator_label=None,
            customer_name="GEORLAN",
            customer_phone="88999991234",
            event_at=datetime.datetime(2026, 8, 31, 22, 15, tzinfo=LOCAL_TIMEZONE),
            payment_method="pix",
            online_payment_status="approved",
            amount_paid=12.0,
            show_financial_breakdown=True,
        ),
    )

    assert ticket.startswith(ESC_RECEIPT_LINE + ESC_FONT_A)
    assert "BAGUETERIA E PASTELARIA POR DO SOL" in ticket
    assert "RETIRADA" in ticket
    assert "ORIGEM: CARDÁPIO ONLINE" in ticket
    assert "PEDIDO #93" in ticket
    assert "PEDIDO: #93" not in ticket
    assert ESC_DOUBLE_HEIGHT_ON + ESC_BOLD_ON in ticket
    assert ESC_BOLD_OFF + ESC_NORMAL_SIZE in ticket
    assert "DATA: 31/08/2026" in ticket
    assert "HORA: 22:15" in ticket
    assert "OPERADOR:" not in ticket
    assert "CANAL:" not in ticket
    assert "CLIENTE" in ticket
    assert "NOME: GEORLAN" in ticket
    assert "TELEFONE: (88) 9XXXX-XX34" in ticket
    assert "FIDELIDADE:" not in ticket
    assert "ITENS" in ticket
    assert "VALOR" in ticket
    assert "1x REFRIGERANTE 1L" in ticket
    assert "R$ 12,00" in ticket
    assert "PAGAMENTO" in ticket
    assert ESC_BOLD_ON + "FORMA: PIX ONLINE" + ESC_BOLD_OFF in ticket
    assert "VALOR PAGO: R$ 12,00" in ticket
    assert "PAGO ONLINE" in ticket
    assert "NÃO COBRAR DO CLIENTE" in ticket
    assert "SUBTOTAL ITENS:" in ticket
    assert "TOTAL DO PEDIDO:" in ticket
    assert "TOTAL GERAL DA MESA:" not in ticket
    assert f"Gerenciado por {ESC_BOLD_ON}Kôma{ESC_BOLD_OFF}" in ticket
    assert "Documento não fiscal" in ticket


def test_online_reprint_is_same_base_plus_reprint_marker_without_operator_metadata():
    ticket = _render(
        [PrintItem(codigo="202", nome="COMBO AMIZADE", preco_unit=59.90)],
        ComandaVariant(
            origin_label="CARDÁPIO ONLINE",
            location_label=None,
            operator_label=None,
            customer_name="GEORLAN",
            customer_phone="88999991234",
            payment_method="dinheiro",
            is_reprint=True,
            show_financial_breakdown=True,
        ),
    )

    assert ticket.count("REIMPRESSÃO") == 1
    assert "ORIGEM: CARDÁPIO ONLINE" in ticket
    assert "PEDIDO #93" in ticket
    assert "OPERADOR:" not in ticket
    assert "CANAL:" not in ticket
    assert ESC_BOLD_ON + "FORMA: DINHEIRO" + ESC_BOLD_OFF in ticket
    assert "TOTAL DO PEDIDO:" in ticket


def test_delivery_keeps_customer_loyalty_payment_and_full_financial_breakdown():
    ticket = _render(
        [
            PrintItem(codigo="001", nome="HAMBÚRGUER", preco_unit=27.0),
            PrintItem(codigo="010", nome="REFRIGERANTE", preco_unit=8.0),
        ],
        ComandaVariant(
            origin_label="CARDÁPIO ONLINE",
            location_label=None,
            operator_label=None,
            customer_name="MARIA",
            customer_phone="88999991234",
            loyalty_previous_orders=15,
            event_at=datetime.datetime(2026, 8, 31, 22, 20, tzinfo=LOCAL_TIMEZONE),
            delivery_address="Rua José de Alencar, 124, Apto 302",
            delivery_neighborhood="Centro",
            payment_method="dinheiro",
            change_for=50.0,
            delivery_fee=5.0,
            coupon_discount=3.0,
            cashback_discount=2.0,
            show_financial_breakdown=True,
        ),
        order_type="Delivery",
    )

    assert ticket.startswith(ESC_RECEIPT_LINE + ESC_FONT_A)
    assert "DELIVERY" in ticket
    assert "ORIGEM: CARDÁPIO ONLINE" in ticket
    assert "PEDIDO #93" in ticket
    assert "OPERADOR:" not in ticket
    assert "CANAL:" not in ticket
    assert "CLIENTE" in ticket
    assert "NOME: MARIA" in ticket
    assert "TELEFONE: (88) 9XXXX-XX34" in ticket
    assert "FIDELIDADE: 15 PEDIDOS ANTERIORES" in ticket
    assert "ENTREGA" in ticket
    assert "ENDEREÇO: Rua José de Alencar, 124," in ticket
    assert "BAIRRO: Centro" in ticket
    assert "PAGAMENTO" in ticket
    assert ESC_BOLD_ON + "FORMA: DINHEIRO" + ESC_BOLD_OFF in ticket
    assert "TROCO PARA: R$ 50,00" in ticket
    assert "SUBTOTAL ITENS:" in ticket
    assert "R$ 35,00" in ticket
    assert "TAXA DE ENTREGA:" in ticket
    assert "R$ 5,00" in ticket
    assert "DESCONTO CUPOM:" in ticket
    assert "-R$ 3,00" in ticket
    assert "DESCONTO CASHBACK:" in ticket
    assert "-R$ 2,00" in ticket
    assert "TOTAL DO PEDIDO:" in ticket
    assert ticket.count("R$ 35,00") >= 2


def test_cashback_without_registered_loyalty_keeps_basic_customer_block_only():
    ticket = _render(
        [PrintItem(codigo="001", nome="HAMBÚRGUER", preco_unit=27.0)],
        ComandaVariant(
            origin_label="CARDÁPIO ONLINE",
            location_label=None,
            operator_label=None,
            customer_name="VISITANTE",
            customer_phone="88999991234",
            payment_method="pix",
            cashback_discount=2.0,
            show_financial_breakdown=True,
        ),
    )

    assert "NOME: VISITANTE" in ticket
    assert "TELEFONE: (88) 9XXXX-XX34" in ticket
    assert "FIDELIDADE:" not in ticket
    assert "DESCONTO CASHBACK:" in ticket


def test_secondary_sector_still_uses_same_visual_base():
    ticket = _render(
        [PrintItem(codigo="B01", nome="DRINK DA CASA", preco_unit=18.0)],
        ComandaVariant(
            origin_label="CARDÁPIO ONLINE",
            location_label=None,
            operator_label=None,
            via_label="BAR",
        ),
    )

    assert ticket.startswith(ESC_RECEIPT_LINE + ESC_FONT_A)
    assert "VIA: BAR" in ticket
    assert "PEDIDO #93" in ticket
    assert "ITENS" in ticket
    assert "VALOR" in ticket
    assert f"Gerenciado por {ESC_BOLD_ON}Kôma{ESC_BOLD_OFF}" in ticket
