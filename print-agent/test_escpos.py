import sys
import unittest
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent
if (AGENT_DIR / "adapters").is_dir():
    sys.path.insert(0, str(AGENT_DIR))
    from adapters.escpos import (
        INITIALIZE,
        PARTIAL_CUT,
        PORTUGUESE_CODE_PAGE,
        build_escpos_payload,
    )
else:
    from escpos import (
        INITIALIZE,
        PARTIAL_CUT,
        PORTUGUESE_CODE_PAGE,
        build_escpos_payload,
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


if __name__ == "__main__":
    unittest.main()
