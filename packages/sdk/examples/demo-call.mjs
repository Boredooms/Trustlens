// The 20-second terminal demo (DEMO_RUNBOOK.md §2, SDK_INTEGRATION_GUIDE.md §2).
// Run after `pnpm --filter trustlens-sdk build`:
//   TRUSTLENS_API_KEY=tl_live_... node packages/sdk/examples/demo-call.mjs
// The decision comes from the server. ALLOW means "no known threat within executed checks".
import { TrustLens, TrustLensError } from "trustlens-sdk";

const apiKey = process.env.TRUSTLENS_API_KEY;
if (!apiKey) {
  console.error("Set TRUSTLENS_API_KEY (Dashboard → Developers → Create key, scope assess:read).");
  process.exit(2);
}

const tl = new TrustLens({
  apiKey,
  baseUrl: process.env.TRUSTLENS_API_URL ?? "http://localhost:8000",
  client: "demo-call/1.0",
});

const LABEL = {
  BLOCK: "Blocked",
  WARN: "Suspicious",
  ALLOW: "No known threat (in the checks that ran)",
  REVIEW: "Needs review",
  UNKNOWN: "Not verified",
};

try {
  const r = await tl.assess({
    url: "https://apply.northstar-admissions.example/pay",
    intent: "payment",
    payee: "fees@okaxis",
  });
  console.log(`decision : ${r.decision} — ${LABEL[r.decision]}`);
  console.log(`risk     : ${r.risk_level}${r.risk_score == null ? "" : ` (${r.risk_score}/100)`}`);
  console.log(`coverage : ${r.coverage?.percent ?? "?"}% of signal groups checked`);
  if (r.action) {
    console.log(`payee    : observed ${r.action.payee ?? "—"} · match ${r.action.match}`);
  }
  console.log("reasons  :");
  for (const reason of r.reasons ?? []) console.log(`  - ${reason}`);
  if (r.scan_id) console.log(`scan_id  : ${r.scan_id}`);
} catch (err) {
  if (err instanceof TrustLensError) {
    // Degrade honestly: we could not verify — this is not an ALLOW.
    console.error(`Could not verify (${err.code}, status ${err.status ?? "n/a"}): ${err.message}`);
    process.exit(1);
  }
  throw err;
}
