"use client";

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

import { MarkedAvatar } from "@/components/app/MarkedAvatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { GroupAvatar } from "@/components/conversations/GroupAvatar";
import { copy } from "@/i18n";
import { type Character } from "@/lib/api";
import { clock, showTime } from "@/lib/callTime";
import { type GroupCallSnapshot, LiveGroupConversation } from "@/lib/liveGroupConversation";
import type { ShownCall } from "@/lib/liveConversation";
import { groupTitle } from "@/lib/groupChat";
import { CALM } from "@/lib/standAnimations";
import { cn } from "@/lib/utils";
import { CollapseIcon, HangUpIcon, MicIcon, MicOffIcon, MicSwitchIcon, SendIcon, TextOnlyIcon, TypingIcon } from "@/theme/icons";
import { Ja } from "@/theme/Ja";
import { useCallTime } from "./useCallTime";
import { useStandOutfits } from "./useStandOutfits";
import { Stand } from "./stand/Stand";

const t = copy.call;
const noSnapshot = (): GroupCallSnapshot => ({
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
});

export function LiveGroupCallLayer({
  live,
  characters,
  layerRef,
  isFullScreen,
}: {
  live: LiveGroupConversation;
  characters: readonly Character[];
  layerRef: RefObject<HTMLElement | null>;
  isFullScreen: boolean;
}) {
  const snapshot = useSyncGroupSnapshot(live);
  if (!snapshot.layer) return null;
  return <GroupCallLayer snapshot={snapshot} live={live} characters={characters} layerRef={layerRef} isFullScreen={isFullScreen} />;
}

function useSyncGroupSnapshot(live: LiveGroupConversation): GroupCallSnapshot {
  // Kept local so this layer can remain a small adapter beside the existing single-character layer.
  return useSyncExternalStore(live.subscribe, live.snapshot, noSnapshot);
}

