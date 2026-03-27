"use client";

import Image from "next/image";
import {
  type CSSProperties,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { authClient } from "@/lib/auth-client";
import {
  DEFAULT_MODELS,
  DEFAULT_PROMPT,
  getModelConfig,
  getModelLabel,
  parseModelConfig,
  toCompareModel,
} from "@/lib/models";
import type {
  AgenticOptions,
  CompareModel,
  GatewayModel,
  ModelResult,
  SavedRun,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_RUNS = 20;
const LOCAL_DRAFT_KEY = "build-off:draft:v1";
const LOCAL_RECENT_MODELS_KEY = "build-off:recent-models:v1";
const MIN_MODEL_CARDS = 2;
const MAX_MODEL_CARDS = 12;
const RECENT_MODEL_LIMIT = 24;

type OutputMode = "preview" | "raw";
type CardSize = "s" | "m" | "l" | "xl";
type ModelCardModeKey = "standard" | "agentic";

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

type ModelCardWorkspaceState = {
  activeRunId: string | null;
  selectedModels: CompareModel[];
  results: ModelResult[];
  agenticActivity: Record<string, AgenticCardState>;
  previewErrors: Record<string, string[]>;
  previewToolErrors: Record<string, string[]>;
  previewOverrides: Record<string, string>;
};

const DEFAULT_AGENTIC_OPTIONS: AgenticOptions = {
  enabled: false,
  maxTurns: 4,
  todoListTool: false,
};

const TOOL_LABELS: Record<string, string> = {
  get_screenshot: "Screenshot",
  get_html: "Read HTML",
  set_html: "Set HTML",
  get_console_logs: "Console logs",
  todo_list: "Todo list",
};

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

function getRunImageSrc(run: SavedRun) {
  return run.imageDataUrl || run.imageUrl || "";
}

function createEmptyResult(model: CompareModel): ModelResult {
  return {
    modelId: model.id,
    label: model.label,
    text: "",
    status: "idle",
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
  };
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function groupModelsByProvider(models: GatewayModel[]) {
  return models.reduce<Record<string, GatewayModel[]>>((groups, model) => {
    const key = `${getModelSourceLabel(model)} / ${model.ownedBy}`;
    groups[key] ??= [];
    groups[key].push(model);
    return groups;
  }, {});
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

function getVisionModels(catalog: GatewayModel[]) {
  return catalog.filter((model) => model.supportsImageInput);
}

function getMaxSelectableModelCards(catalog: GatewayModel[]) {
  if (!catalog.length) return MAX_MODEL_CARDS;
  return Math.min(MAX_MODEL_CARDS, getVisionModels(catalog).length);
}

function getMinSelectableModelCards(catalog: GatewayModel[]) {
  if (!catalog.length) return MIN_MODEL_CARDS;
  return Math.min(
    MIN_MODEL_CARDS,
    Math.max(1, getMaxSelectableModelCards(catalog)),
  );
}

function getPreferredAvailableModels(
  catalog: GatewayModel[],
  selectedConfigs: string[],
  count: number,
  recentConfigs: string[],
) {
  if (count <= 0) return [];

  const usedConfigs = new Set(selectedConfigs);
  const visionModels = getVisionModels(catalog);
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
  return markup.replace(
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
}

function createPreviewSrcDoc(markup: string, previewId: string) {
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

      return {
        dataUrl: canvas.toDataURL("image/png"),
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

function formatRatePerMillion(value?: number) {
  if (value == null) return "—";

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value * 1_000_000 >= 1 ? 2 : 4,
    maximumFractionDigits: value * 1_000_000 >= 1 ? 2 : 4,
  }).format(value * 1_000_000);
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
}) {
  return user.name?.trim() || user.email?.trim() || "Signed in user";
}

function getUserMonogram(user: {
  name?: string | null;
  email?: string | null;
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
  selectedModels,
  recentModelConfigs,
  onSelect,
  onOpenChange,
  variant = "default",
}: ModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedCatalogModel =
    catalog.find((model) => model.config === getModelConfig(value)) ?? null;
  const filteredModels = catalog.filter(
    (model) => model.supportsImageInput && modelMatchesQuery(model, query),
  );
  const filteredGroups = groupModelsByProvider(filteredModels);
  const selectedProvider = selectedCatalogModel
    ? getModelSourceLabel(selectedCatalogModel)
    : getModelSourceLabel(value);
  const selectedProviderTone = getProviderTone(selectedProvider);
  const selectedConfigs = new Set(selectedModels.map((model) => getModelConfig(model)));
  const triggerClassName =
    variant === "header"
      ? "min-w-0 flex-1 rounded-[1rem] border px-3 py-2.5 text-left transition hover:bg-(--card-active)"
      : "w-full rounded-[1rem] border px-3 py-3 text-left transition hover:bg-(--card-active)";

  useEffect(() => {
    if (!isOpen) return;

    searchRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || variant !== "header") return;

    const root = rootRef.current;
    const card = root?.closest(".build-card");
    if (!(root instanceof HTMLElement) || !(card instanceof HTMLElement)) return;

    const updateDropdownGeometry = () => {
      const rootRect = root.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();

      setDropdownStyle({
        left: `${cardRect.left - rootRect.left}px`,
        width: `${cardRect.width}px`,
      });
    };

    const frameId = window.requestAnimationFrame(updateDropdownGeometry);

    const resizeObserver = new ResizeObserver(updateDropdownGeometry);
    resizeObserver.observe(root);
    resizeObserver.observe(card);
    window.addEventListener("resize", updateDropdownGeometry);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateDropdownGeometry);
    };
  }, [isOpen, variant]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setQuery("");
        setIsOpen(false);
        onOpenChange?.(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setQuery("");
        setIsOpen(false);
        onOpenChange?.(false);
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
    <div className={cn("relative", isOpen && "z-40")} ref={rootRef}>
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
            onOpenChange?.(next);
            return next;
          })
        }
        type="button"
      >
        <span className="block truncate text-sm font-medium">
          {selectedCatalogModel ? getModelLabel(selectedCatalogModel.id) : value.label}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-(--muted)">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 font-semibold uppercase tracking-[0.14em]",
              selectedProviderTone.chip,
            )}
          >
            {selectedProvider}
          </span>
          <span className="truncate">
            {selectedCatalogModel
              ? `${selectedCatalogModel.ownedBy} · ${selectedCatalogModel.releasedAt ? `Released ${formatMonthYear(selectedCatalogModel.releasedAt)}` : selectedCatalogModel.id}`
              : value.id}
          </span>
        </span>
      </button>

      {isOpen ? (
        <div
          className="absolute z-[90] mt-2 w-full overflow-hidden rounded-[1.2rem] border border-(--line) bg-(--panel) shadow-[0_24px_80px_color-mix(in_oklch,var(--foreground)_18%,transparent)] backdrop-blur-xl"
          style={dropdownStyle}
        >
          <div className="sticky top-0 z-10 border-b border-(--line) bg-(--panel-strong) p-3">
            <input
              ref={searchRef}
              className="w-full rounded-[0.9rem] border border-(--line) bg-(--card) px-3 py-2 text-sm outline-none transition focus:border-(--foreground)"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name, provider, id, or tag"
              value={query}
            />
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {Object.keys(filteredGroups).length ? (
              Object.entries(filteredGroups).map(([provider, models]) => (
                <div className="mb-2 last:mb-0" key={provider}>
                  <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-(--muted)">
                    {provider}
                  </p>
                  <div className="space-y-1">
                    {models.map((entry) => {
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
                                {isSelectedElsewhere ? (
                                  <span className="rounded-full border border-(--line) px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-(--muted)">
                                    In use
                                  </span>
                                ) : null}
                              </span>
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-(--muted)",
                                providerTone.meta,
                              )}
                            >
                              {formatMonthYear(entry.releasedAt)}
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
  const previewMarkup = isStreaming ? deferredMarkup : normalizedMarkup;

  return (
    <iframe
      className={cn(
        "h-full w-full bg-white",
        !interactive && "pointer-events-none",
      )}
      ref={iframeRef}
      sandbox="allow-scripts"
      srcDoc={createPreviewSrcDoc(previewMarkup, previewId)}
      tabIndex={interactive ? 0 : -1}
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

export function BuildOffClient() {
  const { data: sessionData, isPending: isSessionPending } =
    authClient.useSession();
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
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [modelsError, setModelsError] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [cardSize, setCardSize] = useState<CardSize>("m");
  const [freshModelIds, setFreshModelIds] = useState<string[]>([]);
  const [recentModelConfigs, setRecentModelConfigs] = useState<string[]>([]);
  const [openPickerIndex, setOpenPickerIndex] = useState<number | null>(null);
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [isAuthActionPending, setIsAuthActionPending] = useState(false);
  const [authError, setAuthError] = useState("");
  const [outputMode, setOutputMode] = useState<OutputMode>("preview");
  const [previewErrors, setPreviewErrors] = useState<Record<string, string[]>>(
    {},
  );
  const [previewToolErrors, setPreviewToolErrors] = useState<
    Record<string, string[]>
  >({});
  const [previewOverrides, setPreviewOverrides] = useState<
    Record<string, string>
  >({});
  const [agenticOptions, setAgenticOptions] = useState<AgenticOptions>(
    DEFAULT_AGENTIC_OPTIONS,
  );
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
  const previewFrameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
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
  const restoredDraftRef = useRef(false);
  const pendingDraftModelConfigsByModeRef = useRef<
    Partial<Record<ModelCardModeKey, string[]>> | null
  >(null);
  const pendingDraftModeKeyRef = useRef<ModelCardModeKey>("standard");
  const signedInUser = sessionData?.user ?? null;
  const signedInUserId = signedInUser?.id ?? null;
  const currentModelCardModeKey = getModelCardModeKey(agenticOptions.enabled);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    previewOverridesRef.current = previewOverrides;
  }, [previewOverrides]);

  function buildCurrentModelCardWorkspaceState(): ModelCardWorkspaceState {
    return {
      activeRunId,
      selectedModels,
      results,
      agenticActivity,
      previewErrors,
      previewToolErrors,
      previewOverrides,
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
  }

  function handleToggleAgenticMode() {
    const currentModeKey = getModelCardModeKey(agenticOptions.enabled);
    const nextModeKey =
      currentModeKey === "agentic" ? "standard" : "agentic";
    const currentWorkspaceState = buildCurrentModelCardWorkspaceState();
    const nextWorkspaceState = modelCardStatesByMode[nextModeKey];

    setModelCardStatesByMode((current) => ({
      ...current,
      [currentModeKey]: currentWorkspaceState,
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

      if (
        options?.hydrateLatest &&
        serverRuns.length &&
        !restoredDraftRef.current
      ) {
        const first = serverRuns[0];
        setActiveRunId(first.id);
        setPrompt(first.prompt);
        setImageDataUrl(getRunImageSrc(first));
        setImageName(first.imageName);
        setSelectedModels(first.models);
        setResults(first.results);
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

  useEffect(() => {
    try {
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
          maxTurns: Math.max(
            1,
            Math.min(
              8,
              Math.round(
                draft.agenticOptions.maxTurns ??
                  DEFAULT_AGENTIC_OPTIONS.maxTurns,
              ),
            ),
          ),
        };
        pendingDraftModeKeyRef.current = getModelCardModeKey(
          nextAgenticOptions.enabled,
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
    }
  }, []);

  useEffect(() => {
    if (isSessionPending) return;

    if (!signedInUserId) {
      setRuns([]);
      setRunsError("");
      setIsLoadingRuns(false);
      return;
    }

    loadRunsForCurrentSession({ hydrateLatest: true });
  }, [isSessionPending, signedInUserId]);

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

        const resolveDraftModels = (configs?: string[]) =>
          (configs ?? [])
            .map((config) =>
              nextCatalog.find((model) => model.config === config),
            )
            .filter(
              (model): model is GatewayModel =>
                model != null && model.supportsImageInput,
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
          ),
          agentic: resolveDraftModels(
            pendingDraftModelConfigsByModeRef.current?.agentic,
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

  useEffect(() => {
    if (!catalog.length) return;

    const minCards = getMinSelectableModelCards(catalog);
    const maxCards = getMaxSelectableModelCards(catalog);

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
    ).map(toCompareModel);

    if (!additions.length) return;

    setSelectedModels((current) => [...current, ...additions]);
    setResults((current) => [...current, ...additions.map(createEmptyResult)]);
  }, [catalog, recentModelConfigs, selectedModels]);

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
      };
    }

    if (event.type === "replace-output") {
      return {
        ...result,
        text: "",
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
    setErrorMessage("");
  }

  function hydrateRun(run: SavedRun) {
    setActiveRunId(run.id);
    setPrompt(run.prompt);
    setImageDataUrl(getRunImageSrc(run));
    setImageName(run.imageName);
    setSelectedModels(run.models);
    setResults(run.results);
    setAgenticActivity({});
    setPreviewErrors({});
    setPreviewToolErrors({});
    setPreviewOverrides({});
    setErrorMessage("");
    setIsHistoryOpen(false);
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
    if (!nextModel || !nextModel.supportsImageInput) return;

    setRecentModelConfigs((current) =>
      mergeRecentModelConfigs(current, [nextModel.config]),
    );
    setSelectedModels((current) =>
      current.map((model, currentIndex) =>
        currentIndex === index ? toCompareModel(nextModel) : model,
      ),
    );
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
    const minCards = getMinSelectableModelCards(catalog);
    const maxCards = getMaxSelectableModelCards(catalog);
    const clampedCount = Math.max(minCards, Math.min(maxCards, nextCount));

    if (clampedCount === selectedModels.length) return;

    if (clampedCount > selectedModels.length) {
      const additions = getPreferredAvailableModels(
        catalog,
        selectedModels.map((model) => getModelConfig(model)),
        clampedCount - selectedModels.length,
        recentModelConfigs,
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
    if (selectedModels.length <= getMinSelectableModelCards(catalog)) return;

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

  async function handleSignOut() {
    setAuthError("");
    setIsAuthActionPending(true);

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

  async function handleCompare() {
    if (!signedInUser) {
      setErrorMessage("Sign in with GitHub to run a build-off.");
      return;
    }

    if (!imageDataUrl) {
      setErrorMessage("Add a screenshot first.");
      return;
    }

    const minCards = getMinSelectableModelCards(catalog);
    const maxCards = getMaxSelectableModelCards(catalog);

    if (selectedModels.length < minCards || selectedModels.length > maxCards) {
      setErrorMessage(`Choose between ${minCards} and ${maxCards} models.`);
      return;
    }

    const unsupported = selectedModels.find((model) => {
      const match = catalog.find((item) => item.config === getModelConfig(model));
      return match ? !match.supportsImageInput : false;
    });

    if (unsupported) {
      setErrorMessage(
        `${unsupported.label} does not support screenshot input in the Gateway catalog.`,
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
      models: modelsForRun,
      results: baseResults,
    };

    setActiveRunId(runId);
    setResults(baseResults);
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
    setErrorMessage("");
    setIsHistoryOpen(false);
    setIsRunning(true);
    persistRun(run);

    void (async () => {
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
            if (event.type === "tool-call") {
              void handleToolCallEvent(event);
            }
            if (
              (event.type === "start" || event.type === "replace-output") &&
              typeof event.modelId === "string"
            ) {
              const modelId = event.modelId;
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
            setAgenticActivity((current) =>
              applyEventToAgenticState(current, event),
            );
            setResults((current) =>
              current.map((item) => applyEventToResult(item, event)),
            );
            updateRun(runId, (existing) => ({
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

          updateRun(runId, (existing) => ({
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

  const maxSelectableCards = getMaxSelectableModelCards(catalog);
  const minSelectableCards = getMinSelectableModelCards(catalog);
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
    setResults(createEmptyResults(selectedModels));
    setErrorMessage("");
    setAgenticActivity({});
    setPreviewErrors({});
    setPreviewToolErrors({});
    setPreviewOverrides({});
    setActiveRunId(null);
    setOpenPickerIndex(null);
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
      render: (result) => formatTokenCount(result.usage?.outputTokens),
    },
    {
      label: "Total",
      render: (result) => formatTokenCount(result.usage?.totalTokens),
    },
    { label: "Cost", render: (result) => formatCost(result.costs?.total) },
    { label: "Finish", render: (result) => result.finishReason ?? "—" },
  ];

  if (isSessionPending) {
    return (
      <main className="relative min-h-screen [overflow-x:clip] px-4 py-6 text-(--foreground) sm:px-6 lg:px-8">
        <div className="grain" />

        <section className="mx-auto flex min-h-[70vh] w-full max-w-4xl items-center justify-center">
          <div className="panel rise-in w-full rounded-[2rem] p-8 text-center sm:p-10">
            <p className="eyebrow-label text-xs font-semibold uppercase tracking-[0.35em]">
              Visual Eval Harness
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em]">
              Checking your session
            </h1>
            <p className="mt-3 text-sm text-(--muted)">
              Loading Better Auth so we can restore your saved build-off
              workspace.
            </p>
          </div>
        </section>
      </main>
    );
  }

  if (!signedInUser) {
    return (
      <main className="relative min-h-screen [overflow-x:clip] px-4 py-6 text-(--foreground) sm:px-6 lg:px-8">
        <div className="grain" />

        <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
          <header className="glass-shell rise-in rounded-[2rem] px-5 py-5 sm:px-7 sm:py-6">
            <p className="eyebrow-label text-xs font-semibold uppercase tracking-[0.35em]">
              Visual Eval Harness
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">
              Sign in to save and compare build-off runs
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-(--muted) sm:text-base">
              GitHub OAuth is now wired through Better Auth. Once you sign in,
              run history stays tied to your account instead of mixing together
              across the whole app.
            </p>
          </header>

          <section className="panel rise-in rounded-[2rem] p-6 sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-(--muted)">
                  Authentication
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
                  Continue with GitHub
                </h2>
                <p className="mt-3 text-sm leading-6 text-(--muted)">
                  Your local draft still stays in the browser, but
                  database-backed runs and new comparisons are only available
                  after sign-in.
                </p>
              </div>

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
      <header className="glass-shell floating-nav rise-in mx-auto flex max-w-[1600px] items-center gap-2 rounded-[3rem] px-3 py-1.5 sm:gap-3 sm:px-4">
        {/* Brand */}
        <div className="flex shrink-0 items-center gap-2.5 pl-1">
          <h1 className="text-sm font-semibold tracking-[-0.02em]">
            LLM Build-Off
          </h1>
          <span
            aria-hidden="true"
            className="h-3.5 w-px bg-(--foreground) opacity-20"
          />
          <span className="eyebrow-label hidden text-[11px] font-medium uppercase sm:block">
            Eval Harness
          </span>
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

          {/* Preview / Raw toggle */}
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
            {isAuthActionPending ? "Signing out…" : "Sign out"}
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
                  Models get one draft turn, then can inspect the live iframe via
                  `get_screenshot` and `get_console_logs` before revising.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,220px)]">
                <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-(--muted)">
                  <span>Max turns</span>
                  <input
                    className="rounded-[1rem] border border-(--line) bg-(--card) px-3 py-2 text-sm font-medium tracking-normal text-(--foreground) outline-none transition focus:border-(--accent)"
                    max={8}
                    min={1}
                    onChange={(event) =>
                      setAgenticOptions((current) => ({
                        ...current,
                        maxTurns: Math.max(
                          1,
                          Math.min(8, Number(event.target.value) || 1),
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
                  onClick={() => {
                    hydrateRun(run);
                    setIsHistoryOpen(false);
                  }}
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
                className="relative w-full overflow-hidden rounded-b-[1.75rem]"
                style={{ height: cardSizeConfig.referenceHeight }}
              >
                <Image
                  alt="Reference screenshot"
                  className="object-cover"
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
          const catalogModel =
            catalog.find((entry) => entry.config === getModelConfig(model)) ?? null;
          const previewId = `${model.id}-${index}`;
          const cardAgenticState = agenticActivity[model.id];
          const cardPreviewErrors = previewErrors[previewId] ?? [];
          const cardPreviewToolErrors = previewToolErrors[previewId] ?? [];
          const effectivePreviewMarkup = previewOverrides[model.id] ?? result?.text ?? "";
          const hasHtml = looksLikeHtml(
            unwrapHtmlCodeFence(effectivePreviewMarkup),
          );
          const isDragged = dragSourceIndex === index;
          const isDragTarget =
            dragOverIndex === index && dragSourceIndex !== index;
          const isFresh = freshModelIds.includes(model.id);

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
                    catalog={catalog}
                    disabled={isLoadingModels}
                    onOpenChange={(isOpen) =>
                      setOpenPickerIndex((current) =>
                        isOpen ? index : current === index ? null : current,
                      )
                    }
                    onSelect={(modelId) => handleModelChange(index, modelId)}
                    recentModelConfigs={recentModelConfigs}
                    selectedModels={selectedModels}
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
                  </div>
                ) : null}

                {result?.text || previewOverrides[model.id] ? (
                  outputMode === "preview" ? (
                    <div className="flex flex-col gap-2 p-3">
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
                      <OutputViewport
                        className="overflow-hidden rounded-[1.2rem] border border-(--line) bg-white"
                        contentClassName="overflow-hidden"
                        contentStyle={cardViewportStyle}
                        title={`${result.label} preview`}
                      >
                        <div className="relative h-full w-full">
                          <LiveHtmlPreview
                            iframeRef={(element) => {
                              previewFrameRefs.current[previewId] = element;
                            }}
                            isStreaming={result.status === "streaming"}
                            markup={result.text}
                            overrideMarkup={previewOverrides[model.id]}
                            previewId={previewId}
                            title={`${result.label} preview`}
                          />
                          {cardPreviewToolErrors.length ? (
                            <div className="absolute inset-4 z-20 flex items-start justify-center">
                              <div className="w-full max-w-xl rounded-[1.1rem] border border-[color-mix(in_oklch,var(--danger)_42%,transparent)] bg-[color-mix(in_oklch,white_72%,var(--danger)_10%)] p-3 text-sm text-(--foreground) shadow-[0_20px_60px_color-mix(in_oklch,var(--danger)_18%,transparent)] backdrop-blur-md">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--danger)">
                                      Tool call failed
                                    </p>
                                    <div className="mt-2 space-y-2 text-sm leading-6 text-[color-mix(in_oklch,var(--foreground)_88%,black)]">
                                      {cardPreviewToolErrors.map((msg, i) => (
                                        <p key={`${previewId}-tool-err-${i}`}>
                                          {msg}
                                        </p>
                                      ))}
                                    </div>
                                  </div>
                                  <button
                                    className="shrink-0 rounded-full border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] bg-white/70 px-3 py-1 text-xs font-medium text-(--danger) transition hover:bg-white"
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
                  ) : (
                    <div className="p-3">
                      <OutputViewport
                        className="overflow-hidden rounded-[1.2rem] border border-(--line) bg-(--card)"
                        contentClassName="overflow-auto px-4 py-4"
                        contentStyle={cardViewportStyle}
                        title={`${result.label} raw`}
                      >
                        <pre className="m-0 whitespace-pre-wrap break-words text-[13px] font-[450] leading-7">
                          {result.text}
                        </pre>
                      </OutputViewport>
                    </div>
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
                  {result.usage?.outputTokens != null ? (
                    <span>
                      Out{" "}
                      <strong className="font-semibold text-(--foreground)">
                        {formatTokenCount(result.usage.outputTokens)}
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
