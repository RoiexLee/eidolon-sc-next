"use client";

import { useEffect, useMemo, useState } from "react";

import { MarkedAvatar } from "@/components/app/MarkedAvatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copy } from "@/i18n";
import { updateGroup, type Character, type GroupConversation } from "@/lib/api";
import { groupMemberPatch, validGroupMemberCount } from "@/lib/groupChat";
import { cn } from "@/lib/utils";

const t = copy.groupConversation;

export function GroupMemberDialog({
  open,
  group,
  characters,
  locked = false,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  group: GroupConversation;
  characters: readonly Character[];
  /** A call or text turn is running; member changes must wait until it ends. */
  locked?: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (group: GroupConversation) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(group.current_members.map((member) => member.character_id));
    setError(null);
  }, [group, open]);

  const options = useMemo(() => {
    const current = group.current_members.map((member) => ({
      id: member.character_id,
      name: member.name,
      avatar: characters.find((character) => character.id === member.character_id)?.avatar_url,
    }));
    const currentIds = new Set(current.map(({ id }) => id));
    return [
      ...current,
      ...characters
        .filter((character) => !currentIds.has(character.id))
        .map((character) => ({ id: character.id, name: character.name, avatar: character.avatar_url })),
    ];
  }, [characters, group.current_members]);

  const invalidCount = !validGroupMemberCount(selected.length);

  const submit = async () => {
    if (busy || locked || invalidCount) return;
    const { add_character_ids: addCharacterIds, remove_character_ids: removeCharacterIds } = groupMemberPatch(
      group.current_members.map((member) => member.character_id),
      selected,
    );
    if (addCharacterIds.length === 0 && removeCharacterIds.length === 0) {
      onOpenChange(false);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const nextGroup = await updateGroup(group.id, {
        add_character_ids: addCharacterIds,
        remove_character_ids: removeCharacterIds,
      });
      onSaved(nextGroup);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.memberManageFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.memberManageTitle}</DialogTitle>
          <DialogDescription>{t.memberManageDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[min(60vh,28rem)] gap-1 overflow-y-auto">
          {options.map((option) => {
            const checked = selected.includes(option.id);
            return (
              <label
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 outline-none hover:bg-muted/60 focus-within:ring-3 focus-within:ring-ring/50",
                  checked && "bg-muted",
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={busy || locked || (!checked && selected.length >= 5)}
                  onCheckedChange={(value) =>
                    setSelected((current) =>
                      value ? [...current, option.id] : current.filter((id) => id !== option.id),
                    )
                  }
                  aria-label={option.name}
                />
                <MarkedAvatar name={option.name} src={option.avatar} size="sm" />
                <span className="min-w-0 flex-1 truncate text-row-name">{option.name}</span>
              </label>
            );
          })}
        </div>
        <p className="text-meta text-muted-foreground" aria-live="polite">
          {selected.length < 2 ? t.memberManageTooFew : selected.length > 5 ? t.memberManageTooMany : `${selected.length} / 5`}
        </p>
        {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {copy.common.cancel}
          </Button>
          <Button disabled={invalidCount || busy || locked} onClick={() => void submit()}>
            {t.memberManageSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
