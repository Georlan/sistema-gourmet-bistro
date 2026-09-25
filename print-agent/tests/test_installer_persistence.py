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
    assert "printer_profiles.py" in installer
    assert "transports.py" in installer


def test_windows_installer_has_persistence_update_and_uninstall():
    installer = (ROOT / "install-windows.ps1").read_text(encoding="utf-8")

    # Parâmetros de ciclo de vida
    assert "[switch]$Update" in installer
    assert "[switch]$Uninstall" in installer

    # Execução remota por comando único e silenciosa em background (sem janela)
    assert "$scriptPath = $MyInvocation.MyCommand.Path" in installer
    assert "$hasLocalSource = $scriptDir -and" in installer
    assert "sistema-gourmet-bistro-main\\print-agent" in installer
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
    assert '"printer_profiles.py"' in installer
    assert '"transports.py"' in installer



def test_windows_lifecycle_cmd_wrappers_delegate_to_installer():
    repo_root = ROOT.parent
    updater = (repo_root / "ATUALIZAR-KOMA-WINDOWS.cmd").read_text(encoding="utf-8")
    uninstaller = (repo_root / "DESINSTALAR-KOMA-WINDOWS.cmd").read_text(encoding="utf-8")

    assert "install-windows.ps1" in updater
    assert "-Update" in updater
    assert "install-windows.ps1" in uninstaller
    assert "-Uninstall" in uninstaller
