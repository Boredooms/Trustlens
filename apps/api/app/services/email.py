"""Transactional email via Resend (HOSTED_SERVICES.md; API_ENDPOINTS.md §10 Q-4).

Email is best-effort: a delivery failure never fails the request that triggered it. The caller gets
a delivery outcome so the UI can fall back to "copy the invite link".

Without ``RESEND_API_KEY``:
- development/test: the message (including any link) is written to the log so a developer can act
  on it — outcome ``"logged"``;
- production: nothing is logged except the fact that delivery is not configured (links carry
  secrets) — outcome ``"not_configured"``.
"""

from __future__ import annotations

from dataclasses import dataclass
from html import escape
from typing import Literal

import httpx

from app.config import Settings
from app.logging import get_logger

log = get_logger("email")

RESEND_ENDPOINT = "https://api.resend.com/emails"
SEND_TIMEOUT_S = 8.0

Delivery = Literal["email", "logged", "not_configured", "failed"]


@dataclass(frozen=True)
class Message:
    to: str
    subject: str
    text: str
    html: str


async def send(settings: Settings, message: Message) -> Delivery:
    key = settings.resend_api_key.get_secret_value() if settings.resend_api_key else ""
    if not key:
        if settings.is_production:
            log.warning("email.not_configured", extra={"subject": message.subject})
            return "not_configured"
        log.info(
            "email.logged_dev",
            extra={"to": message.to, "subject": message.subject, "body": message.text},
        )
        return "logged"
    try:
        async with httpx.AsyncClient(timeout=SEND_TIMEOUT_S) as client:
            resp = await client.post(
                RESEND_ENDPOINT,
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "from": settings.email_from,
                    "to": [message.to],
                    "subject": message.subject,
                    "text": message.text,
                    "html": message.html,
                },
            )
        if resp.status_code >= 400:
            log.warning("email.rejected", extra={"status": resp.status_code})
            return "failed"
    except httpx.HTTPError as exc:
        log.warning("email.unavailable", extra={"exc_type": type(exc).__name__})
        return "failed"
    return "email"


def invite_message(
    *, to: str, organisation: str, inviter: str, role: str, accept_url: str, expires_at: str
) -> Message:
    role_label = "administrator" if role == "org_admin" else "member"
    text = (
        f"{inviter} invited you to join {organisation} on TrustLens as a {role_label}.\n\n"
        f"Accept the invitation: {accept_url}\n\n"
        f"The link works once and expires at {expires_at}. Sign in with this email address "
        f"({to}) to accept. If you did not expect this, ignore this email."
    )
    html = (
        f"<p>{escape(inviter)} invited you to join <strong>{escape(organisation)}</strong> on "
        f"TrustLens as a {role_label}.</p>"
        f'<p><a href="{escape(accept_url, quote=True)}">Accept the invitation</a></p>'
        f"<p>The link works once and expires at {escape(expires_at)}. Sign in with "
        f"{escape(to)} to accept. If you did not expect this, ignore this email.</p>"
    )
    return Message(
        to=to, subject=f"You're invited to {organisation} on TrustLens", text=text, html=html
    )
