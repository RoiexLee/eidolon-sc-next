"""Persistence for group conversations.

Group conversations have their own tables and lifecycle.  This module deliberately does
not share the single-character ``Store`` records: a removed character must remain readable
as the author of old group messages.
"""

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from collections.abc import Mapping, Sequence

from eidolon.data_access import Database
from eidolon.database import by_name, delete_group_data
from eidolon.reply_format import Segment
from eidolon.delivery_cues import without_cues

MIN_MEMBERS = 2
MAX_MEMBERS = 5
MAX_TITLE_LENGTH = 100

_SCHEMA = """
CREATE TABLE IF NOT EXISTS group_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_id TEXT,
    source_created_at TEXT
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
    status TEXT NOT NULL,
    request_fingerprint TEXT
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
class GroupMessage:
    id: int
    group_id: str
    turn_id: str | None
    author_kind: str
    author_character_id: str | None
    author_name_snapshot: str | None
    text: str | None
    ja: str | None
    zh: str | None
    segments: list[Segment]
    created_at: str
    reply_to_message_id: int | None
    mentions: tuple[str, ...]

    def shown(self) -> dict:
        segments = [
            {"ja": without_cues(segment.ja), "zh": without_cues(segment.zh)}
            for segment in self.segments
        ]
        return {
            "id": self.id,
            "group_id": self.group_id,
            "turn_id": self.turn_id,
            "author_kind": self.author_kind,
            "author_character_id": self.author_character_id,
            "author_name_snapshot": self.author_name_snapshot,
            "text": self.text,
            "ja": None if self.ja is None else without_cues(self.ja),
            "zh": None if self.zh is None else without_cues(self.zh),
            "segments": segments,
            "created_at": self.created_at,
            "reply_to_message_id": self.reply_to_message_id,
            "mentions": list(self.mentions),
        }


@dataclass(frozen=True)
class GroupTurn:
    id: str
    group_id: str
    client_idempotency_key: str | None
    started_at: str
    ended_at: str | None
    status: str
    request_fingerprint: str | None = None


@dataclass(frozen=True)
class GroupPackage:
    """A complete, user-scoped group snapshot used by data packages."""

    id: str
    created_at: str
    updated_at: str
    title: str | None
    members: tuple[GroupMember, ...]
    messages: tuple[GroupMessage, ...]
    turns: tuple[GroupTurn, ...]


class GroupTurnBusy(RuntimeError):
    """A different group turn is already being generated."""


class GroupTurnConflict(RuntimeError):
    """An idempotency key belongs to a different request or completed turn."""


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


def round_robin_member(
    current_members: Sequence[GroupMember], messages: Sequence[GroupMessage]
) -> GroupMember:
    """Choose the next current member after the latest user's primary speaker."""
    if not current_members:
        raise GroupMembersInvalid("群组必须有 2 至 5 位成员")
    by_id = {member.character_id: member for member in current_members}
    previous_id = None
    user_indexes = [index for index, message in enumerate(messages) if message.author_kind == "user"]
    if user_indexes:
        for message in messages[user_indexes[-1] + 1 :]:
            if message.author_kind == "character" and message.author_character_id is not None:
                previous_id = message.author_character_id
                break
    else:
        previous_id = next(
            (
                message.author_character_id
                for message in reversed(messages)
                if message.author_kind == "character" and message.author_character_id is not None
            ),
            None,
        )
    if previous_id not in by_id:
        return current_members[0]
    previous_index = next(
        index for index, member in enumerate(current_members) if member.character_id == previous_id
    )
    return current_members[(previous_index + 1) % len(current_members)]


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

    async def messages(self, user_id: str, group_id: str) -> list[GroupMessage]:
        return await self._db.read(_messages, user_id, group_id)

    async def message(self, user_id: str, group_id: str, message_id: int) -> GroupMessage | None:
        return await self._db.read(_message, user_id, group_id, message_id)

    async def start_turn(
        self, user_id: str, group_id: str, client_idempotency_key: str | None = None,
        request_fingerprint: str | None = None,
    ) -> GroupTurn:
        return await self._db.write(
            _start_turn, user_id, group_id, client_idempotency_key, request_fingerprint
        )

    async def finish_turn(
        self,
        turn_id: str,
        text: str,
        target: GroupMember,
        reply: list[Segment],
        *,
        reply_to_message_id: int | None = None,
        mentions: Sequence[str] = (),
        finalize: bool = True,
    ) -> tuple[GroupMessage, GroupMessage]:
        return await self._db.write(
            _finish_turn, turn_id, text, target, reply, reply_to_message_id, tuple(mentions), finalize
        )

    async def append_character_message(
        self,
        turn_id: str,
        target: GroupMember,
        reply: list[Segment],
        *,
        reply_to_message_id: int | None = None,
        mentions: Sequence[str] = (),
    ) -> GroupMessage:
        """Record one bounded follow-up after the primary message is persisted."""
        return await self._db.write(
            _append_character_message, turn_id, target, reply, reply_to_message_id, tuple(mentions)
        )

    async def complete_turn(self, turn_id: str) -> None:
        await self._db.write(_complete_turn, turn_id)

    async def fail_turn(self, turn_id: str) -> None:
        await self._db.write(_fail_turn, turn_id)

    async def turn_for_key(
        self, user_id: str, group_id: str, client_idempotency_key: str
    ) -> GroupTurn | None:
        return await self._db.read(_turn_for_key, user_id, group_id, client_idempotency_key)

    def package_groups(self, db: sqlite3.Connection, user_id: str) -> list[GroupPackage]:
        """Read package snapshots on a caller-owned database connection."""
        return _package_groups(db, user_id)

    def write_package(
        self, db: sqlite3.Connection, user_id: str, groups: Sequence[GroupPackage], now: str
    ) -> int:
        """Write package snapshots in the caller's transaction and return new groups."""
        return _write_package(db, user_id, groups, now)


