import datetime

from app.application.printing.comanda_renderer import (
    ComandaVariant,
    apply_operational_visual_hierarchy,
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


def _item(name: str, price: float) -> PrintItem:
    return PrintItem(
        codigo=name.lower().replace(" ", "-"),
        nome=name,
        quantidade=1,
        preco_unit=price,
        cliente_nome="Consumo Geral",
        observacao="",
        destino_impressao="COZINHA",
    )


def _plain_lines(ticket: str) -> list[str]:
    plain = (
        ticket.replace(ESC_BOLD_ON, "")
        .replace(ESC_BOLD_OFF, "")
        .replace(ESC_DOUBLE_HEIGHT_ON, "")
        .replace(ESC_NORMAL_SIZE, "")
    )
    return [line.strip() for line in plain.splitlines() if line.strip()]


def test_first_dine_in_print_promotes_type_table_and_order_to_header():
    old_width = printer_service.width
    printer_service.width = 40
    try:
        ticket = render_canonical_comanda(
            restaurant_name="Bagueteria e Pastelaria Pôr do Sol",
            restaurant_name_position="cabecalho",
            print_footer=None,
            order_number="7-A",
            order_type="Consumo no Local",
            operator_name="Georlan",
            items=[_item("Hambúrguer Bovino", 19.0), _item("Cheese Burguer", 22.0)],
            variant=ComandaVariant(
                location_label=None,
                operator_label="GARÇOM",
                event_at=datetime.datetime(2026, 9, 4, 23, 26, tzinfo=LOCAL_TIMEZONE),
                table_id=8,
                preserve_item_customers=True,
            ),
        )
    finally:
        printer_service.width = old_width

    lines = _plain_lines(ticket)
    type_index = lines.index("CONSUMO NO LOCAL")
    table_index = lines.index("MESA: 8")
    order_index = lines.index("PEDIDO #7-A")

    assert type_index < table_index < order_index
    assert (
        ESC_DOUBLE_HEIGHT_ON
        + ESC_BOLD_ON
        + "MESA: 8".center(40)
        + ESC_BOLD_OFF
        + ESC_NORMAL_SIZE
    ) in ticket
    assert "MESA: 8" not in "\n".join(lines[order_index + 1:])


def test_full_reprint_keeps_reprint_marker_then_prominent_table_then_order():
    old_width = printer_service.width
    printer_service.width = 40
    legacy = "\n".join(
        [
            ESC_BOLD_ON + "CONSUMO NO LOCAL".center(40) + ESC_BOLD_OFF,
            ESC_BOLD_ON + "PEDIDO: #7".ljust(32) + "MESA: 8" + ESC_BOLD_OFF,
            "DATA: 04/09/2026".ljust(29) + "HORA: 23:26",
            "GARÇOM: Georlan",
            "-" * 40,
            ESC_BOLD_ON + "ITENS" + ESC_BOLD_OFF,
        ]
    )

    try:
        ticket = apply_operational_visual_hierarchy(
            legacy,
            order_number="7",
            operator_label="GARÇOM",
            operator_name="Georlan",
            location_label=None,
            identity_label="CONTA",
        )
    finally:
        printer_service.width = old_width

    lines = _plain_lines(ticket)
    assert lines.index("CONSUMO NO LOCAL") < lines.index("REIMPRESSÃO")
    assert lines.index("REIMPRESSÃO") < lines.index("MESA: 8")
    assert lines.index("MESA: 8") < lines.index("PEDIDO #7")
    assert "CONTA: #7" not in ticket
