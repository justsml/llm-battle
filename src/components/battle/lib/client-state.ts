"use client";

import { estimateModelCost } from "@/lib/gateway-models";
import { DEFAULT_MODELS } from "@/lib/models";
import { estimateTokens } from "@/lib/tokenizer";
import type {
  AgenticOptions,
  CompareModel,
  GatewayModel,
  ModelOutputRevision,
  ModelResult,
  OutputVoteValue,
  ModelTraceEvent,
  OutputDomCssStats,
  SavedRun,
} from "@/lib/types";
import { sanitizeTokensPerSecond } from "@/lib/utils";

import type {
  PreviewScreenshot,
  VisualDiffState,
} from "@/components/battle/lib/view-shared";

export const MAX_RUNS = 20;
export const LOCAL_DRAFT_KEY = "battle:draft:v1";
export const LOCAL_RECENT_MODELS_KEY = "battle:recent-models:v1";
const LIVE_TPS_WINDOW_MS = 2500;
const LIVE_TPS_MIN_WINDOW_MS = 400;

export type OutputMode = "preview" | "raw" | "thinking";
export type CardSize = "s" | "m" | "l" | "xl";
export type ModelCardModeKey = "standard" | "agentic";

export type AgenticToolState = {
  count: number;
  status: "idle" | "running" | "error";
  error?: string;
};

export type AgenticCardState = {
  enabled: boolean;
  maxTurns: number;
  stepsCompleted: number;
  tools: Record<string, AgenticToolState>;
};

export type LiveStreamMetricSnapshot = {
  outputTokens?: number;
  totalTokens?: number;
  peakTokensPerSecond?: number;
};

export type RectSnapshot = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ModelCardWorkspaceState = {
  activeRunId: string | null;
  selectedModels: CompareModel[];
  results: ModelResult[];
  agenticActivity: Record<string, AgenticCardState>;
  previewErrors: Record<string, string[]>;
  previewToolErrors: Record<string, string[]>;
  previewOverrides: Record<string, string>;
  selectedRevisionIds: Record<string, string>;
  visualDiffs: Record<string, VisualDiffState>;
};

export type BattleClientProps = {
  authConfig: {
    githubConfigured: boolean;
    allowLocalDevAutoAuth: boolean;
  };
  initialRunId: string | null;
  initialAgenticEnabled?: boolean;
};

export const DEFAULT_AGENTIC_OPTIONS: AgenticOptions = {
  enabled: false,
  maxTurns: 6,
  todoListTool: false,
};

const TOOL_LABELS: Record<string, string> = {
  get_screenshot: "Screenshot",
  get_html: "Read HTML",
  set_html: "Set HTML",
  get_console_logs: "Console logs",
  todo_list: "Todo list",
};

export const EVAL_HARNESS_LINKS: ReadonlyArray<{
  href: string;
  label: string;
  meta: string;
  matchPathnames: readonly string[];
}> = [
  {
    href: "/",
    label: "Battle",
    meta: "New comparisons",
    matchPathnames: ["/"],
  },
  {
    href: "/run-generate",
    label: "Generate",
    meta: "Standard eval runs",
    matchPathnames: ["/run-generate"],
  },
  {
    href: "/run-agentic",
    label: "Agentic",
    meta: "Tool-using eval runs",
    matchPathnames: ["/run-agentic"],
  },
  {
    href: "/stats",
    label: "Stats",
    meta: "Aggregate model results",
    matchPathnames: ["/stats"],
  },
];

export const CARD_SIZE_CONFIG: Record<
  CardSize,
  {
    minWidth: string;
    viewportHeight: string;
    referenceHeight: string;
    fullscreenViewportHeight: string;
  }
> = {
  s: {
    minWidth: "240px",
    viewportHeight: "14rem",
    referenceHeight: "14rem",
    fullscreenViewportHeight: "100vh",
  },
  m: {
    minWidth: "320px",
    viewportHeight: "18rem",
    referenceHeight: "18rem",
    fullscreenViewportHeight: "100vh",
  },
  l: {
    minWidth: "480px",
    viewportHeight: "22rem",
    referenceHeight: "22rem",
    fullscreenViewportHeight: "100vh",
  },
  xl: {
    minWidth: "100%",
    viewportHeight: "min(28.125rem, 60vh)",
    referenceHeight: "min(28.125rem, 60vh)",
    fullscreenViewportHeight: "100vh",
  },
};

export function withTransition(update: () => void) {
  if (typeof document !== "undefined" && "startViewTransition" in document) {
    (
      document as Document & {
        startViewTransition(fn: () => void): unknown;
      }
    ).startViewTransition(update);
  } else {
    update();
  }
}

