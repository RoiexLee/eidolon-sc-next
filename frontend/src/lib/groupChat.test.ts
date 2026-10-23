import { describe, expect, it } from "vitest";

import type { GroupConversation, GroupMessage } from "@/lib/api";
import { currentGroupMembers, groupAvatarMembers, groupTitle, messageAuthor, messagePreview, messageText, replyTarget } from "@/lib/groupChat";

const group: GroupConversation = {
  id: "g1",
  title: null,
  created_at: "2026-10-24T00:00:00Z",
  updated_at: "2026-10-24T00:00:00Z",
  members: [
    { character_id: "a", position: 1, added_at: "", removed_at: null, name_snapshot: "A", current: true, name: "A" },
    { character_id: "old", position: 0, added_at: "", removed_at: "2026-10-23T00:00:00Z", name_snapshot: "Old", current: false, name: "Old" },
    { character_id: "b", position: 2, added_at: "", removed_at: null, name_snapshot: "B", current: true, name: "B" },
  ],
  current_members: [],
  history_members: [],
  last_message: null,
};

function message(partial: Partial<GroupMessage>): GroupMessage {
  return {
    id: 1,
    group_id: "g1",
    turn_id: "t1",
    author_kind: "character",
    author_character_id: "a",
    author_name_snapshot: "A",
    text: null,
    ja: "こんにちは",
    zh: "你好",
    segments: [{ ja: "こんにちは", zh: "你好" }],
    created_at: "",
    reply_to_message_id: null,
    mentions: [],
    ...partial,
  };
}

describe("groupChat", () => {
  it("keeps only current members in position order and uses them for title and avatar", () => {
    expect(currentGroupMembers(group).map((member) => member.character_id)).toEqual(["a", "b"]);
    expect(groupTitle(group)).toBe("A、B");
    expect(groupAvatarMembers(group).map((member) => member.character_id)).toEqual(["a", "b"]);
  });

  it("prefers the explicit title", () => {
    expect(groupTitle({ ...group, title: "制作会议" })).toBe("制作会议");
  });

  it("shows the producer and character message text separately", () => {
    expect(messageAuthor(message({ author_kind: "user", author_name_snapshot: null, text: "嗨", ja: null, zh: null }))).toBe("你");
    expect(messageText(message({ author_kind: "user", text: "嗨", ja: null, zh: null }))).toEqual({ ja: "", zh: "嗨" });
    expect(messageText(message({}))).toEqual({ ja: "こんにちは", zh: "你好" });
    expect(messagePreview(message({}))).toBe("你好");
  });

  it("finds a quoted message only when the reference exists", () => {
    const quoted = message({ id: 3 });
    const reply = message({ id: 4, reply_to_message_id: 3 });
    expect(replyTarget(reply, [quoted, reply])).toEqual(quoted);
    expect(replyTarget(message({ reply_to_message_id: 99 }), [reply])).toBeNull();
  });
});
