"""Collector output shapes. Collectors produce *facts*; rules (app/risk/rules.py) judge them."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Status = Literal["collected", "unavailable", "skipped"]


@dataclass
class EvidenceDraft:
    key: str  # local key, e.g. "dns"; mapped to a ULID at persistence
    source: str  # DATABASE_DESIGN.md §5.3 source enum
    summary: str
    payload: dict[str, Any]


@dataclass
class DnsObs:
    status: Status
    a: list[str] = field(default_factory=list)
    aaaa: list[str] = field(default_factory=list)
    ns: list[str] = field(default_factory=list)
    nxdomain: bool = False


@dataclass
class RegistrationObs:
    status: Status
    age_days: int | None = None
    registrar: str | None = None


@dataclass
class TlsObs:
    status: Status
    presented: bool = False
    handshake_failed: bool = False
    verified: bool = False
    hostname_ok: bool = True
    issuer_cn: str | None = None
    root_issuer_cn: str | None = None
    subject_cn: str | None = None
    sans: list[str] = field(default_factory=list)
    not_before: str | None = None
    not_after: str | None = None
    days_to_expiry: int | None = None
    fingerprint_sha256: str | None = None
    key_type: str | None = None
    key_bits: int | None = None
    signature_algorithm: str | None = None
    chain_length: int | None = None


@dataclass
class FormObs:
    action: str | None
    method: str
    has_password: bool


@dataclass
class PageObs:
    status: Status
    fetch_blocked: bool = False
    title: str | None = None
    text_sample: str = ""  # lowercase visible text, truncated; used for brand-claim matching only
    password_fields: int = 0
    forms: list[FormObs] = field(default_factory=list)
    payees: list[dict[str, str]] = field(default_factory=list)  # [{"type","value"}]
    logo_phash: str | None = None
    dom_source: str = "static"


@dataclass
class RedirectObs:
    status: Status
    hops: list[dict[str, Any]] = field(default_factory=list)
    final_url: str | None = None
    blocked_hop: dict[str, str] | None = None
    too_many: bool = False


@dataclass
class ClientObservation:
    """Metadata the extension/SDK saw on the page. Never form values (ADR-008, privacy)."""

    form_action: str | None = None
    payee: str | None = None
    destination_host: str | None = None


@dataclass
class Observations:
    host: str
    registrable_domain: str
    normalised_url: str
    scheme: str
    dns: DnsObs
    registration: RegistrationObs
    tls: TlsObs
    redirects: RedirectObs
    page: PageObs
    simulated: bool = False
    evidence: list[EvidenceDraft] = field(default_factory=list)

    def result_blocks(self) -> dict[str, Any]:
        """The denormalised ``scans.result`` JSON (API_ENDPOINTS.md §4)."""
        return {
            "dns": {
                "a": self.dns.a,
                "aaaa": self.dns.aaaa,
                "ns": self.dns.ns,
                "status": self.dns.status,
            },
            "registration": {
                "age_days": self.registration.age_days,
                "registrar": self.registration.registrar,
                "status": self.registration.status,
            },
            "tls": {
                "presented": self.tls.presented,
                "verified": self.tls.verified,
                "issuer": self.tls.issuer_cn,
                "days_to_expiry": self.tls.days_to_expiry,
                "fingerprint_sha256": self.tls.fingerprint_sha256,
                "status": self.tls.status,
            },
            "redirects": {
                "hops": self.redirects.hops,
                "final_url": self.redirects.final_url,
                "cross_domain": bool(self.redirects.hops),
                "status": self.redirects.status,
            },
            "page": {
                "title": self.page.title,
                "password_fields": self.page.password_fields,
                "form_actions": [f.action for f in self.page.forms if f.action],
                "payees_seen": len(self.page.payees),
                "dom_source": self.page.dom_source,
                "status": self.page.status,
            },
            "simulated": self.simulated,
        }
