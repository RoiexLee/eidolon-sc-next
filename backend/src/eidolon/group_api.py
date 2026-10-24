"""The lifecycle and explicit-speaker text API for group conversations."""

import asyncio
import hashlib
import json
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import aclosing
from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from starlette.types import Receive, Scope, Send

from eidolon.activity import Result
from eidolon.assembly import Backend
from eidolon.account_api import OwnKeysInput
from eidolon.group_engine import (
    _GroupTurnPrimary,
    GroupSpeaker,
    GroupTurnDone,
    GroupTurnEngine,
    GroupTurnError,
    GroupTurnPartial,
    GroupUserSaid,
)
from eidolon.group_store import (
    GroupConversation,
    GroupMember,
    GroupMemberNotFound,
    GroupMembersInvalid,
    GroupNotFound,
    GroupTurnBusy,
    GroupTurnConflict,
    MAX_MEMBERS,
    MAX_TITLE_LENGTH,
    MIN_MEMBERS,
    round_robin_member,
)
from eidolon.own_keys import BroughtKeys
from eidolon.reply_format import SegmentDelta
from eidolon.engine import MAX_INPUT_LENGTH
from eidolon.sessions import UserId


class NewGroup(BaseModel):
    character_ids: list[str] = Field(min_length=MIN_MEMBERS, max_length=MAX_MEMBERS)
    title: str | None = Field(None, max_length=MAX_TITLE_LENGTH)


class GroupPatch(BaseModel):
    title: str | None = Field(None, max_length=MAX_TITLE_LENGTH)
    add_character_ids: list[str] = Field(default_factory=list, max_length=MAX_MEMBERS)
    remove_character_ids: list[str] = Field(default_factory=list, max_length=MAX_MEMBERS)


class GroupTurnInput(BaseModel):
    text: str
    reply_to_message_id: int | None = None
    mention_character_ids: list[str] = Field(default_factory=list, max_length=1)
    mention_all: bool = False
    client_idempotency_key: str | None = Field(None, max_length=200)
    own_keys: OwnKeysInput | None = None


