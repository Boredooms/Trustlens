#!/usr/bin/env bash
# TrustLens — local servers against the ONLINE stack (macOS/Linux). Development only.
# Uses the hosted Supabase / Upstash / QStash / Clerk configured in apps/api/.env. No local database.
#   bash scripts/dev-up.sh [--migrate] [--seed] [--with-chain]
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd); LOGS="$ROOT/.dev-logs"; mkdir -p "$LOGS"
export PYTHONIOENCODING=utf-8 CI=true
unset DATABASE_URL DIRECT_DATABASE_URL TEST_DATABASE_URL   # a stale shell value beats .env
MIGRATE=0; SEED=0; CHAIN=0
for a in "$@"; do case "$a" in --migrate) MIGRATE=1;; --seed) SEED=1;; --with-chain) CHAIN=1;; esac; done
for f in apps/api/.env apps/web/.env.local; do
  [ -f "$f" ] || { echo "$f is missing. Copy its .env.example and fill in your own values."; exit 1; }
done
echo "1/5 Node dependencies"; pnpm install --frozen-lockfile >/dev/null
cd apps/api
if [ ! -x .venv/bin/python ]; then echo "2/5 Python venv"; python3.12 -m venv .venv; .venv/bin/pip install -q -r requirements-dev.txt; fi
echo "3/5 Online services"
.venv/bin/python -m app.scripts.online_check || { echo "Online check failed; nothing started."; exit 1; }
[ "$MIGRATE" = 1 ] && .venv/bin/python -m alembic upgrade head
[ "$SEED" = 1 ] && .venv/bin/python -m app.scripts.seed_demo
cd "$ROOT"
if [ "$CHAIN" = 1 ]; then
  echo "4/5 Local chain + registry (Web3 anchoring is local-only)"
  nohup pnpm --filter @trustlens/contracts node >"$LOGS/chain.log" 2>&1 &
  sleep 8; pnpm --filter @trustlens/contracts run deploy:local
fi
echo "5/5 Servers"
(cd apps/api && nohup .venv/bin/uvicorn app.main:app --port 8000 >"$LOGS/api.log" 2>&1 &)
nohup pnpm --filter @trustlens/web dev >"$LOGS/web.log" 2>&1 &
nohup node apps/demo-sites/server.mjs >"$LOGS/demo-sites.log" 2>&1 &
echo "Dashboard http://localhost:5173 (Clerk sign-in) · API http://localhost:8000 · Demo sites http://localhost:8081"
echo "Logs in $LOGS."