export function cardVtName(id: string) {
  return `card-${id.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

export function snapshotRect(element: Element | null): RectSnapshot | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function shouldReduceMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function animateBetweenRects(
  element: HTMLElement,
  from: RectSnapshot,
  to: RectSnapshot,
  direction: "open" | "close",
) {
  const deltaX = from.left - to.left;
  const deltaY = from.top - to.top;
  const scaleX = from.width / Math.max(to.width, 1);
  const scaleY = from.height / Math.max(to.height, 1);

  return element.animate(
    [
      {
        opacity: direction === "open" ? 0.78 : 1,
        transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
      },
      {
        opacity: direction === "open" ? 1 : 0.82,
        transform: "translate(0px, 0px) scale(1, 1)",
      },
    ],
    {
      duration: direction === "open" ? 320 : 220,
      easing:
        direction === "open"
          ? "cubic-bezier(0.22, 1, 0.36, 1)"
          : "cubic-bezier(0.4, 0, 1, 1)",
      fill: "both",
    },
  );
}

export function getRunImageSrc(run: SavedRun) {
  return run.imageDataUrl || run.imageUrl || "";
}

export function createEmptyResult(model: CompareModel): ModelResult {
  return {
    modelId: model.id,
    label: model.label,
    text: "",
    thinking: "",
    revisions: [],
    status: "idle",
    vote: {
      score: 0,
      upvotes: 0,
      downvotes: 0,
    },
  };
}

export function createEmptyResults(models: CompareModel[]): ModelResult[] {
  return models.map(createEmptyResult);
}

export function getModelCardModeKey(agenticEnabled: boolean): ModelCardModeKey {
  return agenticEnabled ? "agentic" : "standard";
}

export function createInitialModelCardWorkspaceState(
  models: CompareModel[] = DEFAULT_MODELS,
): ModelCardWorkspaceState {
  return {
    activeRunId: null,
    selectedModels: models,
    results: createEmptyResults(models),
    agenticActivity: {},
    previewErrors: {},
    previewToolErrors: {},
    previewOverrides: {},
    selectedRevisionIds: {},
    visualDiffs: {},
  };
}

export function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createOutputRevision(
  source: ModelOutputRevision["source"],
  html: string,
  timestamp: string,
  label: string,
): ModelOutputRevision {
  return {
    id: `${source}-${timestamp}-${hashString(`${label}:${html}`)}`,
    source,
    html,
    timestamp,
    label,
  };
}

export function appendOutputRevision(
  revisions: ModelOutputRevision[] | undefined,
  nextRevision: ModelOutputRevision,
) {
  const existing = revisions ?? [];
  const trimmedHtml = nextRevision.html.trim();
  if (!trimmedHtml) return existing;

  const previous = existing.at(-1);
  if (previous?.html.trim() === trimmedHtml) {
    return existing;
  }

  return [...existing, nextRevision];
}

function getFallbackOutputRevisions(result: ModelResult) {
  const revisions: ModelOutputRevision[] = [];
  const initialHtml = result.text.trim();
  const repairedHtml = result.repairedText?.trim() ?? "";
  const initialTimestamp =
    result.completedAt ?? result.startedAt ?? new Date().toISOString();

  if (initialHtml) {
    revisions.push(
      createOutputRevision(
        "initial",
        result.text,
        initialTimestamp,
        "Initial output",
      ),
    );
  }

  if (repairedHtml && repairedHtml !== initialHtml) {
    revisions.push(
      createOutputRevision(
        "repair",
        result.repairedText ?? "",
        result.completedAt ?? initialTimestamp,
        "Repair pass",
      ),
    );
  }

  return revisions;
}

export function getOutputRevisions(
  result: ModelResult | null | undefined,
  previewOverride?: string,
) {
  if (!result) return [];

  const revisions =
    result.revisions && result.revisions.length
      ? result.revisions
      : getFallbackOutputRevisions(result);

  if (!previewOverride?.trim()) {
    return revisions;
  }

  const latest = revisions.at(-1);
  if (latest?.html.trim() === previewOverride.trim()) {
    return revisions;
  }

  return [
    ...revisions,
    createOutputRevision(
      "tool",
      previewOverride,
      result.completedAt ?? new Date().toISOString(),
      "Working draft",
    ),
  ];
}

export function getSelectedOutputRevision(
  result: ModelResult | null | undefined,
  previewOverride: string | undefined,
  selectedRevisionId: string | undefined,
) {
  const revisions = getOutputRevisions(result, previewOverride);
  const fallbackIndex = Math.max(0, revisions.length - 1);
  const selectedIndex = selectedRevisionId
    ? revisions.findIndex((revision) => revision.id === selectedRevisionId)
    : fallbackIndex;
  const resolvedIndex = selectedIndex >= 0 ? selectedIndex : fallbackIndex;

  return {
    revisions,
    selectedIndex: resolvedIndex,
    selectedRevision: revisions.length > 0 ? revisions[resolvedIndex] : null,
  };
}

export function getRunHref(runId: string, agenticEnabled: boolean) {
  return `${getPendingRunHref(agenticEnabled)}?runId=${encodeURIComponent(runId)}`;
}

export function getPendingRunHref(agenticEnabled: boolean) {
  return agenticEnabled ? "/run-agentic" : "/run-generate";
}

export function getRunIdFromLocation(
  pathname: string,
  searchParams: URLSearchParams,
) {
  const queryRunId = searchParams.get("runId");
  if (queryRunId) return queryRunId;

  const match = pathname.match(/^\/runs\/([^/]+)$/);
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

export function getRouteAgenticEnabled(pathname: string, fallback: boolean) {
  if (pathname === "/run-agentic") return true;
  if (pathname === "/run-generate" || pathname === "/") return false;
  return fallback;
}

export function toDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file."));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatVoteScore(score: number) {
  if (score > 0) return `+${score}`;
  return String(score);
}

export function getVoteKey(runId: string, modelIndex: number) {
  return `${runId}:${modelIndex}`;
}

export function statusLineClass(status: ModelResult["status"] | undefined) {
  switch (status) {
    case "done":
      return "build-card__status-line build-card__status-line--done";
    case "streaming":
      return "build-card__status-line build-card__status-line--streaming";
    case "error":
      return "build-card__status-line build-card__status-line--error";
    default:
      return "build-card__status-line build-card__status-line--idle";
  }
}

export function liveElapsed(result: ModelResult, nowMs: number): number | undefined {
  if (result.runtimeMs != null) return result.runtimeMs;
  if (result.startedAt && result.status === "streaming") {
    return Math.max(0, nowMs - Date.parse(result.startedAt));
  }
  return result.runtimeMs;
}

export function formatLiveTokenCount(value: number | undefined, estimated = false) {
  const formatted = formatTokenCount(value);
  if (!estimated || value == null) return formatted;
  return `~${formatted}`;
}

export function formatCost(value?: number) {
  if (value == null) return "—";
  if (value === 0) return "$0.000000";

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(value);
}

export function formatTokensPerSecond(value?: number) {
  const sanitizedValue = sanitizeTokensPerSecond(value);
  if (sanitizedValue == null) return "—";
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits:
      sanitizedValue >= 100 ? 0 : sanitizedValue >= 10 ? 1 : 2,
  }).format(sanitizedValue)}/s`;
}

