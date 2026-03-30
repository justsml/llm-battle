import { getModelLabel } from "@/lib/models";
import type {
  GatewayModel,
  ModelOutputRevision,
  ModelTraceEvent,
} from "@/lib/types";
import { sanitizeTokensPerSecond } from "@/lib/utils";

export type ModelSortMode = "released" | "name" | "provider";

export type RemoteHostModelEntry = {
  id: string;
  ownedBy: string;
  object: string;
};

export type PreviewScreenshot = {
  dataUrl: string;
  width?: number;
  height?: number;
  capturedAt?: string;
};

export type VisualDiffState = {
  status: "idle" | "running" | "ready" | "error";
  requestKey?: string;
  screenshot?: PreviewScreenshot;
  diffDataUrl?: string;
  heatmapDataUrl?: string;
  similarity?: number;
  mismatchRatio?: number;
  meanChannelDelta?: number;
  width?: number;
  height?: number;
  capturedAt?: string;
  error?: string;
};

function formatPercent(value?: number, maximumFractionDigits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(maximumFractionDigits)}%`;
}

export function formatMonthYear(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatTimeAgo(value?: string) {
  if (!value) return "—";

  const date = new Date(value);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return "—";

  const diffMs = timestamp - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const relativeFormatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });

  const ranges = [
    { unit: "year", seconds: 60 * 60 * 24 * 365 },
    { unit: "month", seconds: 60 * 60 * 24 * 30 },
    { unit: "week", seconds: 60 * 60 * 24 * 7 },
    { unit: "day", seconds: 60 * 60 * 24 },
    { unit: "hour", seconds: 60 * 60 },
    { unit: "minute", seconds: 60 },
  ] as const;

  for (const range of ranges) {
    if (Math.abs(diffSeconds) >= range.seconds) {
      return relativeFormatter.format(
        Math.round(diffSeconds / range.seconds),
        range.unit,
      );
    }
  }

  return relativeFormatter.format(diffSeconds, "second");
}

export function getCollapsedModelLabel(model: Pick<GatewayModel, "id"> | string) {
  const label = getModelLabel(typeof model === "string" ? model : model.id);
  const simplified = label.split("/").filter(Boolean).at(-1);
  return simplified ?? label;
}

export function formatDuration(ms?: number) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
}

export function formatTokenCount(value?: number) {
  if (value == null) return "—";
  return new Intl.NumberFormat().format(value);
}

function formatRatePerMillion(value?: number) {
  if (value == null) return "—";

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value * 1_000_000 >= 1 ? 2 : 4,
    maximumFractionDigits: value * 1_000_000 >= 1 ? 2 : 4,
  }).format(value * 1_000_000);
}

export function getModelPricingSummary(model: GatewayModel) {
  const parts = [
    model.pricing.input != null ? `In ${formatRatePerMillion(model.pricing.input)}/M` : null,
    model.pricing.output != null ? `Out ${formatRatePerMillion(model.pricing.output)}/M` : null,
  ].filter((value): value is string => value != null);

  return parts.length ? parts.join(" • ") : "Pricing unavailable";
}

export function formatTokensPerSecond(value?: number) {
  const sanitizedValue = sanitizeTokensPerSecond(value);
  if (sanitizedValue == null) return "—";
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits:
      sanitizedValue >= 100 ? 0 : sanitizedValue >= 10 ? 1 : 2,
  }).format(sanitizedValue)}/s`;
}

export function formatSimilarityLabel(value?: number) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)} / 100`;
}

export function formatMismatchLabel(value?: number) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatPercent(value, value <= 0.1 ? 1 : 0);
}

function getToolLabel(toolName: string) {
  return toolName.replaceAll("_", " ");
}

export function describeTraceEvent(event: ModelTraceEvent) {
  switch (event.type) {
    case "start":
      return "Started run";
    case "agent-step":
      return `Finished step ${event.stepNumber != null ? event.stepNumber + 1 : "?"}`;
    case "tool-call":
      return `Called ${getToolLabel(event.toolName)}`;
    case "tool-result":
      return `Received ${getToolLabel(event.toolName)} result`;
    case "tool-error":
      return `${getToolLabel(event.toolName)} failed`;
    case "repair-start":
      return "Started repair pass";
    case "repair-complete":
      return "Completed repair pass";
    case "done":
      return "Completed run";
    case "error":
      return "Run failed";
    default:
      return "Unknown event";
  }
}

export function formatOutputRevisionMeta(
  revision: ModelOutputRevision,
  index: number,
  total: number,
) {
  const step = `Revision ${index + 1} of ${total}`;
  return `${step} · ${revision.label}`;
}
