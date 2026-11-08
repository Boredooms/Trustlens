"""Deterministic message analysis: extraction and findings (MESSAGE_ANALYSIS.md §3–§4).

Pure functions. No network, no database, no model, no randomness: the same text and the same
profiles always produce the same indicators and findings. The route (``api/routes/messages.py``)
loads profiles, assesses links through the normal scan pipeline and calls ``evaluate``.

Message text is untrusted data. Nothing here interprets instructions inside it, and every span that
leaves this module is masked (emails, phone numbers) and length-capped.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from app.errors import DomainError
from app.risk.engine import Finding
from app.schemas.enums import CoverageState, Intent, SignalGroup
from app.services import guard

MAX_URLS = 10
MAX_SPANS = 3
SPAN_CHARS = 120

# ── Defanging ───────────────────────────────────────────────────────────────────
_DEFANG = [
    (re.compile(r"(?i)\bhxxp(s?)"), r"http\1"),
    (re.compile(r"(?i)\[(?:\.|dot)\]|\((?:\.|dot)\)|\{(?:\.|dot)\}"), "."),
    (re.compile(r"\[:\]"), ":"),
    (re.compile(r"[\u2010-\u2015\u2212]"), "-"),
    (re.compile(r"[\u3002\uff0e]"), "."),
]


def defang(text: str) -> str:
    out = unicodedata.normalize("NFKC", text)
    for pattern, repl in _DEFANG:
        out = pattern.sub(repl, out)
    return out


def normalised_hash(text: str) -> str:
    """Exact-repeat fingerprint: case- and whitespace-insensitive, defanged."""
    canon = re.sub(r"\s+", " ", defang(text).lower()).strip()
    return hashlib.sha256(canon.encode()).hexdigest()


# ── Patterns ────────────────────────────────────────────────────────────────────
URL_RE = re.compile(r"(?i)\b(?:https?://[^\s<>\"'`]+|www\.[^\s<>\"'`]+)")
BARE_RE = re.compile(
    r"(?i)(?<![@\w.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(/[^\s<>\"'`]*)?"
)
COMMON_TLDS = frozenset(
    "com net org in io co info xyz top example edu gov me app link site online ly gl live "
    "shop store biz cc club click".split()
)
EMAIL_RE = re.compile(r"(?i)\b[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,24}\b")
FROM_RE = re.compile(
    r"(?im)^\s*from:\s*(?:[^<\n]*<)?([a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,24})>?"
)
UPI_RE = re.compile(r"(?i)(?<![\w.-])([a-z0-9._-]{2,64}@[a-z][a-z0-9-]{1,63})(?![\w@-]|\.[a-z0-9])")
# Digit runs up to 19 so a card number is classified whole (never as a 12-digit "phone" prefix).
PHONE_RE = re.compile(r"(?<![\w@+])(\+\d{1,3}[\s-]?)?(?:\d[\s-]?){9,18}\d(?![\w])")
IBAN_RE = re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b")
WALLET_RE = re.compile(r"\b0x[a-fA-F0-9]{40}\b|\bbc1[ac-hj-np-z02-9]{11,71}\b")
AMOUNT_RE = re.compile(
    r"(?i)(?:₹|\brs\.?|\binr|\busd|\$|€|\beur|£)\s?\d[\d,]*(?:\.\d+)?"
    r"|\b\d[\d,]*(?:\.\d+)?\s?(?:rupees|inr|usd|dollars)\b"
)

URGENCY = {
    "deadline": re.compile(
        r"(?i)\b(within \d+\s*(?:hours?|hrs?|minutes?|mins?|days?)|today only|by (?:today|"
        r"tonight|midnight)|immediately|urgent(?:ly)?|right away|asap|expires? (?:today|soon)|"
        r"last (?:date|day|chance)|act now|limited time)\b"
    ),
    "threat": re.compile(
        r"(?i)\b(account (?:will be |has been |is )?(?:suspended|blocked|locked|deactivated|"
        r"closed|terminated)|will be (?:suspended|blocked|deactivated|cancelled|terminated|"
        r"disconnected)|final (?:notice|warning|reminder)|legal action|penalty|lose (?:your|the) "
        r"(?:seat|account|offer|access))\b"
    ),
    "lure": re.compile(
        r"(?i)\b(congratulations|you (?:have )?(?:won|been selected)|you are selected|guaranteed "
        r"(?:returns?|profit)|double your|free gift|lottery|prize|claim (?:your|now))\b"
    ),
}
CREDENTIAL_TERMS = {
    "otp": re.compile(
        r"(?i)\b(otp|one[- ]time (?:password|code|pin)|verification code|security code)\b"
    ),
    "password": re.compile(r"(?i)\b(password|passcode|pin|login (?:details|credentials))\b"),
    "card": re.compile(r"(?i)\b(cvv|cvc|card number|card details)\b"),
    "kyc": re.compile(r"(?i)\b(kyc|aadhaar|pan card|re-?verify (?:your )?(?:account|identity))\b"),
    "remote_access": re.compile(
        r"(?i)\b(anydesk|teamviewer|quick ?support|remote access|screen ?share)\b"
    ),
    "seed_phrase": re.compile(r"(?i)\b(seed phrase|recovery phrase|private key|secret phrase)\b"),
}
CREDENTIAL_VERB = re.compile(
    r"(?i)\b(share|send|provide|enter|reply|confirm|verify|update|submit|give|tell|forward|"
    r"type|complete|install|download|fill)\b"
)
PAYMENT_VERB = re.compile(
    r"(?i)\b(pay|transfer|deposit|remit|make (?:a |the )?payment|clear (?:the |your )?"
    r"(?:dues|fee|amount)|top ?up)\b"
)
CONFIRMATION = re.compile(
    r"(?i)\b(received|was successful|is successful|has been paid|paid successfully|"
    r"thank you for your payment|payment confirmed)\b"
)
NEGATION = re.compile(r"(?i)\b(never|not|don'?t|won'?t|no one|nobody|cannot|can'?t)\b")
OFF_CHANNEL = re.compile(
    r"(?i)\b(whats ?app|telegram|signal app|personal number|call (?:me|us) on|"
    r"contact (?:the )?(?:recruiter|agent|hr|manager) on)\b"
)
FREE_MAIL = frozenset(
    "gmail.com googlemail.com yahoo.com yahoo.co.in outlook.com hotmail.com live.com "
    "aol.com proton.me protonmail.com icloud.com gmx.com mail.com yandex.com rediffmail.com "
    "zoho.com".split()
)
_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")


# ── Data ────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Span:
    category: str
    text: str


@dataclass(frozen=True)
class Payee:
    type: str  # upi_vpa | iban | card | wallet_address
    value: str  # normalised; cards keep only the last 4 digits


@dataclass
class Extracted:
    urls: list[tuple[str, str]] = field(default_factory=list)  # (normalised url, registrable)
    emails: list[str] = field(default_factory=list)
    sender: str | None = None
    phones: list[dict[str, Any]] = field(default_factory=list)
    payees: list[Payee] = field(default_factory=list)
    amounts: list[str] = field(default_factory=list)
    urgency: list[Span] = field(default_factory=list)
    credential: list[Span] = field(default_factory=list)
    payment: list[Span] = field(default_factory=list)
    off_channel: list[Span] = field(default_factory=list)
    claim_text: str = ""  # text with URLs and emails removed, for brand matching


@dataclass(frozen=True)
class BrandProfile:
    organisation_id: str
    name: str
    tokens: tuple[str, ...]
    domains: frozenset[str]  # verified registrable domains
    payees: frozenset[str]  # verified, normalised recipient values (lower-case)
    simulated: bool = False


@dataclass(frozen=True)
class LinkResult:
    url: str
    registrable_domain: str
    scan_id: str | None
    decision: str | None  # None: not assessed (refused by the guard, or the scan failed)
    finding_codes: tuple[str, ...] = ()
    error: str | None = None
    simulated: bool = False


@dataclass
class MessageEvaluation:
    findings: list[Finding]
    intent: Intent
    coverage: dict[SignalGroup, CoverageState]
    claimed: BrandProfile | None


# ── Helpers ─────────────────────────────────────────────────────────────────────
def mask(text: str) -> str:
    """Mask emails (keep first character and domain) and long digit runs (keep last 2)."""
    out = EMAIL_RE.sub(lambda m: m.group(0)[0] + "***@" + m.group(0).split("@", 1)[1], text)
    out = re.sub(r"\+?\d[\d\s-]{7,}\d", lambda m: "•" * 6 + re.sub(r"\D", "", m.group(0))[-2:], out)
    return out[:SPAN_CHARS]


def _sentences(text: str) -> list[str]:
    """Split on terminal punctuation followed by whitespace, or newlines (URLs stay intact)."""
    return [s.strip() for s in _SENTENCE.split(text) if s.strip()]


def _negated(sentence: str, at: int) -> bool:
    return bool(NEGATION.search(sentence[max(0, at - 40) : at]))


def _luhn(digits: str) -> bool:
    total, parity = 0, len(digits) % 2
    for i, ch in enumerate(digits):
        d = int(ch)
        if i % 2 == parity:
            d = d * 2 - 9 if d * 2 > 9 else d * 2
        total += d
    return total % 10 == 0


def _iban_ok(raw: str) -> bool:
    s = raw.replace(" ", "")
    if not 15 <= len(s) <= 34:
        return False
    moved = s[4:] + s[:4]
    return int("".join(str(int(c, 36)) for c in moved)) % 97 == 1


def _url_candidate(raw: str) -> tuple[str, str] | None:
    raw = raw.rstrip(".,;:!?)]}>'\"")
    url = raw if raw.lower().startswith(("http://", "https://")) else "https://" + raw
    try:
        target = guard.parse_target(url)
    except DomainError:
        return None
    return target.normalised_url, target.registrable_domain


# ── Stage 1: extraction ─────────────────────────────────────────────────────────
def extract(text: str) -> Extracted:
    clean = defang(text)
    ex = Extracted()
    m = FROM_RE.search(clean)
    ex.sender = m.group(1).lower() if m else None
    ex.emails = list(dict.fromkeys(e.lower() for e in EMAIL_RE.findall(clean)))

    seen: set[str] = set()

    def add_url(raw: str) -> None:
        cand = _url_candidate(raw)
        if cand and cand[0] not in seen and len(ex.urls) < MAX_URLS:
            seen.add(cand[0])
            ex.urls.append(cand)

    for raw in URL_RE.findall(clean):
        add_url(raw)
    rest = EMAIL_RE.sub(" ", URL_RE.sub(" ", clean))
    for host, path in BARE_RE.findall(rest):
        if path or host.rsplit(".", 1)[-1].lower() in COMMON_TLDS:
            add_url(host + (path or ""))
    ex.claim_text = UPI_RE.sub(" ", BARE_RE.sub(" ", rest))

    for upi in UPI_RE.findall(rest):
        ex.payees.append(Payee("upi_vpa", upi.lower()))
    for iban in IBAN_RE.findall(clean):
        if _iban_ok(iban):
            ex.payees.append(Payee("iban", iban.replace(" ", "")))
    for w in WALLET_RE.findall(clean):
        ex.payees.append(Payee("wallet_address", w.lower()))
    digits_text = WALLET_RE.sub(" ", IBAN_RE.sub(" ", UPI_RE.sub(" ", rest)))
    for pm in PHONE_RE.finditer(digits_text):
        digits = re.sub(r"\D", "", pm.group(0))
        if not pm.group(1) and 13 <= len(digits) <= 19 and _luhn(digits):
            ex.payees.append(Payee("card", "card-ending-" + digits[-4:]))
            continue
        if 10 <= len(digits) <= 15:
            hint = pm.group(1).strip().lstrip("+") if pm.group(1) else None
            ex.phones.append({"digits": len(digits), "country_code": hint})
    ex.payees = list(dict.fromkeys(ex.payees))
    ex.amounts = list(dict.fromkeys(a.strip() for a in AMOUNT_RE.findall(clean)))[:5]

    for sentence in _sentences(clean):
        masked = mask(sentence)
        for category, pattern in URGENCY.items():
            if pattern.search(sentence):
                ex.urgency.append(Span(category, masked))
        verb = CREDENTIAL_VERB.search(sentence)
        if verb and not _negated(sentence, verb.start()):
            for category, pattern in CREDENTIAL_TERMS.items():
                hit = pattern.search(sentence)
                if hit and not _negated(sentence, hit.start()):
                    ex.credential.append(Span(category, masked))
        pay = PAYMENT_VERB.search(sentence)
        if pay and not _negated(sentence, pay.start()) and not CONFIRMATION.search(sentence):
            ex.payment.append(Span("payment", masked))
        if OFF_CHANNEL.search(sentence):
            ex.off_channel.append(Span("off_channel", masked))
    return ex


def claimed_organisations(ex: Extracted, profiles: list[BrandProfile]) -> list[BrandProfile]:
    """Organisations named in the message (outside URLs and emails), in order of appearance."""
    hits: list[tuple[int, BrandProfile]] = []
    for p in profiles:
        positions = [
            m.start()
            for term in (p.name, *p.tokens)
            if term
            for m in re.finditer(rf"(?i)\b{re.escape(term)}\b", ex.claim_text)
        ]
        if positions:
            hits.append((min(positions), p))
    return [p for _, p in sorted(hits, key=lambda h: (h[0], h[1].name))]


# ── Stage 2: findings ───────────────────────────────────────────────────────────
def _f(code: str, confidence: str, detail: str, **kw: Any) -> Finding:
    return Finding(code=code, confidence=Decimal(confidence), detail=detail, **kw)


def _spans(spans: list[Span]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for s in spans:
        item = {"category": s.category, "text": s.text}
        if item not in out:
            out.append(item)
    return out[:MAX_SPANS]


def evaluate(
    ex: Extracted,
    profiles: list[BrandProfile],
    links: list[LinkResult],
    payee_report_counts: dict[str, int] | None = None,
    *,
    simulated: bool = False,
) -> MessageEvaluation:
    counts = payee_report_counts or {}
    findings: list[Finding] = []
    claims = claimed_organisations(ex, profiles)
    claimed = claims[0] if claims else None
    sim = simulated or bool(claimed and claimed.simulated)

    def add(code: str, confidence: str, detail: str, **kw: Any) -> None:
        if all(f.code != code for f in findings):
            findings.append(_f(code, confidence, detail, simulated=sim, **kw))

    if ex.credential:
        cats = sorted({s.category for s in ex.credential})
        add(
            "MESSAGE_CREDENTIAL_REQUEST",
            "0.90",
            "The message asks for: " + ", ".join(cats) + ".",
            observed={"categories": cats, "spans": _spans(ex.credential)},
        )
    if ex.payment:
        add(
            "MESSAGE_PAYMENT_DEMAND",
            "0.90",
            "The message asks for a payment.",
            observed={"spans": _spans(ex.payment), "amounts": ex.amounts},
        )
    if ex.urgency:
        cats = sorted({s.category for s in ex.urgency})
        add(
            "MESSAGE_URGENCY_PRESSURE",
            "0.80",
            "Pressure language: " + ", ".join(cats) + ".",
            observed={"categories": cats, "spans": _spans(ex.urgency)},
        )
    sender_domain = guard.registrable_domain(ex.sender.split("@", 1)[1]) if ex.sender else None
    free_mail_sender = bool(ex.sender and ex.sender.split("@", 1)[1] in FREE_MAIL)
    if ex.off_channel or (claimed and free_mail_sender):
        add(
            "MESSAGE_CONTACT_CHANNEL_MISMATCH",
            "0.70",
            "Contact moves to an unofficial channel.",
            observed={
                "reason": "free_mail_sender" if free_mail_sender else "off_channel_contact",
                "spans": _spans(ex.off_channel),
            },
        )

    if claimed is not None:
        expected_domains = {"domains": sorted(claimed.domains)}
        if sender_domain and not free_mail_sender and sender_domain not in claimed.domains:
            add(
                "MESSAGE_IMPERSONATES_ORGANISATION",
                "0.80",
                f"Sent from {sender_domain}, which {claimed.name} has not verified.",
                observed={"sender_domain": sender_domain, "org": claimed.name},
                expected=expected_domains,
            )
        foreign = sorted({d for _, d in ex.urls if d not in claimed.domains})
        if foreign:
            add(
                "MESSAGE_LINK_TO_UNVERIFIED_CLAIM",
                "0.95",
                f"Links to {', '.join(foreign)}, not a verified domain of {claimed.name}.",
                observed={"link_domain": foreign[0], "link_domains": foreign, "org": claimed.name},
                expected=expected_domains,
            )
        for p in ex.payees:
            if not claimed.payees:
                add(
                    "PAYEE_UNVERIFIABLE",
                    "0.80",
                    f"{claimed.name} has registered no payment addresses.",
                    observed={"payee": p.value, "org": claimed.name},
                )
            elif p.value in claimed.payees:
                add(
                    "PAYEE_MATCH_CONFIRMED",
                    "1.00",
                    f"{p.value} is registered by {claimed.name}.",
                    observed={"payee": p.value, "match": "exact", "org": claimed.name},
                )
            else:
                add(
                    "PAYEE_NOT_IN_VERIFIED_PROFILE",
                    "1.00",
                    f"{p.value} is not a payment address registered by {claimed.name}.",
                    observed={"payee": p.value, "match": "none", "org": claimed.name},
                    expected={"payees": sorted(claimed.payees)},
                )
        sender_ok = ex.sender is None or (sender_domain in claimed.domains)
        if ex.urls and not foreign and sender_ok:
            add(
                "IDENTITY_MATCH_CONFIRMED",
                "1.00",
                f"Every link goes to a verified domain of {claimed.name}.",
                observed={
                    "domain": ", ".join(sorted({d for _, d in ex.urls})),
                    "org": claimed.name,
                },
            )
    else:
        for p in ex.payees:
            add(
                "PAYEE_UNVERIFIABLE",
                "0.60",
                "No organisation is named, so the payment address cannot be checked.",
                observed={"payee": p.value},
            )

    for p in ex.payees:
        if counts.get(p.value, 0) >= 2:
            add(
                "PAYEE_LINKED_TO_REPORTED_SCAM",
                "1.00",
                f"{p.value} is named in {counts[p.value]} confirmed scam reports.",
                observed={"payee": p.value, "reports": counts[p.value]},
            )

    for link in links:
        observed = {
            "link_domain": link.registrable_domain,
            "scan_id": link.scan_id,
            "decision": link.decision,
        }
        if link.decision == "BLOCK":
            add(
                "MESSAGE_LINK_BLOCKED",
                "1.00",
                "A linked page was assessed BLOCK.",
                observed=observed,
            )
        elif link.decision == "WARN":
            add(
                "MESSAGE_LINK_WARNED", "0.80", "A linked page was assessed WARN.", observed=observed
            )
        if "KNOWN_MALICIOUS_REPUTATION" in link.finding_codes:
            add(
                "KNOWN_MALICIOUS_REPUTATION",
                "1.00",
                f"{link.registrable_domain} is known malicious.",
                observed={"domain": link.registrable_domain, "via_scan": link.scan_id},
            )

    if not any(f.points > 0 for f in findings):
        add(
            "MESSAGE_NO_MALICIOUS_INDICATOR",
            "1.00",
            "No malicious indicator was found in the checks we ran.",
        )

    intent = (
        Intent.PAYMENT
        if ex.payment or ex.payees
        else Intent.LOGIN
        if ex.credential
        else Intent.BROWSE
    )
    assessed = [link for link in links if link.decision is not None]
    collected, skipped, unavailable = (
        CoverageState.COLLECTED,
        CoverageState.SKIPPED,
        CoverageState.UNAVAILABLE,
    )
    coverage = {
        SignalGroup.IDENTITY: collected,
        SignalGroup.CREDENTIAL_DESTINATION: collected,
        SignalGroup.PAYMENT_DESTINATION: collected,
        SignalGroup.REPUTATION: (
            collected if assessed or ex.payees else skipped if not ex.urls else unavailable
        ),
        SignalGroup.INFRASTRUCTURE: collected
        if assessed
        else skipped
        if not ex.urls
        else unavailable,
    }
    return MessageEvaluation(findings=findings, intent=intent, coverage=coverage, claimed=claimed)
