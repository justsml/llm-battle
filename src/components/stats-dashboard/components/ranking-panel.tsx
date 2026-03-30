"use client";

import {
  getCollapsedModelLabel,
  getHistogramValue,
  sortAggregatesByMetric,
  type ModelAggregate,
  type RankingMetricConfig,
} from "../lib/stats-shared";

type RankingPanelProps = {
  title: string;
  entries: ModelAggregate[];
  metric: RankingMetricConfig;
};

export function RankingPanel({
  title,
  entries,
  metric,
}: RankingPanelProps) {
  const ranked = sortAggregatesByMetric(entries, metric.key, metric.preferLower)
    .filter((entry) => getHistogramValue(entry, metric.key) != null)
    .slice(0, 5);

  return (
    <div className="rounded-[1.5rem] border border-(--line) bg-(--card) p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
        {title}
      </p>
      <p className="mt-1 text-xs leading-5 text-(--muted)">{metric.note}</p>

      <div className="mt-4 space-y-2">
        {ranked.length ? (
          ranked.map((entry, index) => (
            <div
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[1rem] bg-[color-mix(in_oklch,var(--foreground)_3%,transparent)] px-3 py-2.5"
              key={`${metric.key}:${entry.modelId}`}
            >
              <span className="text-sm font-semibold text-(--muted)">{index + 1}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {getCollapsedModelLabel(entry.modelId)}
                </p>
                <p className="truncate text-[11px] text-(--muted)">{entry.modelId}</p>
              </div>
              <span className="text-sm font-medium">
                {metric.formatter(getHistogramValue(entry, metric.key))}
              </span>
            </div>
          ))
        ) : (
          <div className="rounded-[1rem] border border-dashed border-(--line) px-4 py-6 text-sm text-(--muted)">
            Not enough data in the current filter.
          </div>
        )}
      </div>
    </div>
  );
}
