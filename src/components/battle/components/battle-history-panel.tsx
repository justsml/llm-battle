"use client";

import { cn } from "@/lib/utils";
import type { SavedRun } from "@/lib/types";

type BattleHistoryPanelProps = {
  activeRunId: string | null;
  formatTimestamp: (value: string) => string;
  isLoadingRuns: boolean;
  runs: SavedRun[];
  runsError: string;
  onSelectRun: (run: SavedRun) => void;
};

export function BattleHistoryPanel({
  activeRunId,
  formatTimestamp,
  isLoadingRuns,
  runs,
  runsError,
  onSelectRun,
}: BattleHistoryPanelProps) {
  return (
    <div className="rise-in mx-auto mt-3 max-w-[1600px] overflow-hidden rounded-[1.75rem] border border-(--line) bg-(--card) p-4 px-4 sm:px-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold tracking-[-0.01em]">
          Run history
        </p>
        <span className="text-xs text-(--muted)">
          {isLoadingRuns ? "Refreshing…" : `${runs.length} saved`}
        </span>
      </div>
      {runsError ? (
        <div className="mb-3 rounded-[1.1rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-4 py-3 text-sm text-(--danger)">
          {runsError}
        </div>
      ) : null}
      {runs.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {runs.map((run, index) => (
            <button
              key={run.id}
              className={cn(
                "w-full rounded-[1.3rem] border px-4 py-3 text-left transition hover:bg-(--card-active)",
                activeRunId === run.id
                  ? "border-(--foreground) bg-(--card-active)"
                  : "border-(--line)",
              )}
              onClick={() => onSelectRun(run)}
              type="button"
            >
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-(--muted)">
                  Run {runs.length - index}
                </span>
                <span className="text-[11px] text-(--muted)">
                  {formatTimestamp(run.createdAt)}
                </span>
              </div>
              <p className="line-clamp-2 text-xs leading-5">{run.prompt}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-[1.5rem] border border-dashed border-(--line) px-5 py-6 text-center text-sm text-(--muted)">
          {isLoadingRuns ? "Loading…" : "No saved runs yet."}
        </div>
      )}
    </div>
  );
}
