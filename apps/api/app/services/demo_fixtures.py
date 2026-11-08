"""Recorded collector fixtures for the seeded demo hosts (DEMO_RUNBOOK.md §3).

Why fixtures: the demo domains are under ``.example`` (RFC 2606), which is reserved and never
resolves, so a live probe cannot observe them — and a localhost stand-in would rightly be rejected
by the SSRF guard. In DEMO_MODE, and only for these hosts, collectors return the recorded
observations below. Everything they produce is labelled ``simulated: true`` (ADR-010). No network
request is made.

This mirrors the "intercept at the collector boundary" pattern used by tests
(BACKEND_OVERVIEW.md §12).
The pages these fixtures describe are served for the browser by ``apps/demo-sites``.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from app.services.observations import (
    DnsObs,
    EvidenceDraft,
    FormObs,
    Observations,
    PageObs,
    RedirectObs,
    RegistrationObs,
    TlsObs,
)

# Northstar's official logo hash, and the lookalikes' copy (Hamming distance 2 of 64).
NORTHSTAR_LOGO_PHASH = "f0e1d2c3b4a59687"
LOOKALIKE_LOGO_PHASH = "f0e1d2c3b4a59684"

DEMO_REGISTRABLE_DOMAINS = frozenset(
    {
        "northstar-demo.example",
        "northstar-admissions.example",
        "northstar-scholarships.example",
        "northstar-placement.example",
        "badhost.example",
    }
)

_GENUINE_DNS = {
    "a": ["198.51.100.20"],
    "ns": ["ns1.northstar-dns.example", "ns2.northstar-dns.example"],
}
_BAD_DNS = {"a": ["203.0.113.10"], "ns": ["ns1.badhost.example", "ns2.badhost.example"]}


def _tls(issuer: str, days: int, fingerprint: str, cn: str, root: str) -> dict[str, Any]:
    return {
        "issuer_cn": issuer,
        "root_issuer_cn": root,
        "subject_cn": cn,
        "sans": [cn],
        "days_to_expiry": days,
        "fingerprint_sha256": fingerprint,
        "key_type": "EC",
        "key_bits": 256,
        "signature_algorithm": "ecdsa-with-SHA256",
        "chain_length": 3,
    }


def _fp(seed: str) -> str:
    return (seed * 64)[:64]


# host → fixture
_FIXTURES: dict[str, dict[str, Any]] = {
    "northstar-demo.example": {
        "dns": _GENUINE_DNS,
        "age_days": 3650,
        "registrar": "Example Registrar",
        "tls": _tls(
            "Demo Intermediate CA", 89, _fp("a1"), "northstar-demo.example", "Demo Root CA"
        ),
        "page": {
            "title": "Northstar University",
            "text": "northstar university admissions fees official site",
            "forms": [],
            "payees": [],
            "logo": NORTHSTAR_LOGO_PHASH,
        },
    },
    "login.northstar-demo.example": {
        "dns": _GENUINE_DNS,
        "age_days": 3650,
        "registrar": "Example Registrar",
        "tls": _tls(
            "Demo Intermediate CA", 21, _fp("b2"), "login.northstar-demo.example", "Demo Root CA"
        ),
        "page": {
            "title": "Northstar University — Sign in",
            "text": "northstar university sign in student portal",
            "forms": [("https://login.northstar-demo.example/session", "post", True)],
            "payees": [],
            "logo": NORTHSTAR_LOGO_PHASH,
        },
    },
    "pay.northstar-demo.example": {
        "dns": _GENUINE_DNS,
        "age_days": 3650,
        "registrar": "Example Registrar",
        "tls": _tls(
            "Example Trust CA", 140, _fp("c3"), "pay.northstar-demo.example", "Example Root"
        ),
        "page": {
            "title": "Northstar University — Fee payment",
            "text": "northstar university fee payment admissions fee",
            "forms": [("https://pay.northstar-demo.example/checkout", "post", False)],
            "payees": [{"type": "upi_vpa", "value": "fees@northstar-demo"}],
            "logo": NORTHSTAR_LOGO_PHASH,
        },
    },
    "apply.northstar-admissions.example": {
        "dns": _BAD_DNS,
        "age_days": 12,
        "registrar": "Cheap Names Ltd",
        "tls": _tls("R3", 89, _fp("d4"), "apply.northstar-admissions.example", "ISRG Root X1"),
        "page": {
            "title": "Northstar University — Admissions 2026",
            "text": "northstar university admissions application fee 1,200 apply now",
            "forms": [
                ("https://collect.badhost.example/login", "post", True),
                ("https://collect.badhost.example/pay", "post", False),
            ],
            "payees": [{"type": "upi_vpa", "value": "fees@okaxis"}],
            "logo": LOOKALIKE_LOGO_PHASH,
        },
    },
    "apply.northstar-scholarships.example": {
        "dns": _BAD_DNS,
        "age_days": 9,
        "registrar": "Cheap Names Ltd",
        "tls": _tls("R3", 80, _fp("e5"), "apply.northstar-scholarships.example", "ISRG Root X1"),
        "page": {
            "title": "Northstar University — Merit Scholarships",
            "text": "northstar university scholarship processing fee claim your award",
            "forms": [("https://collect.badhost.example/pay", "post", False)],
            "payees": [{"type": "upi_vpa", "value": "fees@okaxis"}],
            "logo": LOOKALIKE_LOGO_PHASH,
        },
    },
    "portal.northstar-placement.example": {
        "dns": _BAD_DNS,
        "age_days": 15,
        "registrar": "Cheap Names Ltd",
        "tls": _tls("R3", 75, _fp("f6"), "portal.northstar-placement.example", "ISRG Root X1"),
        "page": {
            "title": "Northstar Placement Cell — Student Login",
            "text": "northstar university placement cell student login register for drives",
            "forms": [("https://collect.badhost.example/login", "post", True)],
            "payees": [],
            "logo": None,
        },
    },
    "collect.badhost.example": {
        "dns": _BAD_DNS,
        "age_days": 30,
        "registrar": "Cheap Names Ltd",
        "tls": _tls("R3", 60, _fp("07"), "collect.badhost.example", "ISRG Root X1"),
        "page": {"title": None, "text": "", "forms": [], "payees": [], "logo": None},
    },
}


def is_demo_host(host: str, registrable: str) -> bool:
    return registrable in DEMO_REGISTRABLE_DOMAINS


def demo_observations(
    host: str, registrable: str, normalised_url: str, scheme: str
) -> Observations:
    fx = _FIXTURES.get(host)
    if fx is None:
        # A demo-domain host we have no recording for behaves like a domain that does not resolve.
        return Observations(
            host=host,
            registrable_domain=registrable,
            normalised_url=normalised_url,
            scheme=scheme,
            dns=DnsObs(status="collected", nxdomain=True),
            registration=RegistrationObs(status="unavailable"),
            tls=TlsObs(status="unavailable"),
            redirects=RedirectObs(status="collected", final_url=normalised_url),
            page=PageObs(status="unavailable"),
            simulated=True,
            evidence=[
                EvidenceDraft(
                    "dns",
                    "dns",
                    f"No DNS answer for {host} (simulated)",
                    {"host": host, "simulated": True},
                )
            ],
        )

    t = fx["tls"]
    page = fx["page"]
    forms = [FormObs(action=a, method=m, has_password=p) for a, m, p in page["forms"]]
    obs = Observations(
        host=host,
        registrable_domain=registrable,
        normalised_url=normalised_url,
        scheme=scheme,
        dns=DnsObs(status="collected", a=list(fx["dns"]["a"]), ns=list(fx["dns"]["ns"])),
        registration=RegistrationObs(
            status="collected", age_days=fx["age_days"], registrar=fx["registrar"]
        ),
        tls=TlsObs(
            status="collected",
            presented=True,
            verified=True,
            hostname_ok=True,
            issuer_cn=t["issuer_cn"],
            root_issuer_cn=t["root_issuer_cn"],
            subject_cn=t["subject_cn"],
            sans=t["sans"],
            days_to_expiry=t["days_to_expiry"],
            fingerprint_sha256=t["fingerprint_sha256"],
            key_type=t["key_type"],
            key_bits=t["key_bits"],
            signature_algorithm=t["signature_algorithm"],
            chain_length=t["chain_length"],
        ),
        redirects=RedirectObs(status="collected", final_url=normalised_url),
        page=PageObs(
            status="collected",
            title=page["title"],
            text_sample=page["text"],
            password_fields=sum(1 for f in forms if f.has_password),
            forms=forms,
            payees=list(page["payees"]),
            logo_phash=page["logo"],
        ),
        simulated=True,
    )
    sim = {"simulated": True}
    obs.evidence = [
        EvidenceDraft(
            "dns",
            "dns",
            f"{len(obs.dns.a)} A record(s), NS {', '.join(obs.dns.ns)} (simulated)",
            {"a": obs.dns.a, "ns": obs.dns.ns, **sim},
        ),
        EvidenceDraft(
            "rdap",
            "rdap",
            f"Registered {obs.registration.age_days} days ago "
            f"via {obs.registration.registrar} (simulated)",
            {"age_days": obs.registration.age_days, "registrar": obs.registration.registrar, **sim},
        ),
        EvidenceDraft(
            "tls",
            "tls",
            f"Certificate issued by {t['issuer_cn']}, "
            f"{t['days_to_expiry']} days to expiry (simulated)",
            {
                k: t[k]
                for k in (
                    "issuer_cn",
                    "root_issuer_cn",
                    "subject_cn",
                    "days_to_expiry",
                    "fingerprint_sha256",
                )
            }
            | sim,
        ),
        EvidenceDraft(
            "page",
            "page",
            f"Page '{page['title']}': {obs.page.password_fields} password field(s), "
            f"{len(forms)} form(s), {len(page['payees'])} payee(s) (simulated)",
            {
                "title": page["title"],
                "form_actions": [f.action for f in forms],
                "password_fields": obs.page.password_fields,
                "payees": page["payees"],
                "logo_phash": page["logo"],
                **sim,
            },
        ),
    ]
    return replace(obs)
