"""Simulated registry: keccak256 and commitmentOf must equal Ethereum's and the deployed contract's.

Contract vectors were read from ThreatReportRegistry.commitmentOf on a Hardhat node (chain 31337,
address 0x5FbDB2315678afecb367f032d93F642f64180aa3) on 2026-11-09.
"""

from __future__ import annotations

import hashlib

import pytest

from app.services.sim_registry import commitment_of, keccak256

from ..conftest import make_settings


@pytest.mark.parametrize(
    ("data", "digest"),
    [
        (b"", "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"),
        (b"abc", "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"),
        (
            b"The quick brown fox jumps over the lazy dog",
            "4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15",
        ),
        (b"a" * 136, None),  # exactly one rate block: padding goes into a second block
        (b"a" * 200, None),
    ],
)
def test_keccak256_known_vectors(data: bytes, digest: str | None) -> None:
    out = keccak256(data).hex()
    assert len(out) == 64
    if digest is not None:
        assert out == digest
    # Ethereum's keccak256 is not NIST SHA3-256 (different padding).
    assert out != hashlib.sha3_256(data).hexdigest()


@pytest.mark.parametrize(
    ("rid", "ph", "salt", "rev", "expected"),
    [
        ("11" * 32, "22" * 32, "33" * 32, 1,
         "0x0e965a04c89654ce21ffdaa18a10e54802d2c0fa50939b1cf78eb084259a767e"),
        ("ab" * 32, "cd" * 32, "ef" * 32, 7,
         "0x416a43a6b216ad80dae8130001e6fe9553da12b316deba19711a82718af6132f"),
        ("00" * 31 + "01", "ff" * 32, "00" * 32, 2**32 - 1,
         "0x00c8335c82e02ac464156652bf5c88612c76ff79962eeb925c460c8ea19905c6"),
    ],
)  # fmt: skip
def test_commitment_matches_the_deployed_contract(
    rid: str, ph: str, salt: str, rev: int, expected: str
) -> None:
    assert commitment_of(rid, ph, salt, rev) == expected


def test_revision_must_fit_uint32() -> None:
    with pytest.raises(ValueError):
        commitment_of("11" * 32, "22" * 32, "33" * 32, 2**32)


def test_simulated_mode_settings() -> None:
    s = make_settings(chain_mode="simulated")
    assert s.chain_configured and s.chain_simulated and s.effective_chain_id == 0


def test_simulated_mode_excludes_rpc_url() -> None:
    with pytest.raises(ValueError, match="mutually exclusive"):
        make_settings(chain_mode="simulated", chain_rpc_url="http://chain.test:8545")


def test_simulated_mode_in_production_requires_demo_mode() -> None:
    prod = {
        "environment": "production",
        "direct_database_url": "postgresql://u:p@db.example.supabase.co:5432/postgres",
        "database_url": "postgresql+asyncpg://u:p@db.example.supabase.co:6543/postgres",
        "jwt_secret": "j" * 40,
        "clerk_secret_key": "x",
        "supabase_url": "https://x.supabase.co",
        "supabase_secret_key": "x",
        "upstash_redis_rest_url": "https://x.upstash.io",
        "upstash_redis_rest_token": "x",
        "qstash_current_signing_key": "x",
        "ip_hash_salt": "x",
        "dev_auth_enabled": False,
    }
    with pytest.raises(ValueError, match="DEMO_MODE"):
        make_settings(chain_mode="simulated", demo_mode=False, **prod)
    assert make_settings(chain_mode="simulated", demo_mode=True, **prod).chain_simulated
