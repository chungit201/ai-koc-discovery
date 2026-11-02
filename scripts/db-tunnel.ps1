# Keeps the MongoDB SSH tunnel (local 27117 -> server 27017) alive; restarts it within ~15s if it drops.
# Installed as a Windows scheduled task (runs at logon, restarts if killed):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-tunnel.ps1 -Install
# Log: .cache\db-tunnel.log
param([switch]$Install)

$root = Split-Path $PSScriptRoot -Parent
$log = Join-Path $root ".cache\db-tunnel.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Log($m) { "$(Get-Date -Format 's') $m" | Add-Content $log }

if ($Install) {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName "DETOLA-db-tunnel" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName "DETOLA-db-tunnel"
  Write-Output "Installed and started scheduled task DETOLA-db-tunnel"
  return
}

Log "watchdog started (pid $PID)"
while ($true) {
  if (-not (Get-NetTCPConnection -LocalPort 27117 -State Listen -ErrorAction SilentlyContinue)) {
    Log "tunnel down -> starting ssh"
    Start-Process ssh -ArgumentList "-o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -N -L 27117:127.0.0.1:27017 root@66.42.50.32" -WindowStyle Hidden
  }
  Start-Sleep 15
}
