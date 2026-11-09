# TrustLens — local servers against the ONLINE stack (Windows PowerShell). Development only.
# Uses the hosted Supabase / Upstash / QStash / Clerk configured in apps/api/.env. No local database.
#   pwsh scripts/dev-up.ps1                 # check online services, start API + web + demo sites
#   pwsh scripts/dev-up.ps1 -Migrate -Seed  # also apply migrations / idempotent demo seed (your project)
#   pwsh scripts/dev-up.ps1 -WithChain      # also start the local Hardhat registry (Web3 is local-only)
# Prerequisites: Node >= 20 + pnpm 9, Python 3.12 (py -3.12), a filled apps/api/.env and apps/web/.env.local.
param([switch]$Migrate, [switch]$Seed, [switch]$WithChain)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:PYTHONIOENCODING = "utf-8"
# A stale shell variable silently beats .env (it once pointed a running API at the test database).
Remove-Item Env:DATABASE_URL, Env:DIRECT_DATABASE_URL, Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue

$api = Join-Path $root "apps/api"
foreach ($f in "apps/api/.env", "apps/web/.env.local") {
  if (-not (Test-Path $f)) { throw "$f is missing. Copy its .env.example and fill in your own values (see README)." }
}
Write-Host "1/5 Node dependencies"; $env:CI = "true"; pnpm install --frozen-lockfile | Out-Null
$py = Join-Path $api ".venv/Scripts/python.exe"
if (-not (Test-Path $py)) {
  Write-Host "2/5 Python venv (3.12)"; py -3.12 -m venv (Join-Path $api ".venv")
  & $py -m pip install -q -r (Join-Path $api "requirements-dev.txt")
}

Write-Host "3/5 Online services"
Push-Location $api
& $py -m app.scripts.online_check
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Online check failed (see above). Nothing was started." }
if ($Migrate) { & $py -m alembic upgrade head }
if ($Seed) { & $py -m app.scripts.seed_demo }
Pop-Location

if ($WithChain) {
  Write-Host "4/5 Local chain + registry (Web3 anchoring is local-only)"
  Start-Process pwsh -ArgumentList "-NoExit", "-Command", "pnpm --filter @trustlens/contracts node" -WorkingDirectory $root
  Start-Sleep 8
  pnpm --filter @trustlens/contracts run deploy:local
}

Write-Host "5/5 Servers"
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "Remove-Item Env:DATABASE_URL,Env:DIRECT_DATABASE_URL -ErrorAction SilentlyContinue; `$env:PYTHONIOENCODING='utf-8'; .\.venv\Scripts\python.exe -m app.serve" -WorkingDirectory $api
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "pnpm --filter @trustlens/web dev" -WorkingDirectory $root
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "node apps/demo-sites/server.mjs" -WorkingDirectory $root
Write-Host "`nDashboard http://localhost:5173 (Clerk sign-in) · API http://localhost:8000 · Demo sites http://localhost:8081"
Write-Host "Proof: cd apps/api; python -m app.scripts.demo_check --timeout 120; python -m app.scripts.platform_check"
