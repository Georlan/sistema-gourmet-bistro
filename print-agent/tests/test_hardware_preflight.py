import sys
import unittest
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent.parent
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from hardware_preflight import build_preflight_report


class HardwarePreflightTest(unittest.TestCase):
    def test_blocks_configured_queue_when_physical_device_is_absent(self):
        report = build_preflight_report({
            "adapter": "linux",
            "printers": [{
                "name": "G250",
                "uri": "usb://Gertec/G250",
                "configured": True,
                "present": False,
                "available": False,
            }],
        })

        self.assertEqual(report["status"], "BLOCKED")
        self.assertEqual(report["configured_but_absent"], ["G250"])
        self.assertIn("equipamento físico não está presente", report["reason"])

    def test_passes_only_when_all_physical_readiness_flags_are_true(self):
        report = build_preflight_report({
            "adapter": "linux",
            "printers": [{
                "name": "Cozinha",
                "uri": "usb://Printer/Cozinha",
                "connection": "usb",
                "configured": True,
                "present": True,
                "available": True,
                "is_default": True,
            }],
        })

        self.assertEqual(report["status"], "PASSED")
        self.assertEqual(report["ready_printers"][0]["name"], "Cozinha")

    def test_requested_printer_cannot_be_satisfied_by_another_ready_queue(self):
        report = build_preflight_report({
            "adapter": "windows",
            "printers": [{
                "name": "Bar",
                "uri": "winspool://Bar",
                "configured": True,
                "present": True,
                "available": True,
            }],
        }, requested_printer="Cozinha")

        self.assertEqual(report["status"], "BLOCKED")
        self.assertIn("Cozinha", report["reason"])


if __name__ == "__main__":
    unittest.main()
