import type { GroupConversation, GroupMember, GroupMessage } from "@/lib/api";

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
