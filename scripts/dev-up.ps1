# TrustLens — one-command local demo (Windows PowerShell). Development only.
# Starts: Postgres (Docker), local Hardhat chain, API, web, demo sites — each in its own window —
# then migrates, seeds, deploys the registry, anchors demo reports and runs the proof scripts.
# Prerequisites: Docker Desktop running, Node >= 20 + pnpm 9, Python 3.12 (py -3.12).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:PYTHONIOENCODING = "utf-8"

Write-Host "1/7 Postgres"; docker compose up -d db | Out-Null
Write-Host "2/7 Node dependencies"; $env:CI = "true"; pnpm install --frozen-lockfile | Out-Null
$api = Join-Path $root "apps/api"
$py = Join-Path $api ".venv/Scripts/python.exe"
if (-not (Test-Path $py)) {
  Write-Host "3/7 Python venv (3.12)"; py -3.12 -m venv (Join-Path $api ".venv")
  & $py -m pip install -q -r (Join-Path $api "requirements-dev.txt")
}
if (-not (Test-Path (Join-Path $api ".env"))) { Copy-Item (Join-Path $api ".env.example") (Join-Path $api ".env") }
if (-not (Test-Path "apps/web/.env.local")) { Copy-Item "apps/web/.env.example" "apps/web/.env.local" }

Write-Host "4/7 Local chain + registry"
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "pnpm --filter @trustlens/contracts node" -WorkingDirectory $root
Start-Sleep 8
pnpm --filter @trustlens/contracts run deploy:local

Write-Host "5/7 Database"
Push-Location $api
& $py -m alembic upgrade head
& $py -m app.scripts.seed_demo
Pop-Location

Write-Host "6/7 Servers"
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "`$env:PYTHONIOENCODING='utf-8'; .\.venv\Scripts\python.exe -m app.serve" -WorkingDirectory $api
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "pnpm --filter @trustlens/web dev" -WorkingDirectory $root
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "node apps/demo-sites/server.mjs" -WorkingDirectory $root
Start-Sleep 10

Write-Host "7/7 Proof"
Push-Location $api
& $py -m app.scripts.demo_check
& $py -m app.scripts.chain_evidence
Pop-Location
Write-Host "`nDashboard http://localhost:5173  (Development sign-in)  ·  API http://localhost:8000  ·  Demo sites http://localhost:8081"
