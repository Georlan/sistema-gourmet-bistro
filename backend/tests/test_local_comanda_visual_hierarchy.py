import datetime
from pathlib import Path

from app.application.printing.comanda_renderer import (
    ComandaVariant,
    render_canonical_comanda,
)
from app.domain.printing import PrintItem
from app.printer_service import (
    ESC_BOLD_OFF,
    ESC_BOLD_ON,
    ESC_DOUBLE_HEIGHT_ON,
    ESC_NORMAL_SIZE,
    printer_service,
)


LOCAL_TIMEZONE = datetime.timezone(datetime.timedelta(hours=-3))


def _item(
    name: str,
    price: float,
    *,
    customer: str = "GERAL",
) -> PrintItem:
    return PrintItem(
        codigo=name.lower().replace(" ", "-"),
        nome=name,
        quantidade=1,
        preco_unit=price,
        cliente_nome=customer,
        observacao="",
        destino_impressao="COZINHA",
    )


def test_local_order_is_born_from_canonical_renderer_with_table_identity():
    old_width = printer_service.width
    printer_service.width = 40
    try:
        ticket = render_canonical_comanda(
            restaurant_name="Bagueteria e Pastelaria Pôr do Sol",
            restaurant_name_position="cabecalho",
            print_footer=None,
            order_number="2-A",
            order_type="Consumo no Local",
            operator_name="Georlan",
            items=[
                _item("Hambúrguer Bovino", 19.0),
                _item("Cheese Burguer", 22.0),
                _item("Campari Dose", 5.0),
            ],
            variant=ComandaVariant(
                location_label=None,
                operator_label="GARÇOM",
                event_at=datetime.datetime(2026, 9, 4, 19, 20, tzinfo=LOCAL_TIMEZONE),
                table_id=5,
                preserve_item_customers=True,
            ),
        )
    finally:
        printer_service.width = old_width

    assert "PEDIDO #2-A" in ticket
    assert "PEDIDO: #2-A" not in ticket
    assert ESC_DOUBLE_HEIGHT_ON + ESC_BOLD_ON in ticket
    assert ESC_BOLD_OFF + ESC_NORMAL_SIZE in ticket
    assert "MESA: 5" in ticket
    assert "DATA: 04/09/2026" in ticket
    assert "HORA: 19:20" in ticket
    assert "GARÇOM: Georlan" in ticket
    assert "ITENS" in ticket
    assert "VALOR" in ticket
    assert "TOTAL DO PEDIDO:" in ticket
    assert "R$ 46,00" in ticket


def test_online_remote_order_uses_same_renderer_without_operator_or_counter_channel():
    old_width = printer_service.width
    printer_service.width = 40
    try:
        ticket = render_canonical_comanda(
            restaurant_name="Bagueteria e Pastelaria Pôr do Sol",
            restaurant_name_position="cabecalho",
            print_footer=None,
            order_number=91,
            order_type="Retirada",
            operator_name="Admin",
            items=[_item("Burguer Pôr do Sol", 34.0)],
            variant=ComandaVariant(
                origin_label="CARDÁPIO ONLINE",
                location_label=None,
                operator_label=None,
                customer_name="Georlan",
                customer_phone="88999991234",
                payment_method="dinheiro",
                show_financial_breakdown=True,
                event_at=datetime.datetime(2026, 9, 1, 0, 21, tzinfo=LOCAL_TIMEZONE),
            ),
        )
    finally:
        printer_service.width = old_width

    assert "PEDIDO #91" in ticket
    assert "SEM MESA" not in ticket
    assert "ORIGEM: CARDÁPIO ONLINE" in ticket
    assert "OPERADOR:" not in ticket
    assert "CANAL: BALCÃO" not in ticket
    assert "NOME: Georlan" in ticket
    assert "PAGAMENTO" in ticket
    assert "FORMA: DINHEIRO" in ticket
    assert "SUBTOTAL ITENS:" in ticket
    assert "VALOR" in ticket


def test_dine_in_engine_calls_canonical_renderer_instead_of_table_formatter():
    source = (
        Path(__file__).resolve().parents[1]
        / "app/application/printing/service.py"
    ).read_text(encoding="utf-8")
    local_engine = source.split("def _run_dine_in_order_engine", 1)[1].split(
        "def _run_remote_order_engine", 1
    )[0]

    assert "render_canonical_comanda(" in local_engine
    assert "enqueue_table_receipt(" not in local_engine
    assert "table_id=mesa_id" in local_engine
    assert "preserve_item_customers=True" in local_engine


def test_online_remote_engine_owns_customer_payment_financial_and_loyalty_context():
    source = (
        Path(__file__).resolve().parents[1]
        / "app/application/printing/service.py"
    ).read_text(encoding="utf-8")
    remote_engine = source.split("def _run_remote_order_engine", 1)[1].split(
        "def _run_delivery_dispatch_engine", 1
    )[0]

    assert 'is_online_order = origin_label == "CARDÁPIO ONLINE"' in remote_engine
    assert 'operator_label=(None if is_online_order else "OPERADOR")' in remote_engine
    assert "customer_phone=(comanda.delivery_telefone if is_primary else None)" in remote_engine
    assert "payment_method=(comanda.delivery_forma_pagamento if is_primary else None)" in remote_engine
    assert "coupon_discount=(" in remote_engine
    assert "cashback_discount=(" in remote_engine
    assert "online_payment_status=(" in remote_engine
    assert "amount_paid=(" in remote_engine
    assert "show_financial_breakdown=is_primary" in remote_engine
    assert "comanda.cliente_id" in remote_engine
    assert "float(comanda.valor_desconto_cashback or 0.0) > 0" in remote_engine
    assert "load_customer_relationship_metrics(" in remote_engine
    assert "loyalty_previous_orders = relationship.pedidos_concluidos" in remote_engine
    assert "loyalty_previous_orders=(" in remote_engine
