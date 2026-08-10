$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:LOCALAPPDATA "KomaPrintAgent"
$adapterDir = Join-Path $installDir "adapters"
$venvDir = Join-Path $installDir ".venv"
$taskName = "KomaPrintAgent"

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
    $pythonCommand = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $pythonCommand) {
    throw "Python 3.10 ou superior não foi encontrado no Windows."
}

$requiredFiles = @(
    "main.py", "config.py", "pairing.py", "worker.py", "dispatcher.py",
    "api_client.py", "journal.py", "requirements.txt",
    "koma-print-launcher.ps1"
)
$adapterFiles = @(
    "__init__.py", "base.py", "escpos.py", "file.py", "linux.py", "windows.py"
)

foreach ($file in $requiredFiles) {
    if (-not (Test-Path (Join-Path $scriptDir $file))) {
        throw "Arquivo de impressão ausente: $file"
    }
}

Write-Host "[KÔMA] Preparando a impressão neste computador..."
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $installDir, $adapterDir | Out-Null

foreach ($file in $requiredFiles) {
    Copy-Item -Force (Join-Path $scriptDir $file) (Join-Path $installDir $file)
}
foreach ($file in $adapterFiles) {
    Copy-Item -Force (Join-Path $scriptDir "adapters\$file") (Join-Path $adapterDir $file)
}

$venvPython = Join-Path $venvDir "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    if ($pythonCommand.Name -eq "py.exe") {
        & $pythonCommand.Source -3 -m venv $venvDir
    } else {
        & $pythonCommand.Source -m venv $venvDir
    }
}
& $venvPython -m pip install --disable-pip-version-check --quiet -r (Join-Path $installDir "requirements.txt")

Write-Host "[KÔMA] Conectando este computador ao restaurante..."
Push-Location $installDir
try {
    & $venvPython main.py --pair-only
} finally {
    Pop-Location
}

$pythonw = Join-Path $venvDir "Scripts\pythonw.exe"
$action = New-ScheduledTaskAction -Execute $pythonw -Argument ("`"{0}`"" -f (Join-Path $installDir "main.py")) -WorkingDirectory $installDir
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

$protocolRoot = "HKCU:\Software\Classes\koma-print"
New-Item -Force $protocolRoot | Out-Null
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:Kôma Print"
$commandKey = Join-Path $protocolRoot "shell\open\command"
New-Item -Force $commandKey | Out-Null
$launcher = Join-Path $installDir "koma-print-launcher.ps1"
Set-Item -Path $commandKey -Value ("powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"{0}`" `"%1`"" -f $launcher)

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
$task = Get-ScheduledTask -TaskName $taskName
if ($task.State -notin @("Running", "Ready")) {
    throw "O Kôma Print não iniciou. Verifique o Agendador de Tarefas do Windows."
}

Write-Host ""
Write-Host "[OK] Impressão instalada e configurada para iniciar com o Windows."
Write-Host "[OK] Conecte a impressora USB e use o botão de busca no Kôma."
