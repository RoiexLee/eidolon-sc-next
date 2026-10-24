import {
  getGroup,
  listGroupMessages,
  type CallEvent,
  type GroupConversation,
  type GroupMessage,
  type Segment,
} from "@/lib/api";
import type { Call, CallHandlers, MicInUse } from "@/lib/call";
import { type CallTarget } from "@/lib/api";
import { backendEnd, droppedEnd, startFailedEnd, type CallEnd } from "@/lib/callEnd";
import type { CallPreferences } from "@/lib/callPreferences";
import type { Failure } from "@/lib/failure";
import { toFailure } from "@/lib/failure";
import type { Layer, CallState, MicNotice, Tones, Voice } from "@/lib/liveConversation";
import { isLive } from "@/lib/liveConversation";

const MAX_INPUT_LENGTH = 2000;

export type GroupCallSnapshot = {
  group: GroupConversation | null;
  messages: GroupMessage[];
  call: CallState;
  layer: Layer | null;
  pickingMic: boolean;
  typing: boolean;
  typed: string | null;
  hearing: string;
  line: Segment | null;
  previousLine: Segment | null;
  micMuted: boolean;
  micId: string;
  micNotice: MicNotice | null;
  draft: string;
  textOnly: boolean;
  failure: Failure | null;
  speakerId: string | null;
  speakerName: string | null;
  /** An internal monotonic id. Backend reply numbers restart for follow-on speakers. */
  speakerReply: number;
};

const EMPTY: GroupCallSnapshot = {
  group: null,
  messages: [],
  call: { phase: "idle" },
  layer: null,
  pickingMic: false,
  typing: false,
  typed: null,
  hearing: "",
  line: null,
  previousLine: null,
  micMuted: false,
  micId: "",
  micNotice: null,
  draft: "",
  textOnly: false,
  failure: null,
  speakerId: null,
  speakerName: null,
  speakerReply: 0,
};

type Ports = {
  startCall: (target: CallTarget, preferences: CallPreferences, handlers: CallHandlers) => Promise<Call>;
  preferences: { load: () => CallPreferences; save: (change: Partial<CallPreferences>) => CallPreferences };
  voice: Voice;
  tones: Tones;
  onMessagesChanged: () => void;
  now?: () => number;
};

/** The group counterpart to LiveConversation. It deliberately owns only group call state and
 * never feeds GroupMessage into single-character conversation logging or affinity. */
export class LiveGroupConversation {
  readonly kind = "group" as const;
  private state: GroupCallSnapshot = { ...EMPTY };
  private published = this.state;
  private listeners = new Set<() => void>();
  private call: Call | null = null;
  private attempt: object | null = null;
  private endedBy: CallEnd | null = null;
  private holding: (() => void) | null = null;
  private disposed = false;
  private connectedAt: number | null = null;
  private segments = new Map<string, Segment>();
  private wireReply: number | null = null;
  private seenSpeakers = new Set<string>();

  constructor(readonly groupId: string, private readonly ports: Ports) {
    this.state = { ...EMPTY, textOnly: ports.preferences.load().muted };
    this.published = this.state;
    ports.voice.setTextOnly(this.state.textOnly);
    void this.load();
  }

