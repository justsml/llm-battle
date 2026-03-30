"use client";

import {
  formatPercent,
  formatTokenCount,
  type PieSlice,
} from "../lib/stats-shared";

type PieChartProps = {
  slices: PieSlice[];
  centerLabel: string;
  centerValue: string;
};

export function PieChart({
  slices,
  centerLabel,
  centerValue,
}: PieChartProps) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const chartSlices = slices.map((slice, index) => {
    const segmentLength = total ? (slice.value / total) * circumference : 0;
    const segmentOffset = slices
      .slice(0, index)
      .reduce((sum, previous) => sum + (total ? (previous.value / total) * circumference : 0), 0);

    return {
      ...slice,
      segmentLength,
      segmentOffset,
    };
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[140px_minmax(0,1fr)] lg:items-center">
      <div className="relative mx-auto h-36 w-36">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
          <circle
            cx="60"
            cy="60"
            fill="none"
            r={radius}
            stroke="color-mix(in oklch, var(--foreground) 8%, transparent)"
            strokeWidth="18"
          />
          {chartSlices.map((slice) => (
            <circle
              cx="60"
              cy="60"
              fill="none"
              key={slice.label}
              r={radius}
              stroke={slice.color}
              strokeDasharray={`${slice.segmentLength} ${circumference - slice.segmentLength}`}
              strokeDashoffset={-slice.segmentOffset}
              strokeLinecap="butt"
              strokeWidth="18"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] uppercase tracking-[0.18em] text-(--muted)">
            {centerLabel}
          </span>
          <span className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
            {centerValue}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {slices.length ? (
          slices.map((slice) => {
            const share = total ? (slice.value / total) * 100 : 0;
            return (
              <div
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[1rem] bg-[color-mix(in_oklch,var(--foreground)_3%,transparent)] px-3 py-2.5"
                key={slice.label}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="truncate text-sm font-medium capitalize">{slice.label}</span>
                <span className="text-xs text-(--muted)">
                  {formatPercent(share)} · {formatTokenCount(slice.value)}
                </span>
              </div>
            );
          })
        ) : (
          <div className="rounded-[1rem] border border-dashed border-(--line) px-4 py-6 text-sm text-(--muted)">
            No slices to chart yet.
          </div>
        )}
      </div>
    </div>
  );
}
