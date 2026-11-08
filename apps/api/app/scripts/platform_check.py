"""End-to-end check of the governance + platform features over HTTP against a running API.

Run: ``python -m app.scripts.platform_check [--api http://localhost:8000]`` (dev sign-in required,
so development only). Creates its own throwaway organisation and cleans up what it can.
Exit 0 = every check passed.
"""

from __future__ import annotations

import argparse
import sys
import time
import uuid
from typing import Any

import httpx

OWNER = "Bearer dev:owner.e2e@trustlens.local:user"
INVITEE = "Bearer dev:invitee.e2e@trustlens.local:user"
OPERATOR = "Bearer dev:operator@trustlens.local:operator"
ANALYST = "Bearer dev:analyst@trustlens.local:analyst"
results: list[bool] = []


def check(name: str, ok: bool, detail: Any = "") -> None:
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail != "" else ""))


def code(resp: httpx.Response) -> str:
    try:
        return str(resp.json().get("error", {}).get("code", resp.status_code))
    except ValueError:
        return str(resp.status_code)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8000")
    parser.add_argument("--timeout", type=float, default=120)
    args = parser.parse_args()
    suffix = uuid.uuid4().hex[:6]
    with httpx.Client(base_url=args.api + "/api/v1", timeout=args.timeout) as c:

        def h(token: str, idem: bool = False) -> dict[str, str]:
            headers = {"Authorization": token}
            if idem:
                headers["Idempotency-Key"] = f"e2e-{uuid.uuid4().hex}"
            return headers

        print("Organisations")
        r = c.post(
            "/organisations",
            headers=h(OWNER, True),
            json={"name": f"E2E Test Org {suffix}", "sector": "education"},
        )
        check("create organisation", r.status_code == 201, r.status_code)
        org = r.json()
        oid = org["id"]
        check("creator is org_admin", org.get("role") == "org_admin", org.get("role"))
        check("starts as draft", org.get("status") == "draft", org.get("status"))
        r = c.patch(f"/organisations/{oid}", headers=h(OWNER), json={"status": "active"})
        check("publish without verified domain refused", code(r) == "NO_VERIFIED_DOMAIN", code(r))
        r = c.patch(f"/organisations/{oid}", headers=h(OWNER), json={"brand_tokens": ["e2etest"]})
        check("edit profile", r.status_code == 200, r.status_code)

        print("Domains")
        domain = f"e2e-{suffix}.example.com"
        r = c.post(f"/organisations/{oid}/domains", headers=h(OWNER, True), json={"domain": domain})
        check("add domain issues challenges", r.status_code == 201, r.status_code)
        dom = r.json()
        methods = {ch.get("method") for ch in dom.get("challenges", [])} or {
            k for k in ("dns_txt", "http_file") if k in str(dom)
        }
        check("DNS TXT + HTTP file challenges", {"dns_txt", "http_file"} <= methods, methods)
        r = c.post(
            f"/organisations/{oid}/domains/{dom['id']}/verify",
            headers=h(OWNER),
            json={"method": "dns_txt"},
        )
        check(
            "verify fails honestly without the record",
            code(r) in {"VERIFICATION_NOT_FOUND", "VERIFICATION_TOKEN_MISMATCH"},
            code(r),
        )
        r = c.get(f"/organisations/{oid}/domains", headers=h(OWNER))
        check("list domains", r.status_code == 200 and len(r.json()["data"]) == 1, r.status_code)

        print("Recipients")
        r = c.post(
            f"/organisations/{oid}/recipients",
            headers=h(OWNER, True),
            json={"recipient_type": "upi_vpa", "value": f"fees{suffix}@okaxis"},
        )
        check("add recipient", r.status_code == 201, r.status_code)
        rid = r.json().get("id")
        r = c.delete(f"/organisations/{oid}/recipients/{rid}", headers=h(OWNER))
        check("delete recipient", r.status_code == 204, r.status_code)

        print("Members")
        c.get("/auth/me", headers=h(INVITEE))  # the invitee has signed in once
        r = c.post(
            f"/organisations/{oid}/members",
            headers=h(OWNER, True),
            json={"email": "invitee.e2e@trustlens.local", "role": "org_member"},
        )
        check("invite member", r.status_code == 201, r.status_code)
        inv = r.json()
        token = (inv.get("accept_url") or "").rstrip("/").rsplit("/", 1)[-1]
        check("invite link available (email not configured)", bool(token), inv.get("delivery"))
        r = c.post(f"/invites/{token}/accept", headers=h(INVITEE))
        check("invitee accepts", r.status_code in (200, 201), r.status_code)
        r = c.post(f"/invites/{token}/accept", headers=h(INVITEE))
        check("invite cannot be reused", r.status_code in (404, 409, 410), code(r))
        r = c.get(f"/organisations/{oid}/members", headers=h(OWNER))
        members = r.json().get("data", [])
        check("2 members listed", len(members) == 2, len(members))
        owner_id = next(m["user_id"] for m in members if m["role"] == "org_admin")
        invitee_id = next(m["user_id"] for m in members if m["role"] != "org_admin")
        r = c.delete(f"/organisations/{oid}/members/{owner_id}", headers=h(OWNER))
        check("last admin cannot leave", code(r) == "LAST_ADMIN_REMOVAL", code(r))
        r = c.patch(
            f"/organisations/{oid}/members/{invitee_id}",
            headers=h(OWNER),
            json={"role": "org_admin"},
        )
        check("promote member", r.status_code == 200, r.status_code)
        r = c.delete(f"/organisations/{oid}/members/{invitee_id}", headers=h(OWNER))
        check("remove member", r.status_code == 204, r.status_code)
        r = c.get(f"/organisations/{oid}", headers=h(INVITEE))
        check("removed member loses access", r.status_code in (403, 404), r.status_code)

        print("Certificates")
        r = c.get("/certificates", headers=h(ANALYST))
        check("certificate inventory", r.status_code == 200, r.status_code)
        certs = r.json().get("data", [])
        if certs:
            r = c.get(f"/certificates/{certs[0]['id']}", headers=h(ANALYST))
            check("certificate detail", r.status_code == 200, r.status_code)
        r = c.post(
            "/certificates/monitors",
            headers=h(OWNER, True),
            json={"organisation_id": oid, "domain": domain},
        )
        check("monitor needs a verified domain", code(r) == "DOMAIN_NOT_VERIFIED", code(r))

        print("Appeals")
        r = c.post(
            "/appeals",
            headers={"Idempotency-Key": f"e2e-{uuid.uuid4().hex}"},
            json={
                "domain": domain,
                "email": "owner.e2e@trustlens.local",
                "message": "This is our site and it was flagged by mistake.",
                "challenge_method": "dns_txt",
            },
        )
        check("anonymous appeal accepted", r.status_code == 201, r.status_code)
        appeal = r.json()
        aid = appeal.get("appeal_id")
        check("appeal carries a challenge", bool(appeal.get("challenge")), "")
        r = c.post(f"/appeals/{aid}/verify")
        check("appeal verify fails without record", r.status_code in (200, 422), code(r))
        r = c.get("/appeals", headers=h(ANALYST))
        check(
            "analyst sees appeal queue",
            r.status_code == 200 and any(a["id"] == aid for a in r.json()["data"]),
            r.status_code,
        )
        r = c.post(
            f"/appeals/{aid}/review",
            headers=h(ANALYST),
            json={"action": "approve", "reason": "Trying to approve an unverified appeal."},
        )
        check("cannot approve unverified appeal", code(r) == "APPEAL_NOT_VERIFIED", code(r))
        r = c.post(
            f"/appeals/{aid}/review",
            headers=h(ANALYST),
            json={"action": "reject", "reason": "End-to-end test rejection."},
        )
        check("reject appeal", r.status_code == 200, r.status_code)

        print("Redirect inspection, usage, audit")
        r = c.post(
            "/inspect-redirect",
            headers=h(OWNER),
            json={"url": "http://169.254.169.254/latest/meta-data/"},
        )
        blocked = r.status_code in (400, 422) or (
            r.status_code == 200 and r.json().get("blocked_hop") is not None
        )
        check("redirect inspector refuses cloud metadata address", blocked, code(r))
        r = c.post(
            "/inspect-redirect",
            headers=h(OWNER),
            json={"url": "https://apply.northstar-admissions.example/pay"},
        )
        check("redirect inspection on demo host", r.status_code == 200, code(r))
        r = c.get("/usage", headers=h(OWNER))
        check("usage report", r.status_code == 200 and "quota" in r.json(), r.status_code)
        r = c.get("/audit-logs", headers=h(OPERATOR), params={"organisation_id": oid})
        actions = {a["action"] for a in r.json().get("data", [])} if r.status_code == 200 else set()
        check("audit trail recorded", r.status_code == 200 and len(actions) >= 4, sorted(actions))
        r = c.get("/audit-logs", headers=h(OWNER))
        check("audit log is operator-only", r.status_code == 403, r.status_code)

        print("Accounts and webhooks")
        r = c.request(
            "DELETE",
            "/auth/me",
            headers=h(OWNER),
            json={"confirm_email": "owner.e2e@trustlens.local"},
        )
        check("sole org admin cannot delete account", code(r) == "LAST_ADMIN_REMOVAL", code(r))
        gone_email = f"gone.e2e-{suffix}@trustlens.local"
        gone = f"Bearer dev:{gone_email}:user"
        first = c.get("/auth/me", headers=h(gone)).json().get("id")
        r = c.request("DELETE", "/auth/me", headers=h(gone), json={"confirm_email": "x@y.test"})
        check("delete needs the typed account email", code(r) == "VALIDATION_FAILED", code(r))
        r = c.request("DELETE", "/auth/me", headers=h(gone), json={"confirm_email": gone_email})
        check("account deleted", r.status_code == 204, r.status_code)
        again = c.get("/auth/me", headers=h(gone)).json().get("id")
        check("deleted account is not resurrected", bool(again) and again != first, again)
        r = c.post(
            args.api + "/webhooks/clerk",
            content=b'{"type":"user.deleted","data":{"id":"user_x"}}',
            headers={"svix-id": "msg_x", "svix-timestamp": "1", "svix-signature": "v1,bad"},
        )
        check("unsigned Clerk webhook rejected", r.status_code in (401, 503), r.status_code)

        print("Operator demo controls")
        r = c.get("/admin/demo", headers=h(OPERATOR))
        check(
            "demo status for operators",
            r.status_code == 200 and "counts" in r.json(),
            r.status_code,
        )
        r = c.get("/admin/demo", headers=h(OWNER))
        check("demo status refused for users", r.status_code == 403, r.status_code)

        print("Cleanup")
        r = c.delete(f"/organisations/{oid}/domains/{dom['id']}", headers=h(OWNER))
        check("remove domain", r.status_code == 204, r.status_code)

    passed = sum(results)
    print(f"\n{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    started = time.perf_counter()
    rc = main()
    print(f"({time.perf_counter() - started:.0f}s)")
    sys.exit(rc)