function formatTokenCount(value?: number) {
  if (value == null) return "—";
  return value.toLocaleString();
}

function sumDefinedNumber(current: number | undefined, next: number | undefined) {
  if (next == null) return current;
  return (current ?? 0) + next;
}

export function formatResultStatus(result: ModelResult) {
  if (result.status === "streaming") return "Streaming";
  if (result.status === "done") return "Complete";
  if (result.status === "error") return result.error || "Error";
  return "Waiting";
}

export function getToolLabel(toolName: string) {
  return TOOL_LABELS[toolName] ?? toolName.replaceAll("_", " ");
}

export function readEventStats(event: Record<string, unknown>): ModelResult["stats"] {
  return typeof event.stats === "object" && event.stats
    ? (event.stats as ModelResult["stats"])
    : undefined;
}

export function readEventDomCssStats(
  event: Record<string, unknown>,
): ModelResult["domCssStats"] {
  return typeof event.domCssStats === "object" && event.domCssStats
    ? (event.domCssStats as ModelResult["domCssStats"])
    : undefined;
}

export function readEventTimestamp(event: Record<string, unknown>) {
  return typeof event.timestamp === "string"
    ? event.timestamp
    : new Date().toISOString();
}

export function readTraceEvents(value: ModelResult["stats"]): ModelTraceEvent[] {
  const events = value?.trace?.events;
  return Array.isArray(events) ? events : [];
}

export function appendTraceEvent(
  stats: ModelResult["stats"] | undefined,
  event: ModelTraceEvent,
): ModelResult["stats"] {
  const existingEvents = readTraceEvents(stats);
  const lastEvent = existingEvents.at(-1);
  if (lastEvent && JSON.stringify(lastEvent) === JSON.stringify(event)) {
    return stats;
  }

  return {
    ...(stats ?? {}),
    trace: {
      events: [...existingEvents, event].slice(-120),
    },
  };
}

