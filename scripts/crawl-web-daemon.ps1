# Long-running Kalodata web crawl (multi-day), logs to logs/. The DB tunnel is kept up separately
# by the DETOLA-db-tunnel task (scripts/db-tunnel.ps1).
#   Run once:      powershell -ExecutionPolicy Bypass -File scripts/crawl-web-daemon.ps1 -Fill
#   As a task:     powershell -ExecutionPolicy Bypass -File scripts/crawl-web-daemon.ps1 -Fill -Install
#                  (Windows scheduled task: starts at logon, survives closed terminals, resumes after reboot)
# -Fill only completes missing data for KOCs already in the DB — never adds new KOCs — then fills
# shop names (scripts/crawl-shops.ts).
# Safety: exit code 3 from the crawler = Kalodata account warning/lock → writes .cache/crawl-halted and
# never restarts until a human deletes that file.
param([string]$Resume = "", [string]$Extra = "", [switch]$Fill, [switch]$Install)

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
New-Item -ItemType Directory -Force logs, .cache | Out-Null
$halt = Join-Path $root ".cache\crawl-halted"

if ($Install) {
  $mode = if ($Fill) { "-Fill" } elseif ($Resume) { "-Resume $Resume" } else { "" }
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" $mode" -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName "DETOLA-crawl" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName "DETOLA-crawl"
  Write-Output "Installed and started scheduled task DETOLA-crawl ($mode)"
  return
}

$crawlArgs = if ($Fill) { @("--fill-missing", "--categories", "848776,848648", "--top", "1000") + ($Extra -split ' ' | Where-Object { $_ }) } elseif ($Resume) { @("--resume", $Resume) + ($Extra -split ' ' | Where-Object { $_ }) } else { @("--categories", "848776,848648", "--ages", "18-24,25-34", "--pages", "40", "--top", "500", "--followers", "none") }

while ($true) {
  if (Test-Path $halt) { "$(Get-Date -Format s) halted: $(Get-Content $halt -Raw)" | Out-File "logs/crawl-web-halted.log" -Append -Encoding utf8; exit 0 }
  $log = "logs/crawl-web-$(Get-Date -Format yyyyMMdd-HHmm).log"
  "$(Get-Date -Format s) start crawl $($crawlArgs -join ' ')" | Out-File $log -Encoding utf8
  # cmd redirection keeps the log UTF-8 (PowerShell 5.1 `>>` writes UTF-16)
  cmd /c "npx tsx --env-file=.env.local scripts/crawl-web.ts $($crawlArgs -join ' ') >> `"$log`" 2>&1"
  $code = $LASTEXITCODE
  "$(Get-Date -Format s) exit $code" | Out-File $log -Append -Encoding utf8
  if ($code -eq 0 -and $Fill) {
    # KOC data complete → then fill shop names from the web shop ranking (same pacing / daily cap)
    "$(Get-Date -Format s) start shops" | Out-File $log -Append -Encoding utf8
    cmd /c "npx tsx --env-file=.env.local scripts/crawl-shops.ts >> `"$log`" 2>&1"
    $code = $LASTEXITCODE
    "$(Get-Date -Format s) shops exit $code" | Out-File $log -Append -Encoding utf8
  }
  if ($code -eq 0) { exit 0 }                                   # finished
  if ($code -eq 3) { "account warning/lock at $(Get-Date -Format s), see $log" | Out-File $halt -Encoding utf8; exit 0 }
  Start-Sleep 600                                               # transient error (network/DB) → retry in 10 min
}
