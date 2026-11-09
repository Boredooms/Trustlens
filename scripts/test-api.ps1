# Run the API test suite, including DB integration tests, against the ISOLATED test database only.
#   docker compose --profile test up -d test-db     (once)
#   pwsh scripts/test-api.ps1
# TEST_DATABASE_URL is set for this process only and never written to apps/api/.env.
$ErrorActionPreference = "Stop"
$api = Join-Path (Split-Path -Parent $PSScriptRoot) "apps/api"
Set-Location $api
$env:PYTHONIOENCODING = "utf-8"
$sync = "postgresql://postgres:postgres@localhost:5433/trustlens_test"
$env:DIRECT_DATABASE_URL = $sync
$env:DATABASE_URL = $sync -replace '^postgresql://', 'postgresql+asyncpg://'
& .\.venv\Scripts\python.exe -m alembic upgrade head
$env:TEST_DATABASE_URL = $env:DATABASE_URL
& .\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider @args
$code = $LASTEXITCODE
Remove-Item Env:DATABASE_URL, Env:DIRECT_DATABASE_URL, Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
exit $code
