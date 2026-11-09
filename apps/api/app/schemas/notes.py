"""Notes wire models (API_ENDPOINTS.md §18).

A note is an ordered list of blocks. The block model is closed: unknown block types or fields are a
422, so a client can never smuggle markup (there is no HTML block; `text` is plain text and the web
app renders it as text). Limits keep a single note bounded: 200 blocks, 4 000 characters per block.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, field_validator

from app.schemas.common import RequestModel, WireModel

BlockType = Literal[
    "paragraph", "heading", "bullet", "numbered", "todo", "quote", "code", "callout", "divider"
]
SubjectType = Literal["scan", "campaign", "investigation", "report"]

MAX_BLOCKS = 200
MAX_TEXT = 4000


class NoteBlock(RequestModel):
    id: Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")]
    type: BlockType
    text: Annotated[str, Field(max_length=MAX_TEXT)] = ""
    checked: bool | None = None
    level: Annotated[int, Field(ge=1, le=3)] | None = None

    @field_validator("checked")
    @classmethod
    def _checked_only_for_todo(cls, v: bool | None, info) -> bool | None:  # type: ignore[no-untyped-def]
        if v is not None and info.data.get("type") != "todo":
            raise ValueError("checked applies to todo blocks only")
        return v


class NoteWrite(RequestModel):
    blocks: Annotated[list[NoteBlock], Field(max_length=MAX_BLOCKS)]

    @field_validator("blocks")
    @classmethod
    def _unique_ids(cls, v: list[NoteBlock]) -> list[NoteBlock]:
        ids = [b.id for b in v]
        if len(ids) != len(set(ids)):
            raise ValueError("block ids must be unique")
        return v


class NoteBlockOut(WireModel):
    id: str
    type: BlockType
    text: str
    checked: bool | None = None
    level: int | None = None


class NoteOut(WireModel):
    id: str
    subject_type: SubjectType
    subject_id: str
    blocks: list[NoteBlockOut]
    created_at: str
    updated_at: str


class NoteList(WireModel):
    data: list[NoteOut]
