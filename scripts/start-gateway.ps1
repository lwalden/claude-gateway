# start-gateway.ps1 — guarded launcher for the hidden autostart task.
#
# Invoked (hidden, no console) via start-gateway-hidden.vbs at user logon.
# Skips launching if the gateway's port is already listening, so a stray
# double-trigger (task restart-on-failure racing a still-healthy process,
# multiple logons in one session) doesn't spawn a second instance that
# would just fail to bind and crash-loop.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env'

$port = 3131
if (Test-Path $envFile) {
    $match = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($match) { $port = [int]$match.Matches[0].Groups[1].Value }
}

$alreadyListening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($alreadyListening) {
    exit 0
}

Set-Location $repoRoot
& node src\index.js
