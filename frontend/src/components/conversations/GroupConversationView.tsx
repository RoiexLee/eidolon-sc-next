"use client";

import { useEffect, useMemo, useState } from "react";

import { MarkedAvatar } from "@/components/app/MarkedAvatar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { groupTitle, messageAuthor, messagePreview, messageText, replyTarget, ROUND_ROBIN_TARGET } from "@/lib/groupChat";
import { BackIcon, MentionIcon, ReplyIcon, SendIcon } from "@/theme/icons";
import { Ja } from "@/theme/Ja";

const t = copy.groupConversation;

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
  const [group, setGroup] = useState<GroupConversation | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [replyId, setReplyId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState({ ja: "", zh: "" });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    setGroup(null);
    setMessages([]);
    setFailure(null);
    void Promise.all([getGroup(groupId), listGroupMessages(groupId)])
      .then(([nextGroup, nextMessages]) => {
        if (!active) return;
        setGroup(nextGroup);
        setMessages(nextMessages);
        setTargetId(nextGroup.current_members[0]?.character_id ?? null);
      })
      .catch((reason) => active && setFailure(reason instanceof Error ? reason.message : t.loadFailed));
    return () => {
      active = false;
    };
  }, [groupId]);

  const currentMembers = group?.current_members ?? [];
  const characterById = useMemo(() => new Map(characters.map((character) => [character.id, character])), [characters]);
  const quoted = replyId === null ? null : messages.find((message) => message.id === replyId) ?? null;

  const submit = async () => {
    const text = draft.trim();
    if (!text || !group || !targetId || sending) return;
    setSending(true);
    setFailure(null);
    setPendingText(text);
    setDraft("");
    setSpeaker(null);
    setStreamingText({ ja: "", zh: "" });
    try {
      for await (const event of sendGroupTurn(
        group.id,
        {
          text,
          mention_character_ids: targetId === ROUND_ROBIN_TARGET ? [] : [targetId],
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
        else if (event.type === "done") {
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
              mentions: targetId === ROUND_ROBIN_TARGET ? [] : [targetId],
            },
            event.message,
          ]);
          setPendingText(null);
          setStreamingText({ ja: "", zh: "" });
          setReplyId(null);
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
        {onBack && <Button variant="ghost" size="icon-lg" aria-label={t.back} onClick={onBack}><BackIcon className="size-6" /></Button>}
        <GroupHeaderAvatar group={group} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-header">{groupTitle(group)}</h1>
          <p className="truncate text-meta text-muted-foreground">{t.memberCount(String(currentMembers.length))}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 && pendingText === null ? (
          <Empty className="h-full"><EmptyHeader><EmptyTitle>{t.emptyTitle}</EmptyTitle></EmptyHeader></Empty>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            {messages.map((message) => (
              <GroupMessageBubble
                key={message.id}
                message={message}
                messages={messages}
                character={message.author_character_id ? characterById.get(message.author_character_id) : undefined}
                onReply={() => message.author_kind === "character" && setReplyId(message.id)}
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
            <Select value={targetId ?? ""} onValueChange={(value) => setTargetId(value || null)} disabled={sending}>
              <SelectTrigger aria-label={t.chooseTarget} className="w-full">
                <MentionIcon className="size-4 text-muted-foreground" />
                <SelectValue placeholder={t.chooseTarget} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROUND_ROBIN_TARGET}>{copy.groupConversation.roundRobin}</SelectItem>
                {currentMembers.map((member) => <SelectItem key={member.character_id} value={member.character_id}>{member.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Textarea
              variant="composer"
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder={t.placeholder}
              aria-label={t.placeholder}
              disabled={sending}
            />
          </div>
          <Button type="submit" size="icon-lg" aria-label={t.send} disabled={!draft.trim() || !targetId || sending} onMouseDown={(event) => event.preventDefault()}>
            <SendIcon className="size-5" />
          </Button>
        </div>
        {failure && <p role="alert" className="text-meta text-destructive">{failure}</p>}
      </form>
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

function GroupHeaderAvatar({ group }: { group: GroupConversation }) {
  return <MarkedAvatar name={groupTitle(group)} size="lg" />;
}
