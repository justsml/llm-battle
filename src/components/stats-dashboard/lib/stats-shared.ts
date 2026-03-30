import type { ModelResult } from "@/lib/types";

export type ModelAggregate = {
  modelId: string;
  label: string;
  runs: number;
  completed: number;
  errored: number;
  avgScore?: number;
  avgLatencyMs?: number;
  avgRuntimeMs?: number;
  avgTotalTokens?: number;
  avgToolCalls?: number;
  avgTokensPerSecond?: number;
  totalCost?: number;
  successRate?: number;
  lastSeenAt: string;
};

export type HistogramMetricKey =
  | "avgScore"
  | "successRate"
  | "avgRuntimeMs"
  | "avgTotalTokens"
  | "avgTokensPerSecond"
  | "totalCost";

export type HistogramMetricConfig = {
  key: HistogramMetricKey;
  label: string;
  accent: string;
  preferLower: boolean;
  formatter: (value?: number) => string;
};

export type RankingMetricConfig = {
  key: HistogramMetricKey | "avgLatencyMs";
  label: string;
  note: string;
  preferLower: boolean;
  formatter: (value?: number) => string;
};

export type PieSlice = {
  label: string;
  value: number;
  color: string;
};

export function formatTokenCount(value?: number) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat().format(value);
}

export function formatPercent(value?: number) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(value >= 99 || value <= 1 ? 0 : 1)}%`;
}

export function getCollapsedModelLabel(modelId: string) {
  const simplified = modelId.split("/").filter(Boolean).at(-1);
  return simplified ?? modelId;
}

export function getStatusTone(status: ModelResult["status"]) {
  if (status === "done") {
    return "border-[color-mix(in_oklch,var(--success)_35%,transparent)] bg-[color-mix(in_oklch,var(--success)_16%,transparent)] text-(--foreground)";
  }

  if (status === "error") {
    return "border-[color-mix(in_oklch,var(--danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--danger)_16%,transparent)] text-(--foreground)";
  }

  if (status === "streaming") {
    return "border-[color-mix(in_oklch,var(--accent)_35%,transparent)] bg-[color-mix(in_oklch,var(--accent)_16%,transparent)] text-(--foreground)";
  }

  return "border-(--line) bg-(--card) text-(--muted)";
}

export function getHistogramValue(
  entry: ModelAggregate,
  key: HistogramMetricKey | "avgLatencyMs",
) {
  return entry[key];
}

export function sortAggregatesByMetric(
  entries: ModelAggregate[],
  key: HistogramMetricKey | "avgLatencyMs",
  preferLower: boolean,
) {
  return [...entries].sort((left, right) => {
    const leftValue = getHistogramValue(left, key);
    const rightValue = getHistogramValue(right, key);

    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;

    return preferLower ? leftValue - rightValue : rightValue - leftValue;
  });
}
