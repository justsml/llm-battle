"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useState } from "react";

import { HistogramPanel } from "@/components/stats-dashboard/components/histogram-panel";
import { PieChart } from "@/components/stats-dashboard/components/pie-chart";
import { RankingPanel } from "@/components/stats-dashboard/components/ranking-panel";
import {
  formatPercent,
  formatTokenCount,
  getCollapsedModelLabel,
  getHistogramValue,
  getStatusTone,
  sortAggregatesByMetric,
  type HistogramMetricConfig,
  type HistogramMetricKey,
  type ModelAggregate,
  type PieSlice,
  type RankingMetricConfig,
} from "@/components/stats-dashboard/lib/stats-shared";
import type { ModelResult, SavedRun } from "@/lib/types";
import { cn, sanitizeTokensPerSecond } from "@/lib/utils";

type FlattenedResult = {
  id: string;
  runId: string;
  runCreatedAt: string;
  runPrompt: string;
  modelIndex: number;
  modelId: string;
  label: string;
  result: ModelResult;
};

type LeaderboardSortKey =
  | "avgScore"
  | "successRate"
  | "avgLatencyMs"
  | "avgRuntimeMs"
  | "avgTotalTokens"
  | "avgToolCalls"
  | "avgTokensPerSecond"
  | "totalCost"
  | "lastSeenAt";

type ResultSortKey =
  | "runCreatedAt"
  | "modelId"
  | "status"
  | "score"
  | "latencyMs"
  | "runtimeMs"
  | "totalTokens"
  | "toolCalls"
  | "tokensPerSecond"
  | "cost";

type ScopeMode = "all" | "run" | "range";

const STATUS_COLORS: Record<ModelResult["status"], string> = {
  done: "#0f8a62",
  error: "#c14953",
  streaming: "#d88716",
  idle: "#6d7485",
};

const PIE_COLORS = [
  "#d95f3c",
  "#5a7dff",
  "#1d9b7d",
  "#d59d1d",
  "#9757d7",
  "#4d6b51",
  "#ce4a8b",
  "#7b6d5d",
];

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatScopeLabel(scope: ScopeMode, selectedRun?: SavedRun | null) {
  if (scope === "run" && selectedRun) {
    return `Single run from ${formatTimestamp(selectedRun.createdAt)}`;
  }

  if (scope === "range") {
    return "Custom time range";
  }

  return "All saved runs";
}

function formatTimeAgo(value: string) {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return "—";

  const diffSeconds = Math.round((ms - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });
  const ranges = [
    { unit: "year", seconds: 31_536_000 },
    { unit: "month", seconds: 2_592_000 },
    { unit: "week", seconds: 604_800 },
    { unit: "day", seconds: 86_400 },
    { unit: "hour", seconds: 3_600 },
    { unit: "minute", seconds: 60 },
  ] as const;

  for (const range of ranges) {
    if (Math.abs(diffSeconds) >= range.seconds) {
      return formatter.format(Math.round(diffSeconds / range.seconds), range.unit);
    }
  }

  return formatter.format(diffSeconds, "second");
}

function formatDuration(ms?: number) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
}