def _open(db: sqlite3.Connection) -> None:
    db.executescript(_SCHEMA)
    columns = {row[1] for row in db.execute("PRAGMA table_info(group_conversations)")}
    if "source_id" not in columns:
        db.execute("ALTER TABLE group_conversations ADD COLUMN source_id TEXT")
    if "source_created_at" not in columns:
        db.execute("ALTER TABLE group_conversations ADD COLUMN source_created_at TEXT")
    columns = {row[1] for row in db.execute("PRAGMA table_info(group_turns)")}
    if "request_fingerprint" not in columns:
        db.execute("ALTER TABLE group_turns ADD COLUMN request_fingerprint TEXT")
    # A model stream cannot survive a process restart, so do not leave its lease blocking
    # the group forever.
    db.execute(
        "UPDATE group_turns SET ended_at = ?, status = 'failed' WHERE status = 'running'",
        (_now(),),
    )


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
    if cursor.execute(
        "SELECT 1 FROM group_turns WHERE group_id = ? AND status = 'running' LIMIT 1", (group_id,)
    ).fetchone() is not None:
        raise GroupTurnBusy("群组正在回复，请稍后再试")
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
    if db.execute(
        "SELECT 1 FROM group_turns WHERE group_id = ? AND status = 'running' LIMIT 1", (group_id,)
    ).fetchone() is not None:
        raise GroupTurnBusy("群组正在回复，请稍后再试")
    delete_group_data(db, group_id)
    return True


def _decode_message(row: sqlite3.Row) -> GroupMessage:
    raw_segments = json.loads(row["segments"] or "[]")
    return GroupMessage(
        row["id"], row["group_id"], row["turn_id"], row["author_kind"],
        row["author_character_id"], row["author_name_snapshot"], row["text"],
        row["ja"], row["zh"], [Segment(**segment) for segment in raw_segments],
        row["created_at"], row["reply_to_message_id"],
        tuple(json.loads(row["mentions"] or "[]")),
    )


def _messages(db: sqlite3.Connection, user_id: str, group_id: str) -> list[GroupMessage]:
    if db.execute(
        "SELECT 1 FROM group_conversations WHERE id = ? AND user_id = ?", (group_id, user_id)
    ).fetchone() is None:
        raise GroupNotFound
    rows = by_name(db).execute(
        "SELECT id, group_id, turn_id, author_kind, author_character_id, author_name_snapshot, "
        "text, ja, zh, segments, created_at, reply_to_message_id, mentions "
        "FROM group_messages WHERE group_id = ? ORDER BY id", (group_id,)
    ).fetchall()
    return [_decode_message(row) for row in rows]


