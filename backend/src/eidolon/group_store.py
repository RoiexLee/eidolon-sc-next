"""Persistence for group conversations.

Group conversations have their own tables and lifecycle.  This module deliberately does
not share the single-character ``Store`` records: a removed character must remain readable
as the author of old group messages.
"""

import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from collections.abc import Mapping, Sequence

from eidolon.data_access import Database
from eidolon.database import by_name, delete_group_data

MIN_MEMBERS = 2
MAX_MEMBERS = 5
MAX_TITLE_LENGTH = 100

_SCHEMA = """
CREATE TABLE IF NOT EXISTS group_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS group_conversations_by_user
    ON group_conversations(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL REFERENCES group_conversations(id),
    character_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    added_at TEXT NOT NULL,
    removed_at TEXT,
    name_snapshot TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS group_members_by_group
    ON group_members(group_id, position);
CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL REFERENCES group_conversations(id),
    turn_id TEXT,
    author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'character')),
    author_character_id TEXT,
    author_name_snapshot TEXT,
    text TEXT,
    ja TEXT,
    zh TEXT,
    segments TEXT,
    created_at TEXT NOT NULL,
    reply_to_message_id INTEGER,
    mentions TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS group_messages_by_group ON group_messages(group_id, id);
CREATE TABLE IF NOT EXISTS group_turns (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES group_conversations(id),
    client_idempotency_key TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS group_turns_by_group ON group_turns(group_id, started_at);
"""


@dataclass(frozen=True)
class GroupMember:
    character_id: str
    position: int
    added_at: str
    removed_at: str | None
    name_snapshot: str

    @property
    def current(self) -> bool:
        return self.removed_at is None


@dataclass(frozen=True)
class GroupMessageSummary:
    id: int
    author_kind: str
    author_character_id: str | None
    author_name_snapshot: str | None
    text: str | None
    created_at: str


@dataclass(frozen=True)
class GroupConversation:
    id: str
    user_id: str
    title: str | None
    created_at: str
    updated_at: str
    members: tuple[GroupMember, ...] = ()
    last_message: GroupMessageSummary | None = None

    @property
    def current_members(self) -> tuple[GroupMember, ...]:
        return tuple(member for member in self.members if member.current)

    @property
    def history_members(self) -> tuple[GroupMember, ...]:
        return tuple(member for member in self.members if not member.current)


class GroupNotFound(LookupError):
    """The group does not exist for the requested user."""


class GroupMembersInvalid(ValueError):
    """A membership update would violate the 2–5 member contract."""


class GroupMemberNotFound(LookupError):
    """An update named a character that is not in the expected membership state."""


class GroupStore:
    """Asynchronous group persistence on the shared :class:`Database`."""

    def __init__(self, db: Database) -> None:
        self._db = db
        db.prepare(_open)

    async def create_group(
        self,
        user_id: str,
        character_ids: Sequence[str],
        title: str | None = None,
        names: Mapping[str, str] | None = None,
    ) -> GroupConversation:
        ids = tuple(character_ids)
        _check_member_count(ids)
        if len(set(ids)) != len(ids):
            raise GroupMembersInvalid("群组成员不能重复")
        now = _now()
        group = GroupConversation(uuid.uuid4().hex, user_id, _title(title), now, now)
        snapshots = {character_id: (names or {}).get(character_id, character_id) for character_id in ids}
        await self._db.write(_insert_group, group, ids, snapshots)
        return GroupConversation(group.id, group.user_id, group.title, group.created_at, group.updated_at,
                                 tuple(GroupMember(character_id, i, now, None, snapshots[character_id])
                                       for i, character_id in enumerate(ids)))

    async def list_groups(self, user_id: str) -> list[GroupConversation]:
        return await self._db.read(_groups, user_id)

    async def get_group(self, group_id: str, user_id: str) -> GroupConversation | None:
        return await self._db.read(_group, group_id, user_id)

    async def update_group(
        self,
        user_id: str,
        group_id: str,
        *,
        title: str | None = None,
        set_title: bool = False,
        add: Sequence[str] = (),
        remove: Sequence[str] = (),
        names: Mapping[str, str] | None = None,
    ) -> None:
        adding, removing = tuple(add), tuple(remove)
        if len(set(adding)) != len(adding) or len(set(removing)) != len(removing):
            raise GroupMembersInvalid("群组成员不能重复")
        if set(adding) & set(removing):
            raise GroupMembersInvalid("不能同时添加和移除同一位成员")
        await self._db.write(
            _update_group, user_id, group_id,
            _title(title) if set_title else None,
            adding, removing, names or {}, set_title,
        )

    async def delete_group(self, user_id: str, group_id: str) -> bool:
        return await self._db.write(_delete_group, user_id, group_id)


def _open(db: sqlite3.Connection) -> None:
    db.executescript(_SCHEMA)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _title(title: str | None) -> str | None:
    if title is None:
        return None
    title = title.strip()
    if len(title) > MAX_TITLE_LENGTH:
        raise GroupMembersInvalid(f"群组名称最多 {MAX_TITLE_LENGTH} 个字")
    return title or None


