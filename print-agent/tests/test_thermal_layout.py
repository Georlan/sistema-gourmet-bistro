import sys
import unittest
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent.parent
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from thermal_layout import apply_layout_profile


class ThermalLayoutProfileTest(unittest.TestCase):
    def test_compact_closing_prioritizes_table_account_and_times(self):
        source = "\n".join(
            [
                "KÔMA DEMO".center(48),
                "FECHAMENTO DA MESA".center(48),
                "MESA: 6",
                "CONTA: #51",
                "ABERTA: 13:52",
                "IMPRESSA: 26/09/2026 13:41",
                "OPERADOR: Caixa Demo",
                "-" * 48,
                "ITENS".ljust(40) + "VALOR",
                "1x BACON PRIME".ljust(38) + "R$ 29,90",
                "TOTAL GERAL DA MESA:".ljust(38) + "R$ 29,90",
                "Gerenciado por Kôma",
                "Documento não fiscal",
            ]
        )

        compact = apply_layout_profile(
            source,
            columns=32,
            layout_mode="compact",
            charset_mode="ascii_safe",
            allow_double_height=False,
        )

        self.assertIn("FECHAMENTO", compact)
        self.assertNotIn("FECHAMENTO DA MESA", compact)
        self.assertIn("MESA 6", compact)
        self.assertIn("CONTA #51", compact)
        self.assertIn("ABERTA 13:52", compact)
        self.assertIn("IMP 13:41", compact)
        self.assertIn("DATA 26/09/26", compact)
        self.assertIn("OP Caixa Demo".upper(), compact.upper())
        self.assertIn("TOTAL DA MESA:", compact)
        self.assertIn("KOMA DEMO", compact)
        self.assertIn("DOCUMENTO NAO FISCAL", compact)
        self.assertNotIn("Ô", compact)
        self.assertNotIn("ã", compact)

    def test_standard_closing_keeps_full_language_and_packs_metadata(self):
        source = "\n".join(
            [
                "KÔMA DEMO".center(48),
                "FECHAMENTO DA MESA".center(48),
                "MESA: 6",
                "CONTA: #51",
                "ABERTA: 13:52",
                "IMPRESSA: 26/09/2026 13:41",
                "OPERADOR: CAIXA DEMO",
                "-" * 48,
            ]
        )

        standard = apply_layout_profile(
            source,
            columns=48,
            layout_mode="standard",
            charset_mode="native",
            allow_double_height=True,
        )

        self.assertIn("KÔMA DEMO", standard)
        self.assertIn("MESA: 6", standard)
        self.assertIn("CONTA: #51", standard)
        self.assertIn("ABERTA: 13:52", standard)
        self.assertIn("IMPRESSA: 26/09/2026 13:41", standard)
        self.assertIn("OPERADOR: CAIXA DEMO", standard)
        self.assertNotIn("\nMESA: 6\nCONTA: #51\n", standard)

    def test_compact_order_uses_one_line_for_table_and_order(self):
        source = "\n".join(
            [
                "CONSUMO NO LOCAL".center(48),
                "REIMPRESSÃO".center(48),
                "VIA COMPLETA DA MESA".center(48),
                "MESA: 6".center(48),
                "PEDIDO #51".center(48),
                "DATA: 26/09/2026".ljust(34) + "HORA: 13:41",
                "GARÇOM: Caixa Demo",
                "-" * 48,
            ]
        )

        compact = apply_layout_profile(
            source,
            columns=32,
            layout_mode="compact",
            charset_mode="ascii_safe",
            allow_double_height=False,
        )

        self.assertIn("MESA 6", compact)
        self.assertIn("PEDIDO #51", compact)
        self.assertIn("REIMPRESSAO | VIA COMPLETA", compact)
        self.assertIn("26/09/26 13:41", compact)
        self.assertIn("OPERADOR: Caixa Demo".upper(), compact.upper())
        self.assertNotIn("GARCOM:", compact)

    def test_multi_customer_compact_mode_saves_lines_without_dropping_people(self):
        source = "\n".join(
            [
                "ITENS",
                "",
                "CLIENTE: PAULO",
                "1x PIZZA".ljust(40) + "R$ 25,00",
                "",
                "-" * 48,
                "SUBTOTAL PAULO".ljust(40) + "R$ 25,00",
                "",
                "CLIENTE: ANA",
                "1x SUCO".ljust(40) + "R$ 8,00",
                "",
                "-" * 48,
                "SUBTOTAL ANA".ljust(40) + "R$ 8,00",
                "",
                "TOTAL GERAL DA MESA:".ljust(40) + "R$ 33,00",
                "",
            ]
        )

        compact = apply_layout_profile(
            source,
            columns=32,
            layout_mode="compact",
            charset_mode="ascii_safe",
            allow_double_height=False,
        )

        self.assertIn("CLIENTE: PAULO", compact)
        self.assertIn("CLIENTE: ANA", compact)
        self.assertIn("SUBTOTAL PAULO", compact)
        self.assertIn("SUBTOTAL ANA", compact)
        self.assertIn("TOTAL DA MESA:", compact)
        self.assertNotIn("-" * 48 + "\nSUBTOTAL PAULO", compact)
        self.assertNotIn("-" * 48 + "\nSUBTOTAL ANA", compact)
        self.assertLess(len(compact.splitlines()), len(source.splitlines()))


if __name__ == "__main__":
    unittest.main()
