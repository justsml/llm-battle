"use client";

import {
  getCollapsedModelLabel,
  getHistogramValue,
  sortAggregatesByMetric,
  type HistogramMetricConfig,
  type ModelAggregate,
} from "../lib/stats-shared";

type HistogramPanelProps = {
  title: string;
  subtitle: string;
  entries: ModelAggregate[];
  metric: HistogramMetricConfig;
};

export function HistogramPanel({
  title,
  subtitle,
  entries,
  metric,
}: HistogramPanelProps) {
  const ranked = sortAggregatesByMetric(entries, metric.key, metric.preferLower)
    .filter((entry) => getHistogramValue(entry, metric.key) != null)
    .slice(0, 6);
  const maxValue = ranked.reduce((max, entry) => {
    const value = getHistogramValue(entry, metric.key) ?? 0;
    return Math.max(max, value);
  }, 0);

  return (
    <div className="rounded-[1.6rem] border border-(--line) bg-[linear-gradient(180deg,color-mix(in_oklch,var(--panel)_94%,transparent),color-mix(in_oklch,var(--card)_94%,transparent))] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
        {title}
      </p>
      <p className="mt-1 text-sm text-[color-mix(in_oklch,var(--foreground)_72%,transparent)]">
        {subtitle}
      </p>

      <div className="mt-4 space-y-3">
        {ranked.length ? (
          ranked.map((entry, index) => {
            const value = getHistogramValue(entry, metric.key);
            const width = maxValue > 0 && value != null ? Math.max((value / maxValue) * 100, 8) : 0;

            return (
              <div key={`${metric.key}:${entry.modelId}`}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {index + 1}. {getCollapsedModelLabel(entry.modelId)}
                    </p>
                    <p className="truncate text-[11px] text-(--muted)">{entry.modelId}</p>
                  </div>
                  <span className="shrink-0 text-sm font-medium">{metric.formatter(value)}</span>
                </div>
                <div className="h-2.5 rounded-full bg-[color-mix(in_oklch,var(--foreground)_7%,transparent)]">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{
                      width: `${width}%`,
                      background: `linear-gradient(90deg, ${metric.accent}, color-mix(in srgb, ${metric.accent} 55%, white))`,
                    }}
                  />
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-[1rem] border border-dashed border-(--line) px-4 py-6 text-sm text-(--muted)">
            No model aggregates available for this metric.
          </div>
        )}
      </div>
    </div>
  );
}
