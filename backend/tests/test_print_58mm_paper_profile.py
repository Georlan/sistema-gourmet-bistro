import datetime
import re
from types import SimpleNamespace

from app.application.printing.comanda_renderer import (
    ComandaVariant,
    render_canonical_comanda,
)
from app.application.printing.paper_profile import resolve_printer_paper_profile
from app.domain.printing import PrintItem

_ESC_RE = re.compile(r"\x1b(?:M|E|!|3)[\s\S]")


def _visible_lines(payload: str) -> list[str]:
    return [_ESC_RE.sub("", line) for line in payload.split("\n")]


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        return self._rows


class _FakeDb:
    def __init__(self, agents):
        self._agents = agents

    def query(self, *args, **kwargs):
        return _FakeQuery(self._agents)


def test_resolve_paper_profile_detects_kprinter_even_when_agent_reported_80mm():
    db = _FakeDb(
        [
            SimpleNamespace(
                printer_diagnostics={
                    "default_printer": "KPrinter_b4ce",
                    "destinations": {
                        "COZINHA": "bt-3253b58cf831",
                        "PADRAO": "bt-3253b58cf831",
                    },
                    "endpoints": [
                        {
                            "id": "bt-3253b58cf831",
                            "name": "KPrinter_b4ce",
                            "display_name": "KPrinter_b4ce",
                            "options": {
                                "columns": 48,
                                "paper_width_mm": 80,
                                "semantic_layout": "standard",
                            },
                        }
                    ],
                }
            )
        ]
    )

    profile = resolve_printer_paper_profile(db, 1, destination="COZINHA")
    assert profile.width == 32
    assert profile.compact_58 is True


def test_resolve_paper_profile_keeps_80mm_for_wide_printers_and_missing_agents():
    db_80 = _FakeDb(
        [
            SimpleNamespace(
                printer_diagnostics={
                    "default_printer": "Epson TM-T20",
                    "destinations": {"COZINHA": "usb-epson"},
                    "endpoints": [
                        {
                            "id": "usb-epson",
                            "name": "Epson TM-T20",
                            "options": {
                                "columns": 48,
                                "paper_width_mm": 80,
                                "semantic_layout": "standard",
                            },
                        }
                    ],
                }
            )
        ]
    )

    wide = resolve_printer_paper_profile(db_80, 6, destination="COZINHA")
    assert wide.width == 48
    assert wide.compact_58 is False

    fallback = resolve_printer_paper_profile(_FakeDb([]), 6, destination="COZINHA")
    assert fallback.width == 48
    assert fallback.compact_58 is False


def test_render_canonical_comanda_58mm_compact_never_exceeds_32_columns():
    payload = render_canonical_comanda(
        restaurant_name="JE LANCHES",
        restaurant_name_position="cabecalho",
        print_footer=None,
        order_number=10,
        order_type="RETIRADA",
        operator_name="CARDÁPIO ONLINE",
        items=[
            PrintItem(
                codigo="1",
                nome="BATATA FRITA PEQUENA (200 G)",
                quantidade=1,
                preco_unit=12.0,
            ),
            PrintItem(
                codigo="2",
                nome="SUCO DE ABACAXI",
                quantidade=1,
                preco_unit=5.0,
            ),
        ],
        variant=ComandaVariant(
            origin_label="CARDÁPIO ONLINE",
            location_label="RETIRADA",
            operator_label="ORIGEM",
            customer_name="Georlan",
            customer_phone="88999616937",
            event_at=datetime.datetime(
                2026, 11, 15, 18, 4, tzinfo=datetime.timezone.utc
            ),
            payment_method="dinheiro",
            amount_due=17.0,
            payment_required=True,
            show_financial_breakdown=True,
        ),
        paper_width=32,
        compact_58=True,
    )

    lines = _visible_lines(payload)
    assert all(len(line) <= 32 for line in lines), [
        line for line in lines if len(line) > 32
    ]
    assert "=" * 32 in lines
    assert "-" * 32 in lines
    assert not any("gerenciado por" in line.lower() for line in lines)
    assert any(
        line.strip() == "DOCUMENTO NAO FISCAL" and len(line) == 32 for line in lines
    )
    assert any("A COBRAR: R$ 17,00" in line for line in lines)
