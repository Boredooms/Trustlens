"""Simulated ThreatReportRegistry for CHAIN_MODE=simulated (WEB3_REGISTRY.md §7.1).

A JSON-RPC answering machine at the same boundary as a real node: ``ChainClient`` talks to it
through an ``httpx`` transport, so anchoring and verification run the exact code they run against a
real chain. It reproduces the rules of packages/contracts/contracts/ThreatReportRegistry.sol:
register once, revise only by the reporter with a higher revision, anyone may dispute, only the
reporter may withdraw, and ``commitmentOf`` is the real ``keccak256(abi.encode(...))`` — checked
against the deployed contract by unit tests. State lives in Postgres (``sim_registry_records``,
append-only ``sim_registry_txs``) so it survives restarts.

What it is not: a blockchain. Nobody but this API can write to it and there is no consensus. Every
anchor it produces carries chain id 0 and is labelled ``simulated`` in every response.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.tables import SimRegistryRecord, SimRegistryTx
from app.services.chain import (
    SELECTORS,
    SIMULATED_CHAIN_ID,
    SIMULATED_CONTRACT,
)

# ── keccak256 (Keccak-f[1600], rate 1088, original 0x01 padding — Ethereum's, not SHA3-256) ──
_RC = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)  # fmt: skip
_ROT = (
    (0, 36, 3, 41, 18),
    (1, 44, 10, 45, 2),
    (62, 6, 43, 15, 61),
    (28, 55, 25, 21, 56),
    (27, 20, 39, 8, 14),
)
_M64 = (1 << 64) - 1


def _rotl(x: int, n: int) -> int:
    return ((x << n) | (x >> (64 - n))) & _M64 if n else x


def _keccak_f(a: list[list[int]]) -> None:
    for rc in _RC:
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rotl(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                a[x][y] ^= d[x]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rotl(a[x][y], _ROT[x][y])
        for x in range(5):
            for y in range(5):
                a[x][y] = b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y])
        a[0][0] ^= rc


def keccak256(data: bytes) -> bytes:
    rate = 136
    msg = bytearray(data)
    msg.append(0x01)
    while len(msg) % rate:
        msg.append(0)
    msg[-1] |= 0x80
    a = [[0] * 5 for _ in range(5)]
    for off in range(0, len(msg), rate):
        block = msg[off : off + rate]
        for i in range(rate // 8):
            a[i % 5][i // 5] ^= int.from_bytes(block[8 * i : 8 * i + 8], "little")
        _keccak_f(a)
    out = b"".join(a[i % 5][i // 5].to_bytes(8, "little") for i in range(4))
    return out


def commitment_of(rid: str, payload_hash: str, salt: str, revision: int) -> str:
    """keccak256(abi.encode(bytes32, bytes32, bytes32, uint32)) — 64-hex-digit words in, 0x… out."""
    if not 0 <= revision < 2**32:
        raise ValueError("revision is a uint32")
    blob = bytes.fromhex(rid + payload_hash + salt + f"{revision:064x}")
    return "0x" + keccak256(blob).hex()


# ── JSON-RPC transport ───────────────────────────────────────────────────────────
_NAME = {v[2:]: k.split("(")[0] for k, v in SELECTORS.items()}
_ZERO = "0" * 64
_MAX_BODY = 64_000


class Revert(Exception):
    """The registry rejected a transaction (the contract would revert with this error name)."""


def _words(hexdata: str) -> list[str]:
    return [hexdata[i : i + 64] for i in range(0, len(hexdata), 64)]


def _addr_word(addr: str) -> str:
    return "0" * 24 + addr[2:].lower()


class SimulatedRegistryTransport(httpx.AsyncBaseTransport):
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self._factory = session_factory

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        raw = await request.aread()
        if len(raw) > _MAX_BODY:
            return httpx.Response(413)
        try:
            body = json.loads(raw)
            method, params, rid = body["method"], body.get("params", []), body.get("id")
        except (ValueError, KeyError, TypeError):
            return httpx.Response(400)
        try:
            result = await self._dispatch(method, params)
        except Revert as exc:
            return self._error(rid, 3, f"execution reverted: {exc}")
        except (ValueError, KeyError, IndexError, TypeError):
            return self._error(rid, -32602, "invalid params")
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": rid, "result": result})

    @staticmethod
    def _error(rid: Any, code: int, message: str) -> httpx.Response:
        doc = {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}}
        return httpx.Response(200, json=doc)

    async def _dispatch(self, method: str, params: list[Any]) -> Any:
        if method == "eth_chainId":
            return hex(SIMULATED_CHAIN_ID)
        if method == "eth_getCode":
            return "0x7357" if str(params[0]).lower() == SIMULATED_CONTRACT else "0x"
        if method == "eth_call":
            return await self._call(self._calldata(params[0]))
        if method == "eth_sendTransaction":
            tx = params[0]
            return await self._send(str(tx["from"]).lower(), self._calldata(tx))
        if method == "eth_getTransactionReceipt":
            async with self._factory() as db:
                row = await db.get(SimRegistryTx, str(params[0]).lower())
            if row is None:
                return None
            return {
                "status": "0x1",
                "blockNumber": hex(row.block_number),
                "transactionHash": row.tx_hash,
            }
        if method == "eth_blockNumber":
            async with self._factory() as db:
                top = (await db.execute(select(func.max(SimRegistryTx.block_number)))).scalar()
            return hex(int(top or 0))
        raise ValueError(f"unsupported method {method}")

    @staticmethod
    def _calldata(tx: dict[str, Any]) -> tuple[str, list[str]]:
        if str(tx.get("to", "")).lower() != SIMULATED_CONTRACT:
            raise ValueError("unknown contract")
        data = str(tx["data"]).lower()
        if not data.startswith("0x") or (len(data) - 10) % 64:
            raise ValueError("malformed calldata")
        name = _NAME[data[2:10]]
        words = _words(data[10:])
        if any(len(w) != 64 or any(ch not in "0123456789abcdef" for ch in w) for w in words):
            raise ValueError("malformed calldata")
        return name, words

    async def _call(self, call: tuple[str, list[str]]) -> str:
        name, w = call
        if name == "commitmentOf":
            return commitment_of(w[0], w[1], w[2], int(w[3], 16))
        async with self._factory() as db:
            if name == "total":
                n = (await db.execute(select(func.count()).select_from(SimRegistryRecord))).scalar()
                return "0x" + f"{int(n or 0):064x}"
            rec = await db.get(SimRegistryRecord, "0x" + w[0])
        if name == "get":
            if rec is None:
                return "0x" + _ZERO * 6
            return "0x" + "".join(
                [
                    rec.commitment[2:],
                    rec.payload_hash[2:],
                    _addr_word(rec.reporter),
                    f"{rec.registered_at:064x}",
                    f"{rec.revision:064x}",
                    f"{rec.status:064x}",
                ]
            )
        if name == "verify":
            if rec is None:
                return "0x" + _ZERO * 3
            ok = commitment_of(w[0], w[1], w[2], rec.revision) == rec.commitment
            return "0x" + f"{int(ok):064x}" + f"{rec.revision:064x}" + f"{rec.status:064x}"
        raise ValueError(f"{name} is not a view function")

    async def _send(self, sender: str, call: tuple[str, list[str]]) -> str:
        name, w = call
        rid = "0x" + w[0]
        input_hex = SELECTORS[next(k for k in SELECTORS if k.startswith(name + "("))] + "".join(w)
        tx_hash = (
            "0x" + keccak256(f"{name}|{input_hex}|{sender}|{os.urandom(16).hex()}".encode()).hex()
        )
        async with self._factory() as db:
            rec = (
                await db.execute(
                    select(SimRegistryRecord)
                    .where(SimRegistryRecord.report_id_bytes32 == rid)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if name == "register":
                commitment, ph, rev = "0x" + w[1], "0x" + w[2], int(w[3], 16)
                if w[1] == _ZERO:
                    raise Revert("EmptyCommitment")
                if rec is not None:
                    raise Revert("AlreadyRegistered")
                db.add(
                    SimRegistryRecord(
                        report_id_bytes32=rid,
                        commitment=commitment,
                        payload_hash=ph,
                        reporter=sender,
                        registered_at=int(time.time()),
                        revision=rev,
                        status=1,
                    )
                )
            elif name == "revise":
                commitment, ph, rev = "0x" + w[1], "0x" + w[2], int(w[3], 16)
                if rec is None:
                    raise Revert("NotRegistered")
                if rec.reporter != sender:
                    raise Revert("NotReporter")
                if w[1] == _ZERO:
                    raise Revert("EmptyCommitment")
                if rev <= rec.revision:
                    raise Revert("StaleRevision")
                rec.commitment, rec.payload_hash, rec.revision = commitment, ph, rev
            elif name == "dispute":
                if rec is None:
                    raise Revert("NotRegistered")
                rec.status = 2
            elif name == "withdraw":
                if rec is None:
                    raise Revert("NotRegistered")
                if rec.reporter != sender:
                    raise Revert("NotReporter")
                rec.status = 3
            else:
                raise ValueError(f"{name} is not a transaction")
            db.add(
                SimRegistryTx(
                    tx_hash=tx_hash,
                    method=name,
                    report_id_bytes32=rid,
                    sender=sender,
                    input=input_hex,
                )
            )
            try:
                await db.commit()
            except IntegrityError as exc:  # a concurrent register of the same report id won
                await db.rollback()
                raise Revert("AlreadyRegistered") from exc
        return tx_hash