function hashString(value: string) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

export function getVisualDiffRequestKey(
  completedAt: string | undefined,
  markup: string,
) {
  return `${completedAt ?? "pending"}:${markup.length}:${hashString(markup)}`;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

async function loadImageElement(src: string) {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to decode image."));
    image.src = src;
  });
}

export async function buildVisualDiff(
  referenceDataUrl: string,
  screenshot: PreviewScreenshot,
): Promise<VisualDiffState> {
  const [referenceImage, previewImage] = await Promise.all([
    loadImageElement(referenceDataUrl),
    loadImageElement(screenshot.dataUrl),
  ]);
  const width = Math.max(
    1,
    Math.min(referenceImage.naturalWidth, previewImage.naturalWidth),
  );
  const height = Math.max(
    1,
    Math.min(referenceImage.naturalHeight, previewImage.naturalHeight),
  );

  const referenceCanvas = document.createElement("canvas");
  referenceCanvas.width = width;
  referenceCanvas.height = height;
  const referenceContext = referenceCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = width;
  previewCanvas.height = height;
  const previewContext = previewCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  const diffCanvas = document.createElement("canvas");
  diffCanvas.width = width;
  diffCanvas.height = height;
  const diffContext = diffCanvas.getContext("2d");

  if (!referenceContext || !previewContext || !diffContext) {
    throw new Error("Canvas is unavailable for visual comparison.");
  }

  referenceContext.drawImage(referenceImage, 0, 0, width, height);
  previewContext.drawImage(previewImage, 0, 0, width, height);

  const referenceData = referenceContext.getImageData(0, 0, width, height);
  const previewData = previewContext.getImageData(0, 0, width, height);
  const diffImage = diffContext.createImageData(width, height);
  const pixelCount = width * height;
  let mismatchPixels = 0;
  let deltaTotal = 0;

  for (let index = 0; index < referenceData.data.length; index += 4) {
    const redDelta = Math.abs(
      referenceData.data[index] - previewData.data[index],
    );
    const greenDelta = Math.abs(
      referenceData.data[index + 1] - previewData.data[index + 1],
    );
    const blueDelta = Math.abs(
      referenceData.data[index + 2] - previewData.data[index + 2],
    );
    const alphaDelta = Math.abs(
      referenceData.data[index + 3] - previewData.data[index + 3],
    );
    const channelDelta = (redDelta + greenDelta + blueDelta + alphaDelta) / 4;
    const normalizedDelta = channelDelta / 255;

    deltaTotal += normalizedDelta;
    if (normalizedDelta > 0.08) mismatchPixels += 1;

    diffImage.data[index] = clampByte(redDelta * 2.8);
    diffImage.data[index + 1] = clampByte(Math.max(0, 140 - channelDelta));
    diffImage.data[index + 2] = clampByte(255 - blueDelta * 1.4);
    diffImage.data[index + 3] = clampByte(Math.max(48, normalizedDelta * 255));
  }

  diffContext.putImageData(diffImage, 0, 0);

  const meanChannelDelta = pixelCount ? deltaTotal / pixelCount : 0;
  const mismatchRatio = pixelCount ? mismatchPixels / pixelCount : 0;
  const similarity = Math.max(0, 1 - meanChannelDelta);

  return {
    status: "ready",
    screenshot,
    diffDataUrl: diffCanvas.toDataURL("image/png"),
    heatmapDataUrl: diffCanvas.toDataURL("image/png"),
    similarity,
    mismatchRatio,
    meanChannelDelta,
    width,
    height,
    capturedAt: screenshot.capturedAt ?? new Date().toISOString(),
  };
}

function formatStatCount(value?: number) {
  if (value == null) return "-";
  return value.toLocaleString();
}

