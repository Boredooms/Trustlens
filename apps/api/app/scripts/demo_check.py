"""Automated demo rehearsal against a running API (DEMO_RUNBOOK.md §8, KICKOFF §7.3).

    python -m app.scripts.demo_check [--api http://localhost:8000]

Uses development sign-in tokens (DEV_AUTH_ENABLED=true) for the analyst/operator, pairs two
extension "devices" (profile A and profile B) through the real pairing flow, and asserts every demo
outcome over HTTP. Exit code 0 only if every assertion holds. It mutates demo data (a report is
confirmed and a simulated incident created): run ``reset_demo`` + ``seed_demo`` before the next
rehearsal.
"""

from __future__ import annotations

import argparse
import sys
import time
from typing import Any

import httpx

ANALYST = "Bearer dev:analyst@trustlens.local:analyst"
OPERATOR = "Bearer dev:operator@trustlens.local:operator"
PROFILE_B_USER = "Bearer dev:student.b@trustlens.local:user"
L1 = "https://apply.northstar-admissions.example"
L3 = "https://portal.northstar-placement.example/login"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{' - ' + detail if detail else ''}")
    return ok


def pair(client: httpx.Client, human: str, device: str) -> str:
    code = client.post(
        "/api/v1/auth/extension/pair",
        json={"device_name": device},
        headers={"Authorization": human},
    )
    code.raise_for_status()
    token = client.post(
        "/api/v1/auth/extension/exchange", json={"code": code.json()["code"], "device_name": device}
    )
    token.raise_for_status()
    return str(token.json()["device_token"])


