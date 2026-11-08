"""Web3 registry: commitment scheme, privacy boundary, salt storage, RPC client, config gates.

Owner: docs/02-architecture/WEB3_REGISTRY.md. No network, no database.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.models.tables import Scan, ThreatReport
from app.services import anchors, chain
from app.services.chain import ChainClient, ChainUnavailable

from ..conftest import make_settings
from ..fake_chain import FakeChain

REPO = Path(__file__).resolve().parents[4]
SAMPLE = json.loads(
    (REPO / "packages/contracts/test/fixtures/sample-report.json").read_text("utf-8")
)
ARTIFACT = json.loads(
    (REPO / "packages/contracts/deployments/ThreatReportRegistry.json").read_text("utf-8")
)
CHAIN = {
    "chain_rpc_url": "http://chain.test:8545",
    "chain_registry_address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "chain_sender_address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
}


def test_selectors_match_the_compiled_contract() -> None:
    assert chain.SELECTORS == ARTIFACT["selectors"]


def test_commitment_scheme_matches_the_javascript_fixture() -> None:
    assert anchors.report_id_bytes32(SAMPLE["report_id"]) == SAMPLE["report_id_bytes32"]
    assert anchors.payload_hash(SAMPLE["payload"]) == SAMPLE["expected_payload_hash"]
    for case in SAMPLE["canonical_cases"]:
        assert anchors.payload_hash(case["value"]) == case["sha256"]


def test_canonical_json_omits_nulls_and_refuses_floats() -> None:
    assert anchors.canonical_json({"b": None, "a": {"c": None, "d": 1}}) == '{"a":{"d":1}}'
    with pytest.raises(ValueError):
        anchors.canonical_json({"score": 0.5})


def _report(**kw: object) -> ThreatReport:
    base: dict[str, object] = {
        "id": "01M6YDPBBZ40KTYGZEWPHQGKG9",
        "reporter_user_id": "01M6YDP977SB58PM0TTEXF1WPE",
        "reporter_channel": "web",
        "url": "https://user:secret@apply.northstar-admissions.example/pay?email=jane.doe@mail.example&otp=482913",
        "normalised_url": "https://apply.northstar-admissions.example/pay",
        "justification": (
            "They asked Jane Doe (+91 98765 43210, jane.doe@mail.example) for OTP 482913"
        ),
        "intent": "payment",
        "observed_payee": "fees@okaxis",
        "status": "pending",
        "simulated": True,
        "created_at": datetime(2026, 11, 8, 12, 0, tzinfo=UTC),
    }
    base.update(kw)
    return ThreatReport(**base)


def test_payload_never_contains_personal_data() -> None:
    settings = make_settings()
    scan = Scan(id="01M6YDPBBZ40KTYGZEWPHQGKG8", decision="BLOCK", engine_version="1.0.0")
    payload = anchors.build_payload(
        settings, _report(), scan, ["PAYEE_NOT_IN_VERIFIED_PROFILE", "TYPOSQUATTING_PATTERN"]
    )
    text = anchors.canonical_json(payload)
    for forbidden in (
        "jane",
        "mail.example",
        "98765",
        "482913",
        "secret",
        "fees@okaxis",
        "okaxis",
        "/pay",
        "apply.",
        "01M6YDP977SB58PM0TTEXF1WPE",  # reporter user id
        "https://",
    ):
        assert forbidden not in text.lower(), forbidden
    assert payload["indicator"] == "northstar-admissions.example"
    assert set(payload) <= anchors.PAYLOAD_KEYS
    assert payload["linked_scan"]["finding_codes"] == [
        "PAYEE_NOT_IN_VERIFIED_PROFILE",
        "TYPOSQUATTING_PATTERN",
    ]


def test_payload_is_deterministic_and_changes_with_status() -> None:
    settings = make_settings()
    a = anchors.build_payload(settings, _report(), None, [])
    assert anchors.payload_hash(a) == anchors.payload_hash(
        anchors.build_payload(settings, _report(), None, [])
    )
    b = anchors.build_payload(settings, _report(status="confirmed"), None, [])
    assert anchors.payload_hash(a) != anchors.payload_hash(b)
    assert "linked_scan" not in a and "observed_payee_sha256" in a


def test_salt_round_trips_and_needs_the_same_key() -> None:
    one = make_settings(jwt_secret="a" * 40)
    salt = anchors.new_salt()
    token = anchors.encrypt_salt(one, salt)
    assert salt not in token
    assert anchors.decrypt_salt(one, token) == salt
    with pytest.raises(ChainUnavailable):
        anchors.decrypt_salt(make_settings(jwt_secret="b" * 40), token)


def test_reporter_pseudonym_is_stable_and_unlinkable_without_the_key() -> None:
    s1, s2 = make_settings(jwt_secret="a" * 40), make_settings(jwt_secret="b" * 40)
    assert anchors.reporter_pseudonym(s1, "U1") == anchors.reporter_pseudonym(s1, "U1")
    assert anchors.reporter_pseudonym(s1, "U1") != anchors.reporter_pseudonym(s2, "U1")
    assert anchors.reporter_pseudonym(s1, None) == "anonymous"


def test_record_decoding() -> None:
    words = ["11" * 32, "22" * 32, "0" * 24 + "ab" * 20, f"{5:064x}", f"{2:064x}", f"{3:064x}"]
    rec = chain.decode_record("0x" + "".join(words))
    assert rec.exists and rec.revision == 2 and rec.status == "withdrawn"
    assert rec.reporter == "0x" + "ab" * 20
    assert not chain.decode_record("0x" + "0" * 384).exists


def test_bytes32_validation() -> None:
    with pytest.raises(ValueError):
        chain.b32("0x1234")


async def test_client_reports_unavailable_when_the_node_is_down() -> None:
    fake = FakeChain(down=True)
    client = ChainClient(make_settings(**CHAIN), transport=fake.transport())
    with pytest.raises(ChainUnavailable):
        await client.check()


async def test_client_refuses_the_wrong_chain_or_a_missing_contract() -> None:
    for fake in (FakeChain(chain_id=1), FakeChain(contract="0x" + "9" * 40)):
        client = ChainClient(make_settings(**CHAIN), transport=fake.transport())
        with pytest.raises(ChainUnavailable):
            await client.check()


async def test_client_register_and_verify_round_trip() -> None:
    fake = FakeChain()
    client = ChainClient(make_settings(**CHAIN), transport=fake.transport())
    await client.check()
    rid, ph, salt = "0x" + "01" * 32, "0x" + "02" * 32, "0x" + "03" * 32
    c = await client.commitment_of(rid, ph, salt, 1)
    tx = await client.register(rid, c, ph, 1)
    assert tx.block_number == 2 and tx.tx_hash.startswith("0x")
    assert (await client.verify(rid, ph, salt)) == (True, 1, "active")
    assert (await client.verify(rid, "0x" + "04" * 32, salt))[0] is False
    with pytest.raises(chain.AnchorTxFailed):
        await client.register(rid, c, ph, 1)


def test_unconfigured_client_is_unavailable() -> None:
    with pytest.raises(ChainUnavailable):
        ChainClient(make_settings())


def test_config_requires_address_and_sender_with_rpc() -> None:
    with pytest.raises(ValueError, match="CHAIN_REGISTRY_ADDRESS"):
        make_settings(chain_rpc_url="http://chain.test:8545")


def test_production_refuses_the_local_dev_chain() -> None:
    prod = {
        "environment": "production",
        "direct_database_url": "postgresql://x/y",
        "jwt_secret": "x" * 40,
        "clerk_secret_key": "sk",
        "supabase_url": "https://s",
        "supabase_service_role_key": "k",
        "upstash_redis_rest_url": "https://u",
        "upstash_redis_rest_token": "t",
        "qstash_current_signing_key": "q",
        "ip_hash_salt": "salt",
    }
    with pytest.raises(ValueError, match="31337"):
        Settings(**{**prod, **CHAIN, **_base()}, _env_file=None)  # type: ignore[arg-type]


def _base() -> dict[str, object]:
    from ..conftest import BASE_SETTINGS

    return {k: v for k, v in BASE_SETTINGS.items() if k != "environment"}


async def test_public_verify_rejects_a_malformed_id_without_touching_the_db(
    client: httpx.AsyncClient,
) -> None:
    r = await client.get("/api/v1/public/verify/not-a-ulid")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "ANCHOR_NOT_FOUND"
