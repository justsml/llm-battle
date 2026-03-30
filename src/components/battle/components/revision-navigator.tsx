"use client";

import type { ModelOutputRevision } from "@/lib/types";
import { cn } from "@/lib/utils";

import { formatOutputRevisionMeta } from "../lib/view-shared";

type RevisionNavigatorProps = {
  revisions: ModelOutputRevision[];
  selectedIndex: number;
  onSelect: (revisionId: string) => void;
  compact?: boolean;
};

export function RevisionNavigator({
  revisions,
  selectedIndex,
  onSelect,
  compact = false,
}: RevisionNavigatorProps) {
  if (!revisions.length) {
    return null;
  }

  const selectedRevision = revisions[selectedIndex] ?? revisions.at(-1) ?? null;
  const disablePrevious = selectedIndex <= 0;
  const disableNext = selectedIndex >= revisions.length - 1;

  return (
    <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
            HTML revisions
          </p>
          {selectedRevision ? (
            <p className="mt-1 text-sm text-(--foreground)">
              {formatOutputRevisionMeta(selectedRevision, selectedIndex, revisions.length)}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-full border border-(--line) px-3 py-1 text-xs font-medium transition hover:bg-(--card-active) disabled:cursor-not-allowed disabled:opacity-45"
            disabled={disablePrevious}
            onClick={() => onSelect(revisions[Math.max(0, selectedIndex - 1)].id)}
            type="button"
          >
            Prev
          </button>
          <button
            className="rounded-full border border-(--line) px-3 py-1 text-xs font-medium transition hover:bg-(--card-active) disabled:cursor-not-allowed disabled:opacity-45"
            disabled={disableNext}
            onClick={() => onSelect(revisions[Math.min(revisions.length - 1, selectedIndex + 1)].id)}
            type="button"
          >
            Next
          </button>
        </div>
      </div>
      {!compact ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {revisions.map((revision, index) => (
            <button
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                index === selectedIndex
                  ? "border-(--foreground) bg-(--card-active) text-(--foreground)"
                  : "border-(--line) text-(--muted) hover:bg-(--card-active)",
              )}
              key={revision.id}
              onClick={() => onSelect(revision.id)}
              type="button"
            >
              {index + 1}. {revision.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
