import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupConversation, GroupMessage } from "@/lib/api";
import type { Call, CallHandlers, MicInUse } from "@/lib/call";
import type { CallPreferences } from "@/lib/callPreferences";
import { LiveGroupConversation } from "@/lib/liveGroupConversation";

const getGroup = vi.hoisted(() => vi.fn());
const listGroupMessages = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, getGroup, listGroupMessages };
});

class FakeCall implements Call {
  readonly maxSeconds = null;
  readonly exempt = true;
  readonly mic: MicInUse = { id: "mic", fellBack: false };
  sent: string[] = [];
  hangUps = 0;
  leaves = 0;
  sendText = (text: string) => this.sent.push(text);
  setTextOnly = vi.fn();
  setMicEnabled = vi.fn();
  switchMic = async () => this.mic;
  hangUp = async () => { this.hangUps += 1; };
  leave = async () => { this.leaves += 1; };
}

class FakeVoice {
  setTextOnly = vi.fn();
  dial = vi.fn();
  play = vi.fn();
  dispose = vi.fn();
}

class FakeTones {
  ring = vi.fn();
  ringLeft = vi.fn(() => 0);
  connect = vi.fn();
  hangUp = vi.fn();
  silence = vi.fn();
}

const group: GroupConversation = {
  id: "g1",
  title: "放学后",
  created_at: "2026-10-24T00:00:00Z",
  updated_at: "2026-10-24T00:00:00Z",
  members: [
    { character_id: "a", position: 0, added_at: "2026-10-24T00:00:00Z", removed_at: null, name_snapshot: "甲", current: true, name: "甲" },
    { character_id: "b", position: 1, added_at: "2026-10-24T00:00:00Z", removed_at: null, name_snapshot: "乙", current: true, name: "乙" },
  ],
  current_members: [
    { character_id: "a", position: 0, added_at: "2026-10-24T00:00:00Z", removed_at: null, name_snapshot: "甲", current: true, name: "甲" },
    { character_id: "b", position: 1, added_at: "2026-10-24T00:00:00Z", removed_at: null, name_snapshot: "乙", current: true, name: "乙" },
  ],
  history_members: [],
  last_message: null,
};