def _message(
    db: sqlite3.Connection, user_id: str, group_id: str, message_id: int
) -> GroupMessage | None:
    if db.execute(
        "SELECT 1 FROM group_conversations WHERE id = ? AND user_id = ?", (group_id, user_id)
    ).fetchone() is None:
        raise GroupNotFound
    row = by_name(db).execute(
        "SELECT id, group_id, turn_id, author_kind, author_character_id, author_name_snapshot, "
        "text, ja, zh, segments, created_at, reply_to_message_id, mentions "
        "FROM group_messages WHERE group_id = ? AND id = ?", (group_id, message_id)
    ).fetchone()
    return None if row is None else _decode_message(row)


def _start_turn(
    db: sqlite3.Connection, user_id: str, group_id: str, client_key: str | None,
    request_fingerprint: str | None,
) -> GroupTurn:
    cursor = by_name(db)
    if cursor.execute(
        "SELECT 1 FROM group_conversations WHERE id = ? AND user_id = ?", (group_id, user_id)
    ).fetchone() is None:
        raise GroupNotFound
    if client_key is not None:
        row = cursor.execute(
            "SELECT id, group_id, client_idempotency_key, started_at, ended_at, status, request_fingerprint "
            "FROM group_turns WHERE group_id = ? AND client_idempotency_key = ?",
            (group_id, client_key),
        ).fetchone()
        if row is not None:
            if row["request_fingerprint"] != request_fingerprint:
                raise GroupTurnConflict("幂等键已经用于另一条群组回合")
            if row["status"] == "running":
                raise GroupTurnBusy("群组正在回复，请稍后再试")
            return GroupTurn(*row)
    row = cursor.execute(
        "SELECT id FROM group_turns WHERE group_id = ? AND status = 'running' LIMIT 1", (group_id,)
    ).fetchone()
    if row is not None:
        raise GroupTurnBusy("群组正在回复，请稍后再试")
    now = _now()
    turn_id = uuid.uuid4().hex
    cursor.execute(
        "INSERT INTO group_turns(id, group_id, client_idempotency_key, started_at, status) "
        "VALUES (?, ?, ?, ?, 'running')", (turn_id, group_id, client_key, now)
    )
    if request_fingerprint is not None:
        cursor.execute(
            "UPDATE group_turns SET request_fingerprint = ? WHERE id = ?",
            (request_fingerprint, turn_id),
        )
    return GroupTurn(turn_id, group_id, client_key, now, None, "running", request_fingerprint)


def _finish_turn(
    db: sqlite3.Connection,
    turn_id: str,
    text: str,
    target: GroupMember,
    reply: list[Segment],
    reply_to_message_id: int | None,
    mentions: Sequence[str],
    finalize: bool,
) -> tuple[GroupMessage, GroupMessage]:
    cursor = by_name(db)
    turn = cursor.execute(
        "SELECT id, group_id, status FROM group_turns WHERE id = ?", (turn_id,)
    ).fetchone()
    if turn is None or turn["status"] != "running":
        raise GroupTurnConflict("群组回合已经结束")
    now = _now()
    user_cursor = cursor.execute(
        "INSERT INTO group_messages(group_id, turn_id, author_kind, text, created_at, "
        "reply_to_message_id, mentions) VALUES (?, ?, 'user', ?, ?, ?, ?)",
        (turn["group_id"], turn_id, text, now, reply_to_message_id, json.dumps(list(mentions))),
    )
    assert user_cursor.lastrowid is not None
    user = GroupMessage(
        user_cursor.lastrowid, turn["group_id"], turn_id, "user", None, None, text,
        None, None, [], now, reply_to_message_id, tuple(mentions),
    )
    ja = "".join(segment.ja for segment in reply)
    zh = "".join(segment.zh for segment in reply)
    character_cursor = cursor.execute(
        "INSERT INTO group_messages(group_id, turn_id, author_kind, author_character_id, "
        "author_name_snapshot, ja, zh, segments, created_at, mentions) "
        "VALUES (?, ?, 'character', ?, ?, ?, ?, ?, ?, ?)",
        (
            turn["group_id"], turn_id, target.character_id, target.name_snapshot, ja, zh,
            json.dumps([{"ja": segment.ja, "zh": segment.zh} for segment in reply], ensure_ascii=False),
            now, json.dumps(list(mentions)),
        ),
    )
    assert character_cursor.lastrowid is not None
    character = GroupMessage(
        character_cursor.lastrowid, turn["group_id"], turn_id, "character", target.character_id,
        target.name_snapshot, None, ja, zh, reply, now, None, tuple(mentions),
    )
    if finalize:
        cursor.execute(
            "UPDATE group_turns SET ended_at = ?, status = 'done' WHERE id = ?", (now, turn_id)
        )
    cursor.execute(
        "UPDATE group_conversations SET updated_at = ? WHERE id = ?", (now, turn["group_id"])
    )
    return user, character


