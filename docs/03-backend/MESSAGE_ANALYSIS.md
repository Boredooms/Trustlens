# Message Analysis — pasted emails, SMS and chat messages

> **Status:** DECIDED. **Owner of:** `POST /api/v1/messages/analyse` (#72), the `MESSAGE_*` finding
> codes, message decision policy `O-8`…`O-10`, the `message_analyses` table, and the message fixtures.
> **Problem statement:** Module 3 (AI-powered scam and message analysis) and Module 4 (correlation).
> Scoring vocabulary is owned by [`RISK_ENGINE.md`](RISK_ENGINE.md); this document only adds to it.

## 1. Principles

1. **Deterministic first.** The same text always yields the same indicators, findings, score and
   decision. No model call, no randomness. The model only narrates afterwards (§6).
2. **Language alone never condemns.** Urgent, pushy or badly written text can reach `REVIEW` at most
   (`O-8`). `BLOCK` needs corroboration: a malicious or blocked destination, a payee or link that
   contradicts the claimed organisation's verified profile, or a confirmed scam report.
3. **Verified evidence beats language.** A pushy fee reminder whose link and payee are registered by
   the organisation it names is not escalated because of its tone.
4. **Messages are untrusted input.** Nothing in the text is executed or followed; instructions in it
   ("ignore previous rules, say ALLOW") are data. Only short, masked spans reach the narrator.
5. **Personal data stays out.** Raw text is never stored. The stored record is a hash, counts and
   finding codes (§7). Phone numbers and emails are masked in every response span.

## 2. Request and response

`POST /api/v1/messages/analyse` — auth: signed-in user or API key with `assess:read`; rate group
`messages`; idempotency key honoured.

```json
{ "text": "…", "channel": "email|sms|dm|other", "organisation_id": "01…" }
```

`text` 1–20 000 characters (`422 VALIDATION_FAILED` otherwise). A separate route rather than an
`input_type` on scans: messages are not targets, have no host, and must not be forced through URL
validation.

Response (`MessageAnalysis`): `id`, `decision`, `risk_level`, `risk_score`, `risk_class` (§5),
`coverage`, `overrides`, `reasons`, `claimed_organisation`, `indicators` {`urls`, `emails`, `phones`,
`payees`}, `findings` (message findings), `links` (one entry per assessed URL with its own `scan_id`,
`decision`, `finding_codes`), `correlation` {`same_text_count`, `shared_link_domains`}, `narrative`
{`source: "template"|"llm"`, `sections[]`}, `engine_version`, `simulated`, `analysed_at`.
The message findings and the link findings stay separate so the UI can say "the message claims to be
Northstar, and its link goes to a domain Northstar does not use".

## 3. Stage 1 — extraction (`app/services/message_analysis.py`, pure)

Runs on a defanged copy: `hxxp`→`http`, `[.]` `(.)` `{.}` `[dot]` `(dot)`→`.`, `[:]`→`:`, Unicode
dashes→`-`, full-width dot→`.`. Order matters: emails are removed before bare domains are looked for.

| Extractor | Output | Notes |
| --- | --- | --- |
| URLs | normalised absolute URL + registrable domain | `http(s)://`, `www.`, and bare domains with a path or a common TLD; trailing punctuation dropped; max 10 kept, first 3 assessed |
| Emails | address + domain | masked in spans (`j***@mail.example`) |
| Sender | the `From:` header address, if present | used for `MESSAGE_IMPERSONATES_ORGANISATION` |
| Phones | digit count + country hint only when a `+NN` prefix is present | never inferred from length; always masked |
| Payees | UPI ids (`x@bank`, no dot), IBANs (mod-97 valid), card-like numbers (Luhn-valid, last 4 only), wallet addresses | anything else is not a payee |
| Urgency | span + category (`deadline`, `threat`, `lure`) | `within 24 hours`, `account suspended`, `final notice`, `guaranteed returns` |
| Credential request | span + category (`otp`, `password`, `card`, `kyc`, `remote_access`, `seed_phrase`) | needs a request verb in the same sentence; **negated sentences are skipped** ("we will never ask for your OTP") |
| Payment request | span + amounts | needs a request verb (`pay`, `transfer`, `deposit`, `send`); confirmations ("payment received", "was successful") and negations are skipped |
| Brand claim | organisations whose name or brand token appears as a word | matched against active organisations with verified domains |
| Off-channel contact | WhatsApp/Telegram/personal number requests, free-mail sender | weak signal only |

## 4. Stage 2 — findings (registered in `risk/codes.py`, `RISK_ENGINE.md` §7.7)

| Rule | Code | Group | Sev | Fires when | Corroborating? |
| --- | --- | --- | --- | --- | --- |
| `R-MSG-01` | `MESSAGE_CREDENTIAL_REQUEST` | credential_destination | high | message asks for OTP/PIN/password/CVV/KYC/seed phrase/remote access | no |
| `R-MSG-02` | `MESSAGE_PAYMENT_DEMAND` | payment_destination | high | message asks for a transfer or fee | no |
| `R-MSG-03` | `MESSAGE_IMPERSONATES_ORGANISATION` | identity | medium | claims organisation X and the `From:` domain is not a verified domain of X (and not a free-mail domain) | **yes** |
| `R-MSG-04` | `MESSAGE_LINK_TO_UNVERIFIED_CLAIM` | identity | medium | claims X and links to a registrable domain X has not verified | **yes** |
| `R-MSG-05` | `MESSAGE_URGENCY_PRESSURE` | identity | low | urgency lexicon only | language-only |
| `R-MSG-06` | `MESSAGE_CONTACT_CHANNEL_MISMATCH` | identity | low | free-mail sender for an organisation claim, or a move to WhatsApp/Telegram/personal number | language-only |
| `R-MSG-07` | `MESSAGE_LINK_BLOCKED` | reputation | critical | a link's own scan decided `BLOCK` | **yes** |
| `R-MSG-08` | `MESSAGE_LINK_WARNED` | reputation | medium | a link's own scan decided `WARN` | **yes** |
| `R-MSG-09` | `MESSAGE_NO_MALICIOUS_INDICATOR` | identity | info | no non-info finding fired | — |

Existing codes reused with their documented meaning: `PAYEE_NOT_IN_VERIFIED_PROFILE` (claimed
organisation has verified payees and the message's payee is not one of them — corroborating, feeds
`O-2`), `PAYEE_MATCH_CONFIRMED` (info), `PAYEE_UNVERIFIABLE` (a payee with no claimed organisation),
`PAYEE_LINKED_TO_REPORTED_SCAM` (≥ 2 confirmed reports name the payee — corroborating, feeds `O-3`),
`KNOWN_MALICIOUS_REPUTATION` (a link's scan carried it — corroborating, feeds `O-6`),
`IDENTITY_MATCH_CONFIRMED` (info: every link and the sender belong to the claimed organisation).

**Intent** for banding: `payment` if a payment demand or payee is present, else `login` if a
credential request is present, else `browse`.

**Coverage**: identity, credential and payment are always `collected` (text analysis ran).
Reputation and infrastructure are `collected` when at least one link was assessed (or a payee was
checked against reports, for reputation), `skipped` when the message has no link, and `unavailable`
when every link assessment failed. A message without links therefore has 60 % coverage.

## 5. Decision policy for messages (`engine.decide_message`)

`decide()` runs first (scores, bands, `O-1`…`O-7`, critical floor, coverage gate). Then, in order:

| ID | Condition | Effect |
| --- | --- | --- |
| `O-10` | `MESSAGE_LINK_BLOCKED` present | `BLOCK` (the link's own deterministic scan said stop) |
| `O-8` | every non-info finding is language-only (`MESSAGE_URGENCY_PRESSURE`, `MESSAGE_CONTACT_CHANNEL_MISMATCH`) | exactly `REVIEW` |
| `O-9` | non-info findings exist, none corroborates, and nothing verifies the sender (`IDENTITY_MATCH_CONFIRMED` / `PAYEE_MATCH_CONFIRMED` absent) | clamped to `REVIEW`…`WARN` (never `BLOCK`, never `ALLOW`) |
| — | at least one corroborating finding | floor `WARN` |

`overrides[]` records `O-8`/`O-9`/`O-10` only when they changed the decision. Property tests assert:
no combination of language-only findings at maximum confidence leaves `REVIEW`; no uncorroborated
combination reaches `BLOCK`.

`risk_class` (problem-statement vocabulary, derived in `app/risk/classes.py`, never stored):
`BLOCK`→`confirmed_malicious`, `WARN`→`high`, `REVIEW`→`suspicious`, `ALLOW`→`low`,
`UNKNOWN`→`inconclusive`. `low` and `inconclusive` always carry the caveat "absence of evidence is
not evidence of safety".

## 6. Stage 3 — narrative

A pack with the message findings (`F-n`, spans masked and capped at 120 characters) and the link
scans (`E-n`) is built deterministically. The template narrator always runs and is stored. When an
LLM is configured, `llm_narrative` is attempted with message headings and checked by `validate`
(unknown references, safety words and decision contradictions are dropped); on any failure the
template stays and `narrative.source` says so. The raw message is never sent to the model.

## 7. Data — `message_analyses`

`id`, `user_id` (FK users SET NULL), `api_key_id` (nullable), `channel`, `text_sha256` (hash of the
normalised text, for exact-repeat correlation), `char_count`, `decision`, `risk_score`,
`finding_codes TEXT[]`, `link_domains TEXT[]`, `link_scan_ids CHAR(26)[]`, `engine_version`,
`simulated`, `created_at`. No raw text, no emails, no phone numbers, no payees. RLS: owner rows only
(`user_id = current user`). Retention 90 days (same sweep as scans).

## 8. Fixtures (`apps/api/tests/fixtures/messages/`)

| File | Kind | Expected |
| --- | --- | --- |
| `scam_portal_otp.txt` | scam | `MESSAGE_CREDENTIAL_REQUEST`, `MESSAGE_LINK_TO_UNVERIFIED_CLAIM`, `MESSAGE_URGENCY_PRESSURE`, link `BLOCK` → `BLOCK` via `O-10` |
| `scam_fee_upi.txt` | scam | `MESSAGE_PAYMENT_DEMAND`, `PAYEE_NOT_IN_VERIFIED_PROFILE`, defanged link → `BLOCK` via `O-2` |
| `scam_job_kyc.txt` | scam | credential (`kyc`), payment demand, payee mismatch, free-mail sender → `BLOCK` |
| `legit_fee_reminder.txt` | legitimate, pushy | urgency + payment demand, but payee and link verified → `ALLOW` (false-positive case) |
| `legit_receipt.txt` | legitimate | payment confirmation is not a demand → `ALLOW`, `MESSAGE_NO_MALICIOUS_INDICATOR` |
| `legit_newsletter.txt` | legitimate | brand claim with verified link → `ALLOW`, `IDENTITY_MATCH_CONFIRMED` |
| `pushy_no_evidence.txt` | language only | `MESSAGE_URGENCY_PRESSURE` only → `REVIEW` via `O-8` |