function GroupCallLayer({
  snapshot,
  live,
  characters,
  layerRef,
  isFullScreen,
}: {
  snapshot: GroupCallSnapshot;
  live: LiveGroupConversation;
  characters: readonly Character[];
  layerRef: RefObject<HTMLElement | null>;
  isFullScreen: boolean;
}) {
  const { layer, call } = snapshot;
  const character = snapshot.speakerId ? characters.find((item) => item.id === snapshot.speakerId) : undefined;
  const title = snapshot.group ? groupTitle(snapshot.group) : "群聊";
  const name = snapshot.speakerName || title;
  const ended = call.phase === "ended";
  const canRedial = ended && !["over_limit", "cooldown", "own_key"].includes(call.end.reason);
  const typeKey = useRef<HTMLButtonElement>(null);
  const time = useCallTime(call);
  useEffect(() => {
    if (layer && !layer.collapsed) layerRef.current?.focus();
  }, [layer?.collapsed, layerRef]);
  if (!layer) return null;
  return (
    <section
      ref={layerRef}
      tabIndex={-1}
      aria-label={name}
      aria-hidden={layer.collapsed}
      inert={layer.collapsed}
      className={cn(
        "dark inset-0 z-10 flex flex-col overflow-hidden bg-her-call-deep text-white outline-none",
        isFullScreen ? "fixed" : "absolute",
        layer.collapsed ? "invisible translate-y-full" : "visible translate-y-0",
        "transition-[translate,visibility] duration-410 ease-call",
      )}
    >
      {character?.background_url || character?.avatar_url ? (
        <img src={character.background_url ?? character.avatar_url ?? ""} alt="" aria-hidden className="pointer-events-none absolute inset-0 size-full object-cover opacity-70" />
      ) : null}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/25 to-her-call-shade" />
      {character && <ActiveSpeakerStand character={character} call={layer.call} collapsed={layer.collapsed} fullScreen={isFullScreen} />}
      <header className="relative flex items-center justify-between gap-2 px-4 pt-4">
        {!ended ? <Button variant="ghost" size="icon-lg" aria-label={t.collapse} onClick={() => live.collapse()}><CollapseIcon className="size-6" /></Button> : <span />}
        <div className="min-w-0 text-center"><h2 className="truncate text-header font-bold">{name}</h2><p className="text-meta text-white/80">{time ? showTime(time) : call.phase === "dialing" ? t.calling : title}</p></div>
        {!ended ? <Button variant="call-glass" size={isFullScreen ? "call" : "call-sm"} aria-pressed={snapshot.textOnly} onClick={() => live.toggleTextOnly()}><TextOnlyIcon aria-hidden />{t.textOnly}</Button> : <span />}
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-end gap-4 overflow-y-auto px-5 py-6">
        <div className="flex flex-col items-center gap-2">
          {snapshot.speakerId && character ? (
            <MarkedAvatar name={name} src={character.avatar_url} size="call" />
          ) : snapshot.group ? (
            <GroupAvatar group={snapshot.group} characters={characters} size="call" />
          ) : (
            <MarkedAvatar name={title} size="call" />
          )}
          {!snapshot.speakerId && <p className="text-call-name">{title}</p>}
        </div>
        {ended ? (
          <div role="alert" className="flex max-w-[34em] flex-col items-center gap-2 rounded-3xl bg-white/12 px-5 py-6 text-center backdrop-blur-md">
            <h3 className="text-lg font-semibold">{t.ended}</h3>
            {call.end.detail && <p className="text-sm">{call.end.detail}</p>}
            {call.seconds !== null && <p className="text-sm text-white/80">{clock(call.seconds)}</p>}
            <div className="mt-3 flex gap-2"><Button variant="call-glass" size="call" onClick={() => live.dismissEnd()}>{t.backToConversation}</Button>{canRedial && <Button variant="call-solid" size="call" onClick={() => void live.startCall()}><SendIcon aria-hidden />{t.redial}</Button>}</div>
          </div>
        ) : (
          <>
            <p role="status" className="text-center text-sm text-white/80">{snapshot.micNotice && t.micNotices[snapshot.micNotice]}</p>
            {(snapshot.line || snapshot.hearing || snapshot.typed) && <div className="w-full max-w-[34em] rounded-3xl bg-white/12 px-5 py-4 text-center backdrop-blur-md">
              {snapshot.line ? <>
                {snapshot.textOnly && snapshot.previousLine && <div className="mb-2 text-sm text-white/60"><Ja>{snapshot.previousLine.ja}</Ja>{snapshot.previousLine.zh && <p>{snapshot.previousLine.zh}</p>}</div>}
                <p className="text-call-line leading-relaxed"><Ja>{snapshot.line.ja}</Ja></p>
                {snapshot.line.zh && <p className="mt-1 text-sm text-white/80">{snapshot.line.zh}</p>}
              </> : !snapshot.typed && <p className="text-sm text-white/80">{snapshot.textOnly ? t.repliesInText : t.speakFreely}</p>}
              {snapshot.hearing && <p className="mt-3 text-sm text-white/80">{t.hearing(snapshot.hearing)}</p>}
              {snapshot.typed && <p className="mt-3 text-sm text-white/80">{t.typed(snapshot.typed)}</p>}
            </div>}
          </>
        )}
        {!ended && snapshot.failure && <p role="alert" className="text-meta text-white/80">{snapshot.failure.message}</p>}
      </div>
      {snapshot.typing && !ended ? (
        <form className="relative flex items-end gap-2 px-4 pb-4" onSubmit={(event) => { event.preventDefault(); live.submit(); }}>
          <Textarea variant="call" rows={1} value={snapshot.draft} onChange={(event) => live.setDraft(event.target.value)} placeholder={copy.conversation.placeholder} aria-label={copy.conversation.placeholder} />
          <Button type="submit" variant="call-solid" size="icon-call" aria-label={copy.conversation.send}><SendIcon aria-hidden /></Button>
        </form>
      ) : (
        !ended && <footer className="relative flex justify-center px-4 pb-8"><div className="flex items-center gap-2 rounded-full bg-white/12 p-2 backdrop-blur-md"><Button variant="call-round" size="icon-call-dock" aria-label={snapshot.micMuted ? t.micUnmute : t.micMute} aria-pressed={snapshot.micMuted} onClick={() => live.toggleMic()}><>{snapshot.micMuted ? <MicOffIcon aria-hidden /> : <MicIcon aria-hidden />}</></Button><Button variant="call-round" size="icon-call-dock" aria-label={t.switchMic} onClick={() => live.openMicPicker()}><MicSwitchIcon aria-hidden /></Button><Button ref={typeKey} variant="call-round" size="icon-call-dock" aria-label={t.type} onClick={() => live.openTyping()}><TypingIcon aria-hidden /></Button><Button variant="hangup" size="call-dock" onClick={() => void live.hangUp()}><HangUpIcon aria-hidden />{t.hangUp}</Button></div></footer>
      )}
    </section>
  );
}

function ActiveSpeakerStand({
  character,
  call,
  collapsed,
  fullScreen,
}: {
  character: Character;
  call: ShownCall;
  collapsed: boolean;
  fullScreen: boolean;
}) {
  const outfits = useStandOutfits(character);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", false);
  if (!outfits) return null;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0",
        fullScreen ? "h-[80%]" : "top-16",
        call.phase === "ended" && "opacity-40",
      )}
    >
      <Stand
        key={call.dial}
        outfits={outfits.toTry}
        framing={fullScreen ? "knees" : "waist"}
        isPaused={collapsed}
        entrance={fullScreen ? "rise" : "fade"}
        direction={CALM}
        isReducedMotion={reducedMotion}
      />
    </div>
  );
}