function formatByteCount(value?: number) {
  if (value == null) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildDomCssStatItems(stats?: OutputDomCssStats) {
  if (!stats) return [];

  return [
    ["HTML size", formatByteCount(stats.htmlBytes)],
    ["DOM nodes", formatStatCount(stats.domNodeCount)],
    ["Elements", formatStatCount(stats.elementCount)],
    ["Text nodes", formatStatCount(stats.textNodeCount)],
    ["Comments", formatStatCount(stats.commentCount)],
    ["Max depth", formatStatCount(stats.maxDomDepth)],
    ["<style>", formatStatCount(stats.styleTagCount)],
    ["Inline style attrs", formatStatCount(stats.inlineStyleAttrCount)],
    ["Stylesheet links", formatStatCount(stats.stylesheetLinkCount)],
    ["<script>", formatStatCount(stats.scriptTagCount)],
    ["Images/SVG", formatStatCount(stats.imageCount)],
    ["Buttons", formatStatCount(stats.buttonCount)],
    ["Inputs", formatStatCount(stats.inputCount)],
    ["Forms", formatStatCount(stats.formCount)],
    ["IDs", formatStatCount(stats.idCount)],
    ["Class attrs", formatStatCount(stats.classCount)],
  ] satisfies Array<[string, string]>;
}

export function createAgenticCardState(options: AgenticOptions): AgenticCardState {
  const toolNames = options.enabled
    ? [
        "get_screenshot",
        "get_html",
        "set_html",
        "get_console_logs",
        ...(options.todoListTool ? ["todo_list"] : []),
      ]
    : [];

  return {
    enabled: options.enabled,
    maxTurns: options.maxTurns,
    stepsCompleted: 0,
    tools: Object.fromEntries(
      toolNames.map((toolName) => [
        toolName,
        {
          count: 0,
          status: "idle" as const,
        },
      ]),
    ),
  };
}

export function getUserDisplayName(user: {
  name?: string | null;
  email?: string | null;
  isAnonymous?: boolean | null;
}) {
  if (user.isAnonymous) return "Local Dev Guest";
  return user.name?.trim() || user.email?.trim() || "Signed in user";
}

export function getUserMonogram(user: {
  name?: string | null;
  email?: string | null;
  isAnonymous?: boolean | null;
}) {
  return getUserDisplayName(user).trim().charAt(0).toUpperCase() || "U";
}

export function createLiveMetricBuffer() {
  return {
    outputText: "",
    points: [] as Array<{ timestampMs: number; outputTokens: number }>,
    peakTokensPerSecond: undefined as number | undefined,
  };
}

export function applyLiveMetricDelta(
  buffer: ReturnType<typeof createLiveMetricBuffer>,
  delta: string,
  now = Date.now(),
) {
  if (!delta) {
    return {
      buffer,
      snapshot: {
        outputTokens: estimateTokens(buffer.outputText),
        peakTokensPerSecond: buffer.peakTokensPerSecond,
      } satisfies LiveStreamMetricSnapshot,
    };
  }

  buffer.outputText += delta;
  const outputTokens = estimateTokens(buffer.outputText);
  buffer.points.push({ timestampMs: now, outputTokens });
  buffer.points = buffer.points.filter(
    (point) => now - point.timestampMs <= LIVE_TPS_WINDOW_MS,
  );

  const oldestPoint = buffer.points[0];
  const elapsedMs = oldestPoint ? now - oldestPoint.timestampMs : 0;
  const peakTokensPerSecond =
    elapsedMs >= LIVE_TPS_MIN_WINDOW_MS
      ? Math.max(
          buffer.peakTokensPerSecond ?? 0,
          (outputTokens - oldestPoint.outputTokens) / (elapsedMs / 1000),
        )
      : buffer.peakTokensPerSecond;

  buffer.peakTokensPerSecond = peakTokensPerSecond;

  return {
    buffer,
    snapshot: {
      outputTokens,
      peakTokensPerSecond,
    } satisfies LiveStreamMetricSnapshot,
  };
}

export function getDisplayOutputMetrics(
  result: ModelResult,
  liveStreamMetrics: Record<string, LiveStreamMetricSnapshot>,
) {
  const liveMetric = liveStreamMetrics[result.modelId];
  const outputTokens = result.usage?.outputTokens ?? liveMetric?.outputTokens;
  const estimatedTotalTokens =
    outputTokens != null
      ? (result.usage?.inputTokens ?? 0) + outputTokens
      : undefined;
  const totalTokens =
    result.usage?.totalTokens ?? liveMetric?.totalTokens ?? estimatedTotalTokens;
  const peakTokensPerSecond =
    sanitizeTokensPerSecond(liveMetric?.peakTokensPerSecond) ??
    sanitizeTokensPerSecond(result.stats?.tokensPerSecond);

  return {
    outputTokens,
    totalTokens,
    peakTokensPerSecond,
    outputEstimated:
      result.usage?.outputTokens == null && liveMetric?.outputTokens != null,
    totalEstimated:
      result.usage?.totalTokens == null && totalTokens != null,
  };
}

export function buildAggregateStatusSummary(args: {
  catalog: GatewayModel[];
  liveStreamMetrics: Record<string, LiveStreamMetricSnapshot>;
  results: ModelResult[];
  selectedModels: CompareModel[];
}) {
  const aggregateStatus = args.results.reduce(
    (summary, result, index) => {
      if (result.status === "idle") {
        return summary;
      }

      const tokenMetrics = getDisplayOutputMetrics(
        result,
        args.liveStreamMetrics,
      );
      const catalogModel =
        args.catalog.find(
          (entry) => entry.config === args.selectedModels[index]?.config,
        ) ?? null;
      const resolvedTotalTokens =
        result.usage?.totalTokens ?? tokenMetrics.totalTokens;
      const inferredInputTokens =
        result.usage?.inputTokens ??
        (resolvedTotalTokens != null && tokenMetrics.outputTokens != null
          ? Math.max(resolvedTotalTokens - tokenMetrics.outputTokens, 0)
          : undefined);
      const resolvedCost =
        result.costs?.total ??
        (catalogModel
          ? estimateModelCost(catalogModel.pricing, {
              inputTokens: inferredInputTokens,
              outputTokens: tokenMetrics.outputTokens,
              totalTokens: resolvedTotalTokens,
              cacheReadTokens: result.usage?.cacheReadTokens,
              cacheWriteTokens: result.usage?.cacheWriteTokens,
            })?.total
          : undefined);

      return {
        totalTokens: sumDefinedNumber(summary.totalTokens, resolvedTotalTokens),
        totalCost: sumDefinedNumber(summary.totalCost, resolvedCost),
        hasEstimatedTokens:
          summary.hasEstimatedTokens || Boolean(tokenMetrics.totalEstimated),
        hasEstimatedCost:
          summary.hasEstimatedCost ||
          (resolvedCost != null && result.costs?.total == null),
        completedCount:
          summary.completedCount + (result.status === "done" ? 1 : 0),
        streamingCount:
          summary.streamingCount + (result.status === "streaming" ? 1 : 0),
        errorCount: summary.errorCount + (result.status === "error" ? 1 : 0),
      };
    },
    {
      totalTokens: undefined as number | undefined,
      totalCost: undefined as number | undefined,
      hasEstimatedTokens: false,
      hasEstimatedCost: false,
      completedCount: 0,
      streamingCount: 0,
      errorCount: 0,
    },
  );
  const activeCount =
    aggregateStatus.completedCount +
    aggregateStatus.streamingCount +
    aggregateStatus.errorCount;
  const headline =
    aggregateStatus.streamingCount
      ? `${aggregateStatus.streamingCount} streaming`
      : aggregateStatus.completedCount
        ? `${aggregateStatus.completedCount} complete`
        : `${aggregateStatus.errorCount} ended with errors`;
  const tokenLabel = formatLiveTokenCount(
    aggregateStatus.totalTokens,
    aggregateStatus.hasEstimatedTokens,
  );
  const costLabel =
    aggregateStatus.hasEstimatedCost && aggregateStatus.totalCost != null
      ? `~${formatCost(aggregateStatus.totalCost)}`
      : formatCost(aggregateStatus.totalCost);

  return {
    activeCount,
    headline,
    tokenLabel,
    costLabel,
  };
}

export function applyVoteSummaryToResult(
  result: ModelResult,
  summary: {
    score: number;
    upvotes: number;
    downvotes: number;
    userVote?: OutputVoteValue;
  },
): ModelResult {
  return {
    ...result,
    vote: {
      score: summary.score,
      upvotes: summary.upvotes,
      downvotes: summary.downvotes,
      userVote: summary.userVote,
    },
  };
}

export function applyEventToAgenticState(args: {
  agenticOptions: AgenticOptions;
  current: Record<string, AgenticCardState>;
  event: Record<string, unknown>;
}) {
  const { agenticOptions, current, event } = args;
  if (typeof event.modelId !== "string") return current;

  const existing =
    current[event.modelId] ??
    createAgenticCardState(
      typeof event.agentic === "object" && event.agentic
        ? {
            ...DEFAULT_AGENTIC_OPTIONS,
            ...(event.agentic as Partial<AgenticOptions>),
          }
        : agenticOptions,
    );

  if (event.type === "start") {
    const nextOptions =
      typeof event.agentic === "object" && event.agentic
        ? {
            ...DEFAULT_AGENTIC_OPTIONS,
            ...(event.agentic as Partial<AgenticOptions>),
          }
        : agenticOptions;

    return {
      ...current,
      [event.modelId]: createAgenticCardState(nextOptions),
    };
  }

  if (event.type === "agent-step") {
    return {
      ...current,
      [event.modelId]: {
        ...existing,
        stepsCompleted: Math.max(
          existing.stepsCompleted,
          typeof event.stepNumber === "number" ? event.stepNumber + 1 : 0,
        ),
      },
    };
  }

  if (event.type === "tool-call" && typeof event.toolName === "string") {
    const toolState = existing.tools[event.toolName] ?? {
      count: 0,
      status: "idle" as const,
    };

    return {
      ...current,
      [event.modelId]: {
        ...existing,
        tools: {
          ...existing.tools,
          [event.toolName]: {
            count: toolState.count + 1,
            status: "running" as const,
          },
        },
      },
    };
  }

  if (event.type === "tool-result" && typeof event.toolName === "string") {
    const toolState = existing.tools[event.toolName] ?? {
      count: 1,
      status: "idle" as const,
    };

    return {
      ...current,
      [event.modelId]: {
        ...existing,
        tools: {
          ...existing.tools,
          [event.toolName]: {
            ...toolState,
            status: "idle" as const,
            error: undefined,
          },
        },
      },
    };
  }

  if (event.type === "tool-error" && typeof event.toolName === "string") {
    const toolState = existing.tools[event.toolName] ?? {
      count: 1,
      status: "idle" as const,
    };

    return {
      ...current,
      [event.modelId]: {
        ...existing,
        tools: {
          ...existing.tools,
          [event.toolName]: {
            ...toolState,
            status: "error" as const,
            error:
              typeof event.error === "string"
                ? event.error
                : "Tool execution failed.",
          },
        },
      },
    };
  }

  return current;
}

export function applyEventToResult(
  result: ModelResult,
  event: Record<string, unknown>,
) {
  if (result.modelId !== event.modelId) return result;

  if (event.type === "start") {
    return {
      ...result,
      status: "streaming" as const,
      text: "",
      thinking: "",
      repairedText: undefined,
      revisions: [],
      startedAt:
        typeof event.startedAt === "string" ? event.startedAt : undefined,
      error: undefined,
      completedAt: undefined,
      firstTokenAt: undefined,
      latencyMs: undefined,
      runtimeMs: undefined,
      finishReason: undefined,
      responseId: undefined,
      usage: undefined,
      costs: undefined,
      stats: appendTraceEvent(readEventStats(event), {
        type: "start",
        timestamp: readEventTimestamp(event),
        agentic:
          typeof event.agentic === "object" && event.agentic
            ? (event.agentic as Partial<AgenticOptions>)
            : undefined,
      }),
      domCssStats: undefined,
    };
  }

  if (event.type === "delta") {
    return {
      ...result,
      text: result.text + (typeof event.delta === "string" ? event.delta : ""),
      status: "streaming" as const,
      firstTokenAt:
        result.firstTokenAt ??
        (typeof event.firstTokenAt === "string"
          ? event.firstTokenAt
          : undefined),
      latencyMs:
        result.latencyMs ??
        (typeof event.latencyMs === "number" ? event.latencyMs : undefined),
      stats: readEventStats(event) ?? result.stats,
    };
  }

  if (event.type === "replace-output") {
    return {
      ...result,
      text: "",
      revisions: [],
      stats: readEventStats(event) ?? result.stats,
    };
  }

  if (event.type === "thinking-delta") {
    return {
      ...result,
      thinking:
        (result.thinking ?? "") +
        (typeof event.delta === "string" ? event.delta : ""),
      stats: readEventStats(event) ?? result.stats,
    };
  }

  if (event.type === "repair-complete") {
    const repairedText =
      typeof event.repairedText === "string"
        ? event.repairedText
        : result.repairedText;

    return {
      ...result,
      repairedText,
      revisions: repairedText
        ? appendOutputRevision(
            result.revisions,
            createOutputRevision(
              "repair",
              repairedText,
              readEventTimestamp(event),
              `Repair ${((result.stats?.repairPassCount ?? 0) + 1).toString()}`,
            ),
          )
        : result.revisions,
      stats: appendTraceEvent(readEventStats(event) ?? result.stats, {
        type: "repair-complete",
        timestamp: readEventTimestamp(event),
        htmlLength:
          typeof event.repairedText === "string"
            ? event.repairedText.length
            : undefined,
      }),
    };
  }

  if (
    event.type === "agent-step" ||
    event.type === "tool-call" ||
    event.type === "tool-result" ||
    event.type === "tool-error" ||
    event.type === "repair-start"
  ) {
    let traceEvent: ModelTraceEvent | null = null;

    if (event.type === "agent-step") {
      traceEvent = {
        type: "agent-step",
        timestamp: readEventTimestamp(event),
        stepNumber:
          typeof event.stepNumber === "number" ? event.stepNumber : undefined,
        finishReason:
          typeof event.finishReason === "string"
            ? event.finishReason
            : undefined,
      };
    } else if (
      event.type === "tool-call" &&
      typeof event.toolCallId === "string" &&
      typeof event.toolName === "string"
    ) {
      traceEvent = {
        type: "tool-call",
        timestamp: readEventTimestamp(event),
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
      };
    } else if (
      event.type === "tool-result" &&
      typeof event.toolCallId === "string" &&
      typeof event.toolName === "string"
    ) {
      traceEvent = {
        type: "tool-result",
        timestamp: readEventTimestamp(event),
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        output: event.output,
        durationMs:
          typeof event.durationMs === "number" ? event.durationMs : undefined,
      };
    } else if (
      event.type === "tool-error" &&
      typeof event.toolCallId === "string" &&
      typeof event.toolName === "string"
    ) {
      traceEvent = {
        type: "tool-error",
        timestamp: readEventTimestamp(event),
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        error:
          typeof event.error === "string"
            ? event.error
            : "Tool execution failed.",
        durationMs:
          typeof event.durationMs === "number" ? event.durationMs : undefined,
      };
    } else if (event.type === "repair-start") {
      traceEvent = {
        type: "repair-start",
        timestamp: readEventTimestamp(event),
      };
    }

    return {
      ...result,
      stats: traceEvent
        ? appendTraceEvent(readEventStats(event) ?? result.stats, traceEvent)
        : readEventStats(event) ?? result.stats,
    };
  }

  if (event.type === "done") {
    const outputText = result.text.trim();
    return {
      ...result,
      status: "done" as const,
      revisions: outputText
        ? appendOutputRevision(
            result.revisions,
            createOutputRevision(
              "initial",
              result.text,
              readEventTimestamp(event),
              "Initial output",
            ),
          )
        : result.revisions,
      completedAt:
        typeof event.completedAt === "string" ? event.completedAt : undefined,
      firstTokenAt:
        result.firstTokenAt ??
        (typeof event.firstTokenAt === "string"
          ? event.firstTokenAt
          : undefined),
      latencyMs:
        result.latencyMs ??
        (typeof event.latencyMs === "number" ? event.latencyMs : undefined),
      runtimeMs:
        typeof event.runtimeMs === "number" ? event.runtimeMs : result.runtimeMs,
      finishReason:
        typeof event.finishReason === "string"
          ? event.finishReason
          : result.finishReason,
      responseId:
        typeof event.responseId === "string"
          ? event.responseId
          : result.responseId,
      usage:
        typeof event.usage === "object" && event.usage
          ? (event.usage as ModelResult["usage"])
          : result.usage,
      costs:
        typeof event.costs === "object" && event.costs
          ? (event.costs as ModelResult["costs"])
          : result.costs,
      stats: appendTraceEvent(readEventStats(event) ?? result.stats, {
        type: "done",
        timestamp: readEventTimestamp(event),
        finishReason:
          typeof event.finishReason === "string"
            ? event.finishReason
            : undefined,
      }),
      domCssStats: readEventDomCssStats(event) ?? result.domCssStats,
    };
  }

  if (event.type === "error") {
    const partialText = result.text.trim();
    return {
      ...result,
      status: "error" as const,
      revisions: partialText
        ? appendOutputRevision(
            result.revisions,
            createOutputRevision(
              "initial",
              result.text,
              readEventTimestamp(event),
              "Last partial output",
            ),
          )
        : result.revisions,
      error:
        typeof event.error === "string"
          ? event.error
          : "Unexpected model error.",
      completedAt:
        typeof event.completedAt === "string" ? event.completedAt : undefined,
      firstTokenAt:
        result.firstTokenAt ??
        (typeof event.firstTokenAt === "string"
          ? event.firstTokenAt
          : undefined),
      latencyMs:
        result.latencyMs ??
        (typeof event.latencyMs === "number" ? event.latencyMs : undefined),
      runtimeMs:
        typeof event.runtimeMs === "number" ? event.runtimeMs : result.runtimeMs,
      usage:
        typeof event.usage === "object" && event.usage
          ? (event.usage as ModelResult["usage"])
          : result.usage,
      costs:
        typeof event.costs === "object" && event.costs
          ? (event.costs as ModelResult["costs"])
          : result.costs,
      stats: appendTraceEvent(readEventStats(event) ?? result.stats, {
        type: "error",
        timestamp: readEventTimestamp(event),
        error:
          typeof event.error === "string"
            ? event.error
            : "Unexpected model error.",
      }),
      domCssStats: readEventDomCssStats(event) ?? result.domCssStats,
    };
  }

  return result;
}