def add_group_routes(app: FastAPI, backend: Backend) -> None:
    groups, characters = backend.group_store, backend.characters
    engine: GroupTurnEngine = backend.group_engine
    locks: dict[str, asyncio.Lock] = {}

    def member(member: GroupMember) -> dict:
        shown = asdict(member)
        shown["current"] = shown["removed_at"] is None
        shown["name"] = shown["name_snapshot"]
        return shown

    def shown(group: GroupConversation) -> dict:
        members = [member(m) for m in group.members]
        current = [member(m) for m in group.current_members]
        history = [member(m) for m in group.history_members]
        return {
            "id": group.id,
            "title": group.title,
            "created_at": group.created_at,
            "updated_at": group.updated_at,
            "members": members,
            "current_members": current,
            "history_members": history,
            "last_message": None if group.last_message is None else asdict(group.last_message),
        }

    def character_names(character_ids: list[str]) -> dict[str, str]:
        if len(set(character_ids)) != len(character_ids):
            raise HTTPException(422, "群组成员不能重复")
        missing = [character_id for character_id in character_ids if character_id not in characters]
        if missing:
            raise HTTPException(404, f"角色不存在：{missing[0]}")
        return {character_id: characters[character_id].name for character_id in character_ids}

    async def group_or_404(group_id: str, user_id: str) -> GroupConversation:
        group = await groups.get_group(group_id, user_id)
        if group is None:
            raise HTTPException(404, "群组不存在")
        return group

    def lock_for(group_id: str) -> asyncio.Lock:
        return locks.setdefault(group_id, asyncio.Lock())

    @app.post("/api/groups", status_code=201)
    async def create_group(body: NewGroup, user_id: UserId) -> dict:
        names = character_names(body.character_ids)
        try:
            group = await groups.create_group(user_id, body.character_ids, body.title, names)
        except GroupMembersInvalid as error:
            raise HTTPException(422, str(error)) from None
        return shown(group)

    @app.get("/api/groups")
    async def list_groups(user_id: UserId) -> list[dict]:
        return [shown(group) for group in await groups.list_groups(user_id)]

    @app.get("/api/groups/{group_id}")
    async def get_group(group_id: str, user_id: UserId) -> dict:
        return shown(await group_or_404(group_id, user_id))

    @app.get("/api/groups/{group_id}/messages")
    async def list_group_messages(group_id: str, user_id: UserId) -> list[dict]:
        await group_or_404(group_id, user_id)
        return [message.shown() for message in await groups.messages(user_id, group_id)]

    @app.patch("/api/groups/{group_id}")
    async def update_group(group_id: str, body: GroupPatch, user_id: UserId) -> dict:
        async with lock_for(group_id):
            await group_or_404(group_id, user_id)
            adding = body.add_character_ids
            removing = body.remove_character_ids
            names = character_names(adding) if adding else {}
            try:
                await groups.update_group(
                    user_id,
                    group_id,
                    title=body.title if "title" in body.model_fields_set else None,
                    set_title="title" in body.model_fields_set,
                    add=adding,
                    remove=removing,
                    names=names,
                )
            except GroupNotFound:
                raise HTTPException(404, "群组不存在") from None
            except GroupMemberNotFound as error:
                raise HTTPException(404, str(error)) from None
            except GroupTurnBusy as error:
                raise HTTPException(409, str(error)) from None
            except GroupMembersInvalid as error:
                raise HTTPException(422, str(error)) from None
        return shown(await group_or_404(group_id, user_id))

    @app.delete("/api/groups/{group_id}", status_code=204)
    async def delete_group(group_id: str, user_id: UserId) -> None:
        async with lock_for(group_id):
            try:
                if not await groups.delete_group(user_id, group_id):
                    raise HTTPException(404, "群组不存在")
            except GroupTurnBusy as error:
                raise HTTPException(409, str(error)) from None

    @app.post("/api/groups/{group_id}/turns")
    async def group_turn(group_id: str, body: GroupTurnInput, user_id: UserId) -> StreamingResponse:
        await group_or_404(group_id, user_id)
        text = body.text.strip()
        if not text:
            raise HTTPException(422, "没有收到要说的话。")
        if len(text) > MAX_INPUT_LENGTH:
            raise HTTPException(422, f"这句话太长了，最多 {MAX_INPUT_LENGTH} 字。")
        mentions = tuple(dict.fromkeys(body.mention_character_ids))
        if len(mentions) != len(body.mention_character_ids) or len(mentions) > 1:
            raise HTTPException(422, "一次只能指定一位群组成员")
        if body.mention_all and mentions:
            raise HTTPException(422, "不能同时指定全体成员和单个成员")
        reference = None
        if body.reply_to_message_id is not None:
            reference = await groups.message(user_id, group_id, body.reply_to_message_id)
            if reference is None:
                raise HTTPException(422, "引用消息不属于该群组")
            if reference.author_kind != "character" or reference.author_character_id is None:
                raise HTTPException(422, "只能引用角色消息")
        if body.mention_all and reference is not None:
            raise HTTPException(422, "全体成员不能与引用同时使用")
        requested_target_id = None if body.mention_all else (mentions[0] if mentions else (
            reference.author_character_id if reference is not None else None
        ))
        if reference is not None and mentions and reference.author_character_id != mentions[0]:
            raise HTTPException(422, "引用消息和指定角色不一致")
        if requested_target_id is not None and requested_target_id not in characters:
            raise HTTPException(422, "目标角色不是当前群组成员")
        client_key = body.client_idempotency_key.strip() if body.client_idempotency_key else None
        fingerprint_parts: list[object] = [text, requested_target_id, body.reply_to_message_id, list(mentions)]
        if body.mention_all:
            fingerprint_parts.append(True)
        fingerprint = hashlib.sha256(
            json.dumps(fingerprint_parts, ensure_ascii=False, separators=(",", ":")).encode()
        ).hexdigest()
        brought = body.own_keys.brought() if body.own_keys else BroughtKeys()
        target: GroupMember | None = None
        targets: tuple[GroupMember, ...] | None = None
        async with lock_for(group_id):
            existing = (
                await groups.turn_for_key(user_id, group_id, client_key)
                if client_key is not None else None
            )
            if existing is not None:
                if existing.request_fingerprint != fingerprint:
                    raise HTTPException(409, "幂等键已经用于另一条群组回合")
                if existing.status == "running":
                    raise HTTPException(409, "群组正在回复，请稍后再试")
                if existing.status == "failed":
                    raise HTTPException(409, "上一次群组回合失败，请使用新的幂等键重试")
                turn = existing
                group = await group_or_404(group_id, user_id)
                admission = None
            else:
                group = await group_or_404(group_id, user_id)
                current_members = group.current_members
                current = {member.character_id: member for member in current_members}
                if body.mention_all:
                    targets = tuple(current_members)
                    mentions = tuple(member.character_id for member in current_members)
                elif requested_target_id is None:
                    target = round_robin_member(current_members, await groups.messages(user_id, group_id))
                elif requested_target_id not in current:
                    raise HTTPException(422, "目标角色不是当前群组成员")
                else:
                    target = current[requested_target_id]
                if reference is not None and reference.author_character_id not in current:
                    raise HTTPException(422, "引用消息不属于当前群组成员")
                try:
                    turn = await groups.start_turn(user_id, group_id, client_key, fingerprint)
                except GroupTurnBusy as error:
                    raise HTTPException(409, str(error)) from None
                except GroupTurnConflict as error:
                    raise HTTPException(409, str(error)) from None
                try:
                    admission = await backend.admissions.group_turn(user_id, brought)
                except BaseException:
                    await groups.fail_turn(turn.id)
                    raise

        settled = False
        primary_committed = False
        turn_completed = turn.status == "done"

        async def settle(result: Result) -> None:
            nonlocal settled, turn_completed
            if settled:
                return
            settled = True
            if primary_committed:
                result = "success"
                if not turn_completed:
                    await groups.complete_turn(turn.id)
                    turn_completed = True
            elif result != "success":
                await groups.fail_turn(turn.id)
            if admission is not None:
                await admission.settle(result)  # type: ignore[union-attr]

        async def events() -> AsyncIterator[str]:
            nonlocal primary_committed
            try:
                if turn.status == "done":
                    messages = await groups.messages(user_id, group_id)
                    results = [m for m in messages if m.turn_id == turn.id and m.author_kind == "character"]
                    result = results[0] if results else None
                    if result is None:
                        raise RuntimeError("群组回合结果缺失")
                    yield _sse({"type": "user", "text": text})
                    for message in results:
                        yield _sse({"type": "speaker", "author_character_id": message.author_character_id, "author_name_snapshot": message.author_name_snapshot})
                    await settle("success")
                    yield _sse({
                        "type": "done",
                        "turn_id": turn.id,
                        "message": result.shown(),
                        "messages": [message.shown() for message in results],
                        "partial": False,
                    })
                    return
                assert target is not None or targets is not None
                async with aclosing(engine.turn(
                    group, target, turn, text, admission.llms,  # type: ignore[union-attr]
                    reply_to_message_id=body.reply_to_message_id, mentions=mentions,
                    targets=targets,
                )) as turn_events:
                    async for event in turn_events:
                        if isinstance(event, GroupUserSaid):
                            yield _sse({"type": "user", "text": event.text})
                        elif isinstance(event, GroupSpeaker):
                            yield _sse(asdict(event))
                        elif isinstance(event, SegmentDelta):
                            yield _sse(asdict(event))
                        elif isinstance(event, GroupTurnPartial):
                            yield _sse({
                                "type": "partial",
                                "message": event.message.shown(),
                                "messages": [event.message.shown()],
                                "error": event.error,
                            })
                        elif isinstance(event, _GroupTurnPrimary):
                            primary_committed = True
                        elif isinstance(event, GroupTurnDone):
                            await settle("success")
                            yield _sse({
                                "type": "done",
                                "turn_id": event.turn_id,
                                "message": event.message.shown(),
                                "messages": [message.shown() for message in event.messages] or [event.message.shown()],
                                "partial": event.partial,
                            })
                        elif isinstance(event, GroupTurnError):
                            await settle("failed")
                            yield _sse(asdict(event))
            except (asyncio.CancelledError, GeneratorExit):
                await settle("left")
                raise
            finally:
                if not settled:
                    await settle("failed")

        return _GroupTurnResponse(
            events(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            end=lambda: settle("left"),
        )


class _GroupTurnResponse(StreamingResponse):
    def __init__(
        self,
        events: AsyncIterator[str],
        *,
        end: Callable[[], Awaitable[None]],
        media_type: str | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(events, media_type=media_type, headers=headers)
        self._end = end

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            await self._end()


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