def _check_member_count(ids: Sequence[str]) -> None:
    if not MIN_MEMBERS <= len(ids) <= MAX_MEMBERS:
        raise GroupMembersInvalid("群组必须有 2 至 5 位成员")


def _insert_group(
    db: sqlite3.Connection,
    group: GroupConversation,
    ids: Sequence[str],
    snapshots: Mapping[str, str],
) -> None:
    db.execute(
        "INSERT INTO group_conversations(id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (group.id, group.user_id, group.title, group.created_at, group.updated_at),
    )
    db.executemany(
        "INSERT INTO group_members(group_id, character_id, position, added_at, name_snapshot) VALUES (?, ?, ?, ?, ?)",
        ((group.id, character_id, position, group.created_at, snapshots[character_id])
         for position, character_id in enumerate(ids)),
    )


def _rows(db: sqlite3.Connection, group_id: str) -> tuple[tuple[GroupMember, ...], GroupMessageSummary | None]:
    members = tuple(
        GroupMember(row["character_id"], row["position"], row["added_at"], row["removed_at"], row["name_snapshot"])
        for row in by_name(db).execute(
            "SELECT character_id, position, added_at, removed_at, name_snapshot "
            "FROM group_members WHERE group_id = ? ORDER BY position", (group_id,)
        )
    )
    row = by_name(db).execute(
        "SELECT id, author_kind, author_character_id, author_name_snapshot, text, created_at "
        "FROM group_messages WHERE group_id = ? ORDER BY id DESC LIMIT 1", (group_id,)
    ).fetchone()
    last = None if row is None else GroupMessageSummary(
        row["id"], row["author_kind"], row["author_character_id"], row["author_name_snapshot"],
        row["text"], row["created_at"],
    )
    return members, last


def _group(db: sqlite3.Connection, group_id: str, user_id: str) -> GroupConversation | None:
    cursor = by_name(db)
    row = cursor.execute(
        "SELECT id, user_id, title, created_at, updated_at FROM group_conversations "
        "WHERE id = ? AND user_id = ?", (group_id, user_id),
    ).fetchone()
    if row is None:
        return None
    members, last = _rows(db, group_id)
    return GroupConversation(row["id"], row["user_id"], row["title"], row["created_at"], row["updated_at"], members, last)


def _groups(db: sqlite3.Connection, user_id: str) -> list[GroupConversation]:
    rows = by_name(db).execute(
        "SELECT id, user_id, title, created_at, updated_at FROM group_conversations "
        "WHERE user_id = ? ORDER BY updated_at DESC, id DESC", (user_id,)
    ).fetchall()
    return [
        GroupConversation(row["id"], row["user_id"], row["title"], row["created_at"], row["updated_at"], *_rows(db, row["id"]))
        for row in rows
    ]


def _update_group(
    db: sqlite3.Connection,
    user_id: str,
    group_id: str,
    title: str | None,
    adding: Sequence[str],
    removing: Sequence[str],
    names: Mapping[str, str],
    title_given: bool,
) -> None:
    cursor = by_name(db)
    if cursor.execute("SELECT 1 FROM group_conversations WHERE id = ? AND user_id = ?", (group_id, user_id)).fetchone() is None:
        raise GroupNotFound
    rows = cursor.execute(
        "SELECT character_id, position, removed_at FROM group_members WHERE group_id = ?", (group_id,)
    ).fetchall()
    active = {row["character_id"] for row in rows if row["removed_at"] is None}
    if any(character_id not in active for character_id in removing):
        raise GroupMemberNotFound("要移除的成员不在群组中")
    if any(character_id in active for character_id in adding):
        raise GroupMembersInvalid("成员已经在群组中")
    result = active - set(removing) | set(adding)
    _check_member_count(tuple(result))
    now = _now()
    for character_id in removing:
        db.execute(
            "UPDATE group_members SET removed_at = ? "
            "WHERE group_id = ? AND character_id = ? AND removed_at IS NULL",
            (now, group_id, character_id),
        )
    next_position = max((row["position"] for row in rows), default=-1) + 1
    for character_id in adding:
        db.execute(
            "INSERT INTO group_members(group_id, character_id, position, added_at, name_snapshot) VALUES (?, ?, ?, ?, ?)",
            (group_id, character_id, next_position, now, names.get(character_id, character_id)),
        )
        next_position += 1
    db.execute(
        "UPDATE group_conversations SET title = CASE WHEN ? THEN ? ELSE title END, updated_at = ? WHERE id = ?",
        (title_given, title, now, group_id),
    )


def _delete_group(db: sqlite3.Connection, user_id: str, group_id: str) -> bool:
    if db.execute("SELECT 1 FROM group_conversations WHERE id = ? AND user_id = ?", (group_id, user_id)).fetchone() is None:
        return False
    delete_group_data(db, group_id)
    return True
