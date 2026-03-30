"use client";

import type { ModelTraceEvent } from "@/lib/types";

import {
  describeTraceEvent,
  formatDuration,
  formatTimeAgo,
  formatTokenCount,
} from "../lib/view-shared";

type TraceTimelineProps = {
  events: ModelTraceEvent[];
};

export function TraceTimeline({ events }: TraceTimelineProps) {
  if (!events.length) {
    return (
      <div className="rounded-[1rem] border border-dashed border-(--line) px-3 py-4 text-sm text-(--muted)">
        No agent trace captured yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((event, index) => (
        <div
          className="rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-3"
          key={`${event.type}-${event.timestamp}-${index}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-(--foreground)">
              {describeTraceEvent(event)}
            </p>
            <span className="text-[11px] uppercase tracking-[0.16em] text-(--muted)">
              {formatTimeAgo(event.timestamp)}
            </span>
          </div>
          <p className="mt-1 text-xs text-(--muted)">
            {event.type === "tool-call" && event.input != null
              ? JSON.stringify(event.input)
              : event.type === "tool-result" && event.durationMs != null
                ? `Completed in ${formatDuration(event.durationMs)}`
                : event.type === "tool-error"
                  ? event.error
                  : event.type === "repair-complete" && event.htmlLength != null
                    ? `${formatTokenCount(event.htmlLength)} chars in repaired output`
                    : event.type === "agent-step" && event.finishReason
                      ? event.finishReason
                      : event.type === "done" && event.finishReason
                        ? event.finishReason
                        : event.type === "error"
                          ? event.error
                          : " "}
          </p>
        </div>
      ))}
    </div>
  );
}
