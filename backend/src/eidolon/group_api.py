"""The lifecycle API for group conversations.

Messages and turns intentionally have no routes yet; this module only serves the group
itself and its members.
"""

from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from eidolon.assembly import Backend
from eidolon.group_store import (
    GroupConversation,
    GroupMember,
    GroupMemberNotFound,
    GroupMembersInvalid,
    GroupNotFound,
    MAX_MEMBERS,
    MAX_TITLE_LENGTH,
    MIN_MEMBERS,
)
from eidolon.sessions import UserId


class NewGroup(BaseModel):
    character_ids: list[str] = Field(min_length=MIN_MEMBERS, max_length=MAX_MEMBERS)
    title: str | None = Field(None, max_length=MAX_TITLE_LENGTH)


class GroupPatch(BaseModel):
    title: str | None = Field(None, max_length=MAX_TITLE_LENGTH)
    add_character_ids: list[str] = Field(default_factory=list, max_length=MAX_MEMBERS)
    remove_character_ids: list[str] = Field(default_factory=list, max_length=MAX_MEMBERS)


def add_group_routes(app: FastAPI, backend: Backend) -> None:
    groups, characters = backend.group_store, backend.characters

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

    @app.patch("/api/groups/{group_id}")
    async def update_group(group_id: str, body: GroupPatch, user_id: UserId) -> dict:
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
        except GroupMembersInvalid as error:
            raise HTTPException(422, str(error)) from None
        return shown(await group_or_404(group_id, user_id))

    @app.delete("/api/groups/{group_id}", status_code=204)
    async def delete_group(group_id: str, user_id: UserId) -> None:
        if not await groups.delete_group(user_id, group_id):
            raise HTTPException(404, "群组不存在")
