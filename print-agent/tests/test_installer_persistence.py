"""Testes dos scripts de instalação persistente Linux e Windows (PR 5)."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_linux_installer_has_persistence_update_and_uninstall():
    installer = (ROOT / "install-linux.sh").read_text(encoding="utf-8")

    # Ações de ciclo de vida
    assert "--update" in installer
    assert "--uninstall" in installer
    assert "--purge" in installer

    # Persistência após reboot
    assert "loginctl enable-linger" in installer
    assert "WantedBy=default.target" in installer
    assert "Restart=always" in installer
    assert "RestartSec=3" in installer

    # Silent background & non-interactive behavior
    assert "systemctl --user enable --now koma-print-agent.service" in installer
    assert "main.py --pair-only" in installer

    # Preservação de arquivos essenciais e dependências
    assert "wake_listener.py" in installer
    assert "simulator.py" in installer
    assert "endpoints.py" in installer
    assert "transports.py" in installer


def test_windows_installer_has_persistence_update_and_uninstall():
    installer = (ROOT / "install-windows.ps1").read_text(encoding="utf-8")

    # Parâmetros de ciclo de vida
    assert "[switch]$Update" in installer
    assert "[switch]$Uninstall" in installer

    # Execução silenciosa em background (sem janela)
    assert "pythonw.exe" in installer
    assert 'Set shell = CreateObject("WScript.Shell")' in installer

    # Agendamento persistente com reinício automático
    assert "New-ScheduledTaskTrigger -AtLogOn" in installer
    assert "-RestartCount 999" in installer
    assert "-RestartInterval (New-TimeSpan -Minutes 1)" in installer
    assert "-ExecutionTimeLimit ([TimeSpan]::Zero)" in installer
    assert "Register-ScheduledTask" in installer
    assert "Start-ScheduledTask" in installer

    # Preservação de arquivos essenciais e dependências
    assert '"wake_listener.py"' in installer
    assert '"simulator.py"' in installer
    assert '"endpoints.py"' in installer
    assert '"transports.py"' in installer
