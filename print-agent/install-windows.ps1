param(
    [switch]$Update,
    [switch]$Uninstall,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$scriptPath = $MyInvocation.MyCommand.Path
$scriptDir = if ($scriptPath) { Split-Path -Parent $scriptPath } else { $null }
$installDir = Join-Path $env:LOCALAPPDATA "KomaPrintAgent"
$adapterDir = Join-Path $installDir "adapters"
$venvDir = Join-Path $installDir ".venv"
$taskName = "KomaPrintAgent"
$protocolRoot = "HKCU:\Software\Classes\koma-print"
$credentialsDir = Join-Path $env:APPDATA "Koma\PrintAgent"
$credentialsFile = Join-Path $credentialsDir "credentials.json"

if ($Uninstall) {
    Write-Host "[KOMA] Desinstalando o Koma Print Agent..."
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item -Path $protocolRoot -Recurse -Force -ErrorAction SilentlyContinue
    if ($Force) {
        Remove-Item -Path $installDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $credentialsDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "[OK] Koma Print Agent e todas as configuracoes locais foram removidos."
    } else {
        Write-Host "[OK] Koma Print Agent desinstalado com sucesso."
        Write-Host "[INFO] Tokens e configuracoes locais foram preservados em $credentialsDir e $installDir."
    }
    return
}

# Se executado diretamente via download remoto (PowerShell one-liner), baixa os arquivos necessarios
$hasLocalSource = $scriptDir -and (Test-Path (Join-Path $scriptDir "main.py"))
if (-not $hasLocalSource) {
    Write-Host "[KOMA] Baixando a versao correta do Koma Print Agent..."
    $zipUrl = "https://github.com/Georlan/sistema-gourmet-bistro/archive/refs/heads/main.zip"
    $tempZip = Join-Path $env:TEMP "koma-print-agent.zip"
    $tempExtract = Join-Path $env:TEMP "koma-print-agent-src"
    Remove-Item -Path $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip -UseBasicParsing
    Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force
    $scriptDir = Join-Path $tempExtract "sistema-gourmet-bistro-main\print-agent"
}

function Get-KomaPythonPath($command) {
    if ($command.Source) { return $command.Source }
    return $command.FullName
}

function Test-KomaPython($command) {
    if (-not $command) { return $false }
    $executable = Get-KomaPythonPath $command
    try {
        if ($command.Name -eq "py.exe") {
            $versionText = (& $executable -3 --version 2>&1 | Out-String)
        } else {
            $versionText = (& $executable --version 2>&1 | Out-String)
        }
        if ($LASTEXITCODE -ne 0 -or $versionText -notmatch 'Python\s+(\d+)\.(\d+)') {
            return $false
        }
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        return ($major -gt 3 -or ($major -eq 3 -and $minor -ge 10))
    } catch {
        return $false
    }
}

$pythonCommand = Get-Command py -ErrorAction SilentlyContinue
if (-not (Test-KomaPython $pythonCommand)) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
}
if (-not (Test-KomaPython $pythonCommand)) {
    $pythonCommand = $null
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Python 3.10+ nao foi encontrado e o Windows Package Manager (winget) nao esta disponivel. Instale Python e execute novamente."
    }
    Write-Host "[KOMA] Python nao encontrado. Instalando Python 3.12 para este usuario..."
    & $winget.Source install --id Python.Python.3.12 -e --scope user --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "A instalacao automatica do Python falhou. Instale Python 3.10+ e execute novamente."
    }
    $pythonCommand = Get-Command py -ErrorAction SilentlyContinue
    if (-not (Test-KomaPython $pythonCommand)) {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    }
    if (-not (Test-KomaPython $pythonCommand)) {
        $pythonCommand = $null
        $pythonExecutable = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs\Python") -Filter python.exe -Recurse -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if (Test-KomaPython $pythonExecutable) {
            $pythonCommand = $pythonExecutable
        }
    }
    if (-not $pythonCommand) {
        throw "Python foi instalado, mas o executavel ainda nao foi localizado. Reinicie o Windows e execute novamente."
    }
}

$requiredFiles = @(
    "main.py", "config.py", "endpoints.py", "pairing.py", "worker.py", "wake_listener.py", "simulator.py", "dispatcher.py", "agent_runtime.py",
    "api_client.py", "journal.py", "requirements.txt", "requirements.lock",
    "koma-print-launcher.ps1", "check-windows.ps1"
)
$adapterFiles = @(
    "__init__.py", "base.py", "escpos.py", "file.py", "linux.py", "windows.py", "transports.py"
)

