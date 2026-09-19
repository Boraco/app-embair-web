param(
  [switch]$RestoreLatestBackup
)

$ErrorActionPreference = "Continue"
$plink = Join-Path $env:TEMP "tools\plink.exe"
$hostkey = "SHA256:rJFDFgulN21wtU9IwwRGA2ChppzqgMzMsZI9ge6SZWY"
$deploySh = if ($RestoreLatestBackup) {
  Join-Path $PSScriptRoot "_restore_latest_backup_vps.sh"
} else {
  Join-Path $PSScriptRoot "_recover_data_vps.sh"
}

Write-Host "Plink: $plink"
Write-Host "Recover script: $deploySh"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $plink
$psi.Arguments = "-T -batch -ssh root@217.160.212.31 -P 22 -pw e6zU0Q5kkB0Nr -hostkey $hostkey `"bash -s`""
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$p = [System.Diagnostics.Process]::Start($psi)

$scriptContent = [System.IO.File]::ReadAllText($deploySh)
$p.StandardInput.Write($scriptContent)
$p.StandardInput.Close()

$outTask = $p.StandardOutput.ReadToEndAsync()
$errTask = $p.StandardError.ReadToEndAsync()

$ok = $p.WaitForExit(300000) # 5 min
if (-not $ok) {
  try { $p.Kill() } catch {}
  Write-Host "TIMEOUT"
}

$out = $outTask.Result
$err = $errTask.Result

Write-Host "EXIT_CODE=$($p.ExitCode)"
Write-Host "=============== STDOUT ==============="
Write-Host $out
Write-Host "=============== STDERR ==============="
Write-Host $err
