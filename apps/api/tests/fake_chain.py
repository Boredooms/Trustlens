"""In-memory stand-in for a JSON-RPC node running ThreatReportRegistry (tests only).

Implements the registry's semantics (register / revise / get / verify / commitmentOf) closely
enough to exercise the API's anchoring logic. ``commitmentOf`` uses sha256 instead of keccak: only
internal consistency matters here; the real formula is tested against the real contract in
packages/contracts.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.services.chain import SELECTORS

SEL = {v[2:]: k.split("(")[0] for k, v in SELECTORS.items()}
ZERO = "0" * 64


@dataclass
class FakeChain:
    chain_id: int = 31337
    contract: str = "0x5fbdb2315678afecb367f032d93f642f64180aa3"
    records: dict[str, dict[str, Any]] = field(default_factory=dict)
    block: int = 1
    receipts: dict[str, dict[str, Any]] = field(default_factory=dict)
    down: bool = False
    calls: list[str] = field(default_factory=list)

    @staticmethod
    def commitment(rid: str, ph: str, salt: str, rev: int) -> str:
        return hashlib.sha256(bytes.fromhex(rid + ph + salt + f"{rev:064x}")).hexdigest()

    def _call(self, data: str) -> str:
        sel, args = data[2:10], data[10:]
        words = [args[i : i + 64] for i in range(0, len(args), 64)]
        name = SEL[sel]
        self.calls.append(name)
        if name == "commitmentOf":
            return "0x" + self.commitment(words[0], words[1], words[2], int(words[3], 16))
        if name == "get":
            r = self.records.get(words[0])
            if r is None:
                return "0x" + ZERO * 6
            return "0x" + "".join(
                [
                    r["c"],
                    r["ph"],
                    "0" * 24 + "f" * 40,
                    f"{1:064x}",
                    f"{r['rev']:064x}",
                    f"{r['st']:064x}",
                ]
            )
        if name == "verify":
            r = self.records.get(words[0])
            if r is None:
                return "0x" + ZERO * 3
            ok = self.commitment(words[0], words[1], words[2], r["rev"]) == r["c"]
            return "0x" + f"{int(ok):064x}" + f"{r['rev']:064x}" + f"{r['st']:064x}"
        raise AssertionError(name)

    def _send(self, data: str) -> str:
        sel, args = data[2:10], data[10:]
        words = [args[i : i + 64] for i in range(0, len(args), 64)]
        name = SEL[sel]
        self.calls.append(name)
        rid, c, ph, rev = words[0], words[1], words[2], int(words[3], 16)
        if name == "register":
            if rid in self.records:
                raise ValueError("AlreadyRegistered")
            self.records[rid] = {"c": c, "ph": ph, "rev": rev, "st": 1}
        elif name == "revise":
            r = self.records[rid]
            if rev <= r["rev"]:
                raise ValueError("StaleRevision")
            r.update(c=c, ph=ph, rev=rev)
        self.block += 1
        tx = "0x" + hashlib.sha256(f"{name}{rid}{rev}{self.block}".encode()).hexdigest()
        self.receipts[tx] = {"status": "0x1", "blockNumber": hex(self.block)}
        return tx

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("node down")
        body = json.loads(request.content)
        method, params = body["method"], body["params"]
        try:
            if method == "eth_chainId":
                result: Any = hex(self.chain_id)
            elif method == "eth_getCode":
                result = "0x6080" if params[0] == self.contract else "0x"
            elif method == "eth_call":
                result = self._call(params[0]["data"])
            elif method == "eth_sendTransaction":
                result = self._send(params[0]["data"])
            elif method == "eth_getTransactionReceipt":
                result = self.receipts.get(params[0])
            else:
                raise AssertionError(method)
        except ValueError as exc:
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": body["id"],
                    "error": {"code": 3, "message": str(exc)},
                },
            )
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": result})

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)
