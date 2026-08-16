import app.printer_service as printer_module
from app.printer_service import PrinterService


def _service() -> PrinterService:
    service = object.__new__(PrinterService)
    service.width = 40
    return service


def _item(nome: str, preco: float, codigo: str):
    return {
        "codigo": codigo,
        "produto": {"id": codigo, "nome": nome},
        "preco_unit": preco,
        "status": "preparando",
        "cliente_nome": "Consumo Geral",
        "observacao": "",
        "quantidade": 1,
    }


def test_waiter_automatic_print_merges_persisted_table_with_current_uncommitted_delta(monkeypatch):
    monkeypatch.setattr(
        printer_module,
        "_load_open_table_receipt_items",
        lambda mesa_id: [_item("ITEM ANTIGO", 10.0, "001")],
    )
    monkeypatch.setattr(
        printer_module,
        "_resolve_service_charge_settings",
        lambda: (False, 10.0),
    )

    ticket = _service().generate_kitchen_ticket(
        num_pedido=43,
        tipo="Consumo no Local",
        mesa_id=7,
        garcom_nome="Georlan",
        items=[
            {
                "codigo": "002",
                "nome": "ITEM NOVO",
                "preco_unit": 20.0,
                "cliente_nome": "Consumo Geral",
            }
        ],
    )

    assert "1x ITEM ANTIGO" in ticket
    assert "1x ITEM NOVO" in ticket
    assert "TOTAL GERAL DA MESA:" in ticket
    assert "R$ 30,00" in ticket


def test_committed_cashier_or_reprint_uses_snapshot_without_duplicating_input(monkeypatch):
    snapshot = [
        _item("ITEM ANTIGO", 10.0, "001"),
        _item("ITEM NOVO", 20.0, "002"),
    ]
    monkeypatch.setattr(
        printer_module,
        "_load_open_table_receipt_items",
        lambda mesa_id: snapshot,
    )
    monkeypatch.setattr(
        printer_module,
        "_resolve_service_charge_settings",
        lambda: (False, 10.0),
    )

    ticket = _service().generate_kitchen_ticket(
        num_pedido=43,
        tipo="Consumo no Local",
        mesa_id=7,
        garcom_nome="Caixa",
        items=[
            {
                "codigo": "002",
                "nome": "ITEM NOVO",
                "preco_unit": 20.0,
                "cliente_nome": "Consumo Geral",
            }
        ],
        source_committed=True,
    )

    assert ticket.count("1x ITEM NOVO") == 1
    assert "1x ITEM ANTIGO" in ticket
    assert "TOTAL GERAL DA MESA:" in ticket
    assert "R$ 30,00" in ticket
