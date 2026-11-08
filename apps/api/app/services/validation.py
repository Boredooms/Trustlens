"""Shared field validation (API_CONTRACTS.md §13)."""

from __future__ import annotations

import re

from app.errors import DomainError
from app.schemas.enums import ErrorCode

# §13 says the UPI handle part is ``[a-zA-Z]{2,32}``; the canonical demo payee
# ``fees@northstar-demo`` needs a hyphen, so hyphens are allowed
# (documented in API_CONTRACTS.md §13).
UPI_VPA = re.compile(r"^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z\-]{1,31}$")


class InvalidRecipient(DomainError):
    code, status, message = ErrorCode.INVALID_RECIPIENT, 422, "That payment address is not valid."


def _iban_ok(value: str) -> bool:
    if not re.fullmatch(r"[A-Z0-9]{15,34}", value):
        return False
    rearranged = value[4:] + value[:4]
    digits = "".join(str(int(ch, 36)) for ch in rearranged)
    return int(digits) % 97 == 1


def normalise_recipient(recipient_type: str, value: str) -> str:
    raw = value.strip()
    if recipient_type == "upi_vpa":
        if not UPI_VPA.match(raw):
            raise InvalidRecipient(details=[{"field": "value", "issue": "upi_vpa_syntax"}])
        return raw.lower()
    if recipient_type == "iban":
        compact = raw.replace(" ", "").upper()
        if not _iban_ok(compact):
            raise InvalidRecipient(details=[{"field": "value", "issue": "iban_checksum"}])
        return compact
    if recipient_type == "bank_account":
        compact = re.sub(r"[\s-]", "", raw)
        if not re.fullmatch(r"[A-Za-z0-9]{6,34}", compact):
            raise InvalidRecipient(details=[{"field": "value", "issue": "bank_account_syntax"}])
        return compact.upper()
    if recipient_type == "wallet_address":
        if not re.fullmatch(r"[A-Za-z0-9]{20,100}", raw):
            raise InvalidRecipient(details=[{"field": "value", "issue": "wallet_syntax"}])
        return raw
    if recipient_type == "payment_link":
        if not raw.lower().startswith("https://"):
            raise InvalidRecipient(details=[{"field": "value", "issue": "payment_link_https"}])
        return raw.lower()
    raise InvalidRecipient(details=[{"field": "recipient_type", "issue": "unknown_type"}])
