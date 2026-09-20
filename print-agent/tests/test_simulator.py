from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from adapters.escpos import build_escpos_payload
from simulator import parse_escpos_payload, simulate_payload


def test_simulator_uses_exact_production_escpos_builder():
    payload = "\x1bE\x01PEDIDO #42\x1bE\x00\n1x X-Salada\n[CUT]"

    simulated = simulate_payload(payload)
    expected = build_escpos_payload(payload, encoding="cp860")

    assert simulated["raw_byte_count"] == len(expected)
    assert simulated["raw_hex"] == expected.hex(" ").upper()
    assert simulated["protocol"] == "ESC/POS RAW"
    assert simulated["encoding"] == "cp860"
    assert simulated["physical_print_time_ms"] is None
    assert simulated["physical_completion_tracking"] is False
    assert simulated["agent_render_ms"] >= 0


def test_simulator_exposes_koma_commands_without_rendering_control_bytes_as_text():
    payload = (
        "\x1bM\x01"
        "\x1bE\x01"
        "\x1b!\x10"
        "MESA 7"
        "\x1b!\x00"
        "\x1bE\x00"
        "\x1bM\x00"
        "\x1b3\x20"
        "\n2x Burger"
    )

    parsed = parse_escpos_payload(build_escpos_payload(payload, encoding="cp860"))
    command_names = [item["name"] for item in parsed["commands"]]
    visible = "\n".join(
        "".join(run["text"] for run in line["runs"])
        for line in parsed["lines"]
    )

    assert "ESC @" in command_names
    assert "ESC t" in command_names
    assert "ESC M" in command_names
    assert "ESC E" in command_names
    assert "ESC !" in command_names
    assert "ESC 3" in command_names
    assert "GS V" in command_names
    assert "MESA 7" in visible
    assert "2x Burger" in visible
    assert "\x1b" not in visible


def test_unknown_escpos_command_is_reported_instead_of_guessed():
    parsed = parse_escpos_payload(b"\x1b\x7fABC")

    assert parsed["unknown_commands"]
    assert parsed["unknown_commands"][0]["name"] == "ESC ?"
