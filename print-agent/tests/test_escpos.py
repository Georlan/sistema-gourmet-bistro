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

    def test_compact_profile_reflows_48_columns_to_42(self):
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

        fitted = fit_text_to_columns(source, 42)
        visible_lines = fitted.splitlines()

        self.assertEqual(visible_lines[0], "=" * 42)
        self.assertEqual(visible_lines[1], "KÔMA DEMO".center(42))
        self.assertEqual(visible_lines[-1], "-" * 42)
        self.assertTrue(all(len(line) <= 42 for line in visible_lines))
        self.assertIn("1x BACON PRIME", fitted)
        self.assertIn("R$ 29,90", fitted)

    def test_compact_profile_restores_nul_before_reflow_and_never_prints_x00(self):
        source = (
            "\x1b3\x20\x1bM\\x00"
            + ("KÔMA DEMO".center(48))
            + "\n"
            + "\x1b!\x10"
            + ("PEDIDO #51-A".center(48))
            + "\x1b!\\x00"
            + "\n"
            + "AÇÃO · OBSERVAÇÃO · CARTÃO · NÃO"
            + "\n\n"
        )
        profile = {
            "columns": 42,
            "font_mode": "B",
            "encoding": "cp860",
            "code_page": 3,
            "line_spacing_dots": 20,
            "feed_lines": 2,
            "compact_layout": True,
        }

        payload = build_escpos_payload(source, profile_options=profile)

        self.assertNotIn(b"x00", payload)
        self.assertIn(b"\x1bM\x01", payload)
        self.assertIn(b"\x1b!\x11", payload)
        self.assertIn(b"\x1b!\x01", payload)
        self.assertIn(b"\x1b3\x14", payload)
        self.assertIn("AÇÃO".encode("cp860"), payload)
        self.assertIn("OBSERVAÇÃO".encode("cp860"), payload)
        self.assertIn("CARTÃO".encode("cp860"), payload)
        self.assertIn("NÃO".encode("cp860"), payload)
        self.assertTrue(payload.endswith(b"\n\n" + PARTIAL_CUT))

    def test_compact_profile_removes_decorative_blank_lines(self):
        source = "=" * 48 + "\n\nTÍTULO\n\n" + "-" * 48 + "\n"
        payload = build_escpos_payload(
            source,
            profile_options={
                "columns": 42,
                "font_mode": "B",
                "encoding": "cp860",
                "code_page": 3,
                "line_spacing_dots": 20,
                "feed_lines": 2,
                "compact_layout": True,
            },
        )
        body = payload[len(INITIALIZE) + len(PORTUGUESE_CODE_PAGE):-len(PARTIAL_CUT)]
        text = body.decode("cp860", errors="ignore")
        self.assertNotIn("\n\nTÍTULO", text)
        self.assertIn("=" * 42, text)
        self.assertIn("-" * 42, text)

    def test_wide_profile_keeps_legacy_spacing_font_and_feed(self):
        source = (
            "\x1b3\x20\x1bM\\x00"
            + ("KÔMA DEMO".center(48))
            + "\n\n"
            + "=" * 48
        )
        payload = build_escpos_payload(
            source,
            profile_options={
                "columns": 48,
                "font_mode": "A",
                "encoding": "cp860",
                "code_page": 3,
                "line_spacing_dots": None,
                "feed_lines": 3,
                "compact_layout": False,
            },
        )
        self.assertIn(b"\x1bM\x00", payload)
        self.assertIn(b"\x1b3\x20", payload)
        self.assertIn(b"\n\n", payload)
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
