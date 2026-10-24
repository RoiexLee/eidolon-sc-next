import { groupAvatarMembers, groupTitle } from "@/lib/groupChat";
import type { Character, GroupConversation } from "@/lib/api";
import { cn } from "@/lib/utils";

/** A group avatar derived from the stable current-member order. It stores no image of its own. */
export function GroupAvatar({ group, characters = [], size = "lg" }: { group: GroupConversation; characters?: readonly Character[]; size?: "bar" | "lg" | "list" | "call" }) {
  const members = groupAvatarMembers(group);
  const byId = new Map(characters.map((character) => [character.id, character]));
  return (
    <span
      aria-label={groupTitle(group)}
      className={cn(
        "grid shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-full bg-muted text-meta text-muted-foreground",
        size === "call" ? "size-28" : size === "list" ? "size-list-avatar" : size === "bar" ? "size-6" : "size-12",
      )}
    >
      {members.map((member, index) => (
        <span key={`${member.character_id}-${index}`} className="flex items-center justify-center">
          {byId.get(member.character_id)?.avatar_url ? (
            <img src={byId.get(member.character_id)?.avatar_url ?? ""} alt="" className="size-full object-cover" />
          ) : Array.from(member.name)[0]}
        </span>
      ))}
    </span>
  );
}
