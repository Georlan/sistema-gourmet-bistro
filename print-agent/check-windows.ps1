$ErrorActionPreference = "Continue"

$installDir = Join-Path $env:LOCALAPPDATA "KomaPrintAgent"
$taskName = "KomaPrintAgent"
$hasBlocker = $false

Write-Host ""
Write-Host "============================================================"
Write-Host "  KOMA - VERIFICACAO RAPIDA DA IMPRESSAO"
Write-Host "============================================================"

if (Test-Path (Join-Path $installDir "main.py")) {
    Write-Host "[OK] Agente instalado em $installDir"
} else {
    Write-Host "[ERRO] Agente ainda nao foi instalado."
    $hasBlocker = $true
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "[ERRO] Tarefa KomaPrintAgent nao encontrada."
    $hasBlocker = $true
} else {
    Write-Host "[OK] Tarefa local: $($task.State)"
    if ($task.State -notin @("Running", "Ready")) {
        Write-Host "[AVISO] Tentando iniciar a tarefa agora..."
        Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    }
}

$configPath = Join-Path $installDir "config.json"
$selectedPrinter = $null
if (Test-Path $configPath) {
    try {
        $config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
        $selectedPrinter = $config.printers.PADRAO
    } catch {
        Write-Host "[AVISO] O arquivo de configuracao ainda nao esta legivel."
    }
}

if ($selectedPrinter -and $selectedPrinter -notin @("Padrao", "Padrão", "auto")) {
    Write-Host "[OK] Fila memorizada pelo Koma: $selectedPrinter"
} else {
    Write-Host "[AVISO] Fila ainda nao memorizada. Abra Salao e impressao no Koma."
}

$defaultPrinter = Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue |
    Where-Object { $_.Default } |
    Select-Object -First 1 -ExpandProperty Name
if ($defaultPrinter) {
    Write-Host "[INFO] Impressora padrao do Windows: $defaultPrinter"
}

$usbQueues = @(Get-Printer -ErrorAction SilentlyContinue | Where-Object {
    $_.PortName -match '^USB[0-9]+:?$'
})
if ($usbQueues.Count -eq 0) {
    Write-Host "[AVISO] Nenhuma fila USB foi encontrada no Spooler."
} else {
    Write-Host "[OK] Fila(s) USB no Windows:"
    foreach ($printer in $usbQueues) {
        $marker = if ($printer.Name -eq $selectedPrinter) { "KOMA" } else { "DISPONIVEL" }
        Write-Host "     [$marker] $($printer.Name) - porta $($printer.PortName)"
    }
}

Write-Host ""
Write-Host "O Koma usa uma fila nomeada e nao troca a impressora padrao."
Write-Host "Para validar com Anota AI: imprima um teste em cada sistema, em sequencia."

if ($hasBlocker) {
    Write-Host "[RESULTADO] Ha bloqueios para corrigir antes da operacao."
    exit 1
}

Write-Host "[RESULTADO] Instalacao local pronta para o teste final no Koma."
exit 0