function formatCost(value?: number) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0.000000";

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatTokensPerSecond(value?: number) {
  const sanitizedValue = sanitizeTokensPerSecond(value);
  if (sanitizedValue == null) return "—";
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits:
      sanitizedValue >= 100 ? 0 : sanitizedValue >= 10 ? 1 : 2,
  }).format(sanitizedValue)}/s`;
}

function formatVoteScore(score?: number) {
  if (score == null || !Number.isFinite(score)) return "—";
  if (score > 0) return `+${score.toFixed(score % 1 === 0 ? 0 : 1)}`;
  return score.toFixed(score % 1 === 0 ? 0 : 1);
}

function getResultSortValue(entry: FlattenedResult, key: ResultSortKey) {
  switch (key) {
    case "runCreatedAt":
      return new Date(entry.runCreatedAt).getTime();
    case "modelId":
      return entry.modelId.toLowerCase();
    case "status":
      return entry.result.status;
    case "score":
      return entry.result.vote?.score ?? 0;
    case "latencyMs":
      return entry.result.latencyMs ?? Number.POSITIVE_INFINITY;
    case "runtimeMs":
      return entry.result.runtimeMs ?? Number.POSITIVE_INFINITY;
    case "totalTokens":
      return entry.result.usage?.totalTokens ?? -1;
    case "toolCalls":
      return entry.result.stats?.toolCallCount ?? -1;
    case "tokensPerSecond":
      return sanitizeTokensPerSecond(entry.result.stats?.tokensPerSecond) ?? -1;
    case "cost":
      return entry.result.costs?.total ?? -1;
    default:
      return 0;
  }
}

function compareValues(left: string | number, right: string | number) {
  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right);
  }

  return Number(left) - Number(right);
}

function getDateDaysAgo(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return formatDateInputValue(date);
}

function normalizeDateRange(start: string, end: string) {
  const startMs = start ? new Date(`${start}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const endMs = end ? new Date(`${end}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;

  return {
    startMs,
    endMs,
    isValid: Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= endMs,
  };
}

function buildModelShareSlices(entries: ModelAggregate[]) {
  const ranked = [...entries].sort((left, right) => right.runs - left.runs);
  const top = ranked.slice(0, 5).map((entry, index) => ({
    label: getCollapsedModelLabel(entry.modelId),
    value: entry.runs,
    color: PIE_COLORS[index % PIE_COLORS.length],
  }));
  const remaining = ranked.slice(5).reduce((sum, entry) => sum + entry.runs, 0);

  if (remaining > 0) {
    top.push({
      label: "Other",
      value: remaining,
      color: "#80776d",
    });
  }

  return top;
}

function buildStatusSlices(entries: FlattenedResult[]) {
  const counts = new Map<ModelResult["status"], number>();

  for (const entry of entries) {
    counts.set(entry.result.status, (counts.get(entry.result.status) ?? 0) + 1);
  }

  return (Object.keys(STATUS_COLORS) as ModelResult["status"][])
    .map((status) => ({
      label: status,
      value: counts.get(status) ?? 0,
      color: STATUS_COLORS[status],
    }))
    .filter((slice) => slice.value > 0);
}

export function StatsDashboardClient() {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ModelResult["status"]>("all");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [rangeStart, setRangeStart] = useState(getDateDaysAgo(30));
  const [rangeEnd, setRangeEnd] = useState(formatDateInputValue(new Date()));
  const [leaderboardSort, setLeaderboardSort] = useState<LeaderboardSortKey>("avgScore");
  const [resultSort, setResultSort] = useState<ResultSortKey>("runCreatedAt");
  const [resultSortDirection, setResultSortDirection] = useState<"asc" | "desc">("desc");
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const response = await fetch("/api/runs");
        const payload = (await response.json().catch(() => null)) as {
          runs?: SavedRun[];
          error?: string;
        } | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Unable to load stats.");
        }

        if (!cancelled) {
          setRuns(payload?.runs ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error ? error.message : "Unable to load stats.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const sortedRuns = [...runs].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const selectedRun =
    sortedRuns.find((run) => run.id === selectedRunId) ?? sortedRuns[0] ?? null;

  useEffect(() => {
    if (!sortedRuns.length) {
      if (selectedRunId) setSelectedRunId("");
      return;
    }

    if (!selectedRunId || !sortedRuns.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(sortedRuns[0].id);
    }
  }, [selectedRunId, sortedRuns]);

  const normalizedRange = normalizeDateRange(rangeStart, rangeEnd);

  const scopedRuns = sortedRuns.filter((run) => {
    if (scopeMode === "run") {
      return selectedRun ? run.id === selectedRun.id : false;
    }

    if (scopeMode === "range") {
      if (!normalizedRange.isValid) return false;
      const createdAtMs = new Date(run.createdAt).getTime();
      return createdAtMs >= normalizedRange.startMs && createdAtMs <= normalizedRange.endMs;
    }

    return true;
  });

  const flattenedResults = scopedRuns.flatMap<FlattenedResult>((run) =>
    run.results.map((result, modelIndex) => ({
      id: `${run.id}:${modelIndex}`,
      runId: run.id,
      runCreatedAt: run.createdAt,
      runPrompt: run.prompt,
      modelIndex,
      modelId: result.modelId,
      label: result.label,
      result,
    })),
  );

  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredResults = flattenedResults
    .filter((entry) => statusFilter === "all" || entry.result.status === statusFilter)
    .filter((entry) => {
      if (!normalizedQuery) return true;

      const haystack = [
        entry.modelId,
        entry.label,
        entry.runPrompt,
        entry.result.finishReason,
        entry.result.error,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });

  const leaderboardMap = new Map<string, ModelAggregate>();

  for (const entry of filteredResults) {
    const existing = leaderboardMap.get(entry.modelId) ?? {
      modelId: entry.modelId,
      label: entry.label || getCollapsedModelLabel(entry.modelId),
      runs: 0,
      completed: 0,
      errored: 0,
      avgScore: 0,
      avgLatencyMs: 0,
      avgRuntimeMs: 0,
      avgTotalTokens: 0,
      avgToolCalls: 0,
      avgTokensPerSecond: 0,
      totalCost: 0,
      successRate: 0,
      lastSeenAt: entry.runCreatedAt,
    };

    existing.runs += 1;
    if (entry.result.status === "done") existing.completed += 1;
    if (entry.result.status === "error") existing.errored += 1;

    existing.avgScore = (existing.avgScore ?? 0) + (entry.result.vote?.score ?? 0);
    existing.avgLatencyMs =
      (existing.avgLatencyMs ?? 0) + (entry.result.latencyMs ?? 0);
    existing.avgRuntimeMs =
      (existing.avgRuntimeMs ?? 0) + (entry.result.runtimeMs ?? 0);
    existing.avgTotalTokens =
      (existing.avgTotalTokens ?? 0) + (entry.result.usage?.totalTokens ?? 0);
    existing.avgToolCalls =
      (existing.avgToolCalls ?? 0) + (entry.result.stats?.toolCallCount ?? 0);
    existing.avgTokensPerSecond =
      (existing.avgTokensPerSecond ?? 0)
      + (sanitizeTokensPerSecond(entry.result.stats?.tokensPerSecond) ?? 0);
    existing.totalCost = (existing.totalCost ?? 0) + (entry.result.costs?.total ?? 0);
    existing.lastSeenAt =
      new Date(existing.lastSeenAt).getTime() > new Date(entry.runCreatedAt).getTime()
        ? existing.lastSeenAt
        : entry.runCreatedAt;

    leaderboardMap.set(entry.modelId, existing);
  }

  const leaderboardBase = [...leaderboardMap.values()].map((entry) => ({
    ...entry,
    avgScore: entry.runs ? (entry.avgScore ?? 0) / entry.runs : undefined,
    avgLatencyMs: entry.runs ? (entry.avgLatencyMs ?? 0) / entry.runs : undefined,
    avgRuntimeMs: entry.runs ? (entry.avgRuntimeMs ?? 0) / entry.runs : undefined,
    avgTotalTokens: entry.runs ? (entry.avgTotalTokens ?? 0) / entry.runs : undefined,
    avgToolCalls: entry.runs ? (entry.avgToolCalls ?? 0) / entry.runs : undefined,
    avgTokensPerSecond: entry.runs
      ? (entry.avgTokensPerSecond ?? 0) / entry.runs
      : undefined,
    successRate: entry.runs ? (entry.completed / entry.runs) * 100 : undefined,
  }));

  const leaderboard = [...leaderboardBase].sort((left, right) => {
    if (leaderboardSort === "lastSeenAt") {
      return new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime();
    }

    if (leaderboardSort === "avgLatencyMs" || leaderboardSort === "avgRuntimeMs") {
      return (left[leaderboardSort] ?? Number.POSITIVE_INFINITY)
        - (right[leaderboardSort] ?? Number.POSITIVE_INFINITY);
    }

    return (right[leaderboardSort] ?? Number.NEGATIVE_INFINITY)
      - (left[leaderboardSort] ?? Number.NEGATIVE_INFINITY);
  });

  const sortedResults = [...filteredResults].sort((left, right) => {
    const comparison = compareValues(
      getResultSortValue(left, resultSort),
      getResultSortValue(right, resultSort),
    );

    return resultSortDirection === "asc" ? comparison : -comparison;
  });

  const totalCost = filteredResults.reduce(
    (sum, entry) => sum + (entry.result.costs?.total ?? 0),
    0,
  );
  const avgLatencyMs = filteredResults.length
    ? filteredResults.reduce((sum, entry) => sum + (entry.result.latencyMs ?? 0), 0)
        / filteredResults.length
    : undefined;
  const avgRuntimeMs = filteredResults.length
    ? filteredResults.reduce((sum, entry) => sum + (entry.result.runtimeMs ?? 0), 0)
        / filteredResults.length
    : undefined;
  const totalToolCalls = filteredResults.reduce(
    (sum, entry) => sum + (entry.result.stats?.toolCallCount ?? 0),
    0,
  );
  const totalTokens = filteredResults.reduce(
    (sum, entry) => sum + (entry.result.usage?.totalTokens ?? 0),
    0,
  );
  const completionRate = filteredResults.length
    ? (filteredResults.filter((entry) => entry.result.status === "done").length / filteredResults.length) * 100
    : undefined;
  const scopeLabel = formatScopeLabel(scopeMode, selectedRun);
  const modelShareSlices = buildModelShareSlices(leaderboardBase);
  const statusSlices = buildStatusSlices(filteredResults);
  const rangeError =
    scopeMode === "range" && !normalizedRange.isValid
      ? "Choose a valid start and end date."
      : "";

  const histogramMetrics: HistogramMetricConfig[] = [
    {
      key: "avgScore",
      label: "Score",
      accent: "#d95f3c",
      preferLower: false,
      formatter: formatVoteScore,
    },
    {
      key: "successRate",
      label: "Success",
      accent: "#1d9b7d",
      preferLower: false,
      formatter: formatPercent,
    },
    {
      key: "avgRuntimeMs",
      label: "Runtime",
      accent: "#5a7dff",
      preferLower: true,
      formatter: formatDuration,
    },
    {
      key: "avgTotalTokens",
      label: "Tokens",
      accent: "#d59d1d",
      preferLower: false,
      formatter: formatTokenCount,
    },
    {
      key: "avgTokensPerSecond",
      label: "Out/sec",
      accent: "#9757d7",
      preferLower: false,
      formatter: formatTokensPerSecond,
    },
    {
      key: "totalCost",
      label: "Spend",
      accent: "#4d6b51",
      preferLower: false,
      formatter: formatCost,
    },
  ];

  const rankingMetrics: RankingMetricConfig[] = [
    {
      key: "avgScore",
      label: "Best score",
      note: "Highest average vote score across the filtered slice.",
      preferLower: false,
      formatter: formatVoteScore,
    },
    {
      key: "successRate",
      label: "Most reliable",
      note: "Highest completion rate inside the current selection.",
      preferLower: false,
      formatter: formatPercent,
    },
    {
      key: "avgLatencyMs",
      label: "Fastest first token",
      note: "Lower average latency ranks higher.",
      preferLower: true,
      formatter: formatDuration,
    },
    {
      key: "avgRuntimeMs",
      label: "Fastest finish",
      note: "Lower average runtime ranks higher.",
      preferLower: true,
      formatter: formatDuration,
    },
    {
      key: "avgTokensPerSecond",
      label: "Highest throughput",
      note: "Best output tokens per second from saved runs.",
      preferLower: false,
      formatter: formatTokensPerSecond,
    },
    {
      key: "totalCost",
      label: "Highest spend",
      note: "Most expensive footprint in the current slice.",
      preferLower: false,
      formatter: formatCost,
    },
  ];

  return (
    <main className="relative min-h-screen [overflow-x:clip] pb-20 pt-4 text-(--foreground)">
      <div className="grain" />

      <header className="glass-shell floating-nav mx-auto flex max-w-[1600px] items-center justify-between gap-3 rounded-[3rem] px-4 py-2">
        <div className="min-w-0">
          <p className="eyebrow-label text-[11px] font-semibold uppercase">Run Observatory</p>
          <h1 className="truncate text-lg font-semibold tracking-[-0.04em]">
            Past-run stats dashboard
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            className="rounded-full px-4 py-2 text-sm font-medium text-(--muted) transition hover:bg-(--card-active) hover:text-(--foreground)"
            href="/"
          >
            Battle
          </Link>
          <span className="rounded-full bg-(--accent) px-4 py-2 text-sm font-semibold text-white">
            Stats
          </span>
        </div>
      </header>

      <section className="mx-auto mt-4 grid max-w-[1600px] gap-4 px-4 sm:px-0 xl:grid-cols-[1.2fr_1fr]">
        <div className="glass-shell rise-in overflow-hidden rounded-[2.4rem] px-6 py-6 sm:px-8">
          <p className="eyebrow-label text-[11px] font-semibold uppercase">
            Model observatory
          </p>
          <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.8fr)]">
            <div>
              <h2 className="max-w-3xl font-[var(--font-serif)] text-4xl leading-[0.95] tracking-[-0.05em] sm:text-5xl">
                Aggregate every saved result by model, then slice it by run or time window.
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[color-mix(in_oklch,var(--foreground)_72%,transparent)] sm:text-base">
                The stats view now rolls up performance per model first, then projects that
                same filtered data into pie summaries, histogram-style comparisons, and
                stat-by-stat rankings so you can switch from one run to a broader trend line
                without losing context.
              </p>
            </div>

            <div className="relative">
              <div className="absolute inset-x-0 top-4 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_oklch,var(--accent)_65%,transparent),transparent)]" />
              <div className="grid gap-3">
                {[
                  {
                    label: "Scope",
                    value: scopeLabel,
                    note: `${scopedRuns.length} runs currently included`,
                  },
                  {
                    label: "Models in view",
                    value: leaderboard.length.toString(),
                    note: `${filteredResults.length} filtered results`,
                  },
                  {
                    label: "Observed spend",
                    value: formatCost(totalCost),
                    note: "aggregated across the active slice",
                  },
                ].map((metric) => (
                  <div
                    className="rounded-[1.5rem] border border-(--line) bg-[color-mix(in_oklch,var(--panel)_92%,transparent)] px-4 py-4"
                    key={metric.label}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                      {metric.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                      {metric.value}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-(--muted)">{metric.note}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="panel rise-in rounded-[2.2rem] p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                label: "Completion",
                value: formatPercent(completionRate),
              },
              {
                label: "Avg latency",
                value: formatDuration(avgLatencyMs),
              },
              {
                label: "Avg runtime",
                value: formatDuration(avgRuntimeMs),
              },
              {
                label: "Total tokens",
                value: formatTokenCount(totalTokens),
              },
              {
                label: "Tool calls",
                value: formatTokenCount(totalToolCalls),
              },
              {
                label: "Runs loaded",
                value: formatTokenCount(scopedRuns.length),
              },
            ].map((metric) => (
              <div
                className="rounded-[1.4rem] border border-(--line) bg-(--card) px-4 py-4"
                key={metric.label}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                  {metric.label}
                </p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                  {metric.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-4 max-w-[1600px] px-4 sm:px-0">
        <div className="panel rise-in rounded-[2rem] p-4 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px_220px]">
            <div className="rounded-[1.2rem] border border-(--line) bg-(--card) p-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Scope
              </span>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {([
                  { id: "all", label: "All runs" },
                  { id: "run", label: "Single run" },
                  { id: "range", label: "Time range" },
                ] as const).map((option) => (
                  <button
                    className={cn(
                      "rounded-[0.95rem] px-3 py-2.5 text-sm font-medium transition",
                      scopeMode === option.id
                        ? "bg-(--accent) text-white"
                        : "bg-[color-mix(in_oklch,var(--foreground)_4%,transparent)] text-(--foreground) hover:bg-(--card-active)",
                    )}
                    key={option.id}
                    onClick={() => setScopeMode(option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={cn(
                "rounded-[1.2rem] border border-(--line) bg-(--card) p-3",
                scopeMode === "all" && "opacity-70",
              )}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Scope details
              </span>

              {scopeMode === "run" ? (
                <label className="mt-3 flex flex-col gap-2">
                  <span className="text-xs text-(--muted)">Choose one run</span>
                  <select
                    className="rounded-[1rem] border border-(--line) bg-[color-mix(in_oklch,var(--foreground)_4%,transparent)] px-3 py-2.5 text-sm outline-none transition focus:border-(--accent)"
                    onChange={(event) => setSelectedRunId(event.target.value)}
                    value={selectedRunId}
                  >
                    {sortedRuns.map((run) => (
                      <option key={run.id} value={run.id}>
                        {formatTimestamp(run.createdAt)} · {run.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : scopeMode === "range" ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-(--muted)">Start date</span>
                    <input
                      className="rounded-[1rem] border border-(--line) bg-[color-mix(in_oklch,var(--foreground)_4%,transparent)] px-3 py-2.5 text-sm outline-none transition focus:border-(--accent)"
                      onChange={(event) => setRangeStart(event.target.value)}
                      type="date"
                      value={rangeStart}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-(--muted)">End date</span>
                    <input
                      className="rounded-[1rem] border border-(--line) bg-[color-mix(in_oklch,var(--foreground)_4%,transparent)] px-3 py-2.5 text-sm outline-none transition focus:border-(--accent)"
                      onChange={(event) => setRangeEnd(event.target.value)}
                      type="date"
                      value={rangeEnd}
                    />
                  </label>
                </div>
              ) : (
                <div className="mt-3 rounded-[1rem] bg-[color-mix(in_oklch,var(--foreground)_3%,transparent)] px-3 py-3 text-sm leading-6 text-(--muted)">
                  Aggregating across every saved run in your history.
                </div>
              )}

              {rangeError ? (
                <p className="mt-2 text-xs text-[color-mix(in_oklch,var(--danger)_78%,transparent)]">
                  {rangeError}
                </p>
              ) : null}
            </div>

            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Search
              </span>
              <input
                className="rounded-[1rem] border border-(--line) bg-(--card) px-3 py-2.5 text-sm outline-none transition focus:border-(--accent)"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Model, prompt, finish reason, error"
                value={query}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Status
              </span>
              <select
                className="rounded-[1rem] border border-(--line) bg-(--card) px-3 py-2.5 text-sm outline-none transition focus:border-(--accent)"
                onChange={(event) =>
                  setStatusFilter(event.target.value as "all" | ModelResult["status"])
                }
                value={statusFilter}
              >
                <option value="all">All results</option>
                <option value="done">Complete</option>
                <option value="error">Error</option>
                <option value="streaming">Streaming</option>
                <option value="idle">Idle</option>
              </select>
            </label>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[220px_220px_minmax(0,1fr)]">
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Leaderboard
              </span>
              <select
                className="rounded-[1rem] border border-(--line) bg-(--card) px-3 py-2.5 text-sm outline-none transition focus:border-(--accent)"
                onChange={(event) => setLeaderboardSort(event.target.value as LeaderboardSortKey)}
                value={leaderboardSort}
              >
                <option value="avgScore">Sort by avg score</option>
                <option value="successRate">Sort by success rate</option>
                <option value="avgLatencyMs">Sort by avg latency</option>
                <option value="avgRuntimeMs">Sort by avg runtime</option>
                <option value="avgTotalTokens">Sort by avg total tokens</option>
                <option value="avgToolCalls">Sort by avg tool calls</option>
                <option value="avgTokensPerSecond">Sort by output rate</option>
                <option value="totalCost">Sort by total cost</option>
                <option value="lastSeenAt">Sort by last seen</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Result ledger
              </span>
              <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-2">
                <select
                  className="rounded-[1rem] border border-(--line) bg-(--card) px-3 py-2.5 text-sm outline-none transition focus:border-(--accent)"
                  onChange={(event) => setResultSort(event.target.value as ResultSortKey)}
                  value={resultSort}
                >
                  <option value="runCreatedAt">Newest run</option>
                  <option value="score">Vote score</option>
                  <option value="cost">Cost</option>
                  <option value="latencyMs">Latency</option>
                  <option value="runtimeMs">Runtime</option>
                  <option value="totalTokens">Total tokens</option>
                  <option value="toolCalls">Tool calls</option>
                  <option value="tokensPerSecond">Output rate</option>
                  <option value="status">Status</option>
                  <option value="modelId">Model</option>
                </select>
                <select
                  className="rounded-[1rem] border border-(--line) bg-(--card) px-3 py-2.5 text-sm outline-none transition focus:border-(--accent)"
                  onChange={(event) =>
                    setResultSortDirection(event.target.value as "asc" | "desc")
                  }
                  value={resultSortDirection}
                >
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </div>
            </label>

            <div className="rounded-[1.2rem] border border-(--line) bg-[linear-gradient(135deg,color-mix(in_oklch,var(--card)_94%,transparent),color-mix(in_oklch,var(--panel)_92%,transparent))] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Active slice
              </p>
              <p className="mt-1 text-sm leading-6 text-[color-mix(in_oklch,var(--foreground)_74%,transparent)]">
                {scopeMode === "all"
                  ? "All runs are pooled together before model-level aggregation."
                  : scopeMode === "run"
                    ? "One run is isolated, then every model in that run is compared side by side."
                    : "Only runs created inside the selected date range are included in the charts and rankings."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-4 grid max-w-[1600px] gap-4 px-4 sm:px-0 xl:grid-cols-2">
        <div className="panel rise-in rounded-[2rem] p-4 sm:p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Pie summaries
              </p>
              <h2 className="mt-1 font-[var(--font-serif)] text-3xl tracking-[-0.04em]">
                Share of volume and status
              </h2>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="rounded-[1.6rem] border border-(--line) bg-(--card) p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Results by model
              </p>
              <p className="mt-1 text-sm text-(--muted)">
                Top models by number of results in the current slice.
              </p>
              <div className="mt-4">
                <PieChart
                  centerLabel="Results"
                  centerValue={formatTokenCount(filteredResults.length)}
                  slices={modelShareSlices}
                />
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-(--line) bg-(--card) p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Status mix
              </p>
              <p className="mt-1 text-sm text-(--muted)">
                Completion, error, and in-flight composition.
              </p>
              <div className="mt-4">
                <PieChart
                  centerLabel="Completion"
                  centerValue={formatPercent(completionRate)}
                  slices={statusSlices}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="panel rise-in rounded-[2rem] p-4 sm:p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Stat rankings
              </p>
              <h2 className="mt-1 font-[var(--font-serif)] text-3xl tracking-[-0.04em]">
                Leaders by individual metric
              </h2>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rankingMetrics.map((metric) => (
              <RankingPanel
                entries={leaderboardBase}
                key={metric.label}
                metric={metric}
                title={metric.label}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-4 max-w-[1600px] px-4 sm:px-0">
        <div className="panel rise-in rounded-[2rem] p-4 sm:p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Histograms
              </p>
              <h2 className="mt-1 font-[var(--font-serif)] text-3xl tracking-[-0.04em]">
                Per-model distribution across core stats
              </h2>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            {histogramMetrics.map((metric) => (
              <HistogramPanel
                entries={leaderboardBase}
                key={metric.key}
                metric={metric}
                subtitle={`${metric.label} per model in the active slice.`}
                title={metric.label}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-4 grid max-w-[1600px] gap-4 px-4 sm:px-0 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        <div className="panel rise-in rounded-[2rem] p-4 sm:p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Model leaderboard
              </p>
              <h2 className="mt-1 font-[var(--font-serif)] text-3xl tracking-[-0.04em]">
                Ranked across history
              </h2>
            </div>
            <span className="text-xs text-(--muted)">{leaderboard.length} models</span>
          </div>

          <div className="mt-4 space-y-3">
            {isLoading ? (
              <div className="rounded-[1.5rem] border border-dashed border-(--line) px-5 py-10 text-center text-sm text-(--muted)">
                Loading saved runs…
              </div>
            ) : errorMessage ? (
              <div className="rounded-[1.5rem] border border-[color-mix(in_oklch,var(--danger)_42%,transparent)] bg-[color-mix(in_oklch,var(--danger)_14%,transparent)] px-5 py-4 text-sm text-(--foreground)">
                {errorMessage}
              </div>
            ) : !leaderboard.length ? (
              <div className="rounded-[1.5rem] border border-dashed border-(--line) px-5 py-10 text-center text-sm text-(--muted)">
                No matching historical results yet.
              </div>
            ) : (
              leaderboard.map((entry, index) => (
                <article
                  className="rounded-[1.6rem] border border-(--line) bg-[linear-gradient(135deg,color-mix(in_oklch,var(--card)_94%,transparent),color-mix(in_oklch,var(--panel-strong)_88%,transparent))] px-4 py-4"
                  key={entry.modelId}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--accent)_35%,transparent)] bg-[color-mix(in_oklch,var(--accent)_16%,transparent)] text-sm font-semibold">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-lg font-semibold tracking-[-0.03em]">
                            {getCollapsedModelLabel(entry.modelId)}
                          </p>
                          <p className="truncate text-xs text-(--muted)">{entry.modelId}</p>
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-(--muted)">
                        Last seen
                      </p>
                      <p className="mt-1 text-sm font-medium">
                        {formatTimeAgo(entry.lastSeenAt)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {[
                      { label: "Avg score", value: formatVoteScore(entry.avgScore) },
                      { label: "Success", value: formatPercent(entry.successRate) },
                      { label: "Runs", value: formatTokenCount(entry.runs) },
                      { label: "Avg latency", value: formatDuration(entry.avgLatencyMs) },
                      { label: "Avg runtime", value: formatDuration(entry.avgRuntimeMs) },
                      { label: "Avg tools", value: formatTokenCount(entry.avgToolCalls) },
                      { label: "Avg total", value: formatTokenCount(entry.avgTotalTokens) },
                      { label: "Out/sec", value: formatTokensPerSecond(entry.avgTokensPerSecond) },
                      { label: "Spend", value: formatCost(entry.totalCost) },
                    ].map((metric) => (
                      <div
                        className="rounded-[1.1rem] bg-[color-mix(in_oklch,var(--foreground)_3%,transparent)] px-3 py-3"
                        key={metric.label}
                      >
                        <p className="text-[10px] uppercase tracking-[0.18em] text-(--muted)">
                          {metric.label}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-(--foreground)">
                          {metric.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        <div className="panel rise-in rounded-[2rem] p-4 sm:p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Results ledger
              </p>
              <h2 className="mt-1 font-[var(--font-serif)] text-3xl tracking-[-0.04em]">
                Every saved output
              </h2>
            </div>
            <span className="text-xs text-(--muted)">{sortedResults.length} entries</span>
          </div>

          <div className="mt-4 space-y-3">
            {isLoading ? (
              <div className="rounded-[1.5rem] border border-dashed border-(--line) px-5 py-10 text-center text-sm text-(--muted)">
                Building ledger…
              </div>
            ) : errorMessage ? null : !sortedResults.length ? (
              <div className="rounded-[1.5rem] border border-dashed border-(--line) px-5 py-10 text-center text-sm text-(--muted)">
                No outputs matched this filter.
              </div>
            ) : (
              sortedResults.map((entry) => (
                <article
                  className="rounded-[1.5rem] border border-(--line) bg-(--card) px-4 py-4 transition hover:bg-(--card-active)"
                  key={entry.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
                            getStatusTone(entry.result.status),
                          )}
                        >
                          {entry.result.status}
                        </span>
                        <span className="text-xs text-(--muted)">
                          {formatTimestamp(entry.runCreatedAt)}
                        </span>
                      </div>
                      <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em]">
                        {getCollapsedModelLabel(entry.modelId)}
                      </h3>
                      <p className="text-xs text-(--muted)">{entry.modelId}</p>
                      <p className="mt-3 line-clamp-2 max-w-3xl text-sm leading-6 text-[color-mix(in_oklch,var(--foreground)_76%,transparent)]">
                        {entry.runPrompt}
                      </p>
                    </div>
                    <div className="shrink-0 rounded-[1.1rem] border border-(--line) px-3 py-2 text-right">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-(--muted)">
                        Vote score
                      </p>
                      <p className="mt-1 text-lg font-semibold">
                        {formatVoteScore(entry.result.vote?.score)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
                    {[
                      { label: "Latency", value: formatDuration(entry.result.latencyMs) },
                      {
                        label: "Runtime",
                        value: formatDuration(entry.result.runtimeMs),
                      },
                      {
                        label: "Total tokens",
                        value: formatTokenCount(entry.result.usage?.totalTokens),
                      },
                      {
                        label: "Tool calls",
                        value: formatTokenCount(entry.result.stats?.toolCallCount),
                      },
                      {
                        label: "Out/sec",
                        value: formatTokensPerSecond(entry.result.stats?.tokensPerSecond),
                      },
                      { label: "Cost", value: formatCost(entry.result.costs?.total) },
                      {
                        label: "Finish",
                        value: entry.result.finishReason ?? "—",
                      },
                      {
                        label: "Tool errors",
                        value: formatTokenCount(entry.result.stats?.toolErrorCount),
                      },
                      {
                        label: "First token",
                        value: entry.result.firstTokenAt
                          ? formatTimeAgo(entry.result.firstTokenAt)
                          : "—",
                      },
                      {
                        label: "Characters",
                        value: formatTokenCount(entry.result.stats?.outputChars),
                      },
                    ].map((metric) => (
                      <div
                        className="rounded-[1rem] bg-[color-mix(in_oklch,var(--foreground)_3%,transparent)] px-3 py-3"
                        key={metric.label}
                      >
                        <p className="text-[10px] uppercase tracking-[0.18em] text-(--muted)">
                          {metric.label}
                        </p>
                        <p className="mt-1 truncate text-sm font-semibold">{metric.value}</p>
                      </div>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