  snapshot = (): GroupCallSnapshot => this.published;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    this.disposed = true;
    this.attempt = null;
    this.holding?.();
    this.holding = null;
    this.call?.leave().catch(() => {});
    this.call = null;
    this.wireReply = null;
    this.seenSpeakers.clear();
    this.ports.tones.silence();
    this.ports.voice.dispose();
    this.clearSpeaker();
  }

  async startCall(): Promise<void> {
    if (!this.state.group || !isFree(this.state)) return;
    const preferences = this.ports.preferences.load();
    this.ports.voice.dial(preferences.phoneTexture);
    const attempt = {};
    this.attempt = attempt;
    this.endedBy = null;
    this.connectedAt = null;
    this.wireReply = null;
    this.seenSpeakers.clear();
    const previousDial = "dial" in this.state.call ? this.state.call.dial : this.state.layer?.call.dial ?? 0;
    const dial = previousDial + 1;
    this.update({ call: { phase: "dialing", dial }, layer: this.state.layer, failure: null, micMuted: false });
    const current = () => this.attempt === attempt;
    const gated = <A extends unknown[]>(handler: (...args: A) => void) => (...args: A) => {
      if (current()) handler(...args);
    };
    let started: Call;
    let held = false;
    try {
      started = await this.ports.startCall({ kind: "group", groupId: this.groupId }, preferences, {
        onMicOpen: gated(() => this.ports.tones.ring()),
        onEvent: gated((event) => this.onCallEvent(event)),
        onHearing: gated((hearing) => this.update({ hearing })),
        onCharacterAudio: gated((track) => this.ports.voice.play(track)),
        onDropped: gated(() => {
          if (this.state.call.phase === "dialing" && !held) return;
          this.endCall(this.endedBy ?? droppedEnd(started.exempt));
        }),
        onMicLost: gated((now) => {
          if (this.state.call.phase === "dialing") return;
          this.update(now ? micInUse(now) : { micId: "", micNotice: "lost" });
        }),
      });
    } catch (reason) {
      if (!current()) return;
      const end = startFailedEnd(reason);
      this.update({ failure: end.detail ? { message: end.detail, signedOut: false, countsTowardLimit: false } : null });
      this.endCall(end);
      return;
    }
    const left = current() ? this.ports.tones.ringLeft() : 0;
    if (left > 0) {
      held = true;
      started.setMicEnabled(false);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.holding = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.holding = null;
      if (current()) started.setMicEnabled(true);
    }
    if (!current()) {
      await started.hangUp().catch(() => {});
      return;
    }
    this.call = started;
    this.connectedAt = this.now();
    this.ports.tones.connect();
    this.update({
      call: {
        phase: "connected",
        dial,
        since: this.connectedAt,
        maxSeconds: started.maxSeconds === null ? null : Math.floor(started.maxSeconds - left / 1000),
      },
      ...micInUse(started.mic),
    });
  }

  async hangUp(): Promise<void> {
    if (!isLive(this.state.call)) return;
    const call = this.call;
    this.endCall(null);
    await call?.hangUp().catch(() => {});
  }

  dismissEnd(): void {
    if (this.state.call.phase === "ended") this.update({ call: { phase: "idle" } });
  }

  /** Group history has no single-character stale summary; retained for the Directory seam. */
  offScreen(): void {}

  /** Keeps an already-open group page's call snapshot in step with member changes. */
  setGroup(group: GroupConversation): void { this.update({ group }); }

  collapse(): void {
    if (isLive(this.state.call) && this.state.layer && !this.state.layer.collapsed)
      this.update({ layer: { ...this.state.layer, collapsed: true }, typing: false });
  }

  expand(): void {
    if (isLive(this.state.call) && this.state.layer?.collapsed)
      this.update({ layer: { ...this.state.layer, collapsed: false } });
  }

  openMicPicker(): void {
    if (this.state.call.phase === "connected") this.update({ pickingMic: true });
  }
  closeMicPicker(): void { if (this.state.pickingMic) this.update({ pickingMic: false }); }
  openTyping(): void { if (this.state.call.phase === "connected") this.update({ typing: true }); }
  closeTyping(): void { if (this.state.typing) this.update({ typing: false }); }
  setDraft(draft: string): void { this.update({ draft: draft.slice(0, MAX_INPUT_LENGTH) }); }

  submit(): void {
    const text = this.state.draft.trim();
    if (!text || !this.call || this.state.call.phase !== "connected") return;
    this.call.sendText(text);
    this.update({ draft: "", typed: text, hearing: "" });
  }

  toggleMic(): void {
    if (!this.call) return;
    const micMuted = !this.state.micMuted;
    this.call.setMicEnabled(!micMuted);
    this.update({ micMuted });
  }

  async switchMic(micId: string): Promise<void> {
    if (!this.call) return;
    try {
      const mic = await this.call.switchMic(micId);
      this.ports.preferences.save({ micId });
      this.update(micInUse(mic));
    } catch {
      this.update({ micNotice: "unavailable" });
    }
  }

  toggleTextOnly(): void {
    const textOnly = !this.state.textOnly;
    this.ports.preferences.save({ muted: textOnly });
    this.ports.voice.setTextOnly(textOnly);
    this.call?.setTextOnly(textOnly);
    this.update({ textOnly });
  }

  private async load(): Promise<void> {
    try {
      const [group, messages] = await Promise.all([getGroup(this.groupId), listGroupMessages(this.groupId)]);
      if (!this.disposed) this.update({ group, messages });
    } catch (reason) {
      if (!this.disposed) this.update({ failure: toFailure(reason) });
    }
  }

  private onCallEvent(event: CallEvent): void {
    if (event.type === "speaker-started") {
      if (!this.isMember(event.speaker_id)) return;
      if (this.seenSpeakers.has(event.speaker_id)) return;
      if (this.state.speakerId === event.speaker_id && this.acceptsReply(event.reply)) return;
      if (!this.acceptsReply(event.reply)) return;
      this.seenSpeakers.add(event.speaker_id);
      if (event.reply !== undefined) this.wireReply = event.reply;
      this.segments.clear();
      this.update({ speakerId: event.speaker_id, speakerName: event.speaker_name, speakerReply: this.state.speakerReply + 1, line: null, previousLine: null, typed: null });
      return;
    }
    if (event.type === "speaker-ended") {
      if (event.speaker_id === this.state.speakerId && this.acceptsReply(event.reply)) {
        this.clearSpeaker();
        this.wireReply = null;
      }
      return;
    }
    if (event.type === "user") {
      this.seenSpeakers.clear();
      this.wireReply = null;
      this.update({ hearing: "", typed: event.text });
      return;
    }
    if (event.type === "delta") {
      const reply = "reply" in event ? event.reply : undefined;
      if (!this.state.speakerId || !this.acceptsReply(reply)) return;
      if (reply !== undefined) this.wireReply = reply;
      const segmentKey = `${this.state.speakerReply}:${event.segment}`;
      const segment = this.segments.get(segmentKey) ?? { ja: "", zh: "" };
      const next = { ...segment, [event.lang]: segment[event.lang] + event.text };
      this.segments.set(segmentKey, next);
      const previous = this.state.line && this.state.line !== next ? this.state.line : this.state.previousLine;
      this.update({ line: next, previousLine: previous });
      return;
    }
    if (event.type === "partial") {
      this.update({ failure: { message: event.error, signedOut: false, countsTowardLimit: false } });
      return;
    }
    if (event.type === "done" && isGroupMessage(event.message)) {
      const messages = "messages" in event && Array.isArray(event.messages) ? event.messages : [];
      const completed = messages.length ? messages : [event.message];
      this.clearSpeaker();
      this.wireReply = null;
      const known = new Set(this.state.messages.map(({ id }) => id));
      this.update({
        messages: [...this.state.messages, ...completed.filter(({ id }) => !known.has(id))],
        typed: null,
        line: null,
        previousLine: null,
      });
      this.ports.onMessagesChanged();
      return;
    }
    if (event.type === "error") {
      this.update({ failure: { message: event.message, signedOut: false, countsTowardLimit: false }, typed: null });
      return;
    }
    if (event.type === "ended") {
      this.endedBy = backendEnd(event);
      this.endCall(this.endedBy);
    }
  }

  private endCall(end: CallEnd | null): void {
    const seconds = this.connectedAt === null ? null : Math.max(0, Math.floor((this.now() - this.connectedAt) / 1000));
    this.attempt = null;
    this.holding?.();
    this.holding = null;
    this.call = null;
    this.connectedAt = null;
    this.wireReply = null;
    this.seenSpeakers.clear();
    this.ports.tones.hangUp();
    this.clearSpeaker();
    const call = end ? { phase: "ended" as const, dial: this.state.call.phase === "idle" ? 1 : this.state.call.dial, end, seconds } : { phase: "idle" as const };
    this.update({ call, hearing: "", micMuted: false, micId: "", micNotice: null, typing: false });
  }

  private clearSpeaker(): void {
    this.segments.clear();
    this.state = { ...this.state, speakerId: null, speakerName: null, line: null, previousLine: null };
    this.published = this.state;
    for (const listener of this.listeners) listener();
  }

  private isMember(characterId: string): boolean {
    return this.state.group?.current_members.some((member) => member.character_id === characterId) ?? false;
  }

  private acceptsReply(reply: number | undefined): boolean {
    return reply === undefined || this.wireReply === null || reply >= this.wireReply;
  }

  private update(change: Partial<GroupCallSnapshot>): void {
    if (this.disposed) return;
    const next = { ...this.state, ...change };
    if (next.call.phase === "idle") {
      const layer = this.state.layer;
      next.layer = !layer || layer.collapsed ? layer : { ...layer, collapsed: true };
    }
    else if (next.call !== this.state.call && next.call.phase !== "connected") next.layer = { call: next.call, collapsed: false };
    else if (next.call !== this.state.call && next.call.phase === "connected") next.layer = { call: next.call, collapsed: this.state.layer?.collapsed ?? false };
    else if (this.state.layer && next.call.phase === "connected") next.layer = { ...this.state.layer, call: next.call };
    next.pickingMic = next.call.phase === "connected" && next.pickingMic;
    next.typing = next.call.phase === "connected" && next.typing;
    this.state = next;
    this.published = next;
    for (const listener of this.listeners) listener();
  }

  private now(): number { return (this.ports.now ?? Date.now)(); }
}

function isGroupMessage(message: unknown): message is GroupMessage {
  return typeof message === "object" && message !== null && "group_id" in message;
}

function micInUse(mic: MicInUse): Pick<GroupCallSnapshot, "micId" | "micNotice"> {
  return { micId: mic.id, micNotice: mic.fellBack ? "fell_back" : null };
}

function isFree(state: GroupCallSnapshot): boolean {
  return state.group !== null && !isLive(state.call);
}
