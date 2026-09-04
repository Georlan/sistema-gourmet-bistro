from pathlib import Path

from app.application.printing.comanda_renderer import apply_operational_visual_hierarchy
from app.printer_service import (
    ESC_BOLD_OFF,
    ESC_BOLD_ON,
    ESC_DOUBLE_HEIGHT_ON,
    ESC_NORMAL_SIZE,
    printer_service,
)


def test_table_account_uses_same_operational_identity_and_items_hierarchy():
    old_width = printer_service.width
    printer_service.width = 40
    try:
        legacy = "\n".join(
            [
                ESC_BOLD_ON + "CONSUMO NO LOCAL".center(40) + ESC_BOLD_OFF,
                ESC_BOLD_ON
                + "PEDIDO: #2".ljust(32)
                + "MESA: 5"
                + ESC_BOLD_OFF,
                "DATA: 04/09/2026".ljust(29) + "HORA: 20:23",
                "GARÇOM: Georlan",
                "-" * 40,
                ESC_BOLD_ON + "ITENS" + ESC_BOLD_OFF,
            ]
        )

        ticket = apply_operational_visual_hierarchy(
            legacy,
            order_number="2",
            operator_label="GARÇOM",
            operator_name="Georlan",
            location_label=None,
            identity_label="CONTA",
        )
    finally:
        printer_service.width = old_width

    assert "CONTA: #2" in ticket
    assert "PEDIDO: #2" not in ticket
    assert ESC_DOUBLE_HEIGHT_ON + ESC_BOLD_ON in ticket
    assert ESC_BOLD_OFF + ESC_NORMAL_SIZE in ticket
    assert "MESA: 5" in ticket
    assert "GARÇOM: Georlan" in ticket
    assert "ITENS" in ticket
    assert "VALOR" in ticket


def test_table_closing_uses_same_title_and_items_visual_system():
    old_width = printer_service.width
    printer_service.width = 40
    try:
        legacy = "\n".join(
            [
                ESC_BOLD_ON + "FECHAMENTO".center(40) + ESC_BOLD_OFF,
                ESC_BOLD_ON + "MESA: 5".ljust(27) + "ABERTURA: 19:20" + ESC_BOLD_OFF,
                "CONTA: #2",
                "DATA: 04/09/2026".ljust(29) + "HORA: 20:23",
                "IMPRESSO POR: GEORLAN",
                "-" * 40,
                ESC_BOLD_ON + "ITENS" + ESC_BOLD_OFF,
            ]
        )

        ticket = apply_operational_visual_hierarchy(
            legacy,
            document_title="FECHAMENTO",
        )
    finally:
        printer_service.width = old_width

    assert (
        ESC_DOUBLE_HEIGHT_ON
        + ESC_BOLD_ON
        + "FECHAMENTO".center(40)
        + ESC_BOLD_OFF
        + ESC_NORMAL_SIZE
    ) in ticket
    assert "ITENS" in ticket
    assert "VALOR" in ticket
    assert "CONTA: #2" in ticket
    assert "IMPRESSO POR: GEORLAN" in ticket


def test_table_receipt_renderer_delegates_visuals_to_shared_hierarchy():
    source = (
        Path(__file__).resolve().parents[1] / "app/services/printing.py"
    ).read_text(encoding="utf-8")
    renderer = source.split("def render_table_receipt", 1)[1].split(
        "def render_table_source_receipt", 1
    )[0]

    assert "apply_operational_visual_hierarchy(" in renderer
    assert 'identity_label=identity_label' in renderer
    assert 'document_title="FECHAMENTO"' in renderer
