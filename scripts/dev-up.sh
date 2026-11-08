#!/usr/bin/env bash
# TrustLens — one-command local demo (macOS/Linux). Development only.
# Starts Postgres (Docker), a local Hardhat chain, the API, web and demo sites in the background
# (logs in .dev-logs/), migrates, seeds, deploys the registry and runs the proof scripts.
# Prerequisites: Docker, Node >= 20 + pnpm 9, python3.12.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
LOGS="$ROOT/.dev-logs"; mkdir -p "$LOGS"
export PYTHONIOENCODING=utf-8 CI=true

echo "1/7 Postgres"; docker compose up -d db >/dev/null
echo "2/7 Node dependencies"; pnpm install --frozen-lockfile >/dev/null
cd apps/api
if [ ! -x .venv/bin/python ]; then
  echo "3/7 Python venv"; python3.12 -m venv .venv
  .venv/bin/pip install -q -r requirements-dev.txt
fi
[ -f .env ] || cp .env.example .env
[ -f ../web/.env.local ] || cp ../web/.env.example ../web/.env.local
cd "$ROOT"

echo "4/7 Local chain + registry"
nohup pnpm --filter @trustlens/contracts node >"$LOGS/chain.log" 2>&1 &
sleep 8
pnpm --filter @trustlens/contracts run deploy:local

echo "5/7 Database"
(cd apps/api && .venv/bin/python -m alembic upgrade head && .venv/bin/python -m app.scripts.seed_demo)

echo "6/7 Servers"
(cd apps/api && nohup .venv/bin/uvicorn app.main:app --port 8000 >"$LOGS/api.log" 2>&1 &)
nohup pnpm --filter @trustlens/web dev >"$LOGS/web.log" 2>&1 &
nohup node apps/demo-sites/server.mjs >"$LOGS/demo-sites.log" 2>&1 &
sleep 10

echo "7/7 Proof"
(cd apps/api && .venv/bin/python -m app.scripts.demo_check && .venv/bin/python -m app.scripts.chain_evidence)
echo
echo "Dashboard http://localhost:5173 (Development sign-in) · API http://localhost:8000 · Demo sites http://localhost:8081"
echo "Logs in $LOGS. Stop with: kill \$(jobs -p) or pkill -f 'hardhat node|uvicorn|vite|server.mjs'"
