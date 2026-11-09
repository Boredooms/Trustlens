# TrustLens — AI-assisted web threat detection and digital trust intelligence

Paste a suspicious **link, domain, email or message** and get an evidence-based assessment: what the
page or message asks for, who it claims to be, where the credentials and money would actually go,
what its TLS certificate and headers say, whether threat intelligence knows it, and what to do.
Confirmed reports can be **anchored on a blockchain** so anyone can check they were not altered.

- **Rules decide, the model narrates.** Decisions come from a deterministic risk engine
  (`apps/api/app/risk`). The LLM (optional) only explains findings it is given, citing them by id.
- **`ALLOW` never means "safe".** It means "no known threat within the checks we ran"; coverage is
  always shown. Unknown is not a pass.
- **Language alone never condemns a message.** Urgency can reach `REVIEW`, never `BLOCK`, without
  corroborating evidence (policy `O-8`/`O-9`).
- **Nothing personal goes on chain.** Only salted hash commitments.

The specification is in [`docs/`](docs/INDEX.md) and is the source of truth.

## Problem statement → where it is

| Requirement | Implementation | Docs |
| --- | --- | --- |
| Module 1 · URL & domain analysis (normalise, typosquat, redirects, reputation, DNS, campaigns) | `apps/api/app/services/{guard,collectors}.py`, `app/risk/rules.py` | [`RISK_ENGINE.md`](docs/03-backend/RISK_ENGINE.md) |
| Module 2 · TLS certificate & web trust (expiry, SAN, chain, OCSP/CRL revocation, CT, weak crypto, issuer advisories) | `app/services/certificates.py`, `app/risk/posture.py` | [`CERTIFICATE_ANALYSIS.md`](docs/03-backend/CERTIFICATE_ANALYSIS.md) |
| Module 3 · AI scam & message analysis | `app/services/message_analysis.py`, `POST /api/v1/messages/analyse`, `/app/messages` | [`MESSAGE_ANALYSIS.md`](docs/03-backend/MESSAGE_ANALYSIS.md) |
| Module 4 · Threat correlation | threat graph, campaigns, LangGraph investigations, message repeat/shared-domain correlation | [`THREAT_GRAPH.md`](docs/07-ai-intelligence/THREAT_GRAPH.md) |
| Module 5 · Website security assessment (passive headers, cookies, mixed content) | `app/risk/posture.py` (unscored) | [`CERTIFICATE_ANALYSIS.md`](docs/03-backend/CERTIFICATE_ANALYSIS.md) §5 |
| Module 6 · Decentralised threat intelligence | `packages/contracts` (Solidity), `app/services/{anchors,chain}.py`, `/verify/:id` | [`WEB3_REGISTRY.md`](docs/02-architecture/WEB3_REGISTRY.md) |
| External intelligence source | URLhaus (abuse.ch), live with a key, labelled fixtures otherwise | [`THREAT_INTELLIGENCE_SOURCES.md`](docs/02-architecture/THREAT_INTELLIGENCE_SOURCES.md) |
| Five risk classes | `Decision` ↔ `risk_class` (`app/risk/classes.py`) | `RISK_ENGINE.md` §8.7 |
| Optional: browser extension, lookalike detection, CA monitoring, community reporting, org dashboard, SDK | `apps/extension`, `packages/sdk`, `apps/web` | [`docs/INDEX.md`](docs/INDEX.md) |

Deliverables: testing report [`docs/evidence/TESTING_REPORT.md`](docs/evidence/TESTING_REPORT.md) ·
Web3 evidence [`docs/evidence/web3/`](docs/evidence/web3/README.md) · baseline
[`docs/evidence/baseline.md`](docs/evidence/baseline.md) · demo script
[`docs/evidence/demo.md`](docs/evidence/demo.md).

## Run it (about 10 minutes from a clean clone)

Prerequisites: **Node ≥ 20 + pnpm 9**, **Python 3.12** (3.13 also works), and your own hosted
services: a **Supabase** project (database only), a **Clerk** application (the only identity
provider), **Upstash Redis + QStash**. Docker is needed only for the isolated integration-test DB.
There is no local application database.

**One command** — Windows: `pwsh scripts/dev-up.ps1` · macOS/Linux: `bash scripts/dev-up.sh`.
It runs `online_check` against your hosted services, then starts the API, the dashboard and the demo
sites. Add `-Migrate -Seed -WithChain` (`--migrate --seed --with-chain`) to migrate the hosted DB,
seed the demo org, and start the local chain.

