$taskName = "KomaPrintAgent"

try {
    Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
} catch {
    $installDir = Join-Path $env:LOCALAPPDATA "KomaPrintAgent"
    $python = Join-Path $installDir ".venv\Scripts\pythonw.exe"
    $main = Join-Path $installDir "main.py"
    Start-Process -FilePath $python -ArgumentList @($main) -WindowStyle Hidden
}
