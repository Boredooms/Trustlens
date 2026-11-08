"""Web3 report registry wire models (docs/02-architecture/WEB3_REGISTRY.md §5)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.schemas.common import RequestModel, WireModel

OnChainStatus = Literal["unknown", "active", "disputed", "withdrawn"]


class AnchorOut(WireModel):
    report_id: str
    anchored: bool
    chain_id: int | None = None
    contract: str | None = None
    report_id_bytes32: str | None = None
    payload_hash: str | None = None
    commitment: str | None = None
    revision: int | None = None
    tx_hash: str | None = None
    block_number: int | None = None
    anchored_at: str | None = None
    simulated: bool | None = None
    created: bool | None = Field(
        default=None, description="True when this call sent a transaction (register or revise)."
    )


class VerifyChecks(WireModel):
    payload_hash_matches: bool = Field(description="sha256 of the payload equals the anchored hash")
    chain_commitment_matches: bool = Field(description="the contract's verify() returned ok")
    report_unchanged: bool = Field(
        description="today's report rebuilds to the anchored snapshot (false: changed since)"
    )


class AnchorVerification(AnchorOut):
    valid: bool = Field(description="All three checks passed. Integrity, never truth.")
    checks: VerifyChecks
    payload: dict[str, Any]
    computed_payload_hash: str
    salt: str
    on_chain_revision: int
    on_chain_status: OnChainStatus
    checked_at: str


class VerifyPayloadRequest(RequestModel):
    payload: dict[str, Any] = Field(
        description=(
            "A candidate canonical payload; hashing it shows whether it is the anchored one."
        )
    )
