"""Report anchoring: privacy-safe payload, salted commitment, register/revise, verify.

Owner: docs/02-architecture/WEB3_REGISTRY.md. The payload builder is the privacy boundary (§4): it
may only emit the keys in ``PAYLOAD_KEYS``; a unit test feeds personal data through it and asserts
none of it survives. Anchoring is post-hoc and never on the verdict path.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from ulid import ULID

from app.config import Settings
from app.errors import DomainError, ValidationFailed
from app.models.tables import ReportAnchor, Scan, ScanFinding, ThreatReport
from app.schemas.enums import ErrorCode
from app.services import guard
from app.services.chain import SIMULATED_CHAIN_ID, ChainClient, ChainUnavailable
from app.services.serialise import ts
from app.utils import new_ulid, utcnow

SCHEMA = "trustlens.report-commitment.v1"
PAYLOAD_KEYS = frozenset(
    {
        "schema",
        "report_id",
        "indicator_type",
        "indicator",
        "intent",
        "status",
        "justification_sha256",
        "observed_payee_sha256",
        "linked_scan",
        "created_at",
        "reporter_pseudonym",
        "simulated",
    }
)
_DEV_KEY_MATERIAL = b"trustlens-development-only-anchor-key"


class AnchorNotFound(DomainError):
    code, status, message = ErrorCode.ANCHOR_NOT_FOUND, 404, "This report has not been anchored."


class AnchorAlreadyExists(DomainError):
    code, status, message = (
        ErrorCode.ANCHOR_ALREADY_EXISTS,
        409,
        "The registry already holds this report, but we have no record of anchoring it.",
    )


# ── Canonical encoding (§3) ─────────────────────────────────────────────────────
def _strip_nulls(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _strip_nulls(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_strip_nulls(v) for v in value]
    if isinstance(value, float):
        raise ValueError("floats are not allowed in a commitment payload")
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(
        _strip_nulls(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


def sha256_hex(data: bytes) -> str:
    return "0x" + hashlib.sha256(data).hexdigest()


def payload_hash(payload: dict[str, Any]) -> str:
    return sha256_hex(canonical_json(payload).encode("utf-8"))


def report_id_bytes32(report_id: str) -> str:
    raw: bytes = bytes(ULID.from_str(report_id).bytes)  # 16 bytes, big-endian
    return "0x" + raw.hex().rjust(64, "0")


# ── Keys derived from JWT_SECRET (§3) ───────────────────────────────────────────
def _derive(settings: Settings, info: bytes) -> bytes:
    material = (
        settings.jwt_secret.get_secret_value().encode()
        if settings.jwt_secret is not None
        else _DEV_KEY_MATERIAL  # production refuses to boot without JWT_SECRET
    )
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info).derive(material)


def _fernet(settings: Settings) -> Fernet:
    return Fernet(base64.urlsafe_b64encode(_derive(settings, b"trustlens-anchor-salt-v1")))


def encrypt_salt(settings: Settings, salt_hex: str) -> str:
    return _fernet(settings).encrypt(salt_hex.encode()).decode()


def decrypt_salt(settings: Settings, token: str) -> str:
    try:
        return _fernet(settings).decrypt(token.encode()).decode()
    except InvalidToken as exc:  # key rotated without re-encryption
        raise ChainUnavailable("The anchor salt cannot be decrypted with the current key.") from exc


def new_salt() -> str:
    return "0x" + os.urandom(32).hex()


def reporter_pseudonym(settings: Settings, user_id: str | None) -> str:
    if not user_id:
        return "anonymous"
    key = _derive(settings, b"trustlens-reporter-pseudonym-v1")
    return hmac.new(key, user_id.encode(), hashlib.sha256).hexdigest()[:16]


# ── Payload (§4 — the privacy boundary) ─────────────────────────────────────────
def build_payload(
    settings: Settings,
    report: ThreatReport,
    scan: Scan | None,
    finding_codes: list[str],
) -> dict[str, Any]:
    # The stored normalised URL was validated at report creation; only its host is used.
    host = (urlsplit(report.normalised_url).hostname or "").lower()
    payload: dict[str, Any] = {
        "schema": SCHEMA,
        "report_id": report.id,
        "indicator_type": "domain",
        "indicator": guard.registrable_domain(host),
        "intent": report.intent,
        "status": report.status,
        "justification_sha256": hashlib.sha256(report.justification.encode()).hexdigest(),
        "observed_payee_sha256": (
            hashlib.sha256(report.observed_payee.encode()).hexdigest()
            if report.observed_payee
            else None
        ),
        "linked_scan": (
            {
                "decision": scan.decision,
                "engine_version": scan.engine_version,
                "finding_codes": sorted(set(finding_codes)),
            }
            if scan is not None
            else None
        ),
        "created_at": ts(report.created_at),
        "reporter_pseudonym": reporter_pseudonym(settings, report.reporter_user_id),
        "simulated": bool(report.simulated),
    }
    clean = _strip_nulls(payload)
    assert set(clean) <= PAYLOAD_KEYS  # noqa: S101 — structural invariant, not input validation
    return dict(clean)


async def payload_for(db: AsyncSession, settings: Settings, report: ThreatReport) -> dict[str, Any]:
    scan = await db.get(Scan, report.scan_id) if report.scan_id else None
    codes: list[str] = []
    if scan is not None:
        codes = list(
            (
                await db.execute(select(ScanFinding.code).where(ScanFinding.scan_id == scan.id))
            ).scalars()
        )
    return build_payload(settings, report, scan, codes)


# ── Anchor ───────────────────────────────────────────────────────────────────────
async def get_anchor(db: AsyncSession, report_id: str) -> ReportAnchor | None:
    return (
        await db.execute(select(ReportAnchor).where(ReportAnchor.report_id == report_id))
    ).scalar_one_or_none()


@dataclass
class AnchorOutcome:
    anchor: ReportAnchor
    created: bool  # a transaction was sent


async def anchor_report(
    db: AsyncSession,
    settings: Settings,
    report: ThreatReport,
    user_id: str | None,
    client: ChainClient,
) -> AnchorOutcome:
    payload = await payload_for(db, settings, report)
    ph = payload_hash(payload)
    rid = report_id_bytes32(report.id)
    await client.check()
    record = await client.get(rid)
    existing = await get_anchor(db, report.id)

    if existing is not None and record.exists:
        if existing.payload_hash == ph and record.commitment == existing.commitment:
            return AnchorOutcome(existing, created=False)
        revision = max(existing.revision, record.revision) + 1
        salt = new_salt()
        commitment = await client.commitment_of(rid, ph, salt, revision)
        tx = await client.revise(rid, commitment, ph, revision)
    elif existing is None and record.exists:
        raise AnchorAlreadyExists()
    else:
        # First anchor, or the chain no longer holds the record (a reset local dev chain).
        revision = existing.revision if existing is not None else 1
        salt = new_salt()
        commitment = await client.commitment_of(rid, ph, salt, revision)
        tx = await client.register(rid, commitment, ph, revision)

    anchor = existing or ReportAnchor(id=new_ulid(), report_id=report.id, created_by=user_id)
    anchor.chain_id = settings.effective_chain_id
    anchor.contract = client.contract
    anchor.report_id_bytes32 = rid
    anchor.payload = payload
    anchor.payload_hash = ph
    anchor.salt_ciphertext = encrypt_salt(settings, salt)
    anchor.commitment = commitment
    anchor.revision = revision
    anchor.tx_hash = tx.tx_hash
    anchor.block_number = tx.block_number
    anchor.anchored_at = utcnow()
    if existing is None:
        db.add(anchor)
    return AnchorOutcome(anchor, created=True)


def anchor_view(anchor: ReportAnchor | None, report_id: str) -> dict[str, Any]:
    if anchor is None:
        return {"report_id": report_id, "anchored": False}
    return {
        "report_id": report_id,
        "anchored": True,
        "chain_id": anchor.chain_id,
        "contract": anchor.contract,
        "report_id_bytes32": anchor.report_id_bytes32,
        "payload_hash": anchor.payload_hash,
        "commitment": anchor.commitment,
        "revision": anchor.revision,
        "tx_hash": anchor.tx_hash,
        "block_number": anchor.block_number,
        "anchored_at": ts(anchor.anchored_at),
        # Simulated demo data, or anchored on the simulated registry (chain id 0): never "on chain".
        "simulated": bool(anchor.payload.get("simulated", False))
        or anchor.chain_id == SIMULATED_CHAIN_ID,
    }


# ── Verify (§5) ──────────────────────────────────────────────────────────────────
async def verify_anchor(
    db: AsyncSession,
    settings: Settings,
    report_id: str,
    client: ChainClient,
    supplied: dict[str, Any] | None = None,
) -> dict[str, Any]:
    report = await db.get(ThreatReport, report_id)
    anchor = await get_anchor(db, report_id) if report is not None else None
    if report is None or anchor is None:
        raise AnchorNotFound()
    payload = supplied if supplied is not None else anchor.payload
    try:
        ph = payload_hash(payload)
    except (ValueError, TypeError) as exc:
        raise ValidationFailed(
            "The payload must contain only strings, integers, booleans."
        ) from exc
    salt = decrypt_salt(settings, anchor.salt_ciphertext)
    await client.check()
    ok, revision, status = await client.verify(anchor.report_id_bytes32, ph, salt)
    current = await payload_for(db, settings, report)
    checks = {
        "payload_hash_matches": ph == anchor.payload_hash,
        "chain_commitment_matches": ok,
        "report_unchanged": canonical_json(current) == canonical_json(anchor.payload),
    }
    return {
        **anchor_view(anchor, report_id),
        "valid": all(checks.values()),
        "checks": checks,
        "payload": payload,
        "computed_payload_hash": ph,
        "salt": salt,
        "on_chain_revision": revision,
        "on_chain_status": status,
        "checked_at": ts(utcnow()),
    }
