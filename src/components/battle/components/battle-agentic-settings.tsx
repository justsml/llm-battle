"use client";

import type { AgenticOptions } from "@/lib/types";

type BattleAgenticSettingsProps = {
  agenticOptions: AgenticOptions;
  onOptionsChange: (updater: (current: AgenticOptions) => AgenticOptions) => void;
};

export function BattleAgenticSettings({
  agenticOptions,
  onOptionsChange,
}: BattleAgenticSettingsProps) {
  return (
    <div className="rise-in mx-auto mt-3 max-w-[1600px] px-4 sm:px-0">
      <section className="panel rounded-[1.75rem] p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-(--muted)">
              Agentic mode
            </p>
            <p className="mt-2 text-sm leading-6 text-(--muted)">
              LLM Tools: `get_screenshot`, `get_console_logs`, `get_html`, and `set_html`.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,220px)]">
            <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-(--muted)">
              <span>Max turns</span>
              <input
                className="rounded-[1rem] border border-(--line) bg-(--card) px-3 py-2 text-sm font-medium tracking-normal text-(--foreground) outline-none transition focus:border-(--accent)"
                max={12}
                min={1}
                onChange={(event) =>
                  onOptionsChange((current) => ({
                    ...current,
                    maxTurns: Math.max(
                      1,
                      Math.min(12, Number(event.target.value) || 1),
                    ),
                  }))
                }
                type="number"
                value={agenticOptions.maxTurns}
              />
            </label>

            <label className="flex items-center gap-3 rounded-[1rem] border border-(--line) bg-(--card) px-3 py-3 text-sm text-(--foreground)">
              <input
                checked={agenticOptions.todoListTool}
                className="h-4 w-4 accent-[var(--accent)]"
                onChange={(event) =>
                  onOptionsChange((current) => ({
                    ...current,
                    todoListTool: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span>Enable `todo_list` tool</span>
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}
