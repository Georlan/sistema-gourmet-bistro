from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_extreme_online_print_escapes_nul_before_persisting():
    source = (ROOT / "backend/app/routes/printing.py").read_text(encoding="utf-8")

    assert 'safe_payload = payload.replace("\\x00", "\\\\x00")' in source
    assert "payload_text=safe_payload" in source
    assert "payload_text=payload," not in source
