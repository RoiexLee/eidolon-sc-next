"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { MarkedAvatar } from "@/components/app/MarkedAvatar";
import { Button } from "@/components/ui/button";
import { CallBar } from "@/components/conversations/CallBar";
import { LiveGroupCallLayer } from "@/components/conversations/GroupCallLayer";
import { GroupAvatar } from "@/components/conversations/GroupAvatar";
import { GroupMemberDialog } from "@/components/conversations/GroupMemberDialog";
import { useDirectory, useWide } from "@/components/conversations/ConversationDirectory";
import { useFocusBack } from "@/components/conversations/useFocusBack";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { copy } from "@/i18n";
import {
  getGroup,
  listGroupMessages,
  sendGroupTurn,
  type Character,
  type GroupConversation,
  type GroupMessage,
} from "@/lib/api";
import { matchesSearch } from "@/lib/characterSearch";
import { ALL_MEMBERS_TARGET, groupMentionAt, groupTitle, messageAuthor, messagePreview, messageText, replyTarget } from "@/lib/groupChat";
import { BackIcon, GroupIcon, ReplyIcon, SendIcon } from "@/theme/icons";
import { PhoneIcon } from "@/theme/icons";
import { Ja } from "@/theme/Ja";
import { cn } from "@/lib/utils";
import { herVars } from "@/theme/herVars";
import { NOT_OPEN, type Snapshot } from "@/lib/liveConversation";
import { LiveGroupConversation, type GroupCallSnapshot } from "@/lib/liveGroupConversation";

const t = copy.groupConversation;
const noSnapshot = () => NOT_OPEN as Snapshot | GroupCallSnapshot;
const noSubscription = () => () => {};
type MentionCandidate = { kind: "all" | "member"; character_id: string; name: string };

