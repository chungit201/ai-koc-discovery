# Long-running cosmetics crawl (multi-day). Keeps the MongoDB SSH tunnel alive and logs to logs/.
#   powershell -ExecutionPolicy Bypass -File scripts/crawl-web-daemon.ps1 [-Resume <runId>]
param([string]$Resume = "", [string]$Extra = "", [switch]$Fill)

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
New-Item -ItemType Directory -Force logs | Out-Null
$log = "logs/crawl-web-$(Get-Date -Format yyyyMMdd-HHmm).log"

# Tunnel watchdog: restart ssh -L if port 27117 stops listening
$tunnel = Start-Job -ScriptBlock {
  while ($true) {
    if (-not (Get-NetTCPConnection -LocalPort 27117 -State Listen -ErrorAction SilentlyContinue)) {
      Start-Process ssh -ArgumentList "-o BatchMode=yes -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -N -L 27117:127.0.0.1:27017 root@66.42.50.32" -WindowStyle Hidden
    }
    Start-Sleep 20
  }
}
Start-Sleep 5

$args = if ($Fill) { @("--fill-missing", "--categories", "848776,848648", "--top", "1000") + ($Extra -split ' ' | Where-Object { $_ }) } elseif ($Resume) { @("--resume", $Resume) + ($Extra -split ' ' | Where-Object { $_ }) } else { @("--categories", "848776,848648", "--ages", "18-24,25-34", "--pages", "40", "--top", "500", "--followers", "none") }
"$(Get-Date -Format s) start crawl $($args -join ' ')" | Out-File $log -Encoding utf8
# cmd redirection keeps the log UTF-8 (PowerShell 5.1 `>>` writes UTF-16)
cmd /c "npx tsx --env-file=.env.local scripts/crawl-web.ts $($args -join ' ') >> `"$log`" 2>&1"
"$(Get-Date -Format s) exit $LASTEXITCODE" | Out-File $log -Append -Encoding utf8

Stop-Job $tunnel; Remove-Job $tunnel
