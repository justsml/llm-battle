"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useState } from "react";

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

type ModelAggregate = {
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

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
}

function formatTokenCount(value?: number) {
  if (value == null) return "—";
  return new Intl.NumberFormat().format(value);
}

function formatCost(value?: number) {
  if (value == null) return "—";
  if (value === 0) return "$0.000000";

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatPercent(value?: number) {
  if (value == null) return "—";
  return `${value.toFixed(value >= 99 || value <= 1 ? 0 : 1)}%`;
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
  if (score == null) return "—";
  if (score > 0) return `+${score}`;
  return String(score);
}

function getStatusTone(status: ModelResult["status"]) {
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

function getCollapsedModelLabel(modelId: string) {
  const simplified = modelId.split("/").filter(Boolean).at(-1);
  return simplified ?? modelId;
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

export function StatsDashboardClient() {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ModelResult["status"]>("all");
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

  const flattenedResults = runs.flatMap<FlattenedResult>((run) =>
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

  const leaderboard = [...leaderboardMap.values()]
    .map((entry) => ({
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
    }))
    .sort((left, right) => {
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

      <section className="mx-auto mt-4 grid max-w-[1600px] gap-4 px-4 sm:px-0 xl:grid-cols-[1.25fr_0.95fr]">
        <div className="glass-shell rise-in overflow-hidden rounded-[2.4rem] px-6 py-6 sm:px-8">
          <p className="eyebrow-label text-[11px] font-semibold uppercase">
            Cross-run analysis
          </p>
          <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.75fr)]">
            <div>
              <h2 className="max-w-3xl font-[var(--font-serif)] text-4xl leading-[0.95] tracking-[-0.05em] sm:text-5xl">
                Compare every stored model result through one sortable, historical lens.
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[color-mix(in_oklch,var(--foreground)_72%,transparent)] sm:text-base">
                This page turns your saved build-offs into a rolling lab notebook:
                model leaderboards, cost and speed patterns, and a ledger of every output
                you have generated so far.
              </p>
            </div>

            <div className="relative">
              <div className="absolute inset-x-0 top-4 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_oklch,var(--accent)_65%,transparent),transparent)]" />
              <div className="grid gap-3">
                {[
                  {
                    label: "Saved runs",
                    value: runs.length.toString(),
                    note: `${filteredResults.length} results in view`,
                  },
                  {
                    label: "Completion",
                    value: formatPercent(completionRate),
                    note: "successful outputs in current filter",
                  },
                  {
                    label: "Observed spend",
                    value: formatCost(totalCost),
                    note: "estimated from provider pricing tables",
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
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_220px_220px_220px]">
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
