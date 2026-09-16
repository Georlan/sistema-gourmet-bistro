from pathlib import Path


def test_linux_installer_packages_wake_listener():
    agent_dir = Path(__file__).resolve().parents[1]
    installer = (agent_dir / "install-linux.sh").read_text(encoding="utf-8")

    assert "wake_listener.py" in installer