foreach ($file in $requiredFiles) {
    if (-not (Test-Path (Join-Path $scriptDir $file))) {
        throw "Arquivo de impressao ausente: $file"
    }
}

$venvPython = Join-Path $venvDir "Scripts\python.exe"
$pythonw = Join-Path $venvDir "Scripts\pythonw.exe"

if ($Update) {
    Write-Host "[KOMA] Atualizando o Koma Print Agent..."
} else {
    Write-Host "[KOMA] Preparando a impressao neste computador..."
}
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
New-Item -ItemType Directory -Force -Path $adapterDir | Out-Null

foreach ($file in $requiredFiles) {
    Copy-Item -Force (Join-Path $scriptDir $file) (Join-Path $installDir $file)
}
foreach ($file in $adapterFiles) {
    Copy-Item -Force (Join-Path $scriptDir "adapters\$file") (Join-Path $adapterDir $file)
}

if (-not (Test-Path $venvPython)) {
    if ($pythonCommand.Name -eq "py.exe") {
        & $pythonCommand.Source -3 -m venv $venvDir
    } else {
        $pythonSource = Get-KomaPythonPath $pythonCommand
        & $pythonSource -m venv $venvDir
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Nao foi possivel preparar o ambiente local de impressao."
    }
}
& $venvPython -m pip install --disable-pip-version-check --quiet -r (Join-Path $installDir "requirements.txt")
if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel instalar as dependencias. Verifique a internet e execute novamente."
}

# Verifica se o agente ja possui credencial local para nao abrir navegador desnecessariamente
$hasStoredConfig = (Test-Path (Join-Path $installDir "config.json")) -or (Test-Path $credentialsFile)
if ($hasStoredConfig) {
    Write-Host "[KOMA] Credencial local detectada; validando conexao..."
    Push-Location $installDir
    try {
        & $venvPython main.py --pair-only
    } catch {
        # Prossegue mesmo se validacao inicial falhar temporariamente
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[KOMA] Conectando este computador ao restaurante..."
    Push-Location $installDir
    try {
        & $venvPython main.py --pair-only
        if ($LASTEXITCODE -ne 0) {
            throw "O computador ainda nao foi conectado. Conclua o pareamento no Koma e execute novamente."
        }
    } finally {
        Pop-Location
    }
}

# Configura execucao automatica em background sem janela (pythonw)
$action = New-ScheduledTaskAction -Execute $pythonw -Argument ("`"{0}`"" -f (Join-Path $installDir "main.py")) -WorkingDirectory $installDir
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
$task = Get-ScheduledTask -TaskName $taskName
if ($task.State -notin @("Running", "Ready")) {
    throw "O Koma Print nao iniciou. Verifique o Agendador de Tarefas do Windows."
}

# Registra protocolo URL silencioso koma-print:// via WScript
$protocolLauncher = Join-Path $installDir "koma-print-launcher.vbs"
$protocolScript = @'
Set shell = CreateObject("WScript.Shell")
shell.Run "schtasks.exe /Run /TN ""KomaPrintAgent""", 0, False
'@
Set-Content -Path $protocolLauncher -Value $protocolScript -Encoding ASCII -Force

New-Item -Force $protocolRoot | Out-Null
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:Koma Print"
$commandKey = Join-Path $protocolRoot "shell\open\command"
New-Item -Force $commandKey | Out-Null
Set-Item -Path $commandKey -Value ("wscript.exe `"{0}`" `"%1`"" -f $protocolLauncher)

Write-Host ""
if ($Update) {
    Write-Host "[OK] Koma Print Agent atualizado e reativado com sucesso."
} else {
    Write-Host "[OK] Impressao instalada e configurada para iniciar automaticamente em segundo plano."
}
Write-Host "[OK] O servico reiniciara automaticamente e continuara ativo apos reinicializacoes."
Write-Host "[OK] O Koma nao alterou a impressora padrao usada por outros aplicativos."
Write-Host ""
if (Test-Path (Join-Path $installDir "check-windows.ps1")) {
    Write-Host "[KOMA] Executando verificacao final..."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installDir "check-windows.ps1")
}
