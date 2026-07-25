# start-gateway.ps1 — guarded launcher for the hidden autostart task.
#
# Invoked (hidden, no console) via start-gateway-hidden.vbs at user logon.
# Skips launching if the gateway's port is already listening, so a stray
# double-trigger (task restart-on-failure racing a still-healthy process,
# multiple logons in one session) doesn't spawn a second instance that
# would just fail to bind and crash-loop. Once the gateway is confirmed
# up, opens the status dashboard in the default browser -- the browser
# tab is meant to be visible; only the node process itself stays hidden.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env'

$port = 3131
if (Test-Path $envFile) {
    $match = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($match) { $port = [int]$match.Matches[0].Groups[1].Value }
}

$healthUrl = "http://localhost:$port/health"

$alreadyListening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $alreadyListening) {
    Start-Process -FilePath 'node' -ArgumentList 'src\index.js' -WorkingDirectory $repoRoot -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 300
        try {
            $resp = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
            if ($resp.status -eq 'ok') { break }
        } catch {
            # Not up yet -- keep polling until the deadline.
        }
    } while ((Get-Date) -lt $deadline)
}

Start-Process "http://localhost:$port/"