def _fail_turn(db: sqlite3.Connection, turn_id: str) -> None:
    db.execute(
        "UPDATE group_turns SET ended_at = ?, status = 'failed' "
        "WHERE id = ? AND status = 'running'", (_now(), turn_id)
    )


def _append_character_message(
    db: sqlite3.Connection,
    turn_id: str,
    target: GroupMember,
    reply: list[Segment],
    reply_to_message_id: int | None,
    mentions: Sequence[str],
) -> GroupMessage:
    cursor = by_name(db)
    turn = cursor.execute(
        "SELECT id, group_id, status FROM group_turns WHERE id = ?", (turn_id,)
    ).fetchone()
    if turn is None or turn["status"] != "running":
        raise GroupTurnConflict("群组回合还在生成主回复或已经结束")
    now = _now()
    ja = "".join(segment.ja for segment in reply)
    zh = "".join(segment.zh for segment in reply)
    message_cursor = cursor.execute(
        "INSERT INTO group_messages(group_id, turn_id, author_kind, author_character_id, "
        "author_name_snapshot, ja, zh, segments, created_at, reply_to_message_id, mentions) "
        "VALUES (?, ?, 'character', ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            turn["group_id"], turn_id, target.character_id, target.name_snapshot, ja, zh,
            json.dumps([{"ja": segment.ja, "zh": segment.zh} for segment in reply], ensure_ascii=False),
            now, reply_to_message_id, json.dumps(list(mentions)),
        ),
    )
    assert message_cursor.lastrowid is not None
    cursor.execute(
        "UPDATE group_conversations SET updated_at = ? WHERE id = ?",
        (now, turn["group_id"]),
    )
    cursor.execute(
        "UPDATE group_turns SET ended_at = ?, status = 'done' "
        "WHERE id = ? AND status = 'running'",
        (now, turn_id),
    )
    return GroupMessage(
        message_cursor.lastrowid, turn["group_id"], turn_id, "character",
        target.character_id, target.name_snapshot, None, ja, zh, reply, now,
        reply_to_message_id, tuple(mentions),
    )


def _complete_turn(db: sqlite3.Connection, turn_id: str) -> None:
    db.execute(
        "UPDATE group_turns SET ended_at = ?, status = 'done' "
        "WHERE id = ? AND status = 'running'", (_now(), turn_id)
    )


def _turn_for_key(
    db: sqlite3.Connection, user_id: str, group_id: str, client_key: str
) -> GroupTurn | None:
    row = by_name(db).execute(
        "SELECT t.id, t.group_id, t.client_idempotency_key, t.started_at, t.ended_at, "
        "t.status, t.request_fingerprint FROM group_turns t "
        "JOIN group_conversations g ON g.id = t.group_id "
        "WHERE t.group_id = ? AND g.user_id = ? AND t.client_idempotency_key = ?",
        (group_id, user_id, client_key),
    ).fetchone()
    return None if row is None else GroupTurn(*row)