def poll(client: httpx.Client, path: str, auth: str, seconds: int = 60) -> dict[str, Any]:
    deadline = time.time() + seconds
    while True:
        body: dict[str, Any] = client.get(path, headers={"Authorization": auth}).json()
        if body.get("status") in ("completed", "partial", "failed") or time.time() > deadline:
            return body
        time.sleep(0.5)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8000")
    parser.add_argument("--timeout", type=float, default=30, help="per-request seconds")
    args = parser.parse_args()
    api = args.api
    with httpx.Client(base_url=api, timeout=args.timeout) as c:
        print("Pre-flight")
        ready = c.get("/ready")
        check(
            "API ready, database ok",
            ready.status_code == 200 and ready.json()["checks"]["database"]["status"] == "ok",
        )

        print("1:00 The warning (extension overlay, profile A)")
        device_a = pair(c, OPERATOR, "Profile A - Chrome")
        a = c.post(
            "/api/v1/assess",
            headers={"Authorization": f"Bearer {device_a}"},
            json={
                "url": f"{L1}/pay",
                "intent": "payment",
                "payee": "fees@okaxis",
                "form_action": "https://collect.badhost.example/pay",
                "destination_host": "collect.badhost.example",
            },
        ).json()
        check(
            "Overlay decision is BLOCK",
            a.get("decision") == "BLOCK",
            f"{a.get('decision')} {a.get('risk_score')}",
        )
        action = a.get("action", {})
        check(
            "Observed fees@okaxis vs expected fees@northstar-demo",
            action.get("payee") == "fees@okaxis"
            and "fees@northstar-demo" in action.get("expected_payees", []),
            f"observed={action.get('payee')} expected={action.get('expected_payees')}",
        )
        check(
            "Coverage reported with the decision",
            isinstance(a.get("coverage", {}).get("percent"), int),
            f"{a.get('coverage', {}).get('percent')}%",
        )

        print("2:00 The dashboard verdict")
        created = c.post(
            "/api/v1/scans",
            headers={"Authorization": ANALYST},
            json={"url": f"{L1}/register", "intent": "payment"},
        )
        scan = poll(c, f"/api/v1/scans/{created.json()['id']}", ANALYST)
        codes = {f["code"] for f in scan.get("findings", [])}
        check(
            "Scan BLOCK",
            scan.get("decision") == "BLOCK",
            f"{scan.get('decision')} / {scan.get('risk_level')}",
        )
        check(
            "Score ~62", abs((scan.get("risk_score") or 0) - 62) <= 5, str(scan.get("risk_score"))
        )
        check(
            "O-2 forced the decision",
            "O-2" in scan.get("overrides", []),
            str(scan.get("overrides")),
        )
        for code in (
            "DOMAIN_NOT_REGISTERED_BY_BRAND",
            "PAYEE_NOT_IN_VERIFIED_PROFILE",
            "SHARES_INFRA_WITH_REPORTED_THREAT",
        ):
            check(f"Finding {code}", code in codes)
        check("Seeded observations labelled simulated", scan.get("simulated") is True)

        print("3:00 The investigation")
        before = (scan.get("decision"), scan.get("risk_score"), scan.get("risk_level"))
        inv_id = c.post(
            "/api/v1/investigations",
            headers={"Authorization": ANALYST},
            json={"scan_id": scan["id"]},
        ).json()["id"]
        inv = poll(c, f"/api/v1/investigations/{inv_id}", ANALYST)
        claims = [
            cl for s in (inv.get("narrative") or {}).get("sections", []) for cl in s["claims"]
        ]
        refs = {r["id"] for r in inv.get("references", [])}
        check("Investigation completed", inv.get("status") == "completed", str(inv.get("status")))
        check(">= 5 claims", len(claims) >= 5, str(len(claims)))
        check(
            "Every claim cites a stored reference",
            bool(claims) and all(cl["refs"] and set(cl["refs"]) <= refs for cl in claims),
        )
        check(
            "AI use labelled",
            "generated" in inv.get("ai", {}),
            f"ai.generated={inv.get('ai', {}).get('generated')}",
        )
        after = c.get(f"/api/v1/scans/{scan['id']}", headers={"Authorization": ANALYST}).json()
        check(
            "Model changed nothing",
            before == (after["decision"], after["risk_score"], after["risk_level"]),
            str(before),
        )

        print("4:00 The campaign")
        camps = c.get("/api/v1/campaigns", headers={"Authorization": ANALYST}).json()["data"]
        camp = next((x for x in camps if "Northstar" in x["name"]), None)
        check("Campaign present", camp is not None, camp["name"] if camp else "none")
        if camp:
            detail = c.get(
                f"/api/v1/campaigns/{camp['id']}", headers={"Authorization": ANALYST}
            ).json()
            check("3 members", detail["member_count"] == 3, str(detail["member_count"]))
            check("Confidence >= 0.6", detail["confidence"] >= 0.6, str(detail["confidence"]))
            types = {i["type"] for i in detail["shared_indicators"]}
            check(
                "Shared nameservers/hosting visible",
                {"nameserver", "hosting"} <= types,
                str(sorted(types)),
            )

        print("5:00 The network (profile B)")
        report = c.post(
            "/api/v1/reports",
            headers={"Authorization": f"Bearer {device_a}"},
            json={
                "url": f"{L1}/register",
                "intent": "payment",
                "observed_payee": "fees@okaxis",
                "justification": "Asked for an application fee to a personal UPI ID.",
                "scan_id": scan["id"],
            },
        )
        check("Profile A report accepted", report.status_code == 201, str(report.status_code))
        review = c.post(
            f"/api/v1/reports/{report.json()['id']}/review",
            headers={"Authorization": ANALYST},
            json={"action": "confirm", "reason": "Payee and credential sink confirmed by analyst."},
        )
        check(
            "Analyst confirmed the report",
            review.status_code == 200 and review.json()["status"] == "confirmed",
        )
        device_b = pair(c, PROFILE_B_USER, "Profile B - Chrome")
        b = c.post(
            "/api/v1/assess",
            headers={"Authorization": f"Bearer {device_b}"},
            json={"url": L3, "intent": "browse"},
        ).json()
        b_codes = {f["code"] for f in b.get("findings", [])}
        check(
            "Profile B gets WARN (not BLOCK, not ALLOW)",
            b.get("decision") == "WARN",
            f"{b.get('decision')} {b.get('risk_score')}",
        )
        check(
            "RELATED_THREAT_FOUND present", "RELATED_THREAT_FOUND" in b_codes, str(sorted(b_codes))
        )

        print("5:45 The CA twist")
        inc = c.post(
            "/api/v1/certificates/incidents",
            headers={"Authorization": OPERATOR},
            json={
                "issuer_cn": "Demo Intermediate CA",
                "title": "Simulated intermediate CA compromise",
                "severity": "high",
                "description": "Demonstration of issuer-incident impact analysis.",
                "source": "simulation",
                "simulated": True,
            },
        )
        body = inc.json()
        check(
            "Incident created and labelled simulated",
            inc.status_code == 201 and body.get("simulated") is True,
        )
        check(
            "2 affected domains",
            body.get("affected_domain_count") == 2,
            str(body.get("affected_domain_count")),
        )

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} assertions passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