function message(id: number, author: "a" | "b"): GroupMessage {
  return {
    id,
    group_id: "g1",
    turn_id: "t1",
    author_kind: "character",
    author_character_id: author,
    author_name_snapshot: author === "a" ? "甲" : "乙",
    text: null,
    ja: "返事",
    zh: "回复",
    segments: [{ ja: "返事", zh: "回复" }],
    created_at: "2026-10-24T00:00:01Z",
    reply_to_message_id: null,
    mentions: [],
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function eventHandlers() {
  let handlers: CallHandlers | null = null;
  const call = new FakeCall();
  const voice = new FakeVoice();
  const tones = new FakeTones();
  const preferences: CallPreferences = { micId: "", quality: "standard", muted: false, phoneTexture: false };
  const live = new LiveGroupConversation("g1", {
    startCall: async (_target, _preferences, next) => {
      handlers = next;
      next.onMicOpen();
      return call;
    },
    preferences: { load: () => preferences, save: () => preferences },
    voice,
    tones,
    onMessagesChanged: vi.fn(),
    now: () => 1_000,
  });
  return { live, call, voice, tones, get handlers() { return handlers; } };
}

beforeEach(() => {
  getGroup.mockResolvedValue(group);
  listGroupMessages.mockResolvedValue([]);
});

afterEach(() => vi.clearAllMocks());

describe("LiveGroupConversation", () => {
  it("uses an updated member snapshot for later call speakers", async () => {
    const fixture = eventHandlers();
    await flush();
    const member = { character_id: "c", position: 2, added_at: "2026-10-24T00:00:00Z", removed_at: null, name_snapshot: "丙", current: true, name: "丙" };
    fixture.live.setGroup({ ...group, members: [...group.members, member], current_members: [...group.current_members, member] });
    expect(fixture.live.snapshot().group?.current_members.map(({ character_id }) => character_id)).toEqual(["a", "b", "c"]);

    await fixture.live.startCall();
    const handler = fixture.handlers;
    if (!handler) throw new Error("call handlers were not installed");
    handler.onEvent({ type: "speaker-started", speaker_id: "c", speaker_name: "丙" });
    expect(fixture.live.snapshot().speakerId).toBe("c");
  });

  it("switches visual speaker state and keeps all done messages out of single-chat state", async () => {
    const fixture = eventHandlers();
    const { live } = fixture;
    await flush();
    await live.startCall();
    expect(live.snapshot().call.phase).toBe("connected");
    const handler = fixture.handlers;
    if (!handler) throw new Error("call handlers were not installed");
    handler.onEvent({ type: "speaker-started", speaker_id: "a", speaker_name: "甲" });
    handler.onEvent({ type: "delta", segment: 0, lang: "ja", text: "甲" });
    expect(live.snapshot().speakerId).toBe("a");
    expect(live.snapshot().line?.ja).toBe("甲");
    handler.onEvent({ type: "speaker-ended", speaker_id: "a" });
    expect(live.snapshot().speakerId).toBeNull();
  });

  it("ignores a stale speaker-ended event and appends group done messages", async () => {
    const fixture = eventHandlers();
    await flush();
    await fixture.live.startCall();
    const handler = fixture.handlers;
    if (!handler) throw new Error("call handlers were not installed");

    handler.onEvent({ type: "speaker-started", speaker_id: "a", speaker_name: "甲" });
    handler.onEvent({ type: "speaker-started", speaker_id: "b", speaker_name: "乙" });
    handler.onEvent({ type: "speaker-started", speaker_id: "a", speaker_name: "甲" });
    handler.onEvent({ type: "speaker-ended", speaker_id: "a" });
    expect(fixture.live.snapshot().speakerId).toBe("b");
    handler.onEvent({ type: "delta", segment: 0, lang: "ja", text: "乙" });
    handler.onEvent({ type: "done", reply: 1, turn_id: "t1", message: message(1, "a"), messages: [message(1, "a"), message(2, "b")], partial: false });

    expect(fixture.live.snapshot().messages.map(({ id }) => id)).toEqual([1, 2]);
    expect(fixture.live.snapshot().speakerId).toBeNull();
  });

  it("clears speaker and call resources when ended or disposed", async () => {
    const fixture = eventHandlers();
    await flush();
    await fixture.live.startCall();
    const handler = fixture.handlers;
    if (!handler) throw new Error("call handlers were not installed");
    handler.onEvent({ type: "speaker-started", speaker_id: "a", speaker_name: "甲" });
    handler.onEvent({ type: "ended", reason: "she_hung_up", message: "结束", counts: false });
    expect(fixture.live.snapshot().speakerId).toBeNull();
    expect(fixture.live.snapshot().call.phase).toBe("ended");
    fixture.live.dispose();
    expect(fixture.voice.dispose).toHaveBeenCalledOnce();
    expect(fixture.tones.silence).toHaveBeenCalledOnce();

    const active = eventHandlers();
    await flush();
    await active.live.startCall();
    active.live.dispose();
    expect(active.call.leaves).toBe(1);
  });

  it("folds the last layer after a user hang-up", async () => {
    const fixture = eventHandlers();
    await flush();
    await fixture.live.startCall();
    const handler = fixture.handlers;
    if (!handler) throw new Error("call handlers were not installed");
    handler.onEvent({ type: "speaker-started", speaker_id: "a", speaker_name: "甲" });
    await fixture.live.hangUp();
    expect(fixture.live.snapshot().call.phase).toBe("idle");
    expect(fixture.live.snapshot().speakerId).toBeNull();
    expect(fixture.live.snapshot().layer?.collapsed).toBe(true);
    expect(fixture.call.hangUps).toBe(1);
  });
});
