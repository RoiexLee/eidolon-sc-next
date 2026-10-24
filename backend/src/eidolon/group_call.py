"""The group-call turn stage used by the WebRTC call pipeline."""

from __future__ import annotations

import asyncio
import logging
from contextlib import aclosing

from pipecat.frames.frames import EndWorkerFrame, TTSUpdateSettingsFrame
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.fish.tts import FishAudioTTSService

from eidolon.call import Call, CallTurns, SegmentCompleteFrame
from eidolon.engine import CallTurnRecorded
from eidolon.group_engine import (
    FAILED,
    GroupSpeaker,
    GroupTurnDone,
    GroupTurnError,
    GroupTurnPartial,
    GroupUserSaid,
)
from eidolon.group_store import GroupStore, GroupTurnBusy, round_robin_member
from eidolon.reply_format import SegmentDelta

log = logging.getLogger(__name__)


class GroupCallTurns(CallTurns):
    """Run serial group turns while exposing speaker boundaries and voice switches."""

    def __init__(
        self,
        groups: GroupStore,
        engine,
        call: Call,
        outcome,
        follow_on_timeout: float,
    ) -> None:
        super().__init__(None, None, call, outcome, follow_on_timeout)  # type: ignore[arg-type]
        self._groups = groups
        self._group_engine = engine
        self._voice_ids = dict(call.group.voice_ids if call.group is not None else ())

    async def _end(self, ending) -> None:
        """End without writing a single-character conversation event."""
        await self._carry_out(self._turns.call_ending())
        if ending.ended is not None:
            await self._send(ending.ended)
        await self.push_frame(EndWorkerFrame(reason=ending.why))

    async def _reply_events(
        self,
        text: str,
        number: int,
        stop,
        ja: dict[int, str],
        zh: dict[int, str],
        turn,
    ) -> None:
        target = self._call.group
        group_turn = None
        current_speaker: str | None = None
        current_segment: int | None = None
        completed = False
        try:
            if target is None:
                raise RuntimeError("group call target missing")
            group = target.group
            messages = await self._groups.messages(group.user_id, group.id)
            member = round_robin_member(group.current_members, messages)
            starting = asyncio.create_task(self._groups.start_turn(group.user_id, group.id))
            try:
                group_turn = await asyncio.shield(starting)
            except asyncio.CancelledError:
                group_turn = await starting
                await self._groups.fail_turn(group_turn.id)
                group_turn = None
                raise
            assert group_turn is not None
            async with aclosing(self._group_engine.turn(
                group, member, group_turn, text, self._call.llms
            )) as events:
                async for event in events:
                    if stop.is_set():
                        break
                    if isinstance(event, GroupSpeaker):
                        if current_speaker is not None:
                            if current_segment is not None:
                                await self._flush_segment(number, current_segment)
                            await self._send({"type": "speaker-ended", "speaker_id": current_speaker})
                            current_segment = None
                        current_speaker = event.author_character_id
                        voice_id = self._voice_ids.get(current_speaker)
                        if voice_id is None:
                            raise RuntimeError(f"群组成员缺少音色：{current_speaker}")
                        await self.push_frame(
                            TTSUpdateSettingsFrame(
                                delta=FishAudioTTSService.Settings(voice=voice_id)
                            ),
                            FrameDirection.DOWNSTREAM,
                        )
                        await self._send({
                            "type": "speaker-started",
                            "speaker_id": event.author_character_id,
                            "speaker_name": event.author_name_snapshot,
                        })
                    elif isinstance(event, GroupUserSaid):
                        await self._send({"type": "user", "text": event.text, "reply": number})
                    elif isinstance(event, SegmentDelta):
                        if current_segment is not None and event.segment != current_segment:
                            await self._flush_segment(number, current_segment)
                        current_segment = event.segment
                        await self._carry_out(self._turns.reply_delta(event.lang, event.text, event.segment))
                        if event.lang == "ja":
                            ja[event.segment] = ja.get(event.segment, "") + event.text
                        else:
                            zh[event.segment] = zh.get(event.segment, "") + event.text
                        await self._send({
                            "type": "delta",
                            "lang": event.lang,
                            "text": event.text,
                            "segment": event.segment,
                            "reply": number,
                        })
                    elif isinstance(event, GroupTurnPartial):
                        await self._send({
                            "type": "partial",
                            "message": event.message.shown(),
                            "error": event.error,
                            "reply": number,
                        })
                    elif isinstance(event, GroupTurnDone):
                        completed = True
                        if current_speaker is not None:
                            if current_segment is not None:
                                await self._flush_segment(number, current_segment)
                            await self._send({"type": "speaker-ended", "speaker_id": current_speaker})
                            current_speaker = None
                        await self._carry_out(self._turns.reply_recorded())
                        self._outcome.turn_recorded(CallTurnRecorded())
                        shown = [message.shown() for message in event.messages] or [event.message.shown()]
                        await self._send({
                            "type": "done",
                            "reply": number,
                            "turn_id": event.turn_id,
                            "message": shown[0],
                            "messages": shown,
                            "partial": event.partial,
                        })
                    elif isinstance(event, GroupTurnError):
                        completed = True
                        if current_speaker is not None:
                            await self._send({"type": "speaker-ended", "speaker_id": current_speaker})
                            current_speaker = None
                        await self._send({"type": "error", "message": event.message, "reply": number})
        except GroupTurnBusy as error:
            await self._send({"type": "error", "message": str(error), "reply": number})
        except Exception:
            # _reply_to logs exceptions, so report a terminal browser event here first.
            log.exception("group call turn failed")
            await self._send({"type": "error", "message": FAILED, "reply": number})
        finally:
            if current_speaker is not None:
                await self._send({"type": "speaker-ended", "speaker_id": current_speaker})
            if group_turn is not None and not completed:
                await self._groups.fail_turn(group_turn.id)

    async def _flush_segment(self, reply: int, segment: int) -> None:
        """Flush the last Japanese segment before changing the TTS voice."""
        await self.push_frame(
            SegmentCompleteFrame(reply, segment),
            FrameDirection.DOWNSTREAM,
        )

