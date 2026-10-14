param([string]$Executable = "$PSScriptRoot\..\src-tauri\target\release\pdf-studio.exe")
$ErrorActionPreference = 'Stop'
$appPath = (Resolve-Path -LiteralPath $Executable).Path
$logPrefix = Join-Path ([IO.Path]::GetTempPath()) ("pdfstudio-startup-" + [Guid]::NewGuid().ToString('N'))
$errorLog = "$logPrefix.err.log"
$outputLog = "$logPrefix.out.log"
$appProcess = $null
try {
    $appProcess = Start-Process -FilePath $appPath -WindowStyle Hidden -PassThru -RedirectStandardError $errorLog -RedirectStandardOutput $outputLog
    if ($appProcess.WaitForExit(15000)) {
        $details = Get-Content -LiteralPath $errorLog -Raw
        throw "PDF Studio exited during startup. $details"
    }
    $appProcess.Refresh()
    if ($appProcess.MainWindowHandle -eq 0) { throw 'PDF Studio stayed running but did not create its main window.' }
    $errors = Get-Content -LiteralPath $errorLog -Raw
    if ($errors -match 'panicked at|Failed to setup app') { throw "Startup failure: $errors" }
    Write-Output "PASS: PDF Studio remained running for 15 seconds with main window '$($appProcess.MainWindowTitle)'."
} finally {
    if ($appProcess -and -not $appProcess.HasExited) {
        [void]$appProcess.CloseMainWindow()
        if (-not $appProcess.WaitForExit(5000)) { $appProcess.Kill() }
    }
    Write-Output "Startup diagnostic log: $errorLog"
}
