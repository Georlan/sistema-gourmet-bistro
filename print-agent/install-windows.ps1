$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:LOCALAPPDATA "KomaPrintAgent"
$adapterDir = Join-Path $installDir "adapters"
$venvDir = Join-Path $installDir ".venv"
$taskName = "KomaPrintAgent"
$protocolRoot = "HKCU:\\Software\\Classes\\koma-print"

# Remove registros antigos antes de reinstalar. Isso impede que um protocolo
# quebrado continue abrindo o PowerShell em ciclo quando a tarefa nao existe.
Remove-Item -Path $protocolRoot -Recurse -Force -ErrorAction SilentlyContinue

$pythonCommand = Get-Command py -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
}
if (-not $pythonCommand) {
    throw "Python 3.10 ou superior nao foi encontrado no Windows."
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
        throw "Arquivo de impressao ausente: $file"
    }
}

Write-Host "[KOMA] Preparando a impressao neste computador..."
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
New-Item -ItemType Directory -Force -Path $adapterDir | Out-Null
if (-not (Test-Path $installDir) -or -not (Test-Path $adapterDir)) {
    throw "Nao foi possivel criar a pasta local do Koma Print Agent."
}

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

Write-Host "[KOMA] Conectando este computador ao restaurante..."
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
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
$task = Get-ScheduledTask -TaskName $taskName
if ($task.State -notin @("Running", "Ready")) {
    throw "O Koma Print nao iniciou. Verifique o Agendador de Tarefas do Windows."
}

# O protocolo do navegador usa WScript para iniciar a tarefa sem exibir
# uma janela do PowerShell. A tarefa ignora chamadas repetidas enquanto
# uma instancia do agente ja estiver ativa.
$protocolLauncher = Join-Path $installDir "koma-print-launcher.vbs"
$protocolScript = @'
Set shell = CreateObject("WScript.Shell")
shell.Run "schtasks.exe /Run /TN ""KomaPrintAgent""", 0, False
'@
Set-Content -Path $protocolLauncher -Value $protocolScript -Encoding ASCII -Force

New-Item -Force $protocolRoot | Out-Null
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:Koma Print"
$commandKey = Join-Path $protocolRoot "shell\\open\\command"
New-Item -Force $commandKey | Out-Null
Set-Item -Path $commandKey -Value ("wscript.exe `"{0}`" `"%1`"" -f $protocolLauncher)

Write-Host ""
Write-Host "[OK] Impressao instalada e configurada para iniciar com o Windows."
Write-Host "[OK] Conecte a impressora USB e use o botao de busca no Koma."
