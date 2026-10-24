"""Group conversation data package round trips."""

import io
import json
import zipfile
from copy import deepcopy
from copy import deepcopy
from dataclasses import replace

from tests.conftest import ClientFactory
from tests.fakes import FakeLLM


async def test_groups_export_import_and_repeat_is_idempotent(
    make_client: ClientFactory, settings, tmp_path
) -> None:
    source = make_client(FakeLLM(["<ja>你好</ja><zh>好</zh>"]))
    created = await source.post(
        "/api/groups", json={"character_ids": ["mano", "kogane"], "title": "朋友们"}
    )
    assert created.status_code == 201, created.text
    group_id = created.json()["id"]
    turn = await source.post(
        f"/api/groups/{group_id}/turns",
        json={"text": "一起吃饭吗", "mention_character_ids": ["mano"]},
    )
    assert turn.status_code == 200, turn.text
    package = (await source.get("/api/account/data-package", params={"include": "groups"})).content
    with zipfile.ZipFile(io.BytesIO(package)) as zipped:
        manifest = json.loads(zipped.read("manifest.json"))
        data = json.loads(zipped.read("data.json"))
    assert manifest["format"] == 3
    assert manifest["categories"] == ["groups"]
    assert manifest["counts"] == {"groups": 1}
    assert len(data["groups"][0]["messages"]) == 2
    assert data["groups"][0]["turns"][0]["status"] == "done"

    target = make_client(FakeLLM(), "other", settings=replace(settings, database_path=tmp_path / "other.db"))
    imported = await target.post(
        "/api/account/data-package?include=groups", content=package,
        headers={"content-type": "application/zip"},
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["groups"] == 1
    groups = (await target.get("/api/groups")).json()
    assert len(groups) == 1 and groups[0]["title"] == "朋友们"
    messages = (await target.get(f"/api/groups/{groups[0]['id']}/messages")).json()
    assert [message["author_kind"] for message in messages] == ["user", "character"]
    repeated = await target.post(
        "/api/account/data-package?include=groups", content=package,
        headers={"content-type": "application/zip"},
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["groups"] == 0
    assert len((await target.get("/api/groups")).json()) == 1


async def test_bad_group_references_and_members_reject_the_whole_package(
    make_client: ClientFactory, settings, tmp_path
) -> None:
    source = make_client(FakeLLM(["<ja>你好</ja><zh>好</zh>"]))
    created = await source.post("/api/groups", json={"character_ids": ["mano", "kogane"]})
    group_id = created.json()["id"]
    assert (await source.post(f"/api/groups/{group_id}/turns", json={"text": "x"})).status_code == 200
    package = (await source.get("/api/account/data-package", params={"include": "groups"})).content
    with zipfile.ZipFile(io.BytesIO(package)) as zipped:
        manifest = json.loads(zipped.read("manifest.json"))
        data = json.loads(zipped.read("data.json"))

    target = make_client(FakeLLM(), "other", settings=replace(settings, database_path=tmp_path / "other.db"))
    mutations = []
    bad_reply = deepcopy(data)
    group = bad_reply["groups"][0]
    group["messages"][0]["reply_to_message_id"] = group["messages"][1]["id"]
    mutations.append(bad_reply)
    bad_members = deepcopy(data)
    bad_members["groups"][0]["members"][1]["removed_at"] = bad_members["groups"][0]["created_at"]
    mutations.append(bad_members)
    for broken_data in mutations:
        broken = io.BytesIO()
        with zipfile.ZipFile(broken, "w") as zipped:
            zipped.writestr("manifest.json", json.dumps(manifest))
            zipped.writestr("data.json", json.dumps(broken_data))
        response = await target.post(
            "/api/account/data-package?include=groups", content=broken.getvalue(),
            headers={"content-type": "application/zip"},
        )
        assert response.status_code == 422 and response.json()["code"] == "broken"
    assert (await target.get("/api/groups")).json() == []

    duplicate = deepcopy(data)
    duplicate["groups"][0]["members"][1]["character_id"] = duplicate["groups"][0]["members"][0]["character_id"]
    duplicate_package = io.BytesIO()
    with zipfile.ZipFile(duplicate_package, "w") as zipped:
        zipped.writestr("manifest.json", json.dumps(manifest))
        zipped.writestr("data.json", json.dumps(duplicate))
    response = await target.post(
        "/api/account/data-package?include=groups", content=duplicate_package.getvalue(),
        headers={"content-type": "application/zip"},
    )
    assert response.status_code == 422 and response.json()["code"] == "broken"
    assert (await target.get("/api/groups")).json() == []
