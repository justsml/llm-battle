"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  type CSSProperties,
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { authClient } from "@/lib/auth-client";
import { estimateModelCost } from "@/lib/gateway-models";
import {
  DEFAULT_MODELS,
  DEFAULT_PROMPT,
  getModelConfig,
  getModelLabel,
  parseModelConfig,
  supportsAgenticModel,
  toCompareModel,
} from "@/lib/models";
import { estimateTokens } from "@/lib/tokenizer";
import type {
  AgenticOptions,
  CompareModel,
  GatewayModel,
  ModelResult,
  ModelTraceEvent,
  OutputDomCssStats,
  OutputVoteValue,
  SavedRun,
} from "@/lib/types";
import { cn, sanitizeTokensPerSecond } from "@/lib/utils";

const MAX_RUNS = 20;
const LOCAL_DRAFT_KEY = "build-off:draft:v1";
const LOCAL_RECENT_MODELS_KEY = "build-off:recent-models:v1";
const MIN_MODEL_CARDS = 2;
const MAX_MODEL_CARDS = 12;
const RECENT_MODEL_LIMIT = 24;
const LIVE_TPS_WINDOW_MS = 2500;
const LIVE_TPS_MIN_WINDOW_MS = 400;
const PREVIEW_STREAM_DEBOUNCE_MS = 180;

type OutputMode = "preview" | "raw" | "thinking";
type CardSize = "s" | "m" | "l" | "xl";
type ModelCardModeKey = "standard" | "agentic";
type ModelSortMode = "released" | "name" | "provider";

type PreviewConsoleEntry = {
  level: string;
  message: string;
  timestamp: string;
};

type AgenticToolState = {
  count: number;
  status: "idle" | "running" | "error";
  error?: string;
};

type AgenticCardState = {
  enabled: boolean;
  maxTurns: number;
  stepsCompleted: number;
  tools: Record<string, AgenticToolState>;
};

type LiveStreamMetricSnapshot = {
  outputTokens?: number;
  totalTokens?: number;
  peakTokensPerSecond?: number;
};

type RectSnapshot = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PreviewScreenshot = {
  dataUrl: string;
  width?: number;
  height?: number;
  capturedAt?: string;
};

type VisualDiffState = {
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

type ModelCardWorkspaceState = {
  activeRunId: string | null;
  selectedModels: CompareModel[];
  results: ModelResult[];
  agenticActivity: Record<string, AgenticCardState>;
  previewErrors: Record<string, string[]>;
  previewToolErrors: Record<string, string[]>;
  previewOverrides: Record<string, string>;
  visualDiffs: Record<string, VisualDiffState>;
};

type BuildOffClientProps = {
  authConfig: {
    githubConfigured: boolean;
    allowLocalDevAutoAuth: boolean;
  };
  initialRunId: string | null;
  initialAgenticEnabled?: boolean;
};

const DEFAULT_AGENTIC_OPTIONS: AgenticOptions = {
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

const EVAL_HARNESS_LINKS: ReadonlyArray<{
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

const CARD_SIZE_CONFIG: Record<
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

/** Wrap a state mutation in a View Transition so the browser animates the DOM delta. */
function withTransition(update: () => void) {
  if (typeof document !== "undefined" && "startViewTransition" in document) {
    (document as Document & { startViewTransition(fn: () => void): unknown }).startViewTransition(update);
  } else {
    update();
  }
}

/** Sanitise a model ID into a valid CSS <custom-ident> for view-transition-name. */
function cardVtName(id: string) {
  return `card-${id.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

function snapshotRect(element: Element | null): RectSnapshot | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function shouldReduceMotion() {
  return (
    typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function animateBetweenRects(
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

function getRunImageSrc(run: SavedRun) {
  return run.imageDataUrl || run.imageUrl || "";
}

function createEmptyResult(model: CompareModel): ModelResult {
  return {
    modelId: model.id,
    label: model.label,
    text: "",
    thinking: "",
    status: "idle",
    vote: {
      score: 0,
      upvotes: 0,
      downvotes: 0,
    },
  };
}

function createEmptyResults(models: CompareModel[]): ModelResult[] {
  return models.map(createEmptyResult);
}

function getModelCardModeKey(agenticEnabled: boolean): ModelCardModeKey {
  return agenticEnabled ? "agentic" : "standard";
}

function createInitialModelCardWorkspaceState(
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
    visualDiffs: {},
  };
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getRunHref(runId: string, agenticEnabled: boolean) {
  return `${getPendingRunHref(agenticEnabled)}?runId=${encodeURIComponent(runId)}`;
}

function getPendingRunHref(agenticEnabled: boolean) {
  return agenticEnabled ? "/run-agentic" : "/run-generate";
}

function getRunIdFromLocation(
  pathname: string,
  searchParams: URLSearchParams,
) {
  const queryRunId = searchParams.get("runId");
  if (queryRunId) return queryRunId;

  const match = pathname.match(/^\/runs\/([^/]+)$/);
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

function getRouteAgenticEnabled(pathname: string, fallback: boolean) {
  if (pathname === "/run-agentic") return true;
  if (pathname === "/run-generate" || pathname === "/") return false;
  return fallback;
}

function toDataUrl(file: File) {
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

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMonthYear(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatTimeAgo(value?: string) {
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

function getCollapsedModelLabel(model: Pick<GatewayModel, "id"> | string) {
  const label = getModelLabel(typeof model === "string" ? model : model.id);
  const simplified = label.split("/").filter(Boolean).at(-1);
  return simplified ?? label;
}

function formatVoteScore(score: number) {
  if (score > 0) return `+${score}`;
  return String(score);
}

function getVoteKey(runId: string, modelIndex: number) {
  return `${runId}:${modelIndex}`;
}

function statusTone(status: ModelResult["status"]) {
  switch (status) {
    case "streaming":
      return "text-(--accent)";
    case "done":
      return "text-(--success)";
    case "error":
      return "text-(--danger)";
    default:
      return "text-(--muted)";
  }
}

function statusLineClass(status: ModelResult["status"] | undefined) {
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

function syncModelLabels(models: CompareModel[], catalog: GatewayModel[]) {
  return models.map((model) => {
    const match = catalog.find((item) => item.config === getModelConfig(model));
    return match
      ? {
          ...model,
          label: match.name,
          config: match.config,
        }
      : {
          ...model,
          label: getModelLabel(model),
          config: getModelConfig(model),
        };
  });
}

function getModelSourceLabel(model: Pick<CompareModel, "id" | "config"> | GatewayModel) {
  const { host } = parseModelConfig(model);

  if (host === "openrouter.ai") return "OpenRouter";
  if (host === "ai-gateway.vercel.sh") return "Vercel";
  return host;
}

function getProviderTone(source: string) {
  if (source === "OpenRouter") {
    return {
      trigger:
        "border-[color-mix(in_oklch,var(--accent)_18%,var(--line))] bg-[color-mix(in_oklch,var(--accent)_5%,var(--panel))]",
      chip:
        "border-[color-mix(in_oklch,var(--accent)_30%,transparent)] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[color-mix(in_oklch,var(--accent)_62%,white)]",
      option:
        "border-l-[color-mix(in_oklch,var(--accent)_36%,transparent)]",
      meta:
        "border-[color-mix(in_oklch,var(--accent)_20%,transparent)] bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]",
    };
  }

  if (source === "Vercel") {
    return {
      trigger:
        "border-[color-mix(in_oklch,var(--success)_16%,var(--line))] bg-[color-mix(in_oklch,var(--success)_4%,var(--panel))]",
      chip:
        "border-[color-mix(in_oklch,var(--success)_28%,transparent)] bg-[color-mix(in_oklch,var(--success)_11%,transparent)] text-[color-mix(in_oklch,var(--success)_66%,white)]",
      option:
        "border-l-[color-mix(in_oklch,var(--success)_32%,transparent)]",
      meta:
        "border-[color-mix(in_oklch,var(--success)_18%,transparent)] bg-[color-mix(in_oklch,var(--success)_7%,transparent)]",
    };
  }

  return {
    trigger:
      "border-[color-mix(in_oklch,var(--foreground)_12%,var(--line))] bg-(--panel)",
    chip:
      "border-(--line) bg-[color-mix(in_oklch,var(--foreground)_4%,transparent)] text-(--muted)",
    option:
      "border-l-[color-mix(in_oklch,var(--foreground)_16%,transparent)]",
    meta: "border-(--line) bg-transparent",
  };
}

function mergeRecentModelConfigs(current: string[], additions: string[]) {
  const merged = [...additions, ...current].filter(Boolean);
  const seen = new Set<string>();
  const next: string[] = [];

  for (const config of merged) {
    if (seen.has(config)) continue;
    seen.add(config);
    next.push(config);

    if (next.length >= RECENT_MODEL_LIMIT) {
      break;
    }
  }

  if (
    next.length === current.length &&
    next.every((config, index) => config === current[index])
  ) {
    return current;
  }

  return next;
}

function shuffleItems<T>(items: T[]) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function getSelectableCatalogModels(
  catalog: GatewayModel[],
  agenticEnabled: boolean,
) {
  return catalog.filter(
    (model) =>
      model.supportsImageInput
      && (!agenticEnabled || supportsAgenticModel(model)),
  );
}

function getMaxSelectableModelCards(
  catalog: GatewayModel[],
  agenticEnabled: boolean,
) {
  if (!catalog.length) return MAX_MODEL_CARDS;
  return Math.min(
    MAX_MODEL_CARDS,
    getSelectableCatalogModels(catalog, agenticEnabled).length,
  );
}

function getMinSelectableModelCards(
  catalog: GatewayModel[],
  agenticEnabled: boolean,
) {
  if (!catalog.length) return MIN_MODEL_CARDS;
  return Math.min(
    MIN_MODEL_CARDS,
    Math.max(1, getMaxSelectableModelCards(catalog, agenticEnabled)),
  );
}

function getPreferredAvailableModels(
  catalog: GatewayModel[],
  selectedConfigs: string[],
  count: number,
  recentConfigs: string[],
  agenticEnabled: boolean,
) {
  if (count <= 0) return [];

  const usedConfigs = new Set(selectedConfigs);
  const visionModels = getSelectableCatalogModels(catalog, agenticEnabled);
  const modelsByConfig = new Map(
    visionModels.map((model) => [model.config, model]),
  );
  const nextModels: GatewayModel[] = [];

  for (const config of recentConfigs) {
    if (usedConfigs.has(config)) continue;
    const model = modelsByConfig.get(config);
    if (!model) continue;

    nextModels.push(model);
    usedConfigs.add(config);

    if (nextModels.length >= count) {
      return nextModels;
    }
  }

  const randomPool = shuffleItems(
    visionModels.filter((model) => !usedConfigs.has(model.config)),
  );

  for (const model of randomPool) {
    nextModels.push(model);
    usedConfigs.add(model.config);

    if (nextModels.length >= count) {
      break;
    }
  }

  return nextModels;
}

function getPreferredModelsForModeSwitch(
  catalog: GatewayModel[],
  currentModels: CompareModel[],
  savedModels: CompareModel[],
  recentConfigs: string[],
  nextAgenticEnabled: boolean,
) {
  if (!catalog.length) {
    return currentModels.length ? currentModels : savedModels;
  }

  const maxSelectableCards = getMaxSelectableModelCards(catalog, nextAgenticEnabled);
  const selectableConfigs = new Set(
    getSelectableCatalogModels(catalog, nextAgenticEnabled).map(
      (model) => model.config,
    ),
  );

  const retainSelectableUniqueModels = (models: CompareModel[]) =>
    models.filter((model, index, entries) => {
      const config = getModelConfig(model);
      return (
        selectableConfigs.has(config)
        && entries.findIndex((entry) => getModelConfig(entry) === config) === index
      );
    });

  const retainedCurrent = retainSelectableUniqueModels(currentModels);
  const retainedSaved = retainSelectableUniqueModels(savedModels).filter(
    (model) =>
      !retainedCurrent.some(
        (entry) => getModelConfig(entry) === getModelConfig(model),
      ),
  );
  const desiredCount = Math.min(
    maxSelectableCards,
    Math.max(retainedCurrent.length, savedModels.length || currentModels.length),
  );
  const additions = getPreferredAvailableModels(
    catalog,
    [...retainedCurrent, ...retainedSaved].map((model) => getModelConfig(model)),
    Math.max(0, desiredCount - retainedCurrent.length - retainedSaved.length),
    recentConfigs,
    nextAgenticEnabled,
  ).map(toCompareModel);

  return [...retainedCurrent, ...retainedSaved, ...additions].slice(
    0,
    desiredCount,
  );
}

function getReleasedAtTime(model: GatewayModel) {
  if (!model.releasedAt) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(model.releasedAt);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function sortModels(models: GatewayModel[], mode: ModelSortMode) {
  return [...models].sort((left, right) => {
    if (mode === "released") {
      const releasedDelta = getReleasedAtTime(right) - getReleasedAtTime(left);
      if (releasedDelta !== 0) return releasedDelta;
    }

    if (mode === "provider") {
      const providerOrder = getModelSourceLabel(left).localeCompare(
        getModelSourceLabel(right),
      );
      if (providerOrder !== 0) return providerOrder;

      const ownerOrder = left.ownedBy.localeCompare(right.ownedBy);
      if (ownerOrder !== 0) return ownerOrder;
    }

    const nameOrder = left.name.localeCompare(right.name);
    if (nameOrder !== 0) return nameOrder;

    return left.id.localeCompare(right.id);
  });
}

function buildModelSections(models: GatewayModel[], mode: ModelSortMode) {
  if (mode === "provider") {
    const groups = sortModels(models, mode).reduce<Record<string, GatewayModel[]>>(
      (result, model) => {
        const key = `${getModelSourceLabel(model)} / ${model.ownedBy}`;
        result[key] ??= [];
        result[key].push(model);
        return result;
      },
      {},
    );

    return Object.entries(groups).map(([label, sectionModels]) => ({
      key: label,
      label,
      models: sectionModels,
    }));
  }

  return [{
    key: mode,
    label: mode === "released" ? "Newest first" : "A-Z",
    models: sortModels(models, mode),
  }];
}

function looksLikeHtmlDocument(value: string) {
  return /<!doctype html|<html[\s>]|<body[\s>]|<head[\s>]/i.test(value);
}

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\w:-]*(?:\s[^>]*)?>/i.test(value);
}

function unwrapHtmlCodeFence(markup: string) {
  const trimmed = markup.trim();
  const fencedMatch = trimmed.match(
    /^```(?:html|htm)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i,
  );

  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const leadingFenceMatch = trimmed.match(/^```(?:html|htm)?[ \t]*\r?\n?/i);
  if (!leadingFenceMatch) {
    return markup;
  }

  const withoutLeadingFence = trimmed.slice(leadingFenceMatch[0].length);
  return withoutLeadingFence.replace(/\r?\n?```[ \t]*$/i, "").trim();
}

/**
 * Models sometimes emit CSS url() syntax inside HTML href/src attributes, e.g.
 *   <link href="url('https://fonts.googleapis.com/...')">
 * Without allow-same-origin on the sandbox, srcdoc resolves relative paths
 * against the parent page origin, turning these into 404s on our own server.
 * Strip the url() wrapper so the attribute value is a plain URL, regardless
 * of whether the model used single quotes, double quotes, or extra whitespace.
 */
function sanitizePreviewMarkup(markup: string): string {
  const normalizedAttributes = markup.replace(
    /\b(href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, attr, doubleQuoted, singleQuoted, unquoted) => {
      const rawValue = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
      const sanitizedValue = rawValue.replace(
        /^\s*url\(\s*(['"]?)(https?:[^'")\s]+)\1\s*\)\s*$/i,
        "$2",
      );

      if (sanitizedValue === rawValue) {
        return match;
      }

      if (doubleQuoted != null) {
        return `${attr}="${sanitizedValue}"`;
      }

      if (singleQuoted != null) {
        return `${attr}='${sanitizedValue}'`;
      }

      return `${attr}=${sanitizedValue}`;
    },
  );

  // Cross-origin assets can taint the canvas used for screenshot export.
  // Add an anonymous crossorigin hint to common fetchable elements when missing.
  return normalizedAttributes.replace(
    /<(img|audio|video|link|script)\b(?![^>]*\bcrossorigin\s*=)([^>]*)>/gi,
    (match, tagName, attrs) => {
      if (!/\b(?:src|href)\s*=/i.test(attrs)) {
        return match;
      }

      return `<${tagName} crossorigin="anonymous"${attrs}>`;
    },
  );
}

function createPreviewSrcDoc(
  markup: string,
  previewId: string,
  fitToViewport = true,
) {
  const sanitized = sanitizePreviewMarkup(unwrapHtmlCodeFence(markup));
  markup = sanitized;
  const previewBridge = `
<script>
(() => {
  const previewId = ${JSON.stringify(previewId)};
  const consoleRecords = [];
  const send = (kind, message) => {
    try {
      window.parent.postMessage(
        {
          source: "build-off-preview",
          previewId,
          kind,
          message: typeof message === "string" ? message : String(message ?? ""),
        },
        "*",
      );
    } catch {}
  };

  const sendCommandResult = (commandId, action, payload, error) => {
    try {
      window.parent.postMessage(
        {
          source: "build-off-preview",
          previewId,
          kind: error ? "command-error" : "command-result",
          commandId,
          action,
          payload,
          error,
        },
        "*",
      );
    } catch {}
  };

  const recordConsole = (level, args) => {
    const message = args
      .map((value) => {
        if (typeof value === "string") return value;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      })
      .join(" ");

    consoleRecords.push({
      level,
      message,
      timestamp: new Date().toISOString(),
    });

    if (consoleRecords.length > 200) {
      consoleRecords.splice(0, consoleRecords.length - 200);
    }
  };

  ["log", "warn", "error", "info"].forEach((level) => {
    const original = console[level]?.bind(console);
    console[level] = (...args) => {
      recordConsole(level, args);
      original?.(...args);
    };
  });

  const captureScreenshot = async () => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("script").forEach((node) => node.remove());
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");

    const transparentPixel =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    const isExportSafeUrl = (value) => {
      if (typeof value !== "string") return true;
      const normalized = value.trim().toLowerCase();
      return (
        !normalized ||
        normalized.startsWith("#") ||
        normalized.startsWith("data:") ||
        normalized.startsWith("blob:")
      );
    };
    const stripUnsafeUrls = (value) =>
      value.replace(/url\(([^)]+)\)/gi, (match, rawUrl) => {
        const cleaned = rawUrl.trim().replace(/^['"]|['"]$/g, "");
        return isExportSafeUrl(cleaned) ? match : "none";
      });

    clone.querySelectorAll("*").forEach((node) => {
      if (!(node instanceof Element)) return;

      const inlineStyle = node.getAttribute("style");
      if (inlineStyle && /url\(/i.test(inlineStyle)) {
        const sanitizedStyle = stripUnsafeUrls(inlineStyle);
        if (sanitizedStyle.trim()) {
          node.setAttribute("style", sanitizedStyle);
        } else {
          node.removeAttribute("style");
        }
      }

      if (node instanceof HTMLImageElement) {
        if (!isExportSafeUrl(node.currentSrc || node.src || "")) {
          node.setAttribute("src", transparentPixel);
          node.removeAttribute("srcset");
          node.removeAttribute("crossorigin");
        }
        return;
      }

      if (
        node instanceof HTMLAudioElement ||
        node instanceof HTMLVideoElement
      ) {
        if (!isExportSafeUrl(node.currentSrc || node.src || "")) {
          node.removeAttribute("src");
        }
        if (node instanceof HTMLVideoElement && !isExportSafeUrl(node.poster || "")) {
          node.removeAttribute("poster");
        }
        node.removeAttribute("srcset");
        return;
      }

      if (node instanceof HTMLSourceElement) {
        if (!isExportSafeUrl(node.src || "")) {
          node.remove();
          return;
        }
        node.removeAttribute("srcset");
        return;
      }

      if (node instanceof HTMLLinkElement) {
        if (!isExportSafeUrl(node.href || "")) {
          node.remove();
        }
        return;
      }

      if (
        node instanceof HTMLIFrameElement ||
        node instanceof HTMLEmbedElement ||
        node instanceof HTMLObjectElement
      ) {
        node.remove();
        return;
      }

      ["src", "srcset", "href", "poster"].forEach((attr) => {
        const value = node.getAttribute(attr);
        if (value && !isExportSafeUrl(value)) {
          node.removeAttribute(attr);
        }
      });
    });

    const width = Math.max(
      320,
      Math.min(
        1600,
        Math.max(
          document.documentElement.scrollWidth,
          document.body?.scrollWidth ?? 0,
          window.innerWidth,
        ),
      ),
    );
    const height = Math.max(
      240,
      Math.min(
        1200,
        Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight ?? 0,
          window.innerHeight,
        ),
      ),
    );

    const svg = \`<svg xmlns="http://www.w3.org/2000/svg" width="\${width}" height="\${height}" viewBox="0 0 \${width} \${height}">
      <foreignObject width="100%" height="100%">\${new XMLSerializer().serializeToString(clone)}</foreignObject>
    </svg>\`;

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Unable to render preview screenshot."));
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas 2D context is unavailable.");
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      let dataUrl = "";
      try {
        dataUrl = canvas.toDataURL("image/png");
      } catch (error) {
        if (error instanceof DOMException && error.name === "SecurityError") {
          throw new Error(
            "Unable to capture preview because it includes external assets that the browser will not export.",
          );
        }
        throw error;
      }

      return {
        dataUrl,
        width,
        height,
        capturedAt: new Date().toISOString(),
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const applyViewportFit = () => {
    const body = document.body;
    if (!body) return;

    body.style.transform = "";
    body.style.transformOrigin = "";
    body.style.width = "";
    body.style.minHeight = "";

    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      body.scrollWidth,
      body.offsetWidth,
    );
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || documentWidth;

    if (!documentWidth || !viewportWidth) return;

    const scale = Math.min(1, viewportWidth / documentWidth);
    if (scale > 0.98) return;

    body.style.transformOrigin = "top left";
    body.style.transform = \`scale(\${scale})\`;
    body.style.width = \`\${100 / scale}%\`;
    body.style.minHeight = \`\${Math.ceil(window.innerHeight / scale)}px\`;
  };

  send("clear", "");

  if (${fitToViewport ? "true" : "false"}) {
    window.addEventListener("load", applyViewportFit);
    window.addEventListener("resize", applyViewportFit);
    requestAnimationFrame(() => {
      requestAnimationFrame(applyViewportFit);
    });

    const fitObserver = new MutationObserver(() => {
      requestAnimationFrame(applyViewportFit);
    });

    fitObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }

  window.addEventListener("error", (event) => {
    recordConsole("error", [event.message || "Runtime error while rendering preview."]);
    send("error", event.message || "Runtime error while rendering preview.");
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    recordConsole("error", [
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection while rendering preview.",
    ]);
    send(
      "error",
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection while rendering preview.",
    );
  });

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (
      !data ||
      typeof data !== "object" ||
      data.source !== "build-off-preview-parent" ||
      data.previewId !== previewId ||
      typeof data.commandId !== "string" ||
      typeof data.action !== "string"
    ) {
      return;
    }

    try {
      if (data.action === "get_console_logs") {
        sendCommandResult(data.commandId, data.action, {
          logs: consoleRecords.slice(-100),
        });
        return;
      }

      if (data.action === "get_screenshot") {
        sendCommandResult(
          data.commandId,
          data.action,
          await captureScreenshot(),
        );
      }
    } catch (error) {
      sendCommandResult(
        data.commandId,
        data.action,
        null,
        error instanceof Error ? error.message : "Preview command failed.",
      );
    }
  });
})();
</script>`;

  const previewBase = `
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; min-height: 100%; overflow: auto !important; background: white; }
</style>`;

  if (!looksLikeHtmlDocument(markup)) {
    return `<!DOCTYPE html><html><head>${previewBase}${previewBridge}</head><body>${markup}</body></html>`;
  }

  if (/<head[\s>]/i.test(markup)) {
    return markup.replace(
      /<head([^>]*)>/i,
      `<head$1>${previewBase}${previewBridge}`,
    );
  }

  if (/<html[\s>]/i.test(markup)) {
    return markup.replace(
      /<html([^>]*)>/i,
      `<html$1><head>${previewBase}${previewBridge}</head>`,
    );
  }

  if (/<body[\s>]/i.test(markup)) {
    return markup.replace(/<body([^>]*)>/i, `<body$1>${previewBridge}`);
  }

  return `<!DOCTYPE html><html><head>${previewBase}${previewBridge}</head><body>${markup}</body></html>`;
}

function formatDuration(ms?: number) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
}

function liveElapsed(result: ModelResult, nowMs: number): number | undefined {
  if (result.runtimeMs != null) return result.runtimeMs;
  if (result.startedAt && result.status === "streaming") {
    return Math.max(0, nowMs - Date.parse(result.startedAt));
  }
  return result.runtimeMs;
}

function formatTokenCount(value?: number) {
  if (value == null) return "—";
  return new Intl.NumberFormat().format(value);
}

function formatLiveTokenCount(value: number | undefined, estimated = false) {
  const formatted = formatTokenCount(value);
  if (!estimated || value == null) return formatted;
  return `~${formatted}`;
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

function formatTokensPerSecond(value?: number) {
  const sanitizedValue = sanitizeTokensPerSecond(value);
  if (sanitizedValue == null) return "—";
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits:
      sanitizedValue >= 100 ? 0 : sanitizedValue >= 10 ? 1 : 2,
  }).format(sanitizedValue)}/s`;
}

function sumDefinedNumber(current: number | undefined, next: number | undefined) {
  if (next == null) return current;
  return (current ?? 0) + next;
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

function getModelPricingSummary(model: GatewayModel) {
  const parts = [
    model.pricing.input != null ? `In ${formatRatePerMillion(model.pricing.input)}/M` : null,
    model.pricing.output != null ? `Out ${formatRatePerMillion(model.pricing.output)}/M` : null,
  ].filter((value): value is string => value != null);

  return parts.length ? parts.join(" • ") : "Pricing unavailable";
}

function formatResultStatus(result: ModelResult) {
  if (result.status === "streaming") return "Streaming";
  if (result.status === "done") return "Complete";
  if (result.status === "error") return result.error || "Error";
  return "Waiting";
}

function getToolLabel(toolName: string) {
  return TOOL_LABELS[toolName] ?? toolName.replaceAll("_", " ");
}

function readEventStats(event: Record<string, unknown>): ModelResult["stats"] {
  return typeof event.stats === "object" && event.stats
    ? (event.stats as ModelResult["stats"])
    : undefined;
}

function readEventDomCssStats(
  event: Record<string, unknown>,
): ModelResult["domCssStats"] {
  return typeof event.domCssStats === "object" && event.domCssStats
    ? (event.domCssStats as ModelResult["domCssStats"])
    : undefined;
}

function readEventTimestamp(event: Record<string, unknown>) {
  return typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
}

function readTraceEvents(
  value: ModelResult["stats"],
): ModelTraceEvent[] {
  const events = value?.trace?.events;
  return Array.isArray(events) ? events : [];
}

function appendTraceEvent(
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

function formatPercent(value?: number, maximumFractionDigits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(maximumFractionDigits)}%`;
}

function formatSimilarityLabel(value?: number) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)} / 100`;
}

function formatMismatchLabel(value?: number) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatPercent(value, value <= 0.1 ? 1 : 0);
}

function hashString(value: string) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

function getVisualDiffRequestKey(
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

async function buildVisualDiff(
  referenceDataUrl: string,
  screenshot: PreviewScreenshot,
): Promise<VisualDiffState> {
  const [referenceImage, previewImage] = await Promise.all([
    loadImageElement(referenceDataUrl),
    loadImageElement(screenshot.dataUrl),
  ]);
  const width = Math.max(1, Math.min(referenceImage.naturalWidth, previewImage.naturalWidth));
  const height = Math.max(1, Math.min(referenceImage.naturalHeight, previewImage.naturalHeight));

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
    const redDelta = Math.abs(referenceData.data[index] - previewData.data[index]);
    const greenDelta = Math.abs(referenceData.data[index + 1] - previewData.data[index + 1]);
    const blueDelta = Math.abs(referenceData.data[index + 2] - previewData.data[index + 2]);
    const alphaDelta = Math.abs(referenceData.data[index + 3] - previewData.data[index + 3]);
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

function describeTraceEvent(event: ModelTraceEvent) {
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

function formatStatCount(value?: number) {
  if (value == null) return "-";
  return value.toLocaleString();
}

function formatByteCount(value?: number) {
  if (value == null) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function buildDomCssStatItems(stats?: OutputDomCssStats) {
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

function createAgenticCardState(options: AgenticOptions): AgenticCardState {
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

function summarizePrompt(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "No prompt yet.";
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 117)}...`;
}

