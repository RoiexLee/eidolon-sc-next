"""Group calls use one WebRTC connection and serialize member speakers."""

from tests.browser import Browser
from tests.conftest import ClientFactory
from tests.fakes import FakeLLM, FakeSpeech


async def create_group(client) -> str:
    response = await client.post(
        "/api/groups", json={"character_ids": ["mano", "kogane"]}
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_group_call_emits_speakers_and_switches_voice(
    make_client: ClientFactory, speech: FakeSpeech, browser: Browser
):
    client = make_client(
        FakeLLM(
            ["<ja>ほわっ</ja><zh>你好</zh>"],
            ["<ja>はいっ</ja><zh>好的</zh>"],
        )
    )
    group_id = await create_group(client)

    assert (await browser.call(client, group_id=group_id)).status_code == 200
    await browser.connect()
    browser.type("大家好")
    messages = await browser.turn()

    assert [message["type"] for message in messages if message["type"] in {
        "speaker-started", "speaker-ended"
    }] == [
        "speaker-started", "speaker-ended", "speaker-started", "speaker-ended"
    ]
    speakers = [
        message["speaker_id"] for message in messages if message["type"] == "speaker-started"
    ]
    assert speakers == ["mano", "kogane"]
    assert messages[-1]["type"] == "done"
    assert speech.ttss[0].voice_changes[-1] == "kogane-voice"

    recorded = (await client.get(f"/api/groups/{group_id}/messages")).json()
    assert [message["author_character_id"] for message in recorded if message["author_kind"] == "character"] == [
        "mano", "kogane"
    ]


async def test_group_call_checks_group_ownership(
    make_client: ClientFactory, browser: Browser
):
    client = make_client(FakeLLM())
    group_id = await create_group(client)
    stranger = make_client(FakeLLM(), "stranger")

    assert (await client.get(f"/api/ice-servers?group_id={group_id}")).status_code == 200
    assert (
        await client.get(
            f"/api/ice-servers?group_id={group_id}&conversation=missing"
        )
    ).status_code == 422
    assert (
        await client.get(
            f"/api/ice-servers?group_id={group_id}&conversation_id=missing"
        )
    ).status_code == 422
    assert (await stranger.get(f"/api/ice-servers?group_id={group_id}")).status_code == 404
    assert (await browser.call(stranger, group_id=group_id)).status_code == 404
    assert (await browser.call(client, group_id="missing")).status_code == 404


async def test_group_call_reports_busy_group_turn(
    make_client: ClientFactory, browser: Browser
):
    client = make_client(FakeLLM())
    group_id = await create_group(client)
    backend = client._transport.app.state.backend  # type: ignore[attr-defined]
    user_id = (await backend.store.first_user_named("producer")).id
    held = await backend.group_store.start_turn(user_id, group_id)

    assert (await browser.call(client, group_id=group_id)).status_code == 200
    await browser.connect()
    browser.type("大家好")
    messages = await browser.turn()

    assert messages[-1]["type"] == "error"
    assert "群组正在回复" in messages[-1]["message"]
    await backend.group_store.fail_turn(held.id)
