import type { GroupConversation, GroupMember, GroupMessage } from "@/lib/api";

/** Select values cannot be empty; this value maps to an empty mentions request. */
export const ROUND_ROBIN_TARGET = "__round_robin__";
export const ALL_MEMBERS_TARGET = "__all_members__";

export type GroupMentionMatch = { start: number; end: number; query: string };

export function groupMentionAt(value: string, cursor: number): GroupMentionMatch | null {
  const before = value.slice(0, cursor);
  const start = before.lastIndexOf("@");
  if (start < 0 || (start > 0 && !/\s/.test(before[start - 1]))) return null;
  const query = before.slice(start + 1);
  return /\s/.test(query) ? null : { start, end: cursor, query };
}

export function groupMemberPatch(currentIds: readonly string[], selectedIds: readonly string[]): {
  add_character_ids: string[];
  remove_character_ids: string[];
} {
  const current = new Set(currentIds);
  const selected = new Set(selectedIds);
  return {
    add_character_ids: selectedIds.filter((id) => !current.has(id)),
    remove_character_ids: currentIds.filter((id) => !selected.has(id)),
  };
}

export function validGroupMemberCount(count: number): boolean {
  return count >= 2 && count <= 5;
}

export function currentGroupMembers(group: GroupConversation): GroupMember[] {
  return group.members.filter((member) => member.current).sort((a, b) => a.position - b.position);
}

export function groupTitle(group: GroupConversation): string {
  return group.title?.trim() || currentGroupMembers(group).map((member) => member.name).join("、");
}

export function groupAvatarMembers(group: GroupConversation): GroupMember[] {
  return currentGroupMembers(group).slice(0, 3);
}

export function messageAuthor(message: GroupMessage): string {
  return message.author_kind === "user" ? "你" : message.author_name_snapshot ?? "角色";
}

export function replyTarget(message: GroupMessage, messages: readonly GroupMessage[]): GroupMessage | null {
  if (message.reply_to_message_id === null) return null;
  return messages.find((candidate) => candidate.id === message.reply_to_message_id) ?? null;
}

export function messageText(message: GroupMessage): { ja: string; zh: string } {
  if (message.author_kind === "user") return { ja: "", zh: message.text ?? "" };
  return { ja: message.ja ?? message.segments.map((segment) => segment.ja).join(""), zh: message.zh ?? message.segments.map((segment) => segment.zh).join("") };
}

export function messagePreview(message: GroupMessage): string {
  const text = messageText(message);
  return text.zh || text.ja;
}