export function GroupConversationView({
  userId,
  groupId,
  characters,
  onBack,
}: {
  userId: string;
  groupId: string;
  characters: Character[];
  onBack?: () => void;
}) {
  const { openGroup, close } = useDirectory();
  const isFullScreen = !useWide();
  const [live, setLive] = useState<LiveGroupConversation | null>(null);
  const snapshot = useSyncExternalStore(live?.subscribe ?? noSubscription, live?.snapshot ?? noSnapshot, noSnapshot) as Snapshot | GroupCallSnapshot;
  const groupSnapshot = live ? snapshot as GroupCallSnapshot : null;
  const focus = useFocusBack({ layerOpen: groupSnapshot?.layer !== null && groupSnapshot?.layer?.collapsed === false, noteShown: Boolean(groupSnapshot && groupSnapshot.call.phase !== "idle" && groupSnapshot.layer?.collapsed) });
  const [group, setGroup] = useState<GroupConversation | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [partialNotice, setPartialNotice] = useState<string | null>(null);
  const [mentionTargetId, setMentionTargetId] = useState<string | null>(null);
  const [mentionToken, setMentionToken] = useState<{ characterId: string; name: string; start: number; end: number } | null>(null);
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [replyId, setReplyId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState({ ja: "", zh: "" });
  const [sending, setSending] = useState(false);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);

  useEffect(() => {
    const current = openGroup(groupId, userId);
    setLive(current);
    return () => close(current);
  }, [close, groupId, openGroup, userId]);

  useEffect(() => {
    let active = true;
    setGroup(null);
    setMessages([]);
    setFailure(null);
    setPartialNotice(null);
    void Promise.all([getGroup(groupId), listGroupMessages(groupId)])
      .then(([nextGroup, nextMessages]) => {
        if (!active) return;
        setGroup(nextGroup);
        setMessages(nextMessages);
        setMentionTargetId(null);
        setMentionToken(null);
        setMentionRange(null);
        setMentionIndex(0);
      })
      .catch((reason) => active && setFailure(reason instanceof Error ? reason.message : t.loadFailed));
    return () => {
      active = false;
    };
  }, [groupId]);

  useEffect(() => {
    if (groupSnapshot && groupSnapshot.messages.length > messages.length) setMessages(groupSnapshot.messages);
  }, [groupSnapshot, messages.length]);

  // A call's done event carries character messages; reload once so the user's call utterance and
  // the server's authoritative ids are visible in the same group history.
  useEffect(() => {
    if (!groupSnapshot || groupSnapshot.messages.length <= messages.length) return;
    let active = true;
    void listGroupMessages(groupId).then((next) => active && setMessages(next)).catch(() => {});
    return () => {
      active = false;
    };
  }, [groupId, groupSnapshot?.messages.length, messages.length]);

  const currentMembers = group?.current_members ?? [];
  const characterById = useMemo(() => new Map(characters.map((character) => [character.id, character])), [characters]);
  const quoted = replyId === null ? null : messages.find((message) => message.id === replyId) ?? null;
  const mentionCandidates = useMemo(() => {
    if (!mentionRange) return [];
    const query = mentionRange.query.toLocaleLowerCase();
    const all = { kind: "all" as const, character_id: ALL_MEMBERS_TARGET, name: t.allMembers };
    const members = currentMembers.filter((member) => {
      const character = characterById.get(member.character_id);
      return character ? matchesSearch(character, query) : member.name.toLocaleLowerCase().includes(query);
    }).map((member) => ({ kind: "member" as const, character_id: member.character_id, name: member.name }));
    return [all, ...members].filter((candidate) => !query || candidate.name.toLocaleLowerCase().includes(query));
  }, [characterById, currentMembers, mentionRange]);

  const updateDraft = (value: string, cursor: number) => {
    setDraft(value);
    if (mentionToken) {
      const token = `@${mentionToken.name}`;
      const start = value.indexOf(token, Math.max(0, mentionToken.start - 1));
      const end = start + token.length;
      if (start < 0 || (start > 0 && !/\s/.test(value[start - 1])) || (end < value.length && !/\s/.test(value[end]))) {
        if (mentionTargetId === mentionToken.characterId) setMentionTargetId(null);
        setMentionToken(null);
      } else {
        setMentionToken({ ...mentionToken, start, end });
      }
    }
    setMentionRange(groupMentionAt(value, cursor));
    setMentionIndex(0);
  };

  const chooseMention = (candidate: MentionCandidate) => {
    if (!mentionRange) return;
    const replacement = `@${candidate.name} `;
    const nextDraft = `${draft.slice(0, mentionRange.start)}${replacement}${draft.slice(mentionRange.end)}`;
    const nextCursor = mentionRange.start + replacement.length;
    setDraft(nextDraft);
    setMentionTargetId(candidate.character_id);
    setMentionToken({ characterId: candidate.character_id, name: candidate.name, start: mentionRange.start, end: mentionRange.start + replacement.trimEnd().length });
    setMentionRange(null);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || !group || sending) return;
    const mentionAll = mentionTargetId === ALL_MEMBERS_TARGET;
    const mentionId = mentionAll ? null : mentionTargetId;
    const requestedTargetId = mentionId ?? quoted?.author_character_id ?? null;
    const mentionIds = mentionAll ? currentMembers.map((member) => member.character_id) : requestedTargetId ? [requestedTargetId] : [];
    setSending(true);
    setFailure(null);
    setPartialNotice(null);
    setPendingText(text);
    setDraft("");
    setMentionRange(null);
    setMentionIndex(0);
    setSpeaker(null);
    setStreamingText({ ja: "", zh: "" });
    try {
      for await (const event of sendGroupTurn(
        group.id,
        {
          text,
          mention_character_ids: mentionAll ? [] : mentionIds,
          mention_all: mentionAll,
          reply_to_message_id: replyId,
          client_idempotency_key: crypto.randomUUID(),
        },
        userId,
      )) {
        if (event.type === "user") setPendingText(event.text);
        else if (event.type === "speaker") {
          setSpeaker(event.author_character_id);
          setStreamingText({ ja: "", zh: "" });
        } else if (event.type === "delta") {
          setStreamingText((current) => ({
            ...current,
            [event.lang]: current[event.lang] + event.text,
          }));
        }
        else if (event.type === "partial") {
          setPartialNotice(event.error || t.partial);
        }
        else if (event.type === "done") {
          const roleMessages = event.messages?.length ? event.messages : [event.message];
          setMessages((current) => [
            ...current,
            {
              id: -Date.now(),
              group_id: group.id,
              turn_id: event.turn_id,
              author_kind: "user",
              author_character_id: null,
              author_name_snapshot: null,
              text,
              ja: null,
              zh: null,
              segments: [],
              created_at: new Date().toISOString(),
              reply_to_message_id: replyId,
              mentions: mentionIds,
            },
            ...roleMessages,
          ]);
          if (event.partial) setPartialNotice(t.partial);
          setPendingText(null);
          setStreamingText({ ja: "", zh: "" });
          setReplyId(null);
          setMentionTargetId(null);
          setMentionToken(null);
          setMentionRange(null);
          window.dispatchEvent(new Event("eidolon:groups-changed"));
        } else if (event.type === "error") {
          setFailure(event.message || t.failed);
          setDraft(text);
          setPendingText(null);
          setStreamingText({ ja: "", zh: "" });
        }
      }
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : t.failed);
      setDraft(text);
      setPendingText(null);
      setStreamingText({ ja: "", zh: "" });
    } finally {
      setSending(false);
      setSpeaker(null);
    }
  };

  if (failure && !group) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>{t.loadFailed}</EmptyTitle>
          <EmptyDescription>{failure}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>{onBack && <Button variant="outline" onClick={onBack}>{t.back}</Button>}</EmptyContent>
      </Empty>
    );
  }
  if (!group) {
    return <div className="flex h-full items-center justify-center"><Spinner className="size-6" aria-label={t.loading} /></div>;
  }

  const inCall = groupSnapshot ? groupSnapshot.call.phase === "dialing" || groupSnapshot.call.phase === "connected" : false;
  const memberChangesLocked = inCall || sending;
  const barShown = inCall && groupSnapshot?.layer?.collapsed === true;
  const isLayerOpen = Boolean(groupSnapshot?.layer && !groupSnapshot.layer.collapsed);
  const groupColor = currentMembers.map((member) => characterById.get(member.character_id)?.color).find(Boolean);
  const callColor = groupSnapshot?.speakerId
    ? characterById.get(groupSnapshot.speakerId)?.color ?? groupColor
    : groupColor;
  return (
    <div style={callColor ? herVars(callColor) : undefined} className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <div inert={isLayerOpen} className="contents">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
        {onBack && <Button variant="ghost" size="icon-lg" aria-label={t.back} onClick={onBack}><BackIcon className="size-6" /></Button>}
        <GroupHeaderAvatar group={group} characters={characters} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-header">{groupTitle(group)}</h1>
          <p className="truncate text-meta text-muted-foreground">{t.memberCount(String(currentMembers.length))}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={inCall ? copy.call.expand : `呼叫${groupTitle(group)}`}
          onClick={() => (inCall ? live?.expand() : void live?.startCall())}
          disabled={!live || !groupSnapshot?.group || Boolean(groupSnapshot.failure && !groupSnapshot.group)}
        >
          <PhoneIcon className={cn("size-5 text-her-mark", inCall && "fill-current")} />
        </Button>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={t.members}
          onClick={() => setMemberDialogOpen(true)}
          disabled={memberChangesLocked}
        >
          <GroupIcon aria-hidden />
        </Button>
      </header>

      {barShown && live && <CallBar ref={focus.note} call={groupSnapshot!.call as Extract<GroupCallSnapshot["call"], { phase: "dialing" | "connected" }>} name={groupTitle(group)} avatar={<GroupAvatar group={group} characters={characters} size="bar" />} onExpand={() => live.expand()} />}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 && pendingText === null ? (
          <Empty className="h-full"><EmptyHeader><EmptyTitle>{t.emptyTitle}</EmptyTitle></EmptyHeader></Empty>
        ) : (
          <div className="flex w-full flex-col gap-3">
            {messages.map((message) => (
              <GroupMessageBubble
                key={message.id}
                message={message}
                messages={messages}
                character={message.author_character_id ? characterById.get(message.author_character_id) : undefined}
                onReply={() => {
                  if (message.author_kind !== "character") return;
                  setReplyId(message.id);
                  if (message.author_character_id) {
                    setMentionTargetId(null);
                    setMentionToken(null);
                  }
                }}
              />
            ))}
            {pendingText !== null && (
              <div className="flex justify-end">
                <div className="max-w-[min(30rem,80vw)] rounded-bubble bg-producer-ink px-4 py-2 text-body text-on-producer-ink">
                  {pendingText}
                </div>
              </div>
            )}
            {speaker && (
              <StreamingCharacterBubble
                name={group.current_members.find((member) => member.character_id === speaker)?.name ?? t.character}
                character={characterById.get(speaker)}
                text={streamingText}
              />
            )}
          </div>
        )}
      </div>

      <form
        className="flex shrink-0 flex-col gap-2 border-t bg-background px-3 py-2"
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        {quoted && (
          <div className="flex items-center gap-2 rounded-control bg-muted px-3 py-2 text-meta">
            <ReplyIcon aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{messageAuthor(quoted)}{messagePreview(quoted) && `：${messagePreview(quoted)}`}</span>
            <button type="button" className="text-muted-foreground underline" onClick={() => setReplyId(null)}>{t.cancelQuote}</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="relative">
              {mentionCandidates.length > 0 && (
                <div id="group-mention-list" role="listbox" aria-label={t.chooseTarget} className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-64 overflow-y-auto rounded-lg bg-popover p-1.5 text-popover-foreground shadow-md ring-1 ring-foreground/10 dark:ring-overlay-edge">
                  {mentionCandidates.map((candidate, index) => (
                    <button
                      key={candidate.character_id}
                      type="button"
                      role="option"
                      id={`group-mention-${candidate.character_id}`}
                      aria-selected={index === mentionIndex}
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none", index === mentionIndex ? "bg-muted" : "hover:bg-muted/60")}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseMention(candidate)}
                    >
                      {candidate.kind === "member" ? (
                        <MarkedAvatar name={candidate.name} src={characterById.get(candidate.character_id)?.avatar_url} size="sm" />
                      ) : (
                        <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-muted text-sm">@</span>
                      )}
                      <span className="min-w-0 truncate">{candidate.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <Textarea
                ref={textareaRef}
                variant="composer"
                rows={1}
                value={draft}
                onChange={(event) => updateDraft(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                onKeyDown={(event) => {
                  if (mentionCandidates.length > 0) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setMentionIndex((index) => (index + 1) % mentionCandidates.length);
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setMentionIndex((index) => (index - 1 + mentionCandidates.length) % mentionCandidates.length);
                      return;
                    }
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      chooseMention(mentionCandidates[mentionIndex]);
                      return;
                    }
                  }
                  if (event.key === "Escape" && mentionRange) {
                    event.preventDefault();
                    setMentionRange(null);
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder={t.placeholder}
                aria-label={t.placeholder}
                aria-expanded={mentionCandidates.length > 0}
                aria-controls={mentionCandidates.length > 0 ? "group-mention-list" : undefined}
                aria-activedescendant={mentionCandidates[mentionIndex] ? `group-mention-${mentionCandidates[mentionIndex].character_id}` : undefined}
                disabled={sending}
              />
            </div>
          </div>
          <Button type="submit" size="icon-lg" aria-label={t.send} disabled={!draft.trim() || sending} onMouseDown={(event) => event.preventDefault()}>
            <SendIcon className="size-5" />
          </Button>
        </div>
        {failure && <p role="alert" className="text-meta text-destructive">{failure}</p>}
        {partialNotice && <p role="status" className="text-meta text-muted-foreground">{partialNotice}</p>}
      </form>
      </div>
      <GroupMemberDialog
        open={memberDialogOpen}
        group={group}
        characters={characters}
        locked={memberChangesLocked}
        onOpenChange={setMemberDialogOpen}
        onSaved={(nextGroup) => {
          live?.setGroup(nextGroup);
          setGroup(nextGroup);
          setMentionTargetId((current) => current === ALL_MEMBERS_TARGET || (current && nextGroup.current_members.some((member) => member.character_id === current)) ? current : null);
          setMentionToken((current) => current && (current.characterId === ALL_MEMBERS_TARGET || nextGroup.current_members.some((member) => member.character_id === current.characterId)) ? current : null);
          setReplyId((current) => {
            if (current === null) return null;
            const quotedMessage = messages.find((message) => message.id === current);
            return quotedMessage?.author_character_id &&
              nextGroup.current_members.some((member) => member.character_id === quotedMessage.author_character_id)
              ? current
              : null;
          });
        }}
      />
      {live && <div className="contents"><LiveGroupCallLayer live={live} characters={characters} layerRef={focus.layer} isFullScreen={isFullScreen} /></div>}
    </div>
  );
}

function GroupMessageBubble({
  message,
  messages,
  character,
  onReply,
}: {
  message: GroupMessage;
  messages: readonly GroupMessage[];
  character?: Character;
  onReply: () => void;
}) {
  const text = messageText(message);
  const quoted = replyTarget(message, messages);
  if (message.author_kind === "user") {
    return <div className="flex justify-end"><div className="max-w-[min(30rem,80vw)] rounded-bubble bg-producer-ink px-4 py-2 text-body text-on-producer-ink"><p>{text.zh}</p>{quoted && <p className="mt-1 text-meta text-on-producer-ink/70">{messageAuthor(quoted)}</p>}</div></div>;
  }
  return (
    <div className="flex items-end gap-2">
      <MarkedAvatar name={message.author_name_snapshot ?? t.character} src={character?.avatar_url} size="bubble" />
      <div className="min-w-0 max-w-[min(30rem,80vw)]">
        <p className="mb-1 text-meta text-muted-foreground">{messageAuthor(message)}</p>
        {quoted && <p className="mb-1 rounded-control bg-muted px-3 py-1 text-meta text-muted-foreground">{messageAuthor(quoted)}{messagePreview(quoted) && `：${messagePreview(quoted)}`}</p>}
        <div className="rounded-bubble bg-card px-4 py-2 text-foreground ring-1 ring-border/60">
          {text.ja && <Ja>{text.ja}</Ja>}
          {text.zh && <p className="text-subtitle text-muted-foreground">{text.zh}</p>}
        </div>
        <button type="button" onClick={onReply} className="mt-1 inline-flex items-center gap-1 text-meta text-muted-foreground underline-offset-2 hover:underline">
          <ReplyIcon aria-hidden className="size-3" />
          {copy.groupConversation.quote}
        </button>
      </div>
    </div>
  );
}

function StreamingCharacterBubble({
  name,
  character,
  text,
}: {
  name: string;
  character?: Character;
  text: { ja: string; zh: string };
}) {
  return (
    <div className="flex items-end gap-2">
      <MarkedAvatar name={name} src={character?.avatar_url} size="bubble" />
      <div className="min-w-0 max-w-[min(30rem,80vw)]">
        <p className="mb-1 text-meta text-muted-foreground">{name}</p>
        <div className="rounded-bubble bg-card px-4 py-2 text-foreground ring-1 ring-border/60">
          {text.ja ? <Ja>{text.ja}</Ja> : <p className="text-meta text-muted-foreground">{copy.groupConversation.speaking(name)}</p>}
          {text.zh && <p className="text-subtitle text-muted-foreground">{text.zh}</p>}
        </div>
      </div>
    </div>
  );
}

function GroupHeaderAvatar({ group, characters }: { group: GroupConversation; characters: readonly Character[] }) {
  return <GroupAvatar group={group} characters={characters} />;
}
