"""Investigation notes (API_ENDPOINTS.md §18).

Private, block-structured notes a person keeps next to a scan, campaign, investigation or report.
Owner-only (also enforced by RLS). Notes are working material: they never feed the risk engine, a
finding, a score or a decision, and they are not shared with an organisation.

Human sessions only (dashboard). API keys and extension device tokens get 403 INSUFFICIENT_SCOPE.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_principal, get_db, rate_limit
from app.api.routes.scans import load_scan
from app.errors import InsufficientScope, ValidationFailed
from app.models.tables import Note
from app.schemas.common import ERROR_RESPONSES
from app.schemas.notes import NoteList, NoteOut, NoteWrite, SubjectType
from app.security.auth import Principal
from app.services.serialise import ts
from app.utils import is_ulid, new_ulid, utcnow

router = APIRouter(prefix="/api/v1/notes", tags=["notes"], responses=ERROR_RESPONSES)


def _human(principal: Principal) -> Principal:
    if principal.kind != "user":
        raise InsufficientScope()
    return principal


def _subject_id(subject_id: str) -> str:
    if not is_ulid(subject_id):
        raise ValidationFailed(details=[{"field": "subject_id", "issue": "invalid_id"}])
    return subject_id


async def _check_subject(
    db: AsyncSession, principal: Principal, subject_type: str, subject_id: str
) -> None:
    # A scan note needs a scan the person can see (existence hiding, as GET /scans/{id}).
    if subject_type == "scan":
        await load_scan(db, subject_id, principal)


def _out(n: Note) -> dict[str, Any]:
    return {
        "id": n.id,
        "subject_type": n.subject_type,
        "subject_id": n.subject_id,
        "blocks": n.blocks,
        "created_at": ts(n.created_at),
        "updated_at": ts(n.updated_at),
    }


@router.get("", response_model=NoteList, summary="List my notes")
async def list_notes(
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(current_principal),
    subject_type: SubjectType | None = None,
    subject_id: str | None = None,
    limit: int = Query(20, ge=1, le=100),
) -> Any:
    _human(principal)
    stmt = (
        select(Note)
        .where(Note.user_id == principal.user.id)
        .order_by(Note.updated_at.desc())
        .limit(limit)
    )
    if subject_type:
        stmt = stmt.where(Note.subject_type == subject_type)
    if subject_id:
        stmt = stmt.where(Note.subject_id == _subject_id(subject_id))
    return {"data": [_out(n) for n in (await db.execute(stmt)).scalars()]}


@router.get(
    "/{subject_type}/{subject_id}", response_model=NoteOut, summary="Get my note for a subject"
)
async def get_note(
    subject_type: SubjectType,
    subject_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(current_principal),
) -> Any:
    _human(principal)
    sid = _subject_id(subject_id)
    await _check_subject(db, principal, subject_type, sid)
    note = (
        await db.execute(
            select(Note).where(
                Note.user_id == principal.user.id,
                Note.subject_type == subject_type,
                Note.subject_id == sid,
            )
        )
    ).scalar_one_or_none()
    response.headers["Cache-Control"] = "no-store"
    if note is None:
        # An empty note is a valid state, not an error: the editor starts blank.
        now = ts(utcnow())
        return {
            "id": "",
            "subject_type": subject_type,
            "subject_id": sid,
            "blocks": [],
            "created_at": now,
            "updated_at": now,
        }
    return _out(note)


@router.put(
    "/{subject_type}/{subject_id}", response_model=NoteOut, summary="Save my note for a subject"
)
async def put_note(
    subject_type: SubjectType,
    subject_id: str,
    body: NoteWrite,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(current_principal),
    _: None = Depends(rate_limit("notes")),
) -> Any:
    _human(principal)
    sid = _subject_id(subject_id)
    await _check_subject(db, principal, subject_type, sid)
    blocks = [b.model_dump(exclude_none=True) for b in body.blocks]
    note = (
        await db.execute(
            select(Note).where(
                Note.user_id == principal.user.id,
                Note.subject_type == subject_type,
                Note.subject_id == sid,
            )
        )
    ).scalar_one_or_none()
    if note is None:
        note = Note(
            id=new_ulid(),
            user_id=principal.user.id,
            subject_type=subject_type,
            subject_id=sid,
            blocks=blocks,
        )
        db.add(note)
    else:
        note.blocks = blocks
        note.updated_at = utcnow()
    await db.commit()
    await db.refresh(note)
    return _out(note)


@router.delete(
    "/{subject_type}/{subject_id}", status_code=204, summary="Delete my note for a subject"
)
async def delete_note(
    subject_type: SubjectType,
    subject_id: str,
    db: AsyncSession = Depends(get_db),
    principal: Principal = Depends(current_principal),
) -> Response:
    _human(principal)
    sid = _subject_id(subject_id)
    await db.execute(
        delete(Note).where(
            Note.user_id == principal.user.id,
            Note.subject_type == subject_type,
            Note.subject_id == sid,
        )
    )
    await db.commit()
    return Response(status_code=204)
