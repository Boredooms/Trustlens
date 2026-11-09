"""Minimal JSON-RPC client for ThreatReportRegistry (docs/02-architecture/WEB3_REGISTRY.md).

No web3 dependency: every argument and return value of the registry is a static ABI type, so the
encoding is 32-byte words. Function selectors are pinned here and checked against the compiled
artefact (``packages/contracts/deployments/ThreatReportRegistry.json``) by a unit test.

The API holds no private key. Transactions use ``eth_sendTransaction`` from an account the node has
unlocked (a local Hardhat node). The RPC URL is operator configuration, not user input, so it does
not pass through ``services/guard.py``; every call is bounded by ``CHAIN_TIMEOUT_SECONDS`` and the
response size is capped.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings
from app.errors import DomainError
from app.schemas.enums import ErrorCode

SELECTORS: dict[str, str] = {
    "commitmentOf(bytes32,bytes32,bytes32,uint32)": "0xf63e2cd4",
    "dispute(bytes32,bytes32)": "0x82cbf88b",
    "get(bytes32)": "0x8eaa6ac0",
    "register(bytes32,bytes32,bytes32,uint32)": "0xdd5be1f0",
    "revise(bytes32,bytes32,bytes32,uint32)": "0x27a86ff3",
    "total()": "0x2ddbd13a",
    "verify(bytes32,bytes32,bytes32)": "0x3fb82028",
    "withdraw(bytes32)": "0x8e19899e",
}
STATUS = ("unknown", "active", "disputed", "withdrawn")
# CHAIN_MODE=simulated (services/sim_registry.py). Fixed, recognisable, and not a real deployment:
# chain id 0 is invalid on every EVM network, and these addresses hold no code anywhere.
SIMULATED_CHAIN_ID = 0
SIMULATED_RPC_URL = "http://simulated-registry.invalid/"
SIMULATED_CONTRACT = "0x" + "7357" * 10
SIMULATED_SENDER = "0x" + "5e4d" * 10
MAX_RESPONSE_BYTES = 1_000_000
_HEX32 = re.compile(r"^0x[0-9a-f]{64}$")


class ChainUnavailable(DomainError):
    code, status, message = (
        ErrorCode.CHAIN_UNAVAILABLE,
        503,
        "The report registry is not reachable right now. Scans and reports are unaffected.",
    )


class AnchorTxFailed(DomainError):
    code, status, message = (
        ErrorCode.ANCHOR_TX_FAILED,
        502,
        "The registry rejected the anchoring transaction.",
    )


@dataclass(frozen=True)
class OnChainRecord:
    commitment: str
    payload_hash: str
    reporter: str
    registered_at: int
    revision: int
    status: str

    @property
    def exists(self) -> bool:
        return self.commitment != "0x" + "0" * 64


@dataclass(frozen=True)
class TxResult:
    tx_hash: str
    block_number: int


def b32(value: str) -> str:
    """Validate a 0x-prefixed bytes32 and return its 64 hex digits."""
    v = value.lower()
    if not _HEX32.match(v):
        raise ValueError(f"not a bytes32: {value!r}")
    return v[2:]


def u256(value: int) -> str:
    if value < 0:
        raise ValueError("unsigned only")
    return f"{value:064x}"


def encode_call(signature: str, *words: str) -> str:
    return SELECTORS[signature] + "".join(words)


def _words(data: str) -> list[str]:
    raw = data[2:] if data.startswith("0x") else data
    return [raw[i : i + 64] for i in range(0, len(raw), 64)]


def decode_record(data: str) -> OnChainRecord:
    w = _words(data)
    if len(w) < 6:
        raise ChainUnavailable()
    status = int(w[5], 16)
    return OnChainRecord(
        commitment="0x" + w[0],
        payload_hash="0x" + w[1],
        reporter="0x" + w[2][24:],
        registered_at=int(w[3], 16),
        revision=int(w[4], 16),
        status=STATUS[status] if status < len(STATUS) else "unknown",
    )


class ChainClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        if not settings.chain_configured:
            raise ChainUnavailable()
        self.settings = settings
        if settings.chain_simulated:
            # Never contacted over the network: the simulated registry transport answers it.
            self.url = SIMULATED_RPC_URL
            self.contract = SIMULATED_CONTRACT
            self.sender = SIMULATED_SENDER
        else:
            self.url = str(settings.chain_rpc_url)
            self.contract = str(settings.chain_registry_address).lower()
            self.sender = (settings.chain_sender_address or "").lower()
        self._transport = transport
        self._id = 0

    async def _rpc(self, method: str, params: list[Any]) -> Any:
        self._id += 1
        body = {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params}
        try:
            async with httpx.AsyncClient(
                timeout=self.settings.chain_timeout_seconds,
                transport=self._transport,
                follow_redirects=False,
            ) as client:
                resp = await client.post(self.url, json=body)
        except httpx.HTTPError as exc:
            raise ChainUnavailable() from exc
        if resp.status_code != 200 or len(resp.content) > MAX_RESPONSE_BYTES:
            raise ChainUnavailable()
        doc = resp.json()
        if "error" in doc:
            if method == "eth_sendTransaction":
                raise AnchorTxFailed()
            raise ChainUnavailable()
        return doc.get("result")

    async def check(self) -> None:
        """Right chain, and a contract at the configured address. Raises ChainUnavailable."""
        chain_id = int(await self._rpc("eth_chainId", []), 16)
        if chain_id != self.settings.effective_chain_id:
            raise ChainUnavailable()
        code = await self._rpc("eth_getCode", [self.contract, "latest"])
        if not code or code == "0x":
            raise ChainUnavailable()

    async def _call(self, data: str) -> str:
        result = await self._rpc("eth_call", [{"to": self.contract, "data": data}, "latest"])
        if not isinstance(result, str) or not result.startswith("0x"):
            raise ChainUnavailable()
        return result

    async def commitment_of(self, rid: str, payload_hash: str, salt: str, revision: int) -> str:
        out = await self._call(
            encode_call(
                "commitmentOf(bytes32,bytes32,bytes32,uint32)",
                b32(rid),
                b32(payload_hash),
                b32(salt),
                u256(revision),
            )
        )
        return "0x" + _words(out)[0]

    async def get(self, rid: str) -> OnChainRecord:
        return decode_record(await self._call(encode_call("get(bytes32)", b32(rid))))

    async def verify(self, rid: str, payload_hash: str, salt: str) -> tuple[bool, int, str]:
        out = _words(
            await self._call(
                encode_call(
                    "verify(bytes32,bytes32,bytes32)", b32(rid), b32(payload_hash), b32(salt)
                )
            )
        )
        status = int(out[2], 16)
        return int(out[0], 16) == 1, int(out[1], 16), STATUS[status] if status < 4 else "unknown"

    async def _send(self, data: str) -> TxResult:
        tx_hash = await self._rpc(
            "eth_sendTransaction", [{"from": self.sender, "to": self.contract, "data": data}]
        )
        if not isinstance(tx_hash, str):
            raise AnchorTxFailed()
        deadline = asyncio.get_running_loop().time() + self.settings.chain_timeout_seconds * 3
        while True:
            receipt = await self._rpc("eth_getTransactionReceipt", [tx_hash])
            if receipt:
                if receipt.get("status") != "0x1":
                    raise AnchorTxFailed()
                return TxResult(tx_hash=tx_hash, block_number=int(receipt["blockNumber"], 16))
            if asyncio.get_running_loop().time() > deadline:
                raise ChainUnavailable()
            await asyncio.sleep(0.25)

    async def register(
        self, rid: str, commitment: str, payload_hash: str, revision: int
    ) -> TxResult:
        return await self._send(
            encode_call(
                "register(bytes32,bytes32,bytes32,uint32)",
                b32(rid),
                b32(commitment),
                b32(payload_hash),
                u256(revision),
            )
        )

    async def revise(self, rid: str, commitment: str, payload_hash: str, revision: int) -> TxResult:
        return await self._send(
            encode_call(
                "revise(bytes32,bytes32,bytes32,uint32)",
                b32(rid),
                b32(commitment),
                b32(payload_hash),
                u256(revision),
            )
        )