Or step by step:

```bash
pnpm install                                            # repo root
pnpm --filter @trustlens/contracts node                 # optional, terminal A: local chain :8545 (chainId 31337)
pnpm --filter @trustlens/contracts run deploy:local     # optional: deterministic address 0x5FbDB2…0aa3

cd apps/api
python -m venv .venv && . .venv/Scripts/activate        # macOS/Linux: . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                                    # fill in the [required] hosted values
python -m app.scripts.online_check                      # status of DB/Redis/QStash/Clerk/LLM, no secrets printed
alembic upgrade head                                    # uses DIRECT_DATABASE_URL (session pooler :5432)
python -m app.scripts.seed_demo                         # Northstar University demo data (simulated, idempotent)
python -m app.serve                                     # terminal B: API :8000 (Linux: uvicorn app.main:app)

pnpm --filter @trustlens/web dev                        # terminal C (repo root): dashboard :5173
node apps/demo-sites/server.mjs                         # terminal D: inert demo sites :8081
```

Open <http://localhost:5173>, sign in with Clerk (or **Development sign-in** when
`DEV_AUTH_ENABLED=true` locally), then try **Scan**, **Messages**,
**Reports** (anchor on chain) and the public page `/verify/<report-id>` in a private window.

## Prove it

```bash
cd apps/api
python -m app.scripts.demo_check            # 26 assertions over HTTP (reset_demo first if re-running)
python -m app.scripts.platform_check        # 42 checks (orgs, verification, members, appeals, …)
python -m app.scripts.evidence_run --network  # writes docs/evidence/TESTING_REPORT.md from real runs
python -m app.scripts.chain_evidence        # anchors demo reports, writes docs/evidence/web3/chain.json
pnpm --filter @trustlens/contracts replay   # offline: deploy, register, verify true, tamper → false
pnpm --filter @trustlens/contracts verify-report -- --report <id>   # verify without trusting the API
```

## Checks

```bash
(cd apps/api && ruff check . && ruff format --check . && mypy app)
docker compose --profile test up -d test-db   # once: isolated test DB on :5433 (trustlens_test)
pwsh scripts/test-api.ps1    # migrates the test DB, runs pytest; never touches the hosted DB
pwsh scripts/secret-scan.ps1 -Staged   # before every commit
pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm -r build
```

## Layout

```text
apps/api            FastAPI — the only verdict producer (risk engine, scanner, intel, messages, anchors)
apps/web            React + Vite dashboard and public pages (incl. /verify/:reportId)
apps/extension      Chrome MV3 extension (see apps/extension/README.md)
apps/demo-sites     Inert genuine + lookalike demo pages (zero dependencies)
packages/contracts  ThreatReportRegistry (Solidity 0.8.24, Hardhat) + replay/verify scripts
packages/sdk        @trustlens/sdk
packages/shared-types  generated from apps/api/openapi.json (pnpm gen:types)
docs/               specification, evidence, handover
```

## Configuration and hosting

Every variable: [`docs/08-infrastructure/ENVIRONMENT_CONFIGURATION.md`](docs/08-infrastructure/ENVIRONMENT_CONFIGURATION.md).
Optional: `LLM_API_KEY` (narration; without it the deterministic template narrator is used),
`URLHAUS_AUTH_KEY` (live URLhaus; without it demo hosts use labelled fixtures and other hosts are not
consulted). Hosted deployment (Render + Vercel + Supabase + Clerk) is documented in
[`docs/handover/HANDOVER.md`](docs/handover/HANDOVER.md) §8 and has **not** been performed for this
build. Never put a secret in a `VITE_*` variable or commit a `.env` file.

## Limitations (stated, not hidden)

- Demo domains are RFC 2606 `.example` hosts answered by recorded fixtures (`simulated: true`).
- The local chain is in-memory; restarting it erases the registry (existing anchors then honestly fail
  `chain_commitment_matches`). API anchoring to a public testnet is not implemented.
- Revocation is best-effort (OCSP, CRL fallback); a timeout is `unavailable`, never "good".
- Header posture is a single unauthenticated response; it is reported, never scored.

## License

[MIT](LICENSE).