function getUserDisplayName(user: {
  name?: string | null;
  email?: string | null;
  isAnonymous?: boolean | null;
}) {
  if (user.isAnonymous) return "Local Dev Guest";
  return user.name?.trim() || user.email?.trim() || "Signed in user";
}

function getUserMonogram(user: {
  name?: string | null;
  email?: string | null;
  isAnonymous?: boolean | null;
}) {
  return getUserDisplayName(user).trim().charAt(0).toUpperCase() || "U";
}

function modelMatchesQuery(model: GatewayModel, query: string) {
  if (!query.trim()) return true;

  const haystack = [
    model.name,
    model.id,
    model.ownedBy,
    model.type,
    model.description,
    ...model.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.trim().toLowerCase());
}

type ModelPickerProps = {
  value: CompareModel;
  catalog: GatewayModel[];
  disabled: boolean;
  agenticEnabled: boolean;
  sortMode: ModelSortMode;
  onSortModeChange: (mode: ModelSortMode) => void;
  selectedModels: CompareModel[];
  recentModelConfigs: string[];
  onSelect: (modelConfig: string) => void;
  onOpenChange?: (isOpen: boolean) => void;
  variant?: "default" | "header";
};

function ModelPicker({
  value,
  catalog,
  disabled,
  agenticEnabled,
  sortMode,
  onSortModeChange,
  selectedModels,
  recentModelConfigs,
  onSelect,
  onOpenChange,
  variant = "default",
}: ModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const didMountRef = useRef(false);

  const selectedCatalogModel =
    catalog.find((model) => model.config === getModelConfig(value)) ?? null;
  const filteredModels = getSelectableCatalogModels(catalog, agenticEnabled).filter(
    (model) => modelMatchesQuery(model, query),
  );
  const filteredSections = buildModelSections(filteredModels, sortMode);
  const selectedProvider = selectedCatalogModel
    ? getModelSourceLabel(selectedCatalogModel)
    : getModelSourceLabel(value);
  const selectedProviderTone = getProviderTone(selectedProvider);
  const selectedConfigs = new Set(selectedModels.map((model) => getModelConfig(model)));
  const triggerClassName =
    variant === "header"
      ? "w-full min-w-0 rounded-[1rem] border px-3 py-2.5 text-left transition hover:bg-(--card-active)"
      : "w-full rounded-[1rem] border px-3 py-3 text-left transition hover:bg-(--card-active)";

  useEffect(() => {
    if (!isOpen) return;

    searchRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setQuery("");
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setQuery("");
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onOpenChange]);

  return (
    <div
      className={cn("relative", variant === "header" && "min-w-0 flex-1", isOpen && "z-40")}
      ref={rootRef}
    >
      <button
        className={cn(
          triggerClassName,
          selectedProviderTone.trigger,
          isOpen &&
            "shadow-[0_18px_50px_color-mix(in_oklch,var(--foreground)_12%,transparent)]",
          variant === "header" && "bg-transparent",
          disabled && "cursor-not-allowed opacity-60",
        )}
        disabled={disabled}
        onClick={() =>
          setIsOpen((current) => {
            const next = !current;
            if (!next) setQuery("");
            return next;
          })
        }
        type="button"
      >
        <span className="block truncate text-sm font-medium">
          {selectedCatalogModel
            ? getCollapsedModelLabel(selectedCatalogModel)
            : getCollapsedModelLabel(value.id)}
        </span>
        <span className="mt-1 block truncate text-xs text-(--muted)">
          {selectedCatalogModel
            ? agenticEnabled && !supportsAgenticModel(selectedCatalogModel)
              ? "Unavailable in agentic mode"
              : selectedCatalogModel.releasedAt
                ? `Released ${formatTimeAgo(selectedCatalogModel.releasedAt)}`
                : selectedCatalogModel.id
            : value.id}
        </span>
      </button>

      {isOpen ? (
        <div
          className="absolute left-0 z-[90] mt-2 w-full overflow-hidden rounded-[1.2rem] border border-(--line) bg-(--panel) shadow-[0_24px_80px_color-mix(in_oklch,var(--foreground)_18%,transparent)] backdrop-blur-xl"
        >
          <div className="sticky top-0 z-10 border-b border-(--line) bg-(--panel-strong) p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                ref={searchRef}
                className="w-full rounded-[0.9rem] border border-(--line) bg-(--card) px-3 py-2 text-sm outline-none transition focus:border-(--foreground)"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by name, provider, id, or tag"
                value={query}
              />
              <select
                aria-label="Sort models"
                className="rounded-[0.9rem] border border-(--line) bg-(--card) px-3 py-2 text-sm outline-none transition focus:border-(--foreground)"
                onChange={(event) =>
                  onSortModeChange(event.target.value as ModelSortMode)
                }
                value={sortMode}
              >
                <option value="released">Release date</option>
                <option value="name">Name</option>
                <option value="provider">Provider</option>
              </select>
            </div>
            {agenticEnabled ? (
              <p className="mt-2 px-1 text-[11px] text-(--muted)">
                Agentic mode only shows vision models with tool calling or reasoning support.
              </p>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {filteredSections.length ? (
              filteredSections.map((section) => (
                <div className="mb-2 last:mb-0" key={section.key}>
                  <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-(--muted)">
                    {section.label}
                  </p>
                  <div className="space-y-1">
                    {section.models.map((entry) => {
                      const providerTone = getProviderTone(
                        getModelSourceLabel(entry),
                      );
                      const isRemembered = recentModelConfigs.includes(entry.config);
                      const isSelectedElsewhere =
                        selectedConfigs.has(entry.config) &&
                        entry.config !== getModelConfig(value);
                      return (
                        <button
                          className={cn(
                            "w-full rounded-[1rem] border border-l-[3px] px-3 py-2 text-left transition",
                            providerTone.option,
                            isRemembered &&
                              "shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--foreground)_14%,transparent)]",
                            entry.config === getModelConfig(value)
                              ? "bg-(--card-active) shadow-[0_10px_26px_color-mix(in_oklch,var(--foreground)_10%,transparent)]"
                              : "border-(--line) bg-(--card) hover:bg-(--card-active)",
                          )}
                          key={entry.config}
                          onClick={() => {
                            onSelect(entry.config);
                            setQuery("");
                            setIsOpen(false);
                            onOpenChange?.(false);
                          }}
                          type="button"
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="block min-w-0">
                              <span className="block text-sm font-medium">
                                {getModelLabel(entry.id)}
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-(--muted)">
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 font-semibold uppercase tracking-[0.14em]",
                                    providerTone.chip,
                                  )}
                                >
                                  {getModelSourceLabel(entry)}
                                </span>
                                <span className="truncate">
                                  {entry.ownedBy}
                                </span>
                                {entry.supportsToolCalling ? (
                                  <span className="rounded-full border border-(--line) px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-(--muted)">
                                    Tools
                                  </span>
                                ) : null}
                                {entry.supportsReasoning ? (
                                  <span className="rounded-full border border-(--line) px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-(--muted)">
                                    Reasoning
                                  </span>
                                ) : null}
                                {isSelectedElsewhere ? (
                                  <span className="rounded-full border border-(--line) px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-(--muted)">
                                    In use
                                  </span>
                                ) : null}
                              </span>
                              <span className="mt-1 block text-[11px] text-(--muted)">
                                {getModelPricingSummary(entry)}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-(--muted)",
                                  providerTone.meta,
                                )}
                              >
                                {formatMonthYear(entry.releasedAt)}
                              </span>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-3 py-8 text-center text-sm text-(--muted)">
                No models matched that filter.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type LiveHtmlPreviewProps = {
  markup: string;
  overrideMarkup?: string;
  previewId: string;
  title: string;
  isStreaming: boolean;
  iframeRef?: (element: HTMLIFrameElement | null) => void;
  interactive?: boolean;
};

type PreviewFrameProps = {
  iframeRef?: (element: HTMLIFrameElement | null) => void;
  interactive: boolean;
  markup: string;
  previewId: string;
  title: string;
};

function PreviewFrame({
  iframeRef,
  interactive,
  markup,
  previewId,
  title,
}: PreviewFrameProps) {
  return (
    <iframe
      className={cn(
        "h-full w-full bg-white",
        !interactive && "pointer-events-none",
      )}
      ref={iframeRef}
      sandbox="allow-scripts"
      srcDoc={createPreviewSrcDoc(markup, previewId, !interactive)}
      tabIndex={interactive ? 0 : -1}
      title={title}
    />
  );
}

type DebouncedStreamingPreviewFrameProps = PreviewFrameProps;

function DebouncedStreamingPreviewFrame({
  iframeRef,
  interactive,
  markup,
  previewId,
  title,
}: DebouncedStreamingPreviewFrameProps) {
  const [committedMarkup, setCommittedMarkup] = useState(markup);

  useEffect(() => {
    if (committedMarkup === markup) return;

    const timeoutId = window.setTimeout(() => {
      setCommittedMarkup(markup);
    }, PREVIEW_STREAM_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [committedMarkup, markup]);

  return (
    <PreviewFrame
      iframeRef={iframeRef}
      interactive={interactive}
      markup={committedMarkup}
      previewId={previewId}
      title={title}
    />
  );
}

function LiveHtmlPreview({
  markup,
  overrideMarkup,
  previewId,
  title,
  isStreaming,
  iframeRef,
  interactive = false,
}: LiveHtmlPreviewProps) {
  const normalizedMarkup = unwrapHtmlCodeFence(overrideMarkup ?? markup);
  const deferredMarkup = useDeferredValue(normalizedMarkup);

  if (isStreaming) {
    return (
      <DebouncedStreamingPreviewFrame
        key={previewId}
        iframeRef={iframeRef}
        interactive={interactive}
        markup={deferredMarkup}
        previewId={previewId}
        title={title}
      />
    );
  }

  return (
    <PreviewFrame
      iframeRef={iframeRef}
      interactive={interactive}
      markup={normalizedMarkup}
      previewId={previewId}
      title={title}
    />
  );
}

type OutputViewportProps = {
  title: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  contentStyle?: CSSProperties;
};

function OutputViewport({
  title,
  children,
  className,
  contentClassName,
  contentStyle,
}: OutputViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === viewportRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  async function toggleFullscreen() {
    const viewport = viewportRef.current;
    if (!viewport) return;

    if (document.fullscreenElement === viewport) {
      await document.exitFullscreen();
      return;
    }

    await viewport.requestFullscreen();
  }

  return (
    <div
      className={cn("output-viewport relative", className)}
      ref={viewportRef}
    >
      <button
        aria-label={`${isFullscreen ? "Exit" : "Open"} ${title} full screen`}
        className="output-viewport__action absolute right-3 top-3 z-10 rounded-full border border-(--line) bg-(--card) px-3 py-1.5 text-xs font-medium text-(--foreground) shadow-[0_10px_30px_color-mix(in_oklch,var(--foreground)_12%,transparent)] transition hover:bg-(--card-active)"
        onClick={() => {
          void toggleFullscreen();
        }}
        type="button"
      >
        {isFullscreen ? "Exit full screen" : "Full screen"}
      </button>

      <div
        className={cn(
          "output-viewport__content",
          contentClassName,
        )}
        style={contentStyle}
      >
        {children}
      </div>
    </div>
  );
}

type VisualComparisonPanelProps = {
  referenceImageUrl: string;
  visualState?: VisualDiffState;
  onRefresh?: () => void;
  compact?: boolean;
};

function VisualComparisonPanel({
  referenceImageUrl,
  visualState,
  onRefresh,
  compact = false,
}: VisualComparisonPanelProps) {
  const hasAssets =
    !!visualState?.screenshot?.dataUrl && !!visualState?.heatmapDataUrl;

  return (
    <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
            Visual match
          </p>
          <p className="mt-1 text-sm text-(--foreground)">
            Similarity <strong>{formatSimilarityLabel(visualState?.similarity)}</strong>
            {" · "}
            Mismatch <strong>{formatMismatchLabel(visualState?.mismatchRatio)}</strong>
          </p>
        </div>
        {onRefresh ? (
          <button
            className="rounded-full border border-(--line) px-3 py-1 text-xs font-medium transition hover:bg-(--card-active)"
            onClick={onRefresh}
            type="button"
          >
            {visualState?.status === "running" ? "Refreshing…" : "Refresh diff"}
          </button>
        ) : null}
      </div>

      {visualState?.status === "error" ? (
        <p className="mt-2 text-sm text-(--danger)">{visualState.error}</p>
      ) : null}

      {hasAssets ? (
        <div
          className={cn(
            "mt-3 grid gap-3",
            compact ? "sm:grid-cols-3" : "lg:grid-cols-3",
          )}
        >
          <div className="overflow-hidden rounded-[0.9rem] border border-(--line) bg-white">
            <Image
              alt="Reference screenshot"
              className="h-auto w-full"
              height={visualState?.height ?? 480}
              src={referenceImageUrl}
              unoptimized
              width={visualState?.width ?? 640}
            />
          </div>
          <div className="overflow-hidden rounded-[0.9rem] border border-(--line) bg-white">
            <Image
              alt="Generated output screenshot"
              className="h-auto w-full"
              height={visualState?.height ?? 480}
              src={visualState?.screenshot?.dataUrl ?? ""}
              unoptimized
              width={visualState?.width ?? 640}
            />
          </div>
          <div className="overflow-hidden rounded-[0.9rem] border border-(--line) bg-[#11141a]">
            <Image
              alt="Visual mismatch heatmap"
              className="h-auto w-full"
              height={visualState?.height ?? 480}
              src={visualState?.heatmapDataUrl ?? ""}
              unoptimized
              width={visualState?.width ?? 640}
            />
          </div>
        </div>
      ) : visualState?.status === "running" ? (
        <p className="mt-3 text-sm text-(--muted)">Capturing the rendered output and building a diff…</p>
      ) : (
        <p className="mt-3 text-sm text-(--muted)">
          Capture a rendered screenshot to compare the output against the reference.
        </p>
      )}
    </div>
  );
}

function TraceTimeline({
  events,
}: {
  events: ModelTraceEvent[];
}) {
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

export function BuildOffClient({
  authConfig,
  initialRunId,
  initialAgenticEnabled = false,
}: BuildOffClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: sessionData, isPending: isSessionPending } =
    authClient.useSession();
  const [isClient, setIsClient] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageName, setImageName] = useState("Paste or upload a screenshot");
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [runsError, setRunsError] = useState("");
  const [selectedModels, setSelectedModels] =
    useState<CompareModel[]>(DEFAULT_MODELS);
  const [catalog, setCatalog] = useState<GatewayModel[]>([]);
  const [results, setResults] = useState<ModelResult[]>(
    createEmptyResults(DEFAULT_MODELS),
  );
  const [liveStreamMetrics, setLiveStreamMetrics] = useState<
    Record<string, LiveStreamMetricSnapshot>
  >({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [modelsError, setModelsError] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSiteMenuOpen, setIsSiteMenuOpen] = useState(false);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [cardSize, setCardSize] = useState<CardSize>("m");
  const [freshModelIds, setFreshModelIds] = useState<string[]>([]);
  const [recentModelConfigs, setRecentModelConfigs] = useState<string[]>([]);
  const [modelSortMode, setModelSortMode] = useState<ModelSortMode>("released");
  const [openPickerIndex, setOpenPickerIndex] = useState<number | null>(null);
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [isHydratingRouteRun, setIsHydratingRouteRun] = useState(false);
  const [hasBootstrappedClientState, setHasBootstrappedClientState] =
    useState(false);
  const [isInitialRouteRunPending, setIsInitialRouteRunPending] = useState(
    Boolean(initialRunId),
  );
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [isAuthActionPending, setIsAuthActionPending] = useState(false);
  const [authError, setAuthError] = useState("");
  const [outputMode, setOutputMode] = useState<OutputMode>("preview");
  const [activePreviewModelId, setActivePreviewModelId] = useState<string | null>(null);
  const [isPreviewClosing, setIsPreviewClosing] = useState(false);
  const [votePendingByKey, setVotePendingByKey] = useState<Record<string, boolean>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string[]>>(
    {},
  );
  const [previewToolErrors, setPreviewToolErrors] = useState<
    Record<string, string[]>
  >({});
  const [previewOverrides, setPreviewOverrides] = useState<
    Record<string, string>
  >({});
  const [visualDiffs, setVisualDiffs] = useState<Record<string, VisualDiffState>>({});
  const [agenticOptions, setAgenticOptions] = useState<AgenticOptions>(() => ({
    ...DEFAULT_AGENTIC_OPTIONS,
    enabled: initialAgenticEnabled,
  }));
  const [agenticActivity, setAgenticActivity] = useState<
    Record<string, AgenticCardState>
  >({});
  const [modelCardStatesByMode, setModelCardStatesByMode] = useState<
    Record<ModelCardModeKey, ModelCardWorkspaceState>
  >(() => ({
    standard: createInitialModelCardWorkspaceState(),
    agentic: createInitialModelCardWorkspaceState(),
  }));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceImageFrameRef = useRef<HTMLDivElement | null>(null);
  const siteMenuRef = useRef<HTMLDivElement>(null);
  const previewCardShellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previewFrameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const activePreviewViewportRef = useRef<HTMLDivElement | null>(null);
  const previewOpenRectRef = useRef<RectSnapshot | null>(null);
  const previewViewportAnimationRef = useRef<Animation | null>(null);
  const previewBackdropAnimationRef = useRef<Animation | null>(null);
  const activePreviewModelIdRef = useRef<string | null>(null);
  const isPreviewClosingRef = useRef(false);
  const liveStreamMetricBuffersRef = useRef<
    Record<
      string,
      {
        outputText: string;
        points: Array<{ timestampMs: number; outputTokens: number }>;
        peakTokensPerSecond?: number;
      }
    >
  >({});
  const resultsRef = useRef<ModelResult[]>(results);
  const previewOverridesRef = useRef<Record<string, string>>({});
  const previewCommandResolvers = useRef<
    Record<
      string,
      {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
      }
    >
  >({});
  const lastSavedDraftRef = useRef<string | null>(null);
  const routeRunHydratedRef = useRef<string | null>(null);
  const restoredDraftRef = useRef(false);
  const attemptedLocalDevSignInRef = useRef(false);
  const visualDiffJobTokensRef = useRef<Record<string, string>>({});
  const pendingDraftModelConfigsByModeRef = useRef<
    Partial<Record<ModelCardModeKey, string[]>> | null
  >(null);
  const pendingDraftModeKeyRef = useRef<ModelCardModeKey>(
    getModelCardModeKey(
      getRouteAgenticEnabled(pathname, initialAgenticEnabled),
    ),
  );
  const signedInUser = sessionData?.user ?? null;
  const signedInUserId = signedInUser?.id ?? null;
  const isAnonymousUser = Boolean(signedInUser?.isAnonymous);
  const currentModelCardModeKey = getModelCardModeKey(agenticOptions.enabled);
  const maxSelectableCards = getMaxSelectableModelCards(
    catalog,
    agenticOptions.enabled,
  );
  const minSelectableCards = getMinSelectableModelCards(
    catalog,
    agenticOptions.enabled,
  );
  const activePreviewResult = activePreviewModelId
    ? results.find((entry) => entry.modelId === activePreviewModelId) ?? null
    : null;
  const activePreviewModel = activePreviewModelId
    ? selectedModels.find((entry) => entry.id === activePreviewModelId) ?? null
    : null;
  const activePreviewIndex = activePreviewModelId
    ? selectedModels.findIndex((entry) => entry.id === activePreviewModelId)
    : -1;
  const activePreviewId =
    activePreviewModel && activePreviewIndex >= 0
      ? `${activePreviewModel.id}-${activePreviewIndex}`
      : null;
  const activePreviewErrors = activePreviewId
    ? previewErrors[activePreviewId] ?? []
    : [];
  const activePreviewToolErrors = activePreviewId
    ? previewToolErrors[activePreviewId] ?? []
    : [];
  const activePreviewVisualDiff = activePreviewId
    ? visualDiffs[activePreviewId]
    : undefined;

  const handleReferenceImageMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const { currentTarget, clientX, clientY } = event;
      const rect = currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const x = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / rect.width),
      );
      const y = Math.min(
        1,
        Math.max(0, (clientY - rect.top) / rect.height),
      );

      currentTarget.style.setProperty(
        "--reference-pan-x",
        `${(x * 100).toFixed(2)}%`,
      );
      currentTarget.style.setProperty(
        "--reference-pan-y",
        `${(y * 100).toFixed(2)}%`,
      );
    },
    [],
  );

  const resetReferenceImagePan = useCallback(() => {
    const frame = referenceImageFrameRef.current;
    if (!frame) return;

    frame.style.setProperty("--reference-pan-x", "50%");
    frame.style.setProperty("--reference-pan-y", "50%");
  }, []);

  const closePreview = useCallback(() => {
    const currentPreviewModelId = activePreviewModelIdRef.current;
    if (!currentPreviewModelId || isPreviewClosingRef.current) return;

    if (shouldReduceMotion()) {
      setActivePreviewModelId(null);
      return;
    }

    const viewport = activePreviewViewportRef.current;
    const sourceRect = snapshotRect(previewCardShellRefs.current[currentPreviewModelId]);
    const currentRect = snapshotRect(viewport);
    if (!viewport || !sourceRect || !currentRect) {
      setActivePreviewModelId(null);
      return;
    }

    setIsPreviewClosing(true);
    previewViewportAnimationRef.current?.cancel();
    previewViewportAnimationRef.current = animateBetweenRects(
      viewport,
      sourceRect,
      currentRect,
      "close",
    );

    const backdrop = viewport.closest(".preview-modal-backdrop");
    if (backdrop instanceof HTMLElement) {
      previewBackdropAnimationRef.current?.cancel();
      previewBackdropAnimationRef.current = backdrop.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        {
          duration: 180,
          easing: "ease-out",
          fill: "both",
        },
      );
    }

    const finalizeClose = () => {
      previewViewportAnimationRef.current = null;
      previewBackdropAnimationRef.current = null;
      setIsPreviewClosing(false);
      setActivePreviewModelId(null);
    };

    previewViewportAnimationRef.current.addEventListener("finish", finalizeClose, {
      once: true,
    });
    previewViewportAnimationRef.current.addEventListener("cancel", finalizeClose, {
      once: true,
    });
  }, []);

  const refreshVisualDiff = useCallback(async (previewId: string) => {
    if (!imageDataUrl) return;

    const previewIndex = selectedModels.findIndex(
      (entry, index) => `${entry.id}-${index}` === previewId,
    );
    if (previewIndex < 0) return;

    const model = selectedModels[previewIndex];
    const result = results[previewIndex];
    const markup = unwrapHtmlCodeFence(
      previewOverrides[model.id] ?? result?.repairedText ?? result?.text ?? "",
    );
    const requestKey = getVisualDiffRequestKey(result?.completedAt, markup);

    const jobToken = uid();
    visualDiffJobTokensRef.current[previewId] = jobToken;
    setVisualDiffs((current) => ({
      ...current,
      [previewId]: {
        ...(current[previewId] ?? { status: "idle" as const }),
        requestKey,
        status: "running",
        error: undefined,
      },
    }));

    try {
      const payload = await sendPreviewCommand(previewId, "get_screenshot");
      const screenshot =
        typeof payload === "object" && payload && typeof (payload as { dataUrl?: unknown }).dataUrl === "string"
          ? {
              dataUrl: (payload as { dataUrl: string }).dataUrl,
              width:
                typeof (payload as { width?: unknown }).width === "number"
                  ? (payload as { width: number }).width
                  : undefined,
              height:
                typeof (payload as { height?: unknown }).height === "number"
                  ? (payload as { height: number }).height
                  : undefined,
              capturedAt:
                typeof (payload as { capturedAt?: unknown }).capturedAt === "string"
                  ? (payload as { capturedAt: string }).capturedAt
                  : new Date().toISOString(),
            }
          : null;

      if (!screenshot) {
        throw new Error("Preview did not return a screenshot.");
      }

      const visualState = await buildVisualDiff(imageDataUrl, screenshot);
      if (visualDiffJobTokensRef.current[previewId] !== jobToken) return;

      setVisualDiffs((current) => ({
        ...current,
        [previewId]: {
          ...visualState,
          requestKey,
        },
      }));

      const modelId = model.id;
      setResults((current) =>
        current.map((result) =>
          result.modelId === modelId
            ? {
                ...result,
                stats: {
                  ...(result.stats ?? {}),
                  visualAnalysis: {
                    similarity: visualState.similarity,
                    mismatchRatio: visualState.mismatchRatio,
                    meanChannelDelta: visualState.meanChannelDelta,
                    width: visualState.width,
                    height: visualState.height,
                    capturedAt: visualState.capturedAt,
                  },
                },
              }
            : result,
        ),
      );
    } catch (error) {
      if (visualDiffJobTokensRef.current[previewId] !== jobToken) return;
      setVisualDiffs((current) => ({
        ...current,
        [previewId]: {
          ...(current[previewId] ?? { status: "idle" as const }),
          requestKey,
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Unable to capture preview for visual diff.",
        },
      }));
    }
  }, [imageDataUrl, previewOverrides, results, selectedModels]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    activePreviewModelIdRef.current = activePreviewModelId;
  }, [activePreviewModelId]);

  useEffect(() => {
    isPreviewClosingRef.current = isPreviewClosing;
  }, [isPreviewClosing]);

  useEffect(() => {
    previewOverridesRef.current = previewOverrides;
  }, [previewOverrides]);

  useEffect(() => {
    if (!imageDataUrl) return;

    for (const [index, model] of selectedModels.entries()) {
      const result = results[index];
      if (!result) continue;

      const previewId = `${model.id}-${index}`;
      const visualState = visualDiffs[previewId];
      const markup = unwrapHtmlCodeFence(
        previewOverrides[model.id] ?? result.repairedText ?? result.text ?? "",
      );
      const requestKey = getVisualDiffRequestKey(result.completedAt, markup);
      const hasRenderableMarkup = looksLikeHtml(markup);
      const isFinalState = result.status === "done" || result.status === "error";
      const visualIsFresh = visualState?.requestKey === requestKey;

      if (
        hasRenderableMarkup &&
        isFinalState &&
        visualState?.status !== "running" &&
        !visualIsFresh
      ) {
        void refreshVisualDiff(previewId);
      }
    }
  }, [
    imageDataUrl,
    previewOverrides,
    refreshVisualDiff,
    results,
    selectedModels,
    visualDiffs,
  ]);

  useEffect(() => {
    if (outputMode !== "preview" && activePreviewModelId) {
      closePreview();
    }
  }, [activePreviewModelId, closePreview, outputMode]);

  useEffect(() => {
    if (!activePreviewModelId) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePreview();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePreviewModelId, closePreview]);

  useEffect(() => {
    if (!activePreviewModelId || shouldReduceMotion()) {
      previewOpenRectRef.current = null;
      return;
    }

    const sourceRect = previewOpenRectRef.current;
    const viewport = activePreviewViewportRef.current;
    if (!sourceRect || !viewport) return;

    const frameId = window.requestAnimationFrame(() => {
      const targetRect = snapshotRect(viewport);
      if (!targetRect) return;

      previewViewportAnimationRef.current?.cancel();
      previewViewportAnimationRef.current = animateBetweenRects(
        viewport,
        sourceRect,
        targetRect,
        "open",
      );
      previewOpenRectRef.current = null;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activePreviewModelId]);

  useEffect(() => {
    if (!catalog.length) return;

    const selectableConfigs = new Set(
      getSelectableCatalogModels(catalog, agenticOptions.enabled).map(
        (model) => model.config,
      ),
    );
    const retained = selectedModels.filter((model, index, models) => {
      const config = getModelConfig(model);
      return (
        selectableConfigs.has(config)
        && models.findIndex((entry) => getModelConfig(entry) === config) === index
      );
    });

    const desiredCount = Math.min(selectedModels.length, maxSelectableCards);
    if (retained.length === selectedModels.length && retained.length === desiredCount) {
      return;
    }

    const additions = getPreferredAvailableModels(
      catalog,
      retained.map((model) => getModelConfig(model)),
      Math.max(0, desiredCount - retained.length),
      recentModelConfigs,
      agenticOptions.enabled,
    ).map(toCompareModel);
    const nextModels = [...retained, ...additions].slice(0, desiredCount);

    if (!nextModels.length) return;

    setSelectedModels(nextModels);
    setResults((current) => {
      const nextById = new Map(current.map((result) => [result.modelId, result]));

      return nextModels.map((model) => {
        const existing = nextById.get(model.id);
        return existing ? { ...existing, label: model.label } : createEmptyResult(model);
      });
    });
  }, [
    agenticOptions.enabled,
    catalog,
    maxSelectableCards,
    recentModelConfigs,
    selectedModels,
  ]);

  function buildCurrentModelCardWorkspaceState(): ModelCardWorkspaceState {
    return {
      activeRunId,
      selectedModels,
      results,
      agenticActivity,
      previewErrors,
      previewToolErrors,
      previewOverrides,
      visualDiffs,
    };
  }

  function applyModelCardWorkspaceState(state: ModelCardWorkspaceState) {
    setActiveRunId(state.activeRunId);
    setSelectedModels(state.selectedModels);
    setResults(state.results);
    setAgenticActivity(state.agenticActivity);
    setPreviewErrors(state.previewErrors);
    setPreviewToolErrors(state.previewToolErrors);
    setPreviewOverrides(state.previewOverrides);
    setVisualDiffs(state.visualDiffs);
  }

  function startBlankWorkspace(options?: {
    agenticEnabled?: boolean;
    syncRoute?: boolean;
  }) {
    const nextAgenticEnabled =
      options?.agenticEnabled ?? agenticOptions.enabled;
    const currentModeKey = getModelCardModeKey(agenticOptions.enabled);
    const nextModeKey = getModelCardModeKey(nextAgenticEnabled);
    const currentWorkspaceState = buildCurrentModelCardWorkspaceState();
    const savedWorkspaceState = modelCardStatesByMode[nextModeKey];
    const nextSelectedModels = getPreferredModelsForModeSwitch(
      catalog,
      currentWorkspaceState.selectedModels,
      savedWorkspaceState.selectedModels,
      recentModelConfigs,
      nextAgenticEnabled,
    );
    const blankWorkspaceState: ModelCardWorkspaceState = {
      activeRunId: null,
      selectedModels: nextSelectedModels,
      results: createEmptyResults(nextSelectedModels),
      agenticActivity: {},
      previewErrors: {},
      previewToolErrors: {},
      previewOverrides: {},
      visualDiffs: {},
    };

    setModelCardStatesByMode((current) => ({
      ...current,
      [currentModeKey]: currentWorkspaceState,
      [nextModeKey]: blankWorkspaceState,
    }));
    setAgenticOptions((current) => ({
      ...current,
      enabled: nextAgenticEnabled,
    }));
    applyModelCardWorkspaceState(blankWorkspaceState);
    setErrorMessage("");
    setOpenPickerIndex(null);
    routeRunHydratedRef.current = null;

    if (options?.syncRoute !== false) {
      syncRouteToRun(null);
    }
  }

  function syncRouteToRun(
    runId: string | null,
    replace = false,
    agenticEnabled = agenticOptions.enabled,
  ) {
    const target = runId ? getRunHref(runId, agenticEnabled) : "/";
    const currentPath =
      typeof window === "undefined" ? pathname : window.location.pathname;
    if (currentPath === target) return;

    if (typeof window !== "undefined") {
      window.history[replace ? "replaceState" : "pushState"](
        window.history.state,
        "",
        target,
      );
      return;
    }

    if (replace) {
      router.replace(target, { scroll: false });
      return;
    }

    router.push(target, { scroll: false });
  }

  function syncRouteToPendingRun(agenticEnabled: boolean, replace = false) {
    const target = getPendingRunHref(agenticEnabled);
    const currentPath =
      typeof window === "undefined" ? pathname : window.location.pathname;
    if (currentPath === target) return;

    if (typeof window !== "undefined") {
      window.history[replace ? "replaceState" : "pushState"](
        window.history.state,
        "",
        target,
      );
      return;
    }

    if (replace) {
      router.replace(target, { scroll: false });
      return;
    }

    router.push(target, { scroll: false });
  }

  function hydrateRun(
    run: SavedRun,
    options?: {
      syncRoute?: boolean;
      replaceRoute?: boolean;
    },
  ) {
    const nextAgenticOptions = {
      ...DEFAULT_AGENTIC_OPTIONS,
      ...run.agentic,
    };
    const currentModeKey = getModelCardModeKey(agenticOptions.enabled);
    const nextModeKey = getModelCardModeKey(nextAgenticOptions.enabled);
    const currentWorkspaceState = buildCurrentModelCardWorkspaceState();
    const nextWorkspaceState: ModelCardWorkspaceState = {
      activeRunId: run.id,
      selectedModels: run.models,
      results: run.results,
      agenticActivity: {},
      previewErrors: {},
      previewToolErrors: {},
      previewOverrides: {},
      visualDiffs: {},
    };

    setPrompt(run.prompt);
    setImageDataUrl(getRunImageSrc(run));
    setImageName(run.imageName);
    setModelCardStatesByMode((current) => ({
      ...current,
      [currentModeKey]: currentWorkspaceState,
      [nextModeKey]: nextWorkspaceState,
    }));
    setAgenticOptions(nextAgenticOptions);
    applyModelCardWorkspaceState(nextWorkspaceState);
    resetAllLiveStreamMetrics();
    setErrorMessage("");
    setIsHistoryOpen(false);

    if (options?.syncRoute !== false) {
      syncRouteToRun(
        run.id,
        options?.replaceRoute,
        Boolean(nextAgenticOptions.enabled),
      );
    }
  }

  async function hydrateRouteRun(runId: string) {
    if (!signedInUser) return;

    const existing = runs.find((run) => run.id === runId);
    if (existing) {
      hydrateRun(existing, { syncRoute: false });
      routeRunHydratedRef.current = runId;
      setIsInitialRouteRunPending(false);
      return;
    }

    setIsHydratingRouteRun(true);
    setRunsError("");

    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        run?: SavedRun;
        error?: string;
      } | null;

      if (!response.ok || !payload?.run) {
        throw new Error(payload?.error ?? "Unable to load that run.");
      }

      persistRun(payload.run);
      hydrateRun(payload.run, { syncRoute: false });
      routeRunHydratedRef.current = runId;
      setIsInitialRouteRunPending(false);
    } catch (error) {
      setRunsError(
        error instanceof Error ? error.message : "Unable to load that run.",
      );
      setIsInitialRouteRunPending(false);
      syncRouteToRun(null, true);
    } finally {
      setIsHydratingRouteRun(false);
    }
  }

  function handleToggleAgenticMode() {
    const currentModeKey = getModelCardModeKey(agenticOptions.enabled);
    const nextModeKey =
      currentModeKey === "agentic" ? "standard" : "agentic";
    const currentWorkspaceState = buildCurrentModelCardWorkspaceState();
    const savedNextWorkspaceState = modelCardStatesByMode[nextModeKey];
    const nextAgenticEnabled = !agenticOptions.enabled;
    const nextSelectedModels = getPreferredModelsForModeSwitch(
      catalog,
      currentWorkspaceState.selectedModels,
      savedNextWorkspaceState.selectedModels,
      recentModelConfigs,
      nextAgenticEnabled,
    );
    const nextWorkspaceState: ModelCardWorkspaceState = {
      ...savedNextWorkspaceState,
      selectedModels: nextSelectedModels,
      results:
        savedNextWorkspaceState.activeRunId
        && savedNextWorkspaceState.selectedModels.length === nextSelectedModels.length
        && savedNextWorkspaceState.selectedModels.every(
          (model, index) =>
            getModelConfig(model) === getModelConfig(nextSelectedModels[index]),
        )
          ? savedNextWorkspaceState.results
          : createEmptyResults(nextSelectedModels),
      agenticActivity:
        savedNextWorkspaceState.activeRunId
        && savedNextWorkspaceState.selectedModels.length === nextSelectedModels.length
        && savedNextWorkspaceState.selectedModels.every(
          (model, index) =>
            getModelConfig(model) === getModelConfig(nextSelectedModels[index]),
        )
          ? savedNextWorkspaceState.agenticActivity
          : {},
      previewErrors: {},
      previewToolErrors: {},
      previewOverrides: {},
      visualDiffs: {},
    };

    setModelCardStatesByMode((current) => ({
      ...current,
      [currentModeKey]: currentWorkspaceState,
      [nextModeKey]: nextWorkspaceState,
    }));
    applyModelCardWorkspaceState(nextWorkspaceState);
    setOpenPickerIndex(null);
    setFreshModelIds([]);
    setAgenticOptions((current) => ({
      ...current,
      enabled: !current.enabled,
    }));
  }


  async function loadRuns(options?: { hydrateLatest?: boolean }) {
    if (!signedInUser) {
      setRuns([]);
      setRunsError("");
      return;
    }

    setIsLoadingRuns(true);
    setRunsError("");

    try {
      const response = await fetch("/api/runs", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as {
        runs?: SavedRun[];
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Unable to load saved runs from the database.",
        );
      }

      const serverRuns = payload?.runs ?? [];
      setRuns(serverRuns);

      if (initialRunId) {
        const requestedRun = serverRuns.find((run) => run.id === initialRunId);
        if (requestedRun) {
          hydrateRun(requestedRun, { syncRoute: false });
          routeRunHydratedRef.current = initialRunId;
          setIsInitialRouteRunPending(false);
          return;
        }
      }

      if (
        !initialRunId &&
        options?.hydrateLatest &&
        serverRuns.length &&
        !restoredDraftRef.current
      ) {
        hydrateRun(serverRuns[0], { syncRoute: false });
      }
    } catch (error) {
      setRunsError(
        error instanceof Error
          ? error.message
          : "Unable to load saved runs from the database.",
      );
    } finally {
      setIsLoadingRuns(false);
    }
  }

  const loadRunsForCurrentSession = useEffectEvent(
    (options?: { hydrateLatest?: boolean }) => {
      void loadRuns(options);
    },
  );

  const hydrateRouteRunForCurrentSession = useEffectEvent((runId: string) => {
    void hydrateRouteRun(runId);
  });

  const bootstrapLocalDevSession = useEffectEvent(() => {
    void handleAnonymousSignIn();
  });

  useEffect(() => {
    try {
      const routeAgenticEnabled = getRouteAgenticEnabled(
        pathname,
        initialAgenticEnabled,
      );

      pendingDraftModeKeyRef.current = getModelCardModeKey(routeAgenticEnabled);
      const rawDraft = window.localStorage.getItem(LOCAL_DRAFT_KEY);
      if (!rawDraft) return;

      const draft = JSON.parse(rawDraft) as {
        prompt?: string;
        imageDataUrl?: string;
        imageName?: string;
        selectedModelConfigs?: string[];
        selectedModelConfigsByMode?: Partial<
          Record<ModelCardModeKey, string[]>
        >;
        agenticOptions?: Partial<AgenticOptions>;
      };

      if (typeof draft.prompt === "string") {
        setPrompt(draft.prompt);
        restoredDraftRef.current = true;
      }

      if (typeof draft.imageDataUrl === "string" && draft.imageDataUrl) {
        setImageDataUrl(draft.imageDataUrl);
        restoredDraftRef.current = true;
      }

      if (typeof draft.imageName === "string" && draft.imageName) {
        setImageName(draft.imageName);
      }

      if (
        draft.selectedModelConfigsByMode &&
        typeof draft.selectedModelConfigsByMode === "object"
      ) {
        pendingDraftModelConfigsByModeRef.current = {
          standard: Array.isArray(draft.selectedModelConfigsByMode.standard)
            ? draft.selectedModelConfigsByMode.standard.filter(
                (value) => typeof value === "string",
              )
            : undefined,
          agentic: Array.isArray(draft.selectedModelConfigsByMode.agentic)
            ? draft.selectedModelConfigsByMode.agentic.filter(
                (value) => typeof value === "string",
              )
            : undefined,
        };
        restoredDraftRef.current = true;
      } else if (
        Array.isArray(draft.selectedModelConfigs) &&
        draft.selectedModelConfigs.length
      ) {
        pendingDraftModelConfigsByModeRef.current = {
          standard: draft.selectedModelConfigs,
        };
        restoredDraftRef.current = true;
      }

      if (draft.agenticOptions && typeof draft.agenticOptions === "object") {
        const nextAgenticOptions = {
          ...DEFAULT_AGENTIC_OPTIONS,
          ...draft.agenticOptions,
          enabled: routeAgenticEnabled,
          maxTurns: Math.max(
            1,
            Math.min(
              12,
              Math.round(
                draft.agenticOptions.maxTurns ??
                  DEFAULT_AGENTIC_OPTIONS.maxTurns,
              ),
            ),
          ),
        };
        pendingDraftModeKeyRef.current = getModelCardModeKey(
          routeAgenticEnabled,
        );
        setAgenticOptions(nextAgenticOptions);
      }

      const rawRecentModels = window.localStorage.getItem(LOCAL_RECENT_MODELS_KEY);
      if (rawRecentModels) {
        const parsedRecentModels = JSON.parse(rawRecentModels) as string[];
        if (Array.isArray(parsedRecentModels)) {
          setRecentModelConfigs(parsedRecentModels.filter((value) => typeof value === "string"));
        }
      }
    } catch {
      // Ignore malformed local draft state.
    } finally {
      setHasBootstrappedClientState(true);
    }
  }, [initialAgenticEnabled, pathname]);

  useEffect(() => {
    if (isSessionPending) return;

    if (!signedInUserId) {
      setRuns([]);
      setRunsError("");
      setIsLoadingRuns(false);
      setIsInitialRouteRunPending(false);
      routeRunHydratedRef.current = null;
      return;
    }

    loadRunsForCurrentSession({ hydrateLatest: true });
  }, [isSessionPending, signedInUserId]);

  useEffect(() => {
    if (isSessionPending || !signedInUserId) return;

    if (!initialRunId) {
      setIsInitialRouteRunPending(false);
      routeRunHydratedRef.current = null;
      return;
    }

    if (routeRunHydratedRef.current === initialRunId) return;
    hydrateRouteRunForCurrentSession(initialRunId);
  }, [initialRunId, isSessionPending, signedInUserId]);

  useEffect(() => {
    if (!isSiteMenuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!siteMenuRef.current?.contains(event.target as Node)) {
        setIsSiteMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsSiteMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSiteMenuOpen]);

  useEffect(() => {
    setIsSiteMenuOpen(false);
  }, [pathname]);

  const handleHistoryPop = useEffectEvent(() => {
      const nextPath = window.location.pathname;
      const runId = getRunIdFromLocation(
        nextPath,
        new URLSearchParams(window.location.search),
      );

      if (runId) {
        routeRunHydratedRef.current = null;
        hydrateRouteRunForCurrentSession(runId);
        return;
      }

      if (nextPath === "/run-agentic") {
        startBlankWorkspace({ agenticEnabled: true, syncRoute: false });
        return;
      } else if (nextPath === "/run-generate") {
        startBlankWorkspace({ agenticEnabled: false, syncRoute: false });
        return;
      }

      startBlankWorkspace({ syncRoute: false });
  });

  useEffect(() => {
    function handlePopState() {
      handleHistoryPop();
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!authConfig.allowLocalDevAutoAuth) return;
    if (attemptedLocalDevSignInRef.current) return;
    if (isSessionPending || signedInUser) return;

    attemptedLocalDevSignInRef.current = true;
    bootstrapLocalDevSession();
  }, [authConfig.allowLocalDevAutoAuth, isSessionPending, signedInUser]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/models");
        if (!response.ok) {
          throw new Error("Unable to load Vercel AI Gateway models.");
        }

        const payload = (await response.json()) as { models?: GatewayModel[] };
        const nextCatalog = payload.models ?? [];

        setCatalog(nextCatalog);

        const resolveDraftModels = (
          configs: string[] | undefined,
          modeKey: ModelCardModeKey,
        ) =>
          (configs ?? [])
            .map((config) =>
              nextCatalog.find((model) => model.config === config),
            )
            .filter(
              (model): model is GatewayModel =>
                model != null
                && getSelectableCatalogModels(
                  nextCatalog,
                  modeKey === "agentic",
                ).some((entry) => entry.config === model.config),
            )
            .filter(
              (model, index, models) =>
                models.findIndex((entry) => entry.id === model.id) === index,
            )
            .filter(
              (model, index, models) =>
                models.findIndex((entry) => entry.config === model.config) ===
                index,
            )
            .map(toCompareModel);

        const selectedFromDraftByMode = {
          standard: resolveDraftModels(
            pendingDraftModelConfigsByModeRef.current?.standard,
            "standard",
          ),
          agentic: resolveDraftModels(
            pendingDraftModelConfigsByModeRef.current?.agentic,
            "agentic",
          ),
        };

        if (
          selectedFromDraftByMode.standard.length ||
          selectedFromDraftByMode.agentic.length
        ) {
          setModelCardStatesByMode((current) => ({
            standard: selectedFromDraftByMode.standard.length
              ? createInitialModelCardWorkspaceState(
                  selectedFromDraftByMode.standard,
                )
              : {
                  ...current.standard,
                  selectedModels: syncModelLabels(
                    current.standard.selectedModels,
                    nextCatalog,
                  ),
                  results: createEmptyResults(
                    syncModelLabels(current.standard.selectedModels, nextCatalog),
                  ),
                },
            agentic: selectedFromDraftByMode.agentic.length
              ? createInitialModelCardWorkspaceState(
                  selectedFromDraftByMode.agentic,
                )
              : {
                  ...current.agentic,
                  selectedModels: syncModelLabels(
                    current.agentic.selectedModels,
                    nextCatalog,
                  ),
                  results: createEmptyResults(
                    syncModelLabels(current.agentic.selectedModels, nextCatalog),
                  ),
                },
          }));

          const modeToHydrate = pendingDraftModeKeyRef.current;
          const nextModels = selectedFromDraftByMode[modeToHydrate];

          if (nextModels.length) {
            setActiveRunId(null);
            setSelectedModels(nextModels);
            setResults(createEmptyResults(nextModels));
            setAgenticActivity({});
            setPreviewErrors({});
            setPreviewToolErrors({});
            setPreviewOverrides({});
          }
        } else {
          setSelectedModels((current) => syncModelLabels(current, nextCatalog));
          setResults((current) =>
            current.map((result) => {
              const match = nextCatalog.find(
                (model) => model.id === result.modelId,
              );
              return match ? { ...result, label: match.name } : result;
            }),
          );
        }

        setRuns((current) =>
          current.map((run) => ({
            ...run,
            models: syncModelLabels(run.models, nextCatalog),
            results: run.results.map((result) => {
              const match = nextCatalog.find(
                (model) => model.id === result.modelId,
              );
              return match ? { ...result, label: match.name } : result;
            }),
          })),
        );
        pendingDraftModelConfigsByModeRef.current = null;
        setModelsError("");
      } catch (error) {
        setModelsError(
          error instanceof Error
            ? error.message
            : "Unable to load Vercel AI Gateway models.",
        );
      } finally {
        setIsLoadingModels(false);
      }
    })();
  }, []);

  useEffect(() => {
    try {
      const currentWorkspaceState: ModelCardWorkspaceState = {
        activeRunId,
        selectedModels,
        results,
        agenticActivity,
        previewErrors,
        previewToolErrors,
        previewOverrides,
        visualDiffs,
      };
      const selectedModelConfigsByMode: Record<ModelCardModeKey, string[]> = {
        standard:
          (
            currentModelCardModeKey === "standard"
              ? currentWorkspaceState
              : modelCardStatesByMode.standard
          ).selectedModels.map((model) => getModelConfig(model)),
        agentic:
          (
            currentModelCardModeKey === "agentic"
              ? currentWorkspaceState
              : modelCardStatesByMode.agentic
          ).selectedModels.map((model) => getModelConfig(model)),
      };
      const nextDraft = JSON.stringify({
        prompt,
        imageDataUrl,
        imageName,
        selectedModelConfigs:
          selectedModelConfigsByMode[currentModelCardModeKey],
        selectedModelConfigsByMode,
        agenticOptions,
      });

      if (lastSavedDraftRef.current === nextDraft) {
        return;
      }

      window.localStorage.setItem(LOCAL_DRAFT_KEY, nextDraft);
      lastSavedDraftRef.current = nextDraft;
    } catch {
      // Ignore unavailable localStorage.
    }
  }, [
    agenticOptions,
    currentModelCardModeKey,
    imageDataUrl,
    imageName,
    modelCardStatesByMode,
    prompt,
    selectedModels,
    results,
    activeRunId,
    agenticActivity,
    previewErrors,
    previewToolErrors,
    previewOverrides,
    visualDiffs,
  ]);

  useEffect(() => {
    setRecentModelConfigs((current) =>
      mergeRecentModelConfigs(
        current,
        selectedModels.map((model) => getModelConfig(model)),
      ),
    );
  }, [selectedModels]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        LOCAL_RECENT_MODELS_KEY,
        JSON.stringify(recentModelConfigs),
      );
    } catch {
      // Ignore unavailable localStorage.
    }
  }, [recentModelConfigs]);

  useEffect(() => {
    if (!isRunning) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 100);
    return () => clearInterval(id);
  }, [isRunning]);

  useEffect(() => {
    if (!freshModelIds.length) return;

    const timeoutId = window.setTimeout(() => {
      setFreshModelIds([]);
    }, 1100);

    return () => window.clearTimeout(timeoutId);
  }, [freshModelIds]);

  useEffect(() => {
    function handlePreviewMessage(event: MessageEvent) {
      const data = event.data;
      if (
        !data ||
        typeof data !== "object" ||
        data.source !== "build-off-preview" ||
        typeof data.previewId !== "string" ||
        typeof data.kind !== "string"
      ) {
        return;
      }

      if (data.kind === "clear") {
        setPreviewErrors((current) => {
          if (!(data.previewId in current)) return current;

          const next = { ...current };
          delete next[data.previewId];
          return next;
        });
        return;
      }

      if (
        data.kind === "error" &&
        typeof data.message === "string" &&
        data.message.trim()
      ) {
        setPreviewErrors((current) => {
          const existing = current[data.previewId] ?? [];
          if (existing.includes(data.message)) return current;

          return {
            ...current,
            [data.previewId]: [...existing, data.message],
          };
        });
        return;
      }

      if (
        (data.kind === "command-result" || data.kind === "command-error") &&
        typeof data.commandId === "string"
      ) {
        const pending = previewCommandResolvers.current[data.commandId];
        if (!pending) return;

        delete previewCommandResolvers.current[data.commandId];

        if (
          data.kind === "command-error" &&
          typeof data.error === "string" &&
          data.error.trim()
        ) {
          pending.reject(new Error(data.error));
          return;
        }

        pending.resolve(data.payload);
      }
    }

    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, []);

  function getEffectiveMarkupForModelId(modelId: string) {
    return (
      previewOverridesRef.current[modelId] ??
      resultsRef.current.find((result) => result.modelId === modelId)?.text ??
      ""
    );
  }

  function dismissPreviewToolErrors(previewId: string) {
    setPreviewToolErrors((current) => {
      if (!(previewId in current)) return current;

      const next = { ...current };
      delete next[previewId];
      return next;
    });
  }

  function openPreview(modelId: string) {
    if (isPreviewClosing) return;
    previewOpenRectRef.current = snapshotRect(previewCardShellRefs.current[modelId]);
    setActivePreviewModelId(modelId);
  }

  function resetLiveStreamMetric(modelId: string) {
    delete liveStreamMetricBuffersRef.current[modelId];
    setLiveStreamMetrics((current) => {
      if (!(modelId in current)) return current;

      const next = { ...current };
      delete next[modelId];
      return next;
    });
  }

  function resetAllLiveStreamMetrics() {
    liveStreamMetricBuffersRef.current = {};
    setLiveStreamMetrics({});
  }

  function applyLiveStreamDelta(modelId: string, delta: string) {
    if (!delta) return;

    const now = Date.now();
    const existing = liveStreamMetricBuffersRef.current[modelId] ?? {
      outputText: "",
      points: [],
      peakTokensPerSecond: undefined,
    };

    existing.outputText += delta;
    const outputTokens = estimateTokens(existing.outputText);
    existing.points.push({ timestampMs: now, outputTokens });
    existing.points = existing.points.filter(
      (point) => now - point.timestampMs <= LIVE_TPS_WINDOW_MS,
    );

    const oldestPoint = existing.points[0];
    const elapsedMs = oldestPoint ? now - oldestPoint.timestampMs : 0;
    const peakTokensPerSecond =
      elapsedMs >= LIVE_TPS_MIN_WINDOW_MS
        ? Math.max(
            existing.peakTokensPerSecond ?? 0,
            (outputTokens - oldestPoint.outputTokens) / (elapsedMs / 1000),
          )
        : existing.peakTokensPerSecond;

    existing.peakTokensPerSecond = peakTokensPerSecond;
    liveStreamMetricBuffersRef.current[modelId] = existing;

    setLiveStreamMetrics((current) => ({
      ...current,
      [modelId]: {
        outputTokens,
        peakTokensPerSecond,
      },
    }));
  }

  function syncLiveStreamMetricFromResult(result: ModelResult) {
    const peakTokensPerSecond =
      sanitizeTokensPerSecond(
        liveStreamMetricBuffersRef.current[result.modelId]?.peakTokensPerSecond,
      ) ?? sanitizeTokensPerSecond(result.stats?.tokensPerSecond);

    setLiveStreamMetrics((current) => ({
      ...current,
      [result.modelId]: {
        outputTokens: result.usage?.outputTokens,
        totalTokens: result.usage?.totalTokens,
        peakTokensPerSecond,
      },
    }));
  }

  function getDisplayOutputMetrics(result: ModelResult) {
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

  useEffect(() => {
    if (!catalog.length) return;

    const minCards = getMinSelectableModelCards(catalog, agenticOptions.enabled);
    const maxCards = getMaxSelectableModelCards(catalog, agenticOptions.enabled);

    if (
      selectedModels.length >= minCards &&
      selectedModels.length <= maxCards
    ) {
      return;
    }

    if (selectedModels.length > maxCards) {
      setSelectedModels((current) => current.slice(0, maxCards));
      setResults((current) => current.slice(0, maxCards));
      return;
    }

    const additions = getPreferredAvailableModels(
      catalog,
      selectedModels.map((model) => getModelConfig(model)),
      minCards - selectedModels.length,
      recentModelConfigs,
      agenticOptions.enabled,
    ).map(toCompareModel);

    if (!additions.length) return;

    setSelectedModels((current) => [...current, ...additions]);
    setResults((current) => [...current, ...additions.map(createEmptyResult)]);
  }, [agenticOptions.enabled, catalog, recentModelConfigs, selectedModels]);

  useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
        item.type.startsWith("image/"),
      );

      if (!file) return;

      event.preventDefault();
      const dataUrl = await toDataUrl(file);
      setImageDataUrl(dataUrl);
      setImageName(file.name || "Pasted screenshot");
      setVisualDiffs({});
      setErrorMessage("");
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function persistRun(run: SavedRun) {
    setRuns((current) =>
      [run, ...current.filter((item) => item.id !== run.id)].slice(0, MAX_RUNS),
    );
  }

  function updateRun(runId: string, updater: (run: SavedRun) => SavedRun) {
    setRuns((current) =>
      current.map((run) => (run.id === runId ? updater(run) : run)),
    );
  }

  function replaceRunId(previousRunId: string, nextRunId: string) {
    if (previousRunId === nextRunId) return;

    setRuns((current) =>
      current.map((run) =>
        run.id === previousRunId
          ? {
              ...run,
              id: nextRunId,
            }
          : run,
      ),
    );
    setActiveRunId((current) =>
      current === previousRunId ? nextRunId : current,
    );
    routeRunHydratedRef.current =
      routeRunHydratedRef.current === previousRunId ? nextRunId : routeRunHydratedRef.current;
    syncRouteToRun(nextRunId, true, agenticOptions.enabled);
  }

  function applyVoteSummaryToResult(
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

  function applyVoteSummaryToRun(
    runId: string,
    modelIndex: number,
    summary: {
      score: number;
      upvotes: number;
      downvotes: number;
      userVote?: OutputVoteValue;
    },
  ) {
    updateRun(runId, (existing) => ({
      ...existing,
      results: existing.results.map((result, index) =>
        index === modelIndex ? applyVoteSummaryToResult(result, summary) : result,
      ),
    }));
  }

  function getPreviewIdForModelId(modelId: string) {
    const index = selectedModels.findIndex((model) => model.id === modelId);
    return index >= 0 ? `${selectedModels[index].id}-${index}` : null;
  }

  function sendPreviewCommand(previewId: string, action: string) {
    const frame = previewFrameRefs.current[previewId];
    const target = frame?.contentWindow;
    if (!target) {
      return Promise.reject(new Error("Preview frame is not ready yet."));
    }

    return new Promise<unknown>((resolve, reject) => {
      const commandId = uid();
      previewCommandResolvers.current[commandId] = { resolve, reject };

      target.postMessage(
        {
          source: "build-off-preview-parent",
          previewId,
          commandId,
          action,
        },
        "*",
      );

      window.setTimeout(() => {
        const pending = previewCommandResolvers.current[commandId];
        if (!pending) return;
        delete previewCommandResolvers.current[commandId];
        pending.reject(new Error("Preview command timed out."));
      }, 20_000);
    });
  }

  async function handleToolCallEvent(event: Record<string, unknown>) {
    if (
      typeof event.modelId !== "string" ||
      typeof event.toolCallId !== "string" ||
      typeof event.toolName !== "string"
    ) {
      return;
    }

    if (
      event.toolName !== "get_screenshot" &&
      event.toolName !== "get_console_logs" &&
      event.toolName !== "get_html" &&
      event.toolName !== "set_html"
    ) {
      return;
    }

    if (event.toolName === "get_html") {
      await fetch("/api/compare/tool-response", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          toolCallId: event.toolCallId,
          output: {
            html: getEffectiveMarkupForModelId(event.modelId),
          },
        }),
      });
      return;
    }

    if (event.toolName === "set_html") {
      const modelId = event.modelId;
      const input =
        typeof event.input === "object" && event.input ? event.input : null;
      const html =
        input && typeof (input as { html?: unknown }).html === "string"
          ? (input as { html: string }).html
          : "";

      if (!html.trim()) {
        await fetch("/api/compare/tool-response", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toolCallId: event.toolCallId,
            error: "set_html requires a non-empty html string.",
          }),
        });
        return;
      }

      setPreviewOverrides((current) => ({
        ...current,
        [modelId]: html,
      }));
      await fetch("/api/compare/tool-response", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          toolCallId: event.toolCallId,
          output: {
            ok: true,
            htmlLength: html.length,
          },
        }),
      });
      return;
    }

    const previewId = getPreviewIdForModelId(event.modelId);
    if (!previewId) {
      await fetch("/api/compare/tool-response", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          toolCallId: event.toolCallId,
          error: "No preview is available for that tool call.",
        }),
      });
      return;
    }

    try {
      const output = await sendPreviewCommand(previewId, event.toolName);
      await fetch("/api/compare/tool-response", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          toolCallId: event.toolCallId,
          output,
        }),
      });
    } catch (error) {
      await fetch("/api/compare/tool-response", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          toolCallId: event.toolCallId,
          error:
            error instanceof Error
              ? error.message
              : "Preview tool execution failed.",
        }),
      });
    }
  }

  function applyEventToAgenticState(
    current: Record<string, AgenticCardState>,
    event: Record<string, unknown>,
  ) {
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

    if (
      event.type === "tool-call" &&
      typeof event.toolName === "string"
    ) {
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

    if (
      event.type === "tool-result" &&
      typeof event.toolName === "string"
    ) {
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

    if (
      event.type === "tool-error" &&
      typeof event.toolName === "string"
    ) {
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

  function applyEventToResult(
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
        text:
          result.text + (typeof event.delta === "string" ? event.delta : ""),
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
        stats: readEventStats(event) ?? result.stats,
      };
    }

    if (event.type === "thinking-delta") {
      return {
        ...result,
        thinking:
          (result.thinking ?? "")
          + (typeof event.delta === "string" ? event.delta : ""),
        stats: readEventStats(event) ?? result.stats,
      };
    }

    if (event.type === "repair-complete") {
      return {
        ...result,
        repairedText:
          typeof event.repairedText === "string"
            ? event.repairedText
            : result.repairedText,
        stats: appendTraceEvent(readEventStats(event) ?? result.stats, {
          type: "repair-complete",
          timestamp: readEventTimestamp(event),
          htmlLength:
            typeof event.repairedText === "string" ? event.repairedText.length : undefined,
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
            typeof event.finishReason === "string" ? event.finishReason : undefined,
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
            typeof event.error === "string" ? event.error : "Tool execution failed.",
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
          : (readEventStats(event) ?? result.stats),
      };
    }

    if (event.type === "done") {
      return {
        ...result,
        status: "done" as const,
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
          typeof event.runtimeMs === "number"
            ? event.runtimeMs
            : result.runtimeMs,
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
      return {
        ...result,
        status: "error" as const,
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
          typeof event.runtimeMs === "number"
            ? event.runtimeMs
            : result.runtimeMs,
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

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const dataUrl = await toDataUrl(file);
    setImageDataUrl(dataUrl);
    setImageName(file.name);
    setVisualDiffs({});
    setErrorMessage("");
  }

  function handleModelChange(index: number, nextModelConfig: string) {
    const currentModelConfig = getModelConfig(selectedModels[index]);
    const selectedConfigsExcludingCurrent = selectedModels
      .filter((_, currentIndex) => currentIndex !== index)
      .map((model) => getModelConfig(model));

    let resolvedModelConfig = nextModelConfig;

    if (selectedConfigsExcludingCurrent.includes(nextModelConfig)) {
      const fallbackModel = getPreferredAvailableModels(
        catalog,
        selectedConfigsExcludingCurrent,
        1,
        recentModelConfigs.filter(
          (config) =>
            config !== nextModelConfig && config !== currentModelConfig,
        ),
        agenticOptions.enabled,
      )[0];

      if (fallbackModel) {
        resolvedModelConfig = fallbackModel.config;
      } else if (!selectedConfigsExcludingCurrent.includes(currentModelConfig)) {
        resolvedModelConfig = currentModelConfig;
      } else {
        return;
      }
    }

    const nextModel = catalog.find((model) => model.config === resolvedModelConfig);
    if (
      !nextModel
      || !getSelectableCatalogModels(catalog, agenticOptions.enabled).some(
        (model) => model.config === nextModel.config,
      )
    ) {
      return;
    }

    setRecentModelConfigs((current) =>
      mergeRecentModelConfigs(current, [nextModel.config]),
    );
    setSelectedModels((current) =>
      current.map((model, currentIndex) =>
        currentIndex === index ? toCompareModel(nextModel) : model,
      ),
    );
    resetLiveStreamMetric(selectedModels[index].id);
    resetLiveStreamMetric(nextModel.id);
    setResults((current) =>
      current.map((result, currentIndex) =>
        currentIndex === index
          ? {
              ...createEmptyResult(toCompareModel(nextModel)),
              usage: undefined,
              costs: undefined,
            }
          : result,
      ),
    );
    setErrorMessage("");
  }

  function handleTargetPanelCount(nextCount: number) {
    const minCards = getMinSelectableModelCards(catalog, agenticOptions.enabled);
    const maxCards = getMaxSelectableModelCards(catalog, agenticOptions.enabled);
    const clampedCount = Math.max(minCards, Math.min(maxCards, nextCount));

    if (clampedCount === selectedModels.length) return;

    if (clampedCount > selectedModels.length) {
      const additions = getPreferredAvailableModels(
        catalog,
        selectedModels.map((model) => getModelConfig(model)),
        clampedCount - selectedModels.length,
        recentModelConfigs,
        agenticOptions.enabled,
      ).map(toCompareModel);

      if (!additions.length) return;

      setFreshModelIds(additions.map((model) => model.id));
      setSelectedModels((current) => [...current, ...additions]);
      setResults((current) => [
        ...current,
        ...additions.map(createEmptyResult),
      ]);
    } else {
      setSelectedModels((current) => current.slice(0, clampedCount));
      setResults((current) => current.slice(0, clampedCount));
    }

    setErrorMessage("");
  }

  function handleRemovePanel(index: number) {
    if (
      selectedModels.length
      <= getMinSelectableModelCards(catalog, agenticOptions.enabled)
    ) {
      return;
    }

    resetLiveStreamMetric(selectedModels[index].id);
    setSelectedModels((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
    setResults((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
    setErrorMessage("");
  }

  async function handleGitHubSignIn() {
    setAuthError("");
    setIsAuthActionPending(true);

    try {
      await authClient.signIn.social({
        provider: "github",
        callbackURL: window.location.href,
      });
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Unable to start GitHub sign-in. Check your Better Auth config.",
      );
    } finally {
      setIsAuthActionPending(false);
    }
  }

  async function handleAnonymousSignIn() {
    setAuthError("");
    setIsAuthActionPending(true);

    try {
      await authClient.signIn.anonymous();
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Unable to create a local development session.",
      );
    } finally {
      setIsAuthActionPending(false);
    }
  }

  async function handleSignOut() {
    setAuthError("");
    setIsAuthActionPending(true);
    attemptedLocalDevSignInRef.current = false;

    try {
      await authClient.signOut();
      setRuns([]);
      setIsHistoryOpen(false);
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Unable to sign out right now.",
      );
      setIsAuthActionPending(false);
      return;
    }

    setIsAuthActionPending(false);
  }

  async function handleVote(modelIndex: number, vote: OutputVoteValue) {
    if (!activeRunId) {
      setErrorMessage("Wait for the run to finish saving before voting.");
      return;
    }

    const voteKey = getVoteKey(activeRunId, modelIndex);
    const currentVote = results[modelIndex]?.vote?.userVote;
    const optimisticUserVote = currentVote === vote ? undefined : vote;
    const currentSummary = results[modelIndex]?.vote ?? {
      score: 0,
      upvotes: 0,
      downvotes: 0,
    };
    const optimisticSummary = {
      score:
        currentSummary.score -
        (currentVote ?? 0) +
        (optimisticUserVote ?? 0),
      upvotes:
        currentSummary.upvotes -
        (currentVote === 1 ? 1 : 0) +
        (optimisticUserVote === 1 ? 1 : 0),
      downvotes:
        currentSummary.downvotes -
        (currentVote === -1 ? 1 : 0) +
        (optimisticUserVote === -1 ? 1 : 0),
      userVote: optimisticUserVote,
    };

    setVotePendingByKey((current) => ({
      ...current,
      [voteKey]: true,
    }));
    setResults((current) =>
      current.map((result, index) =>
        index === modelIndex
          ? applyVoteSummaryToResult(result, optimisticSummary)
          : result,
      ),
    );
    applyVoteSummaryToRun(activeRunId, modelIndex, optimisticSummary);

    try {
      const response = await fetch("/api/runs/vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runId: activeRunId,
          modelIndex,
          vote,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        summary?: {
          score: number;
          upvotes: number;
          downvotes: number;
          userVote?: OutputVoteValue;
        };
        error?: string;
      } | null;

      if (!response.ok || !payload?.summary) {
        throw new Error(payload?.error ?? "Unable to save vote.");
      }

      setResults((current) =>
        current.map((result, index) =>
          index === modelIndex
            ? applyVoteSummaryToResult(result, payload.summary!)
            : result,
        ),
      );
      applyVoteSummaryToRun(activeRunId, modelIndex, payload.summary);
    } catch (error) {
      setResults((current) =>
        current.map((result, index) =>
          index === modelIndex
            ? applyVoteSummaryToResult(result, {
                ...currentSummary,
                userVote: currentVote,
              })
            : result,
        ),
      );
      applyVoteSummaryToRun(activeRunId, modelIndex, {
        ...currentSummary,
        userVote: currentVote,
      });
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to save vote.",
      );
    } finally {
      setVotePendingByKey((current) => {
        if (!(voteKey in current)) return current;

        const next = { ...current };
        delete next[voteKey];
        return next;
      });
    }
  }

  async function handleCompare() {
    if (!signedInUser) {
      setErrorMessage("Sign in to run a build-off.");
      return;
    }

    if (!imageDataUrl) {
      setErrorMessage("Add a screenshot first.");
      return;
    }

    const minCards = getMinSelectableModelCards(catalog, agenticOptions.enabled);
    const maxCards = getMaxSelectableModelCards(catalog, agenticOptions.enabled);

    if (selectedModels.length < minCards || selectedModels.length > maxCards) {
      setErrorMessage(`Choose between ${minCards} and ${maxCards} models.`);
      return;
    }

    const unsupported = selectedModels.find((model) => {
      const match = catalog.find((item) => item.config === getModelConfig(model));
      return match
        ? !match.supportsImageInput
          || (agenticOptions.enabled && !supportsAgenticModel(match))
        : agenticOptions.enabled;
    });

    if (unsupported) {
      setErrorMessage(
        agenticOptions.enabled
          ? `${unsupported.label} is not verified for agentic mode in the model catalog.`
          : `${unsupported.label} does not support screenshot input in the Gateway catalog.`,
      );
      return;
    }

    const runId = uid();
    const startedAt = new Date().toISOString();
    const modelsForRun = [...selectedModels];
    const baseResults = createEmptyResults(modelsForRun);
    const run: SavedRun = {
      id: runId,
      createdAt: startedAt,
      prompt,
      imageDataUrl,
      imageName,
      agentic: agenticOptions,
      models: modelsForRun,
      results: baseResults,
    };

    setActiveRunId(runId);
    setResults(baseResults);
    resetAllLiveStreamMetrics();
    if (agenticOptions.enabled) {
      setOutputMode("preview");
    }
    setAgenticActivity(
      Object.fromEntries(
        modelsForRun.map((entry) => [
          entry.id,
          createAgenticCardState(agenticOptions),
        ]),
      ),
    );
    setPreviewErrors({});
    setPreviewToolErrors({});
    setPreviewOverrides({});
    setVisualDiffs({});
    setErrorMessage("");
    setIsHistoryOpen(false);
    setIsRunning(true);
    persistRun(run);
    syncRouteToPendingRun(agenticOptions.enabled);

    void (async () => {
      let persistedRunId = runId;

      try {
        const response = await fetch("/api/compare", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            imageDataUrl,
            imageName,
            models: modelsForRun,
            agentic: agenticOptions,
          }),
        });

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error ?? "The compare request failed.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as Record<string, unknown>;
            if (
              event.type === "ready" &&
              typeof event.runId === "string" &&
              event.runId
            ) {
              replaceRunId(persistedRunId, event.runId);
              persistedRunId = event.runId;
            }
            if (
              (event.type === "complete" || event.type === "fatal") &&
              typeof event.runId === "string" &&
              event.runId === persistedRunId
            ) {
              updateRun(persistedRunId, (existing) => ({
                ...existing,
                imageUrl:
                  typeof event.imageUrl === "string" && event.imageUrl
                    ? event.imageUrl
                    : existing.imageUrl,
                imageObjectKey:
                  typeof event.imageObjectKey === "string" && event.imageObjectKey
                    ? event.imageObjectKey
                    : existing.imageObjectKey,
                imageDataUrl:
                  typeof event.imageDataUrl === "string" && event.imageDataUrl
                    ? event.imageDataUrl
                    : typeof event.imageUrl === "string" && event.imageUrl
                      ? undefined
                      : existing.imageDataUrl,
              }));
            }
            if (event.type === "tool-call") {
              void handleToolCallEvent(event);
            }
            if (
              (event.type === "start" || event.type === "replace-output") &&
              typeof event.modelId === "string"
            ) {
              const modelId = event.modelId;
              if (event.type === "start") {
                resetLiveStreamMetric(modelId);
              }
              const previewId = getPreviewIdForModelId(modelId);
              setPreviewOverrides((current) => {
                if (!(modelId in current)) return current;

                const next = { ...current };
                delete next[modelId];
                return next;
              });
              if (previewId) {
                setPreviewToolErrors((current) => {
                  if (!(previewId in current)) return current;

                  const next = { ...current };
                  delete next[previewId];
                  return next;
                });
              }
            }
            if (
              event.type === "tool-error" &&
              typeof event.modelId === "string"
            ) {
              const previewId = getPreviewIdForModelId(event.modelId);
              if (previewId) {
                const toolLabel =
                  typeof event.toolName === "string"
                    ? getToolLabel(event.toolName)
                    : "Tool";
                const message =
                  typeof event.error === "string" && event.error.trim()
                    ? `${toolLabel}: ${event.error}`
                    : `${toolLabel}: Tool execution failed.`;

                setPreviewToolErrors((current) => {
                  const existing = current[previewId] ?? [];
                  if (existing.includes(message)) return current;

                  return {
                    ...current,
                    [previewId]: [...existing, message],
                  };
                });
              }
            }
            if (
              event.type === "delta" &&
              typeof event.modelId === "string" &&
              typeof event.delta === "string"
            ) {
              applyLiveStreamDelta(event.modelId, event.delta);
            }
            setAgenticActivity((current) =>
              applyEventToAgenticState(current, event),
            );
            let finalizedResult: ModelResult | undefined;
            setResults((current) => {
              const next = current.map((item) => applyEventToResult(item, event));
              if (event.type === "done" || event.type === "error") {
                finalizedResult = next.find((item) => item.modelId === event.modelId);
              }
              return next;
            });
            if (finalizedResult) {
              syncLiveStreamMetricFromResult(finalizedResult);
            }
            updateRun(persistedRunId, (existing) => ({
              ...existing,
              results: existing.results.map((item) =>
                applyEventToResult(item, event),
              ),
            }));
          }
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to compare right now.";
        setErrorMessage(message);
        setResults((current) => {
          const next: ModelResult[] = current.map((item) => ({
            ...item,
            status: item.status === "done" ? "done" : ("error" as const),
            error: item.error ?? message,
          }));

          updateRun(persistedRunId, (existing) => ({
            ...existing,
            results: next,
          }));

          return next;
        });
      } finally {
        setIsRunning(false);
      }
    })();
  }

  const canAddPanel =
    !isLoadingModels && selectedModels.length < maxSelectableCards;
  const canRemovePanel = selectedModels.length > minSelectableCards;
  const isEditLocked = isRunning || results.some((r) => r.status !== "idle");
  const cardSizeConfig = CARD_SIZE_CONFIG[cardSize];
  const cardViewportStyle = {
    "--output-viewport-height": cardSizeConfig.viewportHeight,
    "--output-viewport-fullscreen-height":
      cardSizeConfig.fullscreenViewportHeight,
  } as CSSProperties;

  function handleDragStart(index: number) {
    setDragSourceIndex(index);
  }

  function handleDragOver(targetIndex: number) {
    if (dragSourceIndex !== null && dragSourceIndex !== targetIndex) {
      setDragOverIndex(targetIndex);
    }
  }

  function handleDrop(targetIndex: number) {
    const src = dragSourceIndex;
    setDragSourceIndex(null);
    setDragOverIndex(null);
    if (src === null || src === targetIndex) return;
    withTransition(() => {
      setSelectedModels((current) => {
        const next = [...current];
        const [removed] = next.splice(src, 1);
        next.splice(targetIndex, 0, removed);
        return next;
      });
      setResults((current) => {
        const next = [...current];
        const [removed] = next.splice(src, 1);
        next.splice(targetIndex, 0, removed);
        return next;
      });
    });
  }

  function handleDragEnd() {
    setDragSourceIndex(null);
    setDragOverIndex(null);
  }

  function handleNewRun() {
    startBlankWorkspace();
  }

  const comparisonRows: Array<{
    label: string;
    render: (result: ModelResult) => ReactNode;
  }> = [
    {
      label: "Status",
      render: (result) => (
        <span
          className={cn(
            "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
            result.status === "done" &&
              "border-[color-mix(in_oklch,var(--success)_35%,transparent)] bg-[color-mix(in_oklch,var(--success)_18%,transparent)] text-(--success)",
            result.status === "streaming" &&
              "border-[color-mix(in_oklch,var(--accent)_38%,transparent)] bg-[color-mix(in_oklch,var(--accent)_18%,transparent)] text-(--accent)",
            result.status === "error" &&
              "border-[color-mix(in_oklch,var(--danger)_38%,transparent)] bg-[color-mix(in_oklch,var(--danger)_18%,transparent)] text-(--danger)",
            result.status === "idle" &&
              "border-(--line) bg-(--card) text-(--muted)",
          )}
        >
          {formatResultStatus(result)}
        </span>
      ),
    },
    { label: "Latency", render: (result) => formatDuration(result.latencyMs) },
    {
      label: "Runtime",
      render: (result) => formatDuration(liveElapsed(result, nowMs)),
    },
    {
      label: "Input",
      render: (result) => formatTokenCount(result.usage?.inputTokens),
    },
    {
      label: "Output",
      render: (result) => {
        const metrics = getDisplayOutputMetrics(result);
        return formatLiveTokenCount(
          metrics.outputTokens,
          metrics.outputEstimated,
        );
      },
    },
    {
      label: "Total",
      render: (result) => {
        const metrics = getDisplayOutputMetrics(result);
        return formatLiveTokenCount(metrics.totalTokens, metrics.totalEstimated);
      },
    },
    {
      label: "Tool calls",
      render: (result) => formatTokenCount(result.stats?.toolCallCount),
    },
    {
      label: "Steps",
      render: (result) => formatTokenCount(result.stats?.stepCount),
    },
    {
      label: "Tps",
      render: (result) =>
        formatTokensPerSecond(getDisplayOutputMetrics(result).peakTokensPerSecond),
    },
    { label: "Cost", render: (result) => formatCost(result.costs?.total) },
    { label: "Finish", render: (result) => result.finishReason ?? "—" },
  ];

  const aggregateStatus = results.reduce(
    (summary, result, index) => {
      if (result.status === "idle") {
        return summary;
      }

      const tokenMetrics = getDisplayOutputMetrics(result);
      const catalogModel =
        catalog.find(
          (entry) => entry.config === getModelConfig(selectedModels[index]),
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
          summary.hasEstimatedCost || (resolvedCost != null && result.costs?.total == null),
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
  const aggregateActiveCount =
    aggregateStatus.completedCount +
    aggregateStatus.streamingCount +
    aggregateStatus.errorCount;

  const shouldShowInitialLoadingState =
    isSessionPending
    || !hasBootstrappedClientState
    || (Boolean(initialRunId) && isInitialRouteRunPending);
  const initialLoadingTitle =
    initialRunId && !isSessionPending
      ? "Loading saved run"
      : "Preparing workspace";
  const initialLoadingMessage =
    initialRunId && !isSessionPending
      ? `Restoring run ${initialRunId} before the workspace renders.`
      : "Restoring session and local workspace state before we paint the app.";

  if (shouldShowInitialLoadingState) {
    return (
      <main className="relative min-h-screen [overflow-x:clip] px-4 py-6 text-(--foreground) sm:px-6 lg:px-8">
        <div className="grain" />

        <section className="mx-auto flex min-h-[70vh] w-full max-w-4xl items-center justify-center">
          <div className="panel rise-in w-full rounded-[2rem] p-8 text-center sm:p-10">
            <p className="eyebrow-label text-xs font-semibold uppercase tracking-[0.35em]">
              Visual Eval Harness
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em]">
              {initialLoadingTitle}
            </h1>
            <p className="mt-3 text-sm text-(--muted)">
              {initialLoadingMessage}
            </p>
          </div>
        </section>
      </main>
    );
  }

  if (!signedInUser) {
    const missingGitHubConfig = !authConfig.githubConfigured;

    return (
      <main className="relative min-h-screen [overflow-x:clip] px-4 py-6 text-(--foreground) sm:px-6 lg:px-8">
        <div className="grain" />

        <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
          <header className="glass-shell rise-in rounded-[2rem] px-5 py-5 sm:px-7 sm:py-6">
            <p className="eyebrow-label text-xs font-semibold uppercase tracking-[0.35em]">
              Visual Eval Harness
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">
              {authConfig.allowLocalDevAutoAuth
                ? "Preparing your localhost dev session"
                : "Sign in to save and compare build-off runs"}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-(--muted) sm:text-base">
              {authConfig.allowLocalDevAutoAuth
                ? "GitHub OAuth is not configured for this development environment, so Better Auth will create a temporary local account for this browser and keep it signed in for up to two weeks."
                : "GitHub OAuth is now wired through Better Auth. Once you sign in, run history stays tied to your account instead of mixing together across the whole app."}
            </p>
          </header>

          <section className="panel rise-in rounded-[2rem] p-6 sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-(--muted)">
                  Authentication
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
                  {authConfig.allowLocalDevAutoAuth
                    ? "Create a local dev account"
                    : missingGitHubConfig
                      ? "GitHub auth needs setup"
                      : "Continue with GitHub"}
                </h2>
                <p className="mt-3 text-sm leading-6 text-(--muted)">
                  {authConfig.allowLocalDevAutoAuth
                    ? "Your local draft still stays in the browser, and database-backed runs will attach to this temporary localhost account automatically."
                    : missingGitHubConfig
                      ? "GitHub OAuth env vars are missing. Open the app on localhost in development for automatic guest access, or add the GitHub Better Auth config."
                      : "Your local draft still stays in the browser, but database-backed runs and new comparisons are only available after sign-in."}
                </p>
              </div>

              {authConfig.allowLocalDevAutoAuth ? (
                <button
                  className="rounded-full bg-(--foreground) px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={isAuthActionPending}
                  onClick={() => {
                    void handleAnonymousSignIn();
                  }}
                  type="button"
                >
                  {isAuthActionPending
                    ? "Creating local session..."
                    : "Retry local sign-in"}
                </button>
              ) : missingGitHubConfig ? null : (
                <button
                  className="rounded-full bg-(--foreground) px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={isAuthActionPending}
                  onClick={() => {
                    void handleGitHubSignIn();
                  }}
                  type="button"
                >
                  {isAuthActionPending
                    ? "Redirecting..."
                    : "Continue with GitHub"}
                </button>
              )}
            </div>

            {authError ? (
              <div className="mt-4 rounded-[1.1rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-4 py-3 text-sm text-(--danger)">
                {authError}
              </div>
            ) : null}
          </section>
        </section>
      </main>
    );
  }


  return (
    <main className="relative min-h-screen [overflow-x:clip] pb-16 pt-4 text-(--foreground)">
      <div className="grain" />

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <header className="glass-shell floating-nav rise-in mx-auto flex max-w-[1600px] items-center gap-2 overflow-visible rounded-[3rem] px-3 py-1.5 sm:gap-3 sm:px-4">
        {/* Brand */}
        <div
          className={cn(
            "relative flex shrink-0 items-center gap-2.5 overflow-visible pl-1",
            isSiteMenuOpen && "z-50",
          )}
          ref={siteMenuRef}
        >
          <h1 className="text-sm font-semibold tracking-[-0.02em]">
            LLM Battle
          </h1>
          <span
            aria-hidden="true"
            className="h-3.5 w-px bg-(--foreground) opacity-20"
          />
          <button
            aria-expanded={isSiteMenuOpen}
            aria-haspopup="menu"
            className="site-menu-trigger eyebrow-label inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase"
            onClick={() => setIsSiteMenuOpen((current) => !current)}
            type="button"
          >
            <span>Eval Harness</span>
            <span
              aria-hidden="true"
              className={cn(
                "text-[10px] transition-transform duration-250",
                isSiteMenuOpen && "rotate-180",
              )}
            >
              ▾
            </span>
          </button>
          {isSiteMenuOpen ? (
            <div className="site-menu-panel" role="menu">
              <div className="site-menu-panel__section">
                <p className="site-menu-panel__eyebrow">Navigate</p>
                {EVAL_HARNESS_LINKS.map((item) => (
                  <Link
                    className={cn(
                      "site-menu-panel__item",
                      item.matchPathnames.includes(pathname) &&
                        "site-menu-panel__item--active",
                    )}
                    href={item.href}
                    key={item.href}
                    onClick={() => setIsSiteMenuOpen(false)}
                    role="menuitem"
                  >
                    <span className="site-menu-panel__label">{item.label}</span>
                    <span className="site-menu-panel__meta">{item.meta}</span>
                  </Link>
                ))}
              </div>

              <div className="site-menu-panel__divider" />

              <div className="site-menu-panel__section">
                <p className="site-menu-panel__eyebrow">Workspace</p>
                <button
                  className={cn(
                    "site-menu-panel__item text-left",
                    isHistoryOpen && "site-menu-panel__item--active",
                  )}
                  onClick={() => {
                    setIsSiteMenuOpen(false);
                    setIsHistoryOpen((current) => {
                      const next = !current;
                      if (next) void loadRuns();
                      return next;
                    });
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span className="site-menu-panel__label">Run history</span>
                  <span className="site-menu-panel__meta">
                    {runs.length ? `${runs.length} saved runs` : "Recent sessions"}
                  </span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Submenu */}
        <div className="flex flex-1 items-center justify-center gap-0.5 overflow-x-auto">
          <button
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-(--muted) transition-colors hover:bg-(--card-active) hover:text-(--foreground)"
            onClick={() => setIsPromptModalOpen(true)}
            type="button"
          >
            Edit prompt
          </button>

          <button
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              agenticOptions.enabled
                ? "bg-[color-mix(in_oklch,var(--accent)_22%,transparent)] text-(--foreground)"
                : "text-(--muted) hover:bg-(--card-active) hover:text-(--foreground)",
            )}
            onClick={handleToggleAgenticMode}
            type="button"
          >
            Agentic mode
          </button>

          <button
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              isHistoryOpen
                ? "bg-(--card-active) text-(--foreground)"
                : "text-(--muted) hover:bg-(--card-active) hover:text-(--foreground)",
            )}
            onClick={() => {
              const next = !isHistoryOpen;
              setIsHistoryOpen(next);
              if (next) void loadRuns();
            }}
            type="button"
          >
            History{runs.length ? ` (${runs.length})` : ""}
          </button>

          <Link
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-(--muted) transition-colors hover:bg-(--card-active) hover:text-(--foreground)"
            href="/stats"
          >
            Stats
          </Link>

          <span
            aria-hidden="true"
            className="mx-1 hidden h-4 w-px shrink-0 bg-(--foreground) opacity-15 sm:block"
          />

          {/* Card size toggle */}
          <div className="hidden shrink-0 items-center overflow-hidden rounded-full border border-(--line) sm:flex">
            {(["s", "m", "l", "xl"] as const).map((size) => (
              <button
                key={size}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition",
                  cardSize === size
                    ? "bg-(--foreground) text-(--background)"
                    : "text-(--muted) hover:bg-(--card-active)",
                )}
                onClick={() => withTransition(() => setCardSize(size))}
                type="button"
              >
                {size.toUpperCase()}
              </button>
            ))}
          </div>

          <span
            aria-hidden="true"
            className="mx-1 hidden h-4 w-px shrink-0 bg-(--foreground) opacity-15 sm:block"
          />

          {/* Output toggle */}
          <div className="hidden shrink-0 items-center overflow-hidden rounded-full border border-(--line) sm:flex">
            <button
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                outputMode === "preview"
                  ? "bg-(--foreground) text-(--background)"
                  : "text-(--muted) hover:bg-(--card-active)",
              )}
              disabled={isRunning && agenticOptions.enabled}
              onClick={() => setOutputMode("preview")}
              type="button"
            >
              Preview
            </button>
            <button
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                outputMode === "raw"
                  ? "bg-(--foreground) text-(--background)"
                  : "text-(--muted) hover:bg-(--card-active)",
              )}
              disabled={isRunning && agenticOptions.enabled}
              onClick={() => setOutputMode("raw")}
              type="button"
            >
              Raw
            </button>
            <button
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition",
                outputMode === "thinking"
                  ? "bg-(--foreground) text-(--background)"
                  : "text-(--muted) hover:bg-(--card-active)",
              )}
              onClick={() => setOutputMode("thinking")}
              type="button"
            >
              Thinking
            </button>
          </div>

          <span
            aria-hidden="true"
            className="mx-1 h-4 w-px shrink-0 bg-(--foreground) opacity-15"
          />

          {/* Run action */}
          {isRunning ? (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-(--muted)">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-(--accent)" />
              Running…
            </span>
          ) : isEditLocked ? (
            <button
              className="shrink-0 rounded-full bg-(--foreground) px-4 py-1.5 text-xs font-semibold text-(--background) transition hover:opacity-90"
              onClick={handleNewRun}
              type="button"
            >
              + New Run
            </button>
          ) : (
            <button
              className="shrink-0 rounded-full bg-(--accent) px-4 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!imageDataUrl}
              onClick={handleCompare}
              type="button"
            >
              Run ▸
            </button>
          )}
        </div>

        {/* User + sign out */}
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex items-center gap-2 rounded-full py-1.5 pl-2 pr-3 [background:color-mix(in_oklch,var(--foreground)_7%,transparent)]">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--accent-soft) text-[10px] font-semibold uppercase tracking-wide">
              {getUserMonogram(signedInUser)}
            </span>
            <span className="hidden max-w-45 truncate text-xs font-medium sm:block">
              {getUserDisplayName(signedInUser)}
            </span>
          </div>
          <button
            className="rounded-full px-4 py-1.5 text-xs font-medium text-(--muted) transition-colors hover:bg-(--card-active) hover:text-(--foreground) disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isAuthActionPending}
            onClick={() => {
              void handleSignOut();
            }}
            type="button"
          >
            {isAuthActionPending
              ? "Signing out…"
              : isAnonymousUser
                ? "Reset guest"
                : "Sign out"}
          </button>
        </div>
      </header>

      {/* ── Banners ──────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-[1600px] px-4 sm:px-0">
        {authError ? (
          <div className="rise-in mt-3 rounded-[1.4rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-4 py-3 text-sm text-(--danger)">
            {authError}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="rise-in mt-3 rounded-[1.4rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-4 py-3 text-sm text-(--danger)">
            {errorMessage}
          </div>
        ) : null}
        {modelsError ? (
          <div className="rise-in mt-3 rounded-[1.4rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-4 py-3 text-sm text-(--danger)">
            {modelsError}
          </div>
        ) : null}
        {isHydratingRouteRun ? (
          <div className="rise-in mt-3 rounded-[1.4rem] border border-[color-mix(in_oklch,var(--foreground)_12%,transparent)] bg-[color-mix(in_oklch,var(--foreground)_5%,transparent)] px-4 py-3 text-sm text-(--muted)">
            Loading run {initialRunId}…
          </div>
        ) : null}
      </div>

      {agenticOptions.enabled ? (
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
                      setAgenticOptions((current) => ({
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
                      setAgenticOptions((current) => ({
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
      ) : null}

      {/* ── History panel ────────────────────────────────────────────────── */}
      {isHistoryOpen ? (
        <div className="rise-in mx-auto mt-3 max-w-[1600px] overflow-hidden rounded-[1.75rem] border border-(--line) bg-(--card) p-4 px-4 sm:px-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold tracking-[-0.01em]">
              Run history
            </p>
            <span className="text-xs text-(--muted)">
              {isLoadingRuns ? "Refreshing…" : `${runs.length} saved`}
            </span>
          </div>
          {runsError ? (
            <div className="mb-3 rounded-[1.1rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-4 py-3 text-sm text-(--danger)">
              {runsError}
            </div>
          ) : null}
          {runs.length ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {runs.map((run, index) => (
                <button
                  key={run.id}
                  className={cn(
                    "w-full rounded-[1.3rem] border px-4 py-3 text-left transition hover:bg-(--card-active)",
                    activeRunId === run.id
                      ? "border-(--foreground) bg-(--card-active)"
                      : "border-(--line)",
                  )}
                  onClick={() => hydrateRun(run)}
                  type="button"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-(--muted)">
                      Run {runs.length - index}
                    </span>
                    <span className="text-[11px] text-(--muted)">
                      {formatTimestamp(run.createdAt)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs leading-5">{run.prompt}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-(--line) px-5 py-6 text-center text-sm text-(--muted)">
              {isLoadingRuns ? "Loading…" : "No saved runs yet."}
            </div>
          )}
        </div>
      ) : null}

      {aggregateActiveCount ? (
        <div className="status-strip-dock">
          <section className="status-strip glass-shell rise-in mx-auto max-w-[1600px]">
            <div className="status-strip__intro">
              <p className="status-strip__eyebrow">Run totals</p>
              <p className="status-strip__headline">
                {aggregateStatus.streamingCount
                  ? `${aggregateStatus.streamingCount} streaming`
                  : aggregateStatus.completedCount
                    ? `${aggregateStatus.completedCount} complete`
                    : `${aggregateStatus.errorCount} ended with errors`}
              </p>
            </div>

            <div className="status-strip__stats">
              <div className="status-strip__stat">
                <span className="status-strip__label">Cards</span>
                <strong className="status-strip__value">
                  {aggregateActiveCount}/{selectedModels.length}
                </strong>
              </div>
              <div className="status-strip__stat">
                <span className="status-strip__label">Total tokens</span>
                <strong className="status-strip__value">
                  {formatLiveTokenCount(
                    aggregateStatus.totalTokens,
                    aggregateStatus.hasEstimatedTokens,
                  )}
                </strong>
              </div>
              <div className="status-strip__stat">
                <span className="status-strip__label">Total cost</span>
                <strong className="status-strip__value">
                  {aggregateStatus.hasEstimatedCost &&
                  aggregateStatus.totalCost != null
                    ? `~${formatCost(aggregateStatus.totalCost)}`
                    : formatCost(aggregateStatus.totalCost)}
                </strong>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* ── Card grid ────────────────────────────────────────────────────── */}
      <div
        className="mx-auto mt-3 grid max-w-[1600px] gap-3 px-4 sm:px-0"
        style={{
          gridTemplateColumns:
            cardSize === "xl"
              ? "1fr"
              : `repeat(auto-fill, minmax(min(100%, ${cardSizeConfig.minWidth}), 1fr))`,
        }}
      >
        {/* Image card */}
        <div className="build-card" style={{ viewTransitionName: "card-ref" }}>
          <div className="build-card__header">
            <span className="flex-1 text-sm font-semibold tracking-[-0.02em]">
              Reference
            </span>
            {!isEditLocked ? (
              <button
                className="rounded-full border border-(--line) px-3 py-1 text-xs font-medium transition hover:bg-(--card-active)"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                Upload
              </button>
            ) : null}
          </div>
          <div className="build-card__body">
            {imageDataUrl ? (
              <div
                className="relative w-full overflow-hidden rounded-b-[1.75rem] cursor-move"
                onMouseLeave={resetReferenceImagePan}
                onMouseMove={handleReferenceImageMouseMove}
                ref={referenceImageFrameRef}
                style={{ height: cardSizeConfig.referenceHeight }}
              >
                <Image
                  alt="Reference screenshot"
                  className="object-cover transition-[object-position] duration-150 ease-out"
                  fill
                  sizes={
                    cardSize === "xl"
                      ? "100vw"
                      : cardSize === "l"
                        ? "(max-width: 1024px) 100vw, 480px"
                        : cardSize === "m"
                          ? "(max-width: 768px) 100vw, 320px"
                          : "(max-width: 640px) 100vw, 240px"
                  }
                  style={{
                    objectPosition:
                      "var(--reference-pan-x, 50%) var(--reference-pan-y, 50%)",
                  }}
                  src={imageDataUrl}
                  unoptimized
                />
              </div>
            ) : (
              <button
                className="flex w-full flex-col items-center justify-center gap-3 rounded-b-[1.75rem] px-6 py-8 text-center transition hover:bg-[color-mix(in_oklch,var(--foreground)_3%,transparent)]"
                onClick={() => fileInputRef.current?.click()}
                style={{ minHeight: cardSizeConfig.referenceHeight }}
                type="button"
              >
                <span className="text-2xl opacity-25">↑</span>
                <span className="text-sm leading-6 text-(--muted)">
                  Paste a screenshot, or click to upload
                </span>
              </button>
            )}
          </div>
          {imageDataUrl ? (
            <div className="build-card__footer">
              <span className="truncate">{imageName}</span>
            </div>
          ) : null}
        </div>

        {/* Model cards */}
        {selectedModels.map((model, index) => {
          const result = results[index];
          const tokenMetrics = result
            ? getDisplayOutputMetrics(result)
            : undefined;
          const catalogModel =
            catalog.find((entry) => entry.config === getModelConfig(model)) ?? null;
          const previewId = `${model.id}-${index}`;
          const cardAgenticState = agenticActivity[model.id];
          const cardPreviewErrors = previewErrors[previewId] ?? [];
          const cardPreviewToolErrors = previewToolErrors[previewId] ?? [];
          const cardVisualDiff = visualDiffs[previewId];
          const repairedMarkup = result?.repairedText ?? result?.text ?? "";
          const effectivePreviewMarkup = previewOverrides[model.id] ?? repairedMarkup;
          const displayRawMarkup = repairedMarkup;
          const thinkingOutput = result?.thinking?.trim() ?? "";
          const domCssStatItems = buildDomCssStatItems(result?.domCssStats);
          const traceEvents = readTraceEvents(result?.stats).slice().reverse();
          const hasHtml = looksLikeHtml(
            unwrapHtmlCodeFence(effectivePreviewMarkup),
          );
          const isPreviewOpen = activePreviewModelId === model.id;
          const isDragged = dragSourceIndex === index;
          const isDragTarget =
            dragOverIndex === index && dragSourceIndex !== index;
          const isFresh = freshModelIds.includes(model.id);
          const voteSummary = result?.vote ?? {
            score: 0,
            upvotes: 0,
            downvotes: 0,
          };
          const voteKey = activeRunId ? getVoteKey(activeRunId, index) : null;
          const isVotePending = voteKey ? !!votePendingByKey[voteKey] : false;
          const canVote =
            !!activeRunId &&
            !!result &&
            (result.status === "done" || result.status === "error");

          return (
            <div
              key={`${model.id}-${index}`}
              className={cn(
                "build-card",
                isFresh && "build-card--fresh",
                openPickerIndex === index && "build-card--picker-open",
                isDragged && "build-card--drag-source",
                isDragTarget && "build-card--drag-target",
              )}
              style={{ viewTransitionName: cardVtName(model.id) }}
              draggable={!isEditLocked}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => {
                e.preventDefault();
                if (!isEditLocked) handleDragOver(index);
              }}
              onDragStart={() => {
                if (!isEditLocked) handleDragStart(index);
              }}
              onDrop={() => {
                if (!isEditLocked) handleDrop(index);
              }}
            >
              {/* Card header */}
              <div className="build-card__header">
                {!isEditLocked ? (
                  <span
                    aria-hidden="true"
                    className="build-card__drag"
                    title="Drag to reorder"
                  >
                    ⠿
                  </span>
                ) : null}
                {isEditLocked ? (
                  <span className="flex-1 truncate text-sm font-semibold tracking-[-0.02em]">
                    {model.label}
                  </span>
                ) : (
                  <ModelPicker
                    agenticEnabled={agenticOptions.enabled}
                    catalog={catalog}
                    disabled={isLoadingModels}
                    onOpenChange={(isOpen) =>
                      setOpenPickerIndex((current) =>
                        isOpen ? index : current === index ? null : current,
                      )
                    }
                    onSelect={(modelId) => handleModelChange(index, modelId)}
                    onSortModeChange={setModelSortMode}
                    recentModelConfigs={recentModelConfigs}
                    selectedModels={selectedModels}
                    sortMode={modelSortMode}
                    value={model}
                    variant="header"
                  />
                )}
                {isEditLocked ? (
                  <span className="shrink-0 rounded-full border border-(--line) px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-(--muted)">
                    {catalogModel ? `${getModelSourceLabel(catalogModel)} · ${catalogModel.ownedBy}` : getModelSourceLabel(model)}
                  </span>
                ) : null}
                <span
                  aria-label={formatResultStatus(result)}
                  className={statusLineClass(result?.status)}
                  title={formatResultStatus(result)}
                />
                {!isEditLocked && canRemovePanel ? (
                  <button
                    aria-label={`Remove ${model.label}`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-lg leading-none text-(--muted) transition hover:bg-(--card-active) hover:text-(--foreground)"
                    onClick={() => withTransition(() => handleRemovePanel(index))}
                    type="button"
                  >
                    ×
                  </button>
                ) : null}
              </div>

              {/* Result content */}
              <div className="build-card__body">
                {cardAgenticState?.enabled ? (
                  <div className="border-b border-(--line) px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.18em] text-(--muted)">
                      <span>
                        Agentic {cardAgenticState.stepsCompleted}/
                        {cardAgenticState.maxTurns} turns
                      </span>
                      <span>
                        {Object.values(cardAgenticState.tools).reduce(
                          (sum, toolState) => sum + toolState.count,
                          0,
                        )}{" "}
                        tool calls
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Object.entries(cardAgenticState.tools).map(
                        ([toolName, toolState]) => (
                          <span
                            className={cn(
                              "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                              toolState.status === "running" &&
                                "border-[color-mix(in_oklch,var(--accent)_40%,transparent)] bg-[color-mix(in_oklch,var(--accent)_18%,transparent)] text-(--foreground)",
                              toolState.status === "error" &&
                                "border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] text-(--danger)",
                              toolState.status === "idle" &&
                                "border-(--line) bg-(--panel-strong) text-(--muted)",
                            )}
                            key={toolName}
                            title={toolState.error}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                toolState.status === "running" &&
                                  "pulse-dot bg-(--accent)",
                                toolState.status === "error" &&
                                  "bg-(--danger)",
                                toolState.status === "idle" &&
                                  "bg-(--muted)",
                              )}
                            />
                            {getToolLabel(toolName)} {toolState.count}
                          </span>
                        ),
                      )}
                    </div>
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                        Trace
                      </p>
                      <div className="mt-2 space-y-2">
                        {traceEvents.slice(0, 3).map((traceEvent, traceIndex) => (
                          <div
                            className="rounded-[0.9rem] border border-(--line) bg-(--panel-strong) px-3 py-2"
                            key={`${previewId}-trace-${traceIndex}`}
                          >
                            <p className="text-xs font-medium text-(--foreground)">
                              {describeTraceEvent(traceEvent)}
                            </p>
                            <p className="mt-1 text-[11px] text-(--muted)">
                              {formatTimeAgo(traceEvent.timestamp)}
                            </p>
                          </div>
                        ))}
                        {!traceEvents.length ? (
                          <p className="text-xs text-(--muted)">
                            Tool calls and step transitions will appear here.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {displayRawMarkup || previewOverrides[model.id] || thinkingOutput ? (
                  outputMode === "preview" ? (
                    <div className="flex flex-col gap-2 p-3">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-(--muted)">Visual score</p>
                          <p className="mt-1 text-sm font-semibold text-(--foreground)">
                            {formatSimilarityLabel(
                              cardVisualDiff?.similarity ?? result?.stats?.visualAnalysis?.similarity,
                            )}
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-(--muted)">Mismatch</p>
                          <p className="mt-1 text-sm font-semibold text-(--foreground)">
                            {formatMismatchLabel(
                              cardVisualDiff?.mismatchRatio ?? result?.stats?.visualAnalysis?.mismatchRatio,
                            )}
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-(--muted)">Trace events</p>
                          <p className="mt-1 text-sm font-semibold text-(--foreground)">
                            {formatTokenCount(traceEvents.length)}
                          </p>
                        </div>
                      </div>
                      {!hasHtml ? (
                        <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-2 text-xs text-(--muted)">
                          No HTML yet — preview appears as markup arrives.
                        </div>
                      ) : null}
                      {cardPreviewErrors.length ? (
                        <div className="rounded-[1rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-3 py-2 text-xs text-(--danger)">
                          {cardPreviewErrors.map((msg, i) => (
                            <p key={`${previewId}-err-${i}`}>{msg}</p>
                          ))}
                        </div>
                      ) : null}
                      {isPreviewOpen ? (
                        <div
                          className="preview-card-placeholder"
                          style={{ minHeight: cardSizeConfig.viewportHeight }}
                        >
                          <span>Preview opened</span>
                        </div>
                      ) : (
                        <div
                          className="preview-card-shell"
                          ref={(element) => {
                            previewCardShellRefs.current[model.id] = element;
                          }}
                        >
                          <OutputViewport
                            className="overflow-hidden rounded-[1.2rem] border border-(--line) bg-white"
                            contentClassName="overflow-hidden"
                            contentStyle={cardViewportStyle}
                            title={`${result.label} preview`}
                          >
                            <button
                              aria-label={`Open ${result.label} preview`}
                              className="preview-card-trigger"
                              onClick={() => {
                                openPreview(model.id);
                              }}
                              type="button"
                            >
                              <span className="preview-card-trigger__hint">
                                Open live preview
                              </span>
                            </button>
                            <div className="relative h-full w-full">
                              <LiveHtmlPreview
                                iframeRef={(element) => {
                                  previewFrameRefs.current[previewId] = element;
                                }}
                                isStreaming={result.status === "streaming"}
                                markup={displayRawMarkup}
                                overrideMarkup={previewOverrides[model.id]}
                                previewId={previewId}
                                title={`${result.label} preview`}
                              />
                              {cardPreviewToolErrors.length ? (
                                <div className="absolute inset-4 z-20 flex items-start justify-center">
                                  <div className="w-full max-w-xl rounded-[1.1rem] border border-[color-mix(in_oklch,var(--danger)_46%,var(--line))] bg-[linear-gradient(180deg,color-mix(in_oklch,var(--panel-strong)_84%,var(--danger)_16%),color-mix(in_oklch,var(--panel)_88%,black_8%))] p-3 text-sm text-[color-mix(in_oklch,var(--foreground)_96%,white)] shadow-[0_20px_60px_color-mix(in_oklch,var(--danger)_24%,transparent)] backdrop-blur-xl">
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color-mix(in_oklch,var(--danger)_72%,white)]">
                                          Tool call failed
                                        </p>
                                        <div className="mt-2 space-y-2 text-sm leading-6 text-[color-mix(in_oklch,var(--foreground)_96%,white)]">
                                          {cardPreviewToolErrors.map((msg, i) => (
                                            <p key={`${previewId}-tool-err-${i}`}>
                                              {msg}
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                      <button
                                        className="shrink-0 rounded-full border border-[color-mix(in_oklch,var(--danger)_42%,transparent)] bg-[color-mix(in_oklch,var(--panel-strong)_82%,var(--danger)_18%)] px-3 py-1 text-xs font-semibold text-[color-mix(in_oklch,var(--foreground)_94%,white)] transition hover:bg-[color-mix(in_oklch,var(--panel-strong)_72%,var(--danger)_28%)]"
                                        onClick={() =>
                                          dismissPreviewToolErrors(previewId)
                                        }
                                        type="button"
                                      >
                                        Dismiss
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </OutputViewport>
                        </div>
                      )}
                    </div>
                  ) : (
                    outputMode === "raw" ? (
                      <div className="flex flex-col gap-2 p-3">
                        <div className="flex items-center justify-between rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-(--muted)">
                          <span>DOM + CSS stats</span>
                          <span>
                            {result?.stats?.repairPassCount ? "Includes repaired output" : "Initial output"}
                          </span>
                        </div>
                        <VisualComparisonPanel
                          compact
                          onRefresh={hasHtml ? () => {
                            void refreshVisualDiff(previewId);
                          } : undefined}
                          referenceImageUrl={imageDataUrl}
                          visualState={cardVisualDiff}
                        />
                        {domCssStatItems.length ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {domCssStatItems.map(([label, value]) => (
                              <div
                                key={`${model.id}-${label}`}
                                className="rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-2"
                              >
                                <p className="text-[11px] uppercase tracking-[0.16em] text-(--muted)">{label}</p>
                                <p className="mt-1 text-sm font-semibold text-(--foreground)">{value}</p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <OutputViewport
                          className="overflow-hidden rounded-[1.2rem] border border-(--line) bg-(--card)"
                          contentClassName="overflow-auto px-4 py-4"
                          contentStyle={cardViewportStyle}
                          title={`${result.label} raw`}
                        >
                          <pre className="m-0 whitespace-pre-wrap break-words text-[13px] font-[450] leading-7">
                            {displayRawMarkup}
                          </pre>
                        </OutputViewport>
                      </div>
                    ) : (
                      <div className="p-3">
                        <OutputViewport
                          className="overflow-hidden rounded-[1.2rem] border border-(--line) bg-(--card)"
                          contentClassName="overflow-auto px-4 py-4"
                          contentStyle={cardViewportStyle}
                          title={`${result.label} thinking`}
                        >
                          {agenticOptions.enabled ? (
                            <TraceTimeline events={traceEvents} />
                          ) : (
                            <pre className="m-0 whitespace-pre-wrap break-words text-[13px] font-[450] leading-7 text-(--muted)">
                              {thinkingOutput || "Thinking traces appear when the model emits reasoning output."}
                            </pre>
                          )}
                        </OutputViewport>
                      </div>
                    )
                  )
                ) : (
                  <div
                    className="flex flex-1 items-center justify-center px-6 py-8 text-center text-sm leading-6 text-(--muted)"
                    style={{ minHeight: cardSizeConfig.viewportHeight }}
                  >
                    {isRunning
                      ? "Waiting for tokens…"
                      : isEditLocked
                        ? "No output."
                        : "Run to see output here."}
                  </div>
                )}
              </div>

              {/* Metrics footer — appears after run starts */}
              {result && result.status !== "idle" ? (
                <div className="build-card__footer">
                  <span className="inline-flex items-center gap-1">
                    <button
                      aria-label={`Thumbs up ${result.label}`}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs transition",
                        voteSummary.userVote === 1
                          ? "border-[color-mix(in_oklch,var(--success)_42%,transparent)] bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-(--foreground)"
                          : "border-(--line) hover:bg-(--card-active)",
                      )}
                      disabled={!canVote || isVotePending}
                      onClick={() => {
                        void handleVote(index, 1);
                      }}
                      title={`${voteSummary.upvotes} thumbs up`}
                      type="button"
                    >
                      👍
                    </button>
                    <strong className="font-semibold text-(--foreground)">
                      {formatVoteScore(voteSummary.score)}
                    </strong>
                    <button
                      aria-label={`Thumbs down ${result.label}`}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs transition",
                        voteSummary.userVote === -1
                          ? "border-[color-mix(in_oklch,var(--danger)_42%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] text-(--foreground)"
                          : "border-(--line) hover:bg-(--card-active)",
                      )}
                      disabled={!canVote || isVotePending}
                      onClick={() => {
                        void handleVote(index, -1);
                      }}
                      title={`${voteSummary.downvotes} thumbs down`}
                      type="button"
                    >
                      👎
                    </button>
                  </span>
                  <span>
                    Latency{" "}
                    <strong className="font-semibold text-(--foreground)">
                      {formatDuration(result.latencyMs)}
                    </strong>
                  </span>
                  <span>
                    Runtime{" "}
                    <strong className="font-semibold text-(--foreground)">
                      {formatDuration(liveElapsed(result, nowMs))}
                    </strong>
                  </span>
                  {result.usage?.inputTokens != null ? (
                    <span>
                      In{" "}
                      <strong className="font-semibold text-(--foreground)">
                        {formatTokenCount(result.usage.inputTokens)}
                      </strong>
                    </span>
                  ) : null}
                  {tokenMetrics?.outputTokens != null ? (
                    <span>
                      Out{" "}
                      <strong className="font-semibold text-(--foreground)">
                        {formatLiveTokenCount(
                          tokenMetrics.outputTokens,
                          tokenMetrics.outputEstimated,
                        )}
                      </strong>
                    </span>
                  ) : null}
                  {tokenMetrics?.totalTokens != null ? (
                    <span>
                      Total{" "}
                      <strong className="font-semibold text-(--foreground)">
                        {formatLiveTokenCount(
                          tokenMetrics.totalTokens,
                          tokenMetrics.totalEstimated,
                        )}
                      </strong>
                    </span>
                  ) : null}
                  {result.stats?.toolCallCount != null ? (
                    <span>
                      Tools{" "}
                      <strong className="font-semibold text-(--foreground)">
                        {formatTokenCount(result.stats.toolCallCount)}
                      </strong>
                    </span>
                  ) : null}
                  {result.stats?.stepCount != null ? (
                    <span>
                      Steps{" "}
                      <strong className="font-semibold text-(--foreground)">
                        {formatTokenCount(result.stats.stepCount)}
                      </strong>
                    </span>
                  ) : null}
                  {result.stats?.repairPassCount != null ? (
                    <span>
                      Repair passes{" "}
                      <strong className="font-semibold text-(--foreground)">
                        {formatTokenCount(result.stats.repairPassCount)}
                      </strong>
                    </span>
                  ) : null}
                  {tokenMetrics?.peakTokensPerSecond != null ? (
                    <span>
                      Tps{" "}
                      <strong className="font-semibold text-(--foreground)">
                        {formatTokensPerSecond(
                          tokenMetrics.peakTokensPerSecond,
                        )}
                      </strong>
                    </span>
                  ) : null}
                  {result.stats?.toolErrorCount != null ? (
                    <span>
                      Tool errors{" "}
                      <strong className="font-semibold text-(--foreground)">
                        {formatTokenCount(result.stats.toolErrorCount)}
                      </strong>
                    </span>
                  ) : null}
                  {result.costs?.total != null ? (
                    <span>
                      Cost{" "}
                      <strong className="font-semibold text-(--foreground)">
                        {formatCost(result.costs.total)}
                      </strong>
                    </span>
                  ) : null}
                  {result.finishReason ? (
                    <span>
                      Finish{" "}
                      <strong className="font-semibold text-(--foreground)">
                        {result.finishReason}
                      </strong>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {/* Ghost "add" card */}
        {!isEditLocked && canAddPanel ? (
          <button
            className="ghost-card"
            style={{ viewTransitionName: "card-add" }}
            onClick={() => withTransition(() => handleTargetPanelCount(selectedModels.length + 1))}
            type="button"
          >
            <span aria-hidden="true" className="ghost-card__halo" />
            <span className="ghost-card__orb">
              <span className="ghost-card__plus">+</span>
            </span>
            <span className="ghost-card__content">
              <span className="ghost-card__eyebrow">
                Add contender
              </span>
              <span className="ghost-card__title">
                Open one more lane for a fresh model
              </span>
              <span className="ghost-card__meta">
                {selectedModels.length} of {maxSelectableCards} cards in play
              </span>
            </span>
          </button>
        ) : null}
      </div>

      {isClient && activePreviewResult && activePreviewModel && activePreviewId
        ? createPortal(
            <div
              aria-modal="true"
              className="preview-modal-backdrop"
              onClick={closePreview}
              role="dialog"
            >
              <div
                className="preview-modal-sheet h-full"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="preview-modal__header">
                  <div>
                    <p className="preview-modal__eyebrow">Interactive preview</p>
                    <h2 className="preview-modal__title">
                      {activePreviewResult.label}
                    </h2>
                  </div>
                  <button
                    className="preview-modal__close"
                    onClick={closePreview}
                    type="button"
                  >
                    Close
                  </button>
                </div>

                <div className="preview-modal__body flex-1">
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,0.9fr)]">
                    <div className="flex min-h-0 flex-col gap-3">
                  {activePreviewErrors.length ? (
                    <div className="rounded-[1rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-3 py-2 text-xs text-(--danger)">
                      {activePreviewErrors.map((msg, i) => (
                        <p key={`${activePreviewId}-modal-err-${i}`}>{msg}</p>
                      ))}
                    </div>
                  ) : null}

                  <div
                    className="preview-modal__viewport"
                    ref={activePreviewViewportRef}
                  >
                    <LiveHtmlPreview
                      iframeRef={(element) => {
                        previewFrameRefs.current[activePreviewId] = element;
                      }}
                      interactive
                      isStreaming={activePreviewResult.status === "streaming"}
                      markup={
                        activePreviewResult.repairedText ?? activePreviewResult.text
                      }
                      overrideMarkup={previewOverrides[activePreviewModel.id]}
                      previewId={activePreviewId}
                      title={`${activePreviewResult.label} interactive preview`}
                      />
                    </div>

                  {activePreviewToolErrors.length ? (
                    <div className="rounded-[1.1rem] border border-[color-mix(in_oklch,var(--danger)_46%,var(--line))] bg-[linear-gradient(180deg,color-mix(in_oklch,var(--panel-strong)_84%,var(--danger)_16%),color-mix(in_oklch,var(--panel)_88%,black_8%))] p-3 text-sm text-[color-mix(in_oklch,var(--foreground)_96%,white)] shadow-[0_20px_60px_color-mix(in_oklch,var(--danger)_24%,transparent)] backdrop-blur-xl">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color-mix(in_oklch,var(--danger)_72%,white)]">
                            Tool call failed
                          </p>
                          <div className="mt-2 space-y-2 text-sm leading-6 text-[color-mix(in_oklch,var(--foreground)_96%,white)]">
                            {activePreviewToolErrors.map((msg, i) => (
                              <p key={`${activePreviewId}-modal-tool-err-${i}`}>
                                {msg}
                              </p>
                            ))}
                          </div>
                        </div>
                        <button
                          className="shrink-0 rounded-full border border-[color-mix(in_oklch,var(--danger)_42%,transparent)] bg-[color-mix(in_oklch,var(--panel-strong)_82%,var(--danger)_18%)] px-3 py-1 text-xs font-semibold text-[color-mix(in_oklch,var(--foreground)_94%,white)] transition hover:bg-[color-mix(in_oklch,var(--panel-strong)_72%,var(--danger)_28%)]"
                          onClick={() => dismissPreviewToolErrors(activePreviewId)}
                          type="button"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ) : null}
                    </div>

                    <div className="flex min-h-0 flex-col gap-3">
                      <VisualComparisonPanel
                        onRefresh={() => {
                          void refreshVisualDiff(activePreviewId);
                        }}
                        referenceImageUrl={imageDataUrl}
                        visualState={activePreviewVisualDiff}
                      />
                      <div className="rounded-[1rem] border border-(--line) bg-(--panel) p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                          Agent trace
                        </p>
                        <div className="mt-3 max-h-[34rem] overflow-auto pr-1">
                          <TraceTimeline
                            events={readTraceEvents(activePreviewResult.stats).slice().reverse()}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* ── Prompt modal ─────────────────────────────────────────────────── */}
      {isPromptModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => setIsPromptModalOpen(false)}
        >
          <div
            className="modal-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-(--line) px-6 py-4">
              <h2 className="text-sm font-semibold tracking-[-0.02em]">
                Edit prompt
              </h2>
              <button
                className="rounded-full bg-(--foreground) px-4 py-1.5 text-xs font-semibold text-(--background) transition hover:opacity-90"
                onClick={() => setIsPromptModalOpen(false)}
                type="button"
              >
                Done
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <textarea
                className="min-h-80 w-full resize-none bg-transparent text-sm leading-7 text-(--foreground) outline-none"
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Tell the models what kind of build guidance you want."
                value={prompt}
              />
            </div>
            <div className="shrink-0 border-t border-(--line) px-6 py-3">
              <p className="text-xs text-(--muted)">
                {prompt.length.toLocaleString()} characters
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        type="file"
      />
    </main>
  );
}
