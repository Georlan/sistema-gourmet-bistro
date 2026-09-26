import sys
import unittest
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent.parent
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from adapters.escpos import (
    INITIALIZE,
    PARTIAL_CUT,
    PORTUGUESE_CODE_PAGE,
    build_escpos_payload,
    fit_text_to_columns,
)


class EscPosPayloadTest(unittest.TestCase):
    def test_restores_controls_and_removes_visual_cut_marker(self):
        source = "\x1bM\\x00AÇÃO\n               [CUT]               \n"
        payload = build_escpos_payload(source)

        self.assertTrue(payload.startswith(INITIALIZE))
        self.assertIn(PORTUGUESE_CODE_PAGE, payload)
        self.assertIn(b"\x1bM\x00", payload)
        self.assertIn("AÇÃO".encode("cp860"), payload)
        self.assertNotIn(b"[CUT]", payload)
        self.assertTrue(payload.endswith(PARTIAL_CUT))

    def test_initializes_every_ticket(self):
        self.assertTrue(build_escpos_payload("RECIBO").startswith(b"\x1b@"))

    def test_compact_profile_reflows_48_columns_to_32(self):
        amount = "R$ 29,90"
        source = "\n".join(
            [
                "=" * 48,
                "KÔMA DEMO".center(48),
                "1x BACON PRIME".ljust(48 - len(amount)) + amount,
                "OBSERVAÇÃO MUITO LONGA PARA UMA BOBINA COMPACTA DE CINQUENTA E OITO MILÍMETROS",
                "-" * 48,
            ]
        )

        fitted = fit_text_to_columns(source, 32)
        visible_lines = fitted.splitlines()

        self.assertEqual(visible_lines[0], "=" * 32)
        self.assertEqual(visible_lines[1], "KÔMA DEMO".center(32))
        self.assertEqual(visible_lines[-1], "-" * 32)
        self.assertTrue(all(len(line) <= 32 for line in visible_lines))
        self.assertIn("1x BACON PRIME", fitted)
        self.assertIn("R$ 29,90", fitted)

    def test_compact_58mm_removes_blank_lines_and_double_height_without_cut(self):
        source = (
            "\x1b!\x10"
            + "DELIVERY".center(48)
            + "\x1b!\\x00"
            + "\n\n"
            + ("PEDIDO #65".center(48))
            + "\n\n"
            + "1x PUDIM DA CASA".ljust(48 - len("R$ 10,99"))
            + "R$ 10,99"
            + "\n\n"
        )

        payload = build_escpos_payload(
            source,
            profile_options={
                "columns": 32,
                "compact_layout": True,
                "supports_cut": False,
                "feed_lines": 2,
                "allow_double_height": False,
            },
        )

        self.assertNotIn(b"x00", payload)
        self.assertNotIn(b"\x1b!\x10", payload)
        self.assertIn(b"\x1b!\x00", payload)
        self.assertNotIn(b"\n\nDELIVERY", payload)
        self.assertFalse(payload.endswith(PARTIAL_CUT))
        self.assertTrue(payload.endswith(b"\n\n"))

    def test_restores_escaped_nul_before_reflow(self):
        source = "\x1bM\\x00" + ("KÔMA DEMO".center(48))
        payload = build_escpos_payload(
            source,
            profile_options={
                "columns": 32,
                "compact_layout": True,
                "supports_cut": False,
                "feed_lines": 2,
                "allow_double_height": False,
            },
        )
        self.assertIn(b"\x1bM\x00", payload)
        self.assertNotIn(b"x00", payload)

    def test_80mm_profile_keeps_cut_double_height_and_three_line_feed(self):
        source = "\x1b!\x10TITULO\x1b!\x00"
        payload = build_escpos_payload(
            source,
            profile_options={
                "columns": 48,
                "compact_layout": False,
                "supports_cut": True,
                "feed_lines": 3,
                "allow_double_height": True,
            },
        )
        self.assertIn(b"\x1b!\x10", payload)
        self.assertTrue(payload.endswith(b"\n\n\n" + PARTIAL_CUT))

    def test_wide_profile_preserves_existing_48_column_layout(self):
        source = "\n".join(
            [
                "=" * 48,
                "KÔMA DEMO".center(48),
                "-" * 48,
            ]
        )
        self.assertEqual(fit_text_to_columns(source, 48), source)

    def test_compact_profile_preserves_edge_escpos_controls(self):
        source = "\x1bE\x01" + ("TOTAL DO PEDIDO:".ljust(40) + "R$ 29,90") + "\x1bE\x00"
        fitted = fit_text_to_columns(source, 32)

        self.assertTrue(fitted.startswith("\x1bE\x01"))
        self.assertTrue(fitted.endswith("\x1bE\x00"))
        for line in fitted.splitlines():
            visible = line.replace("\x1bE\x01", "").replace("\x1bE\x00", "")
            self.assertLessEqual(len(visible), 32)


if __name__ == "__main__":
    unittest.main()
