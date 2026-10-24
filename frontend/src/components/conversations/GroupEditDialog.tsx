"use client";

import { useEffect, useMemo, useState } from "react";

import { MarkedAvatar } from "@/components/app/MarkedAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { copy } from "@/i18n";
import { updateGroup, type Character, type GroupConversation } from "@/lib/api";
import { cn } from "@/lib/utils";

const t = copy.groupConversation;
const DERIVED_AVATAR = "__derived__";

export function GroupEditDialog({
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
  locked?: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (group: GroupConversation) => void;
}) {
  const [title, setTitle] = useState("");
  const [avatar, setAvatar] = useState(DERIVED_AVATAR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(group.title ?? "");
    setAvatar(group.avatar_character_id ?? DERIVED_AVATAR);
    setError(null);
  }, [group, open]);

  const options = useMemo(
    () => group.current_members.map((member) => ({
      id: member.character_id,
      name: member.name,
      avatar: characters.find((character) => character.id === member.character_id)?.avatar_url,
    })),
    [characters, group.current_members],
  );

  const submit = async () => {
    if (busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      const nextGroup = await updateGroup(group.id, {
        title: title.trim() || null,
        avatar_character_id: avatar === DERIVED_AVATAR ? null : avatar,
        add_character_ids: [],
        remove_character_ids: [],
      });
      onSaved(nextGroup);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.groupEditFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.groupEditTitle}</DialogTitle>
          <DialogDescription>{t.groupEditDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="group-title">{t.groupEditName}</Label>
          <Input
            id="group-title"
            value={title}
            maxLength={100}
            disabled={busy || locked}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t.groupEditNamePlaceholder}
          />
        </div>
        <div className="grid gap-2">
          <Label>{t.groupEditAvatar}</Label>
          <RadioGroup value={avatar} onValueChange={setAvatar} className="grid gap-1">
            <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60", avatar === DERIVED_AVATAR && "bg-muted")}>
              <RadioGroupItem value={DERIVED_AVATAR} disabled={busy || locked} aria-label={t.groupEditAvatarDerived} />
              <span className="grid size-8 grid-cols-2 grid-rows-2 overflow-hidden rounded-full bg-muted text-meta text-muted-foreground" aria-hidden>
                {options.slice(0, 4).map((option) => <span key={option.id} className="flex items-center justify-center">{Array.from(option.name)[0]}</span>)}
              </span>
              <span className="text-row-name">{t.groupEditAvatarDerived}</span>
            </label>
            {options.map((option) => (
              <label key={option.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60", avatar === option.id && "bg-muted")}>
                <RadioGroupItem value={option.id} disabled={busy || locked} aria-label={option.name} />
                <MarkedAvatar name={option.name} src={option.avatar} size="sm" />
                <span className="min-w-0 flex-1 truncate text-row-name">{option.name}</span>
              </label>
            ))}
          </RadioGroup>
        </div>
        {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{copy.common.cancel}</Button>
          <Button disabled={busy || locked} onClick={() => void submit()}>{t.groupEditSubmit}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
