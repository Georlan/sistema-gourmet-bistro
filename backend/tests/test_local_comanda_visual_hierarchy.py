from pathlib import Path

from app.application.printing.comanda_renderer import apply_operational_visual_hierarchy
from app.printer_service import (
    ESC_BOLD_OFF,
    ESC_BOLD_ON,
    ESC_DOUBLE_HEIGHT_ON,
    ESC_NORMAL_SIZE,
    printer_service,
)


def test_local_order_keeps_human_identity_and_table_with_shared_hierarchy():
    old_width = printer_service.width
    printer_service.width = 40
    try:
        legacy = "\n".join(
            [
                ESC_BOLD_ON + "CONSUMO NO LOCAL".center(40) + ESC_BOLD_OFF,
                ESC_BOLD_ON
                + "PEDIDO: #2-A".ljust(32)
                + "MESA: 5"
                + ESC_BOLD_OFF,
                "DATA: 04/09/2026".ljust(29) + "HORA: 19:20",
                "GARÇOM: Georlan",
                "-" * 40,
                ESC_BOLD_ON + "ITENS" + ESC_BOLD_OFF,
                "",
                ESC_BOLD_ON + "1x HAMBÚRGUER BOVINO        R$ 19,00" + ESC_BOLD_OFF,
                "-" * 40,
                ESC_BOLD_ON + "TOTAL DESTE PEDIDO:         R$ 19,00" + ESC_BOLD_OFF,
            ]
        )

        ticket = apply_operational_visual_hierarchy(
            legacy,
            operator_label="GARÇOM",
            operator_name="Georlan",
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
    assert "TOTAL DESTE PEDIDO:" in ticket


def test_remote_base_does_not_leave_sem_mesa_after_shared_hierarchy():
    old_width = printer_service.width
    printer_service.width = 40
    try:
        legacy = "\n".join(
            [
                ESC_BOLD_ON
                + "PEDIDO: #91".ljust(32)
                + "SEM MESA"
                + ESC_BOLD_OFF,
                "DATA: 01/09/2026".ljust(29) + "HORA: 00:21",
                "GARÇOM: Admin",
                ESC_BOLD_ON + "ITENS" + ESC_BOLD_OFF,
            ]
        )
        ticket = apply_operational_visual_hierarchy(
            legacy,
            order_number=91,
            operator_label="OPERADOR",
            operator_name="Admin",
            location_label="BALCÃO",
        )
    finally:
        printer_service.width = old_width

    assert "PEDIDO #91" in ticket
    assert "SEM MESA" not in ticket
    assert "OPERADOR: Admin" in ticket
    assert "CANAL: BALCÃO" in ticket
    assert "VALOR" in ticket


def test_dine_in_engine_applies_shared_hierarchy_before_returning_job():
    source = (
        Path(__file__).resolve().parents[1]
        / "app/application/printing/service.py"
    ).read_text(encoding="utf-8")
    local_engine = source.split("def _run_dine_in_order_engine", 1)[1].split(
        "def _run_remote_order_engine", 1
    )[0]

    assert "apply_operational_visual_hierarchy(" in local_engine
    assert 'operator_label="GARÇOM"' in local_engine
    assert '.replace("\\x00", "\\\\x00")' in local_engine
