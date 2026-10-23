"use client";

import { useEffect, useState } from "react";

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
import { createGroup, type Character, type GroupConversation } from "@/lib/api";
import { cn } from "@/lib/utils";

const t = copy.conversationList;

export function GroupCreateDialog({
  open,
  characters,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  characters: Character[];
  onOpenChange: (open: boolean) => void;
  onCreated: (group: GroupConversation) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected([]);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (selected.length < 2 || selected.length > 5 || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createGroup(selected));
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.groupCreateFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.groupCreateTitle}</DialogTitle>
          <DialogDescription>{t.groupCreateDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[min(60vh,28rem)] gap-1 overflow-y-auto">
          {characters.map((character) => {
            const checked = selected.includes(character.id);
            return (
              <label
                key={character.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 outline-none hover:bg-muted/60 focus-within:ring-3 focus-within:ring-ring/50",
                  checked && "bg-muted",
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={!checked && selected.length >= 5}
                  onCheckedChange={(value) =>
                    setSelected((current) =>
                      value ? [...current, character.id] : current.filter((id) => id !== character.id),
                    )
                  }
                  aria-label={character.name}
                />
                <span className="min-w-0 flex-1 truncate text-row-name">{character.name}</span>
              </label>
            );
          })}
        </div>
        <p className="text-meta text-muted-foreground" aria-live="polite">
          {selected.length < 2 ? t.groupCreateTooFew : selected.length > 5 ? t.groupCreateTooMany : `${selected.length} / 5`}
          {error && <span className="ml-2 text-destructive">{error}</span>}
        </p>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {copy.common.cancel}
          </Button>
          <Button disabled={selected.length < 2 || selected.length > 5 || busy} onClick={() => void submit()}>
            {t.groupCreateSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