def _package_groups(db: sqlite3.Connection, user_id: str) -> list[GroupPackage]:
    """Read groups and their ended turns/messages without exposing SQL to callers."""
    cursor = by_name(db)
    groups = cursor.execute(
        "SELECT id, title, created_at, updated_at FROM group_conversations "
        "WHERE user_id = ? ORDER BY created_at, id", (user_id,)
    ).fetchall()
    result: list[GroupPackage] = []
    for group in groups:
        members = tuple(
            GroupMember(row["character_id"], row["position"], row["added_at"], row["removed_at"], row["name_snapshot"])
            for row in cursor.execute(
                "SELECT character_id, position, added_at, removed_at, name_snapshot "
                "FROM group_members WHERE group_id = ? ORDER BY position, id", (group["id"],)
            )
        )
        turns = tuple(
            GroupTurn(*row)
            for row in cursor.execute(
                "SELECT id, group_id, client_idempotency_key, started_at, ended_at, status, request_fingerprint "
                "FROM group_turns WHERE group_id = ? AND status <> 'running' AND ended_at IS NOT NULL "
                "ORDER BY started_at, id", (group["id"],)
            )
        )
        ended = {turn.id for turn in turns}
        rows = cursor.execute(
            "SELECT id, group_id, turn_id, author_kind, author_character_id, author_name_snapshot, "
            "text, ja, zh, segments, created_at, reply_to_message_id, mentions "
            "FROM group_messages WHERE group_id = ? ORDER BY id", (group["id"],)
        ).fetchall()
        messages = tuple(
            _decode_message(row)
            for row in rows
            if row["turn_id"] is None or row["turn_id"] in ended
        )
        result.append(GroupPackage(
            group["id"], group["created_at"], group["updated_at"], group["title"],
            members, messages, turns,
        ))
    return result


def _write_package(
    db: sqlite3.Connection, user_id: str, groups: Sequence[GroupPackage], now: str
) -> int:
    """Insert package groups, remapping every database id and preserving source identity."""
    added = 0
    cursor = by_name(db)
    for group in groups:
        if cursor.execute(
            "SELECT 1 FROM group_conversations WHERE user_id = ? AND source_id = ? "
            "AND source_created_at = ? LIMIT 1",
            (user_id, group.id, group.created_at),
        ).fetchone() is not None:
            continue
        current = [member for member in group.members if member.removed_at is None]
        _check_member_count(tuple(member.character_id for member in current))
        new_group_id = uuid.uuid4().hex
        cursor.execute(
            "INSERT INTO group_conversations(id, user_id, title, created_at, updated_at, source_id, source_created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (new_group_id, user_id, group.title, group.created_at, group.updated_at, group.id, group.created_at),
        )
        cursor.executemany(
            "INSERT INTO group_members(group_id, character_id, position, added_at, removed_at, name_snapshot) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ((new_group_id, member.character_id, member.position, member.added_at, member.removed_at, member.name_snapshot)
             for member in group.members),
        )
        turn_ids: dict[str, str] = {}
        for turn in group.turns:
            new_turn_id = uuid.uuid4().hex
            turn_ids[turn.id] = new_turn_id
            status = "failed" if turn.status == "running" else turn.status
            ended_at = turn.ended_at or now
            cursor.execute(
                "INSERT INTO group_turns(id, group_id, client_idempotency_key, started_at, ended_at, status, request_fingerprint) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (new_turn_id, new_group_id, turn.client_idempotency_key, turn.started_at, ended_at,
                 status, turn.request_fingerprint),
            )
        message_ids: dict[int, int] = {}
        for message in group.messages:
            message_turn = None if message.turn_id is None else turn_ids.get(message.turn_id)
            reply_to = None if message.reply_to_message_id is None else message_ids.get(message.reply_to_message_id)
            segments = json.dumps(
                [{"ja": segment.ja, "zh": segment.zh} for segment in message.segments],
                ensure_ascii=False,
            )
            inserted = cursor.execute(
                "INSERT INTO group_messages(group_id, turn_id, author_kind, author_character_id, author_name_snapshot, "
                "text, ja, zh, segments, created_at, reply_to_message_id, mentions) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (new_group_id, message_turn, message.author_kind, message.author_character_id,
                 message.author_name_snapshot, message.text, message.ja, message.zh, segments,
                 message.created_at, reply_to, json.dumps(list(message.mentions), ensure_ascii=False)),
            )
            assert inserted.lastrowid is not None
            message_ids[message.id] = inserted.lastrowid
        added += 1
    return added
