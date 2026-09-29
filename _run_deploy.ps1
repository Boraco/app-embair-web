$ErrorActionPreference = "Continue"
$plink = Join-Path $env:TEMP "tools\plink.exe"
$hostkey = "SHA256:rJFDFgulN21wtU9IwwRGA2ChppzqgMzMsZI9ge6SZWY"
$deploySh = Join-Path $PSScriptRoot "_deploy_vps.sh"
$sshSecure = Read-Host "Contrasena SSH del VPS" -AsSecureString
$sshPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sshSecure)
try { $sshPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($sshPtr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($sshPtr) }

Write-Host "Plink: $plink"
Write-Host "Deploy script: $deploySh"
Write-Host "Conectando a 217.160.212.31..."

# Pipe deploy script via stdin to bash -s on remote
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $plink
$psi.Arguments = "-T -batch -ssh root@217.160.212.31 -P 22 -pw `"$sshPassword`" -hostkey $hostkey `"bash -s`""
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$p = [System.Diagnostics.Process]::Start($psi)

# Send the deploy script as stdin
$scriptContent = [System.IO.File]::ReadAllText($deploySh)
$p.StandardInput.Write($scriptContent)
$p.StandardInput.Close()

$outTask = $p.StandardOutput.ReadToEndAsync()
$errTask = $p.StandardError.ReadToEndAsync()

$ok = $p.WaitForExit(180000) # 3 min
if (-not $ok) {
  try { $p.Kill() } catch {}
  Write-Host "TIMEOUT - el deploy excedio 3 minutos"
}

$out = $outTask.Result
$err = $errTask.Result

Write-Host "EXIT_CODE=$($p.ExitCode)"
Write-Host "=============== STDOUT ==============="
Write-Host $out
Write-Host "=============== STDERR ==============="
Write-Host $err
