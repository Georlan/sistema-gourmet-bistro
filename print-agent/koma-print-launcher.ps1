$taskName = "KomaPrintAgent"
$installDir = Join-Path $env:LOCALAPPDATA "KomaPrintAgent"
$credentialsFile = Join-Path $env:APPDATA "Koma\PrintAgent\credentials.json"
$hasCredentials = Test-Path $credentialsFile

if ($hasCredentials) {
    try {
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
    } catch {
        $python = Join-Path $installDir ".venv\Scripts\pythonw.exe"
        $main = Join-Path $installDir "main.py"
        Start-Process -FilePath $python -ArgumentList @($main) -WorkingDirectory $installDir -WindowStyle Hidden
    }
} else {
    $python = Join-Path $installDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $python)) {
        $python = Join-Path $installDir ".venv\Scripts\pythonw.exe"
    }
    $main = Join-Path $installDir "main.py"
    if (Test-Path $main) {
        Start-Process -FilePath $python -ArgumentList @($main, "--pair-only") -WorkingDirectory $installDir
    }
}
