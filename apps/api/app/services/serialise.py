"""ORM → wire dictionaries. One serializer per resource so the envelope never drifts (ADR-007)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.models.tables import Entity, Evidence, Scan, ScanFinding
from app.risk.classes import risk_class
from app.services.scan_orchestrator import finding_to_wire
from app.utils import iso_z


def ts(value: datetime | None) -> str | None:
    return iso_z(value) if value else None


def scan_summary(scan: Scan) -> dict[str, Any]:
    return {
        "id": scan.id,
        "url": scan.url,
        "registrable_domain": scan.registrable_domain,
        "intent": scan.intent,
        "status": scan.status,
        "decision": scan.decision,
        "risk_level": scan.risk_level,
        "risk_score": scan.risk_score,
        # Derived problem-statement class (RISK_ENGINE.md §8.7); never stored.
        "risk_class": risk_class(scan.decision) if scan.decision else None,
        "coverage_percent": (scan.coverage or {}).get("percent"),
        "simulated": scan.simulated,
        "created_at": ts(scan.created_at),
        "completed_at": ts(scan.completed_at),
    }


def evidence_wire(row: Evidence, *, include_payload: bool = True) -> dict[str, Any]:
    return {
        "id": row.id,
        "source": row.source,
        "observed_at": ts(row.observed_at),
        "summary": row.summary,
        "payload": row.payload if include_payload else None,
        "simulated": row.simulated,
    }


def scan_full(scan: Scan, findings: list[ScanFinding], evidence: list[Evidence]) -> dict[str, Any]:
    return {
        **scan_summary(scan),
        "normalised_url": scan.normalised_url,
        "organisation_id": scan.organisation_id,
        "coverage": scan.coverage if scan.coverage.get("percent") is not None else None,
        "reasons": scan.reasons,
        "overrides": scan.overrides,
        "engine_version": scan.engine_version,
        "result": scan.result,
        "findings": [finding_to_wire(f) for f in findings],
        "evidence": [evidence_wire(e) for e in evidence],
        "cached_groups": scan.cached_groups,
        "failure_code": scan.failure_code,
        "duration_ms": scan.duration_ms,
    }


def node(entity: Entity) -> dict[str, Any]:
    return {
        "id": entity.id,
        "type": entity.type,
        "label": entity.label,
        "attributes": entity.attributes,
        "reputation_score": entity.reputation_score,
        "simulated": entity.simulated,
    }
