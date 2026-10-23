"""Group conversation lifecycle: persistence and its user-scoped HTTP API."""

import sqlite3

import pytest

from eidolon.data_access import Database
from eidolon.group_store import GroupStore
from eidolon.store import Store
from tests.conftest import ClientFactory
from tests.fakes import FakeLLM


async def test_group_lifecycle_and_user_isolation(make_client: ClientFactory) -> None:
    client = make_client(FakeLLM())
    other = make_client(FakeLLM(), "other")

    created = await client.post(
        "/api/groups", json={"character_ids": ["mano", "kogane"], "title": "两位朋友"}
    )
    assert created.status_code == 201, created.text
    group = created.json()
    assert [member["character_id"] for member in group["current_members"]] == ["mano", "kogane"]
    assert [member["name_snapshot"] for member in group["current_members"]] == ["櫻木真乃", "月岡恋鐘"]

    group_id = group["id"]
    assert (await other.get(f"/api/groups/{group_id}")).status_code == 404
    assert (await other.patch(f"/api/groups/{group_id}", json={"title": "越权"})).status_code == 404
    assert (await other.delete(f"/api/groups/{group_id}")).status_code == 404

    removed = await client.patch(
        f"/api/groups/{group_id}", json={"remove_character_ids": ["mano"]}
    )
    assert removed.status_code == 422, removed.text
    assert (await client.get(f"/api/groups/{group_id}")).json()["current_members"]

    deleted = await client.delete(f"/api/groups/{group_id}")
    assert deleted.status_code == 204
    assert (await client.get(f"/api/groups/{group_id}")).status_code == 404


async def test_group_store_accepts_two_to_five_and_keeps_removed_snapshots(
    make_client: ClientFactory,
) -> None:
    client = make_client(FakeLLM())
    backend = client._transport.app.state.backend  # type: ignore[attr-defined]
    user_id = (await backend.store.first_user_named("producer")).id
    ids = [f"character-{i}" for i in range(5)]
    group = await backend.group_store.create_group(
        user_id, ids, names={character_id: f"角色 {i}" for i, character_id in enumerate(ids)}
    )
    assert [member.character_id for member in group.current_members] == ids

    await backend.group_store.update_group(user_id, group.id, remove=[ids[1]])
    found = await backend.group_store.get_group(group.id, user_id)
    assert found is not None
    assert [member.character_id for member in found.current_members] == [ids[0], *ids[2:]]
    removed = next(member for member in found.history_members if member.character_id == ids[1])
    assert removed.name_snapshot == "角色 1"

    await backend.group_store.update_group(user_id, group.id, add=[ids[1]])
    found = await backend.group_store.get_group(group.id, user_id)
    assert found is not None
    assert [member.character_id for member in found.current_members][-1] == ids[1]
    assert [member.character_id for member in found.history_members].count(ids[1]) == 1


async def test_group_title_can_be_cleared(make_client: ClientFactory) -> None:
    client = make_client(FakeLLM())
    created = await client.post(
        "/api/groups", json={"character_ids": ["mano", "kogane"], "title": "临时名称"}
    )
    group_id = created.json()["id"]
    cleared = await client.patch(f"/api/groups/{group_id}", json={"title": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["title"] is None


async def test_group_tables_are_added_to_an_existing_single_chat_database(tmp_path) -> None:
    database = Database(tmp_path / "old.db")
    try:
        user = await Store(database).create_user("producer")
        group = await GroupStore(database).create_group(user.id, ["one", "two"])
        assert group.current_members
    finally:
        await database.close()


async def test_group_api_enforces_member_count(make_client: ClientFactory) -> None:
    client = make_client(FakeLLM())
    for character_ids in (["mano"], ["mano", "kogane", "one", "two", "three", "four"]):
        response = await client.post("/api/groups", json={"character_ids": character_ids})
        assert response.status_code == 422


async def test_group_store_rejects_member_count_and_unknown_api_character(
    make_client: ClientFactory,
) -> None:
    client = make_client(FakeLLM())
    backend = client._transport.app.state.backend  # type: ignore[attr-defined]
    user_id = (await backend.store.first_user_named("producer")).id

    for ids in (["one"], [f"character-{i}" for i in range(6)]):
        with pytest.raises(ValueError):
            await backend.group_store.create_group(user_id, ids)

    response = await client.post(
        "/api/groups", json={"character_ids": ["mano", "missing-character"]}
    )
    assert response.status_code == 404


async def test_group_rows_are_removed_with_account_and_group(
    make_client: ClientFactory,
    settings,
) -> None:
    client = make_client(FakeLLM())
    backend = client._transport.app.state.backend  # type: ignore[attr-defined]
    user_id = (await backend.store.first_user_named("producer")).id
    group = await backend.group_store.create_group(user_id, ["mano", "kogane"])

    def rows(db: sqlite3.Connection) -> None:
        db.execute(
            "INSERT INTO group_turns(id, group_id, started_at, status) VALUES ('turn', ?, 'now', 'done')",
            (group.id,),
        )
        db.execute(
            "INSERT INTO group_messages(group_id, author_kind, text, created_at) VALUES (?, 'user', 'hello', 'now')",
            (group.id,),
        )

    await backend.database.write(rows)
    assert await backend.group_store.delete_group(user_id, group.id)
    with sqlite3.connect(settings.database_path) as db:
        assert db.execute("SELECT COUNT(*) FROM group_conversations").fetchone() == (0,)
        assert db.execute("SELECT COUNT(*) FROM group_members").fetchone() == (0,)
        assert db.execute("SELECT COUNT(*) FROM group_messages").fetchone() == (0,)
        assert db.execute("SELECT COUNT(*) FROM group_turns").fetchone() == (0,)

    # Recreate one and exercise the account deletion cleanup path.
    group = await backend.group_store.create_group(user_id, ["mano", "kogane"])
    await backend.database.write(rows)
    response = await client.post("/api/account/delete", json={"confirm": True})
    assert response.status_code == 204
    with sqlite3.connect(settings.database_path) as db:
        assert db.execute("SELECT COUNT(*) FROM group_conversations").fetchone() == (0,)
        assert db.execute("SELECT COUNT(*) FROM group_members").fetchone() == (0,)
        assert db.execute("SELECT COUNT(*) FROM group_messages").fetchone() == (0,)
        assert db.execute("SELECT COUNT(*) FROM group_turns").fetchone() == (0,)
