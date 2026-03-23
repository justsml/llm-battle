"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { DEFAULT_MODELS, DEFAULT_PROMPT, toCompareModel } from "@/lib/models";
import type { CompareModel, GatewayModel, ModelResult, SavedRun } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_RUNS = 20;
const LOCAL_DRAFT_KEY = "build-off:draft:v1";
const MIN_MODEL_CARDS = 2;
const MAX_MODEL_CARDS = 12;

type OutputMode = "preview" | "raw";

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
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
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
      return "text-[var(--accent)]";
    case "done":
      return "text-[var(--success)]";
    case "error":
      return "text-[var(--danger)]";
    default:
      return "text-[var(--muted)]";
  }
}

function syncModelLabels(models: CompareModel[], catalog: GatewayModel[]) {
  return models.map((model) => {
    const match = catalog.find((item) => item.id === model.id);
    return match ? { ...model, label: match.name } : model;
  });
}

function groupModelsByProvider(models: GatewayModel[]) {
  return models.reduce<Record<string, GatewayModel[]>>((groups, model) => {
    const key = model.ownedBy;
    groups[key] ??= [];
    groups[key].push(model);
    return groups;
  }, {});
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
  return Math.min(MIN_MODEL_CARDS, Math.max(1, getMaxSelectableModelCards(catalog)));
}

function getNextAvailableModels(catalog: GatewayModel[], selectedIds: string[], count: number) {
  if (count <= 0) return [];

  const usedIds = new Set(selectedIds);
  const nextModels: GatewayModel[] = [];

  for (const model of getVisionModels(catalog)) {
    if (usedIds.has(model.id)) continue;
    nextModels.push(model);
    usedIds.add(model.id);

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

function createPreviewSrcDoc(markup: string, previewId: string) {
  const previewBridge = `
<script>
(() => {
  const previewId = ${JSON.stringify(previewId)};
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

  send("clear", "");

  window.addEventListener("error", (event) => {
    send("error", event.message || "Runtime error while rendering preview.");
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    send(
      "error",
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection while rendering preview.",
    );
  });
})();
</script>`;

  const previewBase = `
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; min-height: 100%; background: white; }
</style>`;

  if (!looksLikeHtmlDocument(markup)) {
    return `<!DOCTYPE html><html><head>${previewBase}${previewBridge}</head><body>${markup}</body></html>`;
  }

  if (/<head[\s>]/i.test(markup)) {
    return markup.replace(/<head([^>]*)>/i, `<head$1>${previewBase}${previewBridge}`);
  }

  if (/<html[\s>]/i.test(markup)) {
    return markup.replace(/<html([^>]*)>/i, `<html$1><head>${previewBase}${previewBridge}</head>`);
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

function formatTokenCount(value?: number) {
  if (value == null) return "—";
  return new Intl.NumberFormat().format(value);
}

function formatCompactTokenCount(value?: number) {
  if (value == null) return "—";

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  }

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
  index: number;
  value: CompareModel;
  catalog: GatewayModel[];
  disabled: boolean;
  selectedModels: CompareModel[];
  onSelect: (modelId: string) => void;
};

function ModelPicker({ index, value, catalog, disabled, selectedModels, onSelect }: ModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedCatalogModel = catalog.find((model) => model.id === value.id) ?? null;
  const filteredModels = catalog.filter((model) => modelMatchesQuery(model, query));
  const filteredGroups = groupModelsByProvider(filteredModels);

  useEffect(() => {
    if (!isOpen) return;

    searchRef.current?.focus();
  }, [isOpen]);

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
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <button
        className="w-full rounded-[1rem] border border-[var(--line)] bg-[var(--panel)] px-3 py-3 text-left transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
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
        <span className="block text-sm font-medium">{selectedCatalogModel?.name ?? value.label}</span>
        <span className="mt-1 block truncate text-xs text-[var(--muted)]">
          {selectedCatalogModel?.ownedBy ?? "Unknown provider"} · {value.id}
        </span>
      </button>

      {isOpen ? (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-[1.2rem] border border-[var(--line)] bg-[color:color-mix(in_oklch,var(--panel)_94%,white)] shadow-[0_20px_60px_color-mix(in_oklch,var(--foreground)_15%,transparent)] backdrop-blur-xl">
          <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[color:color-mix(in_oklch,var(--panel)_96%,white)] p-3">
            <input
              ref={searchRef}
              className="w-full rounded-[0.9rem] border border-[var(--line)] bg-white/90 px-3 py-2 text-sm outline-none transition focus:border-[var(--foreground)]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name, provider, id, or tag"
              value={query}
            />
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {Object.keys(filteredGroups).length ? (
              Object.entries(filteredGroups).map(([provider, models]) => (
                <div className="mb-2 last:mb-0" key={provider}>
                  <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                    {provider}
                  </p>
                  <div className="space-y-1">
                    {models.map((entry) => {
                      const isSelectedElsewhere = selectedModels.some(
                        (selectedModel, selectedIndex) =>
                          selectedIndex !== index && selectedModel.id === entry.id,
                      );
                      const isDisabled = !entry.supportsImageInput || isSelectedElsewhere;

                      return (
                        <button
                          className={cn(
                            "w-full rounded-[1rem] border px-3 py-2 text-left transition",
                            entry.id === value.id
                              ? "border-[var(--foreground)] bg-white"
                              : "border-[var(--line)] bg-white/55 hover:bg-white",
                            isDisabled && "cursor-not-allowed opacity-50",
                          )}
                          disabled={isDisabled}
                          key={entry.id}
                          onClick={() => {
                            onSelect(entry.id);
                            setQuery("");
                            setIsOpen(false);
                          }}
                          type="button"
                        >
                          <span className="block text-sm font-medium">{entry.name}</span>
                          <span className="mt-1 block text-xs text-[var(--muted)]">
                            {entry.id}
                            {!entry.supportsImageInput ? " · no image input" : ""}
                            {isSelectedElsewhere ? " · already selected" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                No models matched that filter.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function BuildOffClient() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageName, setImageName] = useState("Paste or upload a screenshot");
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [selectedModels, setSelectedModels] = useState<CompareModel[]>(DEFAULT_MODELS);
  const [catalog, setCatalog] = useState<GatewayModel[]>([]);
  const [results, setResults] = useState<ModelResult[]>(createEmptyResults(DEFAULT_MODELS));
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [modelsError, setModelsError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [outputMode, setOutputMode] = useState<OutputMode>("preview");
  const [previewErrors, setPreviewErrors] = useState<Record<string, string[]>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoredDraftRef = useRef(false);
  const pendingDraftModelIdsRef = useRef<string[] | null>(null);

  useEffect(() => {
    try {
      const rawDraft = window.localStorage.getItem(LOCAL_DRAFT_KEY);
      if (!rawDraft) return;

      const draft = JSON.parse(rawDraft) as {
        prompt?: string;
        imageDataUrl?: string;
        imageName?: string;
        selectedModelIds?: string[];
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

      if (Array.isArray(draft.selectedModelIds) && draft.selectedModelIds.length) {
        pendingDraftModelIdsRef.current = draft.selectedModelIds;
        restoredDraftRef.current = true;
      }
    } catch {
      // Ignore malformed local draft state.
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/runs");
        if (!response.ok) return;

        const payload = (await response.json()) as { runs?: SavedRun[] };
        const serverRuns = payload.runs ?? [];

        if (serverRuns.length) {
          setRuns(serverRuns);

          if (!restoredDraftRef.current) {
            const first = serverRuns[0];
            setActiveRunId(first.id);
            setPrompt(first.prompt);
            setImageDataUrl(getRunImageSrc(first));
            setImageName(first.imageName);
            setSelectedModels(first.models);
            setResults(first.results);
          }
        }
      } catch {
        // Server history unavailable — start fresh
      }
    })();
  }, []);

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
        const selectedFromDraft =
          pendingDraftModelIdsRef.current
            ?.map((modelId) => nextCatalog.find((model) => model.id === modelId))
            .filter((model): model is GatewayModel => model != null && model.supportsImageInput)
            .filter(
              (model, index, models) => models.findIndex((entry) => entry.id === model.id) === index,
            ) ?? [];

        if (selectedFromDraft.length) {
          const nextModels = selectedFromDraft.map(toCompareModel);
          setActiveRunId(null);
          setSelectedModels(nextModels);
          setResults(createEmptyResults(nextModels));
        } else {
          setSelectedModels((current) => syncModelLabels(current, nextCatalog));
          setResults((current) =>
            current.map((result) => {
              const match = nextCatalog.find((model) => model.id === result.modelId);
              return match ? { ...result, label: match.name } : result;
            }),
          );
        }

        setRuns((current) =>
          current.map((run) => ({
            ...run,
            models: syncModelLabels(run.models, nextCatalog),
            results: run.results.map((result) => {
              const match = nextCatalog.find((model) => model.id === result.modelId);
              return match ? { ...result, label: match.name } : result;
            }),
          })),
        );
        pendingDraftModelIdsRef.current = null;
        setModelsError("");
      } catch (error) {
        setModelsError(
          error instanceof Error ? error.message : "Unable to load Vercel AI Gateway models.",
        );
      } finally {
        setIsLoadingModels(false);
      }
    })();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        LOCAL_DRAFT_KEY,
        JSON.stringify({
          prompt,
          imageDataUrl,
          imageName,
          selectedModelIds: selectedModels.map((model) => model.id),
        }),
      );
    } catch {
      // Ignore unavailable localStorage.
    }
  }, [imageDataUrl, imageName, prompt, selectedModels]);

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

      if (data.kind === "error" && typeof data.message === "string" && data.message.trim()) {
        setPreviewErrors((current) => {
          const existing = current[data.previewId] ?? [];
          if (existing.includes(data.message)) return current;

          return {
            ...current,
            [data.previewId]: [...existing, data.message],
          };
        });
      }
    }

    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, []);

  useEffect(() => {
    if (!catalog.length) return;

    const minCards = getMinSelectableModelCards(catalog);
    const maxCards = getMaxSelectableModelCards(catalog);

    if (selectedModels.length >= minCards && selectedModels.length <= maxCards) {
      return;
    }

    if (selectedModels.length > maxCards) {
      setSelectedModels((current) => current.slice(0, maxCards));
      setResults((current) => current.slice(0, maxCards));
      return;
    }

    const additions = getNextAvailableModels(
      catalog,
      selectedModels.map((model) => model.id),
      minCards - selectedModels.length,
    ).map(toCompareModel);

    if (!additions.length) return;

    setSelectedModels((current) => [...current, ...additions]);
    setResults((current) => [...current, ...additions.map(createEmptyResult)]);
  }, [catalog, selectedModels]);

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
    setRuns((current) => current.map((run) => (run.id === runId ? updater(run) : run)));
  }

  function applyEventToResult(result: ModelResult, event: Record<string, unknown>) {
    if (result.modelId !== event.modelId) return result;

    if (event.type === "start") {
      return {
        ...result,
        status: "streaming" as const,
        startedAt: typeof event.startedAt === "string" ? event.startedAt : undefined,
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
        text: result.text + (typeof event.delta === "string" ? event.delta : ""),
        status: "streaming" as const,
        firstTokenAt:
          result.firstTokenAt ?? (typeof event.firstTokenAt === "string" ? event.firstTokenAt : undefined),
        latencyMs:
          result.latencyMs ?? (typeof event.latencyMs === "number" ? event.latencyMs : undefined),
      };
    }

    if (event.type === "done") {
      return {
        ...result,
        status: "done" as const,
        completedAt: typeof event.completedAt === "string" ? event.completedAt : undefined,
        firstTokenAt:
          result.firstTokenAt ?? (typeof event.firstTokenAt === "string" ? event.firstTokenAt : undefined),
        latencyMs:
          result.latencyMs ?? (typeof event.latencyMs === "number" ? event.latencyMs : undefined),
        runtimeMs: typeof event.runtimeMs === "number" ? event.runtimeMs : result.runtimeMs,
        finishReason: typeof event.finishReason === "string" ? event.finishReason : result.finishReason,
        responseId: typeof event.responseId === "string" ? event.responseId : result.responseId,
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
        error: typeof event.error === "string" ? event.error : "Unexpected model error.",
        completedAt: typeof event.completedAt === "string" ? event.completedAt : undefined,
        firstTokenAt:
          result.firstTokenAt ?? (typeof event.firstTokenAt === "string" ? event.firstTokenAt : undefined),
        latencyMs:
          result.latencyMs ?? (typeof event.latencyMs === "number" ? event.latencyMs : undefined),
        runtimeMs: typeof event.runtimeMs === "number" ? event.runtimeMs : result.runtimeMs,
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
    setPreviewErrors({});
    setErrorMessage("");
  }

  function handleModelChange(index: number, nextModelId: string) {
    const nextModel = catalog.find((model) => model.id === nextModelId);
    if (!nextModel || !nextModel.supportsImageInput) return;

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
      const additions = getNextAvailableModels(
        catalog,
        selectedModels.map((model) => model.id),
        clampedCount - selectedModels.length,
      ).map(toCompareModel);

      if (!additions.length) return;

      setSelectedModels((current) => [...current, ...additions]);
      setResults((current) => [...current, ...additions.map(createEmptyResult)]);
    } else {
      setSelectedModels((current) => current.slice(0, clampedCount));
      setResults((current) => current.slice(0, clampedCount));
    }

    setErrorMessage("");
  }

  function handleRemovePanel(index: number) {
    if (selectedModels.length <= getMinSelectableModelCards(catalog)) return;

    setSelectedModels((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setResults((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setErrorMessage("");
  }

  async function handleCompare() {
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
      const match = catalog.find((item) => item.id === model.id);
      return match ? !match.supportsImageInput : false;
    });

    if (unsupported) {
      setErrorMessage(`${unsupported.label} does not support screenshot input in the Gateway catalog.`);
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
    setPreviewErrors({});
    setErrorMessage("");
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
          }),
        });

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
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
            setResults((current) => current.map((item) => applyEventToResult(item, event)));
            updateRun(runId, (existing) => ({
              ...existing,
              results: existing.results.map((item) => applyEventToResult(item, event)),
            }));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to compare right now.";
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

  const activeRun = runs.find((run) => run.id === activeRunId) ?? null;
  const maxSelectableCards = getMaxSelectableModelCards(catalog);
  const minSelectableCards = getMinSelectableModelCards(catalog);
  const canAddPanel = !isLoadingModels && selectedModels.length < maxSelectableCards;
  const canRemovePanel = selectedModels.length > minSelectableCards;

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-6 text-[var(--foreground)] sm:px-6 lg:px-8">
      <div className="grain" />

      <section className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="rise-in flex items-center rounded-[2rem] border border-white/40 bg-white/30 px-5 py-4 shadow-[0_8px_32px_color-mix(in_oklch,var(--foreground)_8%,transparent)] backdrop-blur-xl backdrop-saturate-150 sm:px-7 sm:py-5">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--muted)]">
            Visual Eval Harness
          </p>
        </header>

        <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="panel rise-in rounded-[2rem] p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                  Reference
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Screenshot + prompt</h2>
              </div>

              <div className="flex gap-2">
                <button
                  className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium transition hover:-translate-y-0.5 hover:bg-white"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  Upload image
                </button>
                <button
                  className="rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={isRunning}
                  onClick={handleCompare}
                  type="button"
                >
                  {isRunning ? "Comparing..." : "Run build-off"}
                </button>
              </div>
            </div>

            <input
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
              type="file"
            />

            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="overflow-hidden rounded-[1.6rem] border border-[var(--line)] bg-[var(--panel-strong)]">
                {imageDataUrl ? (
                  <div className="relative aspect-[4/3] h-full w-full">
                    <Image
                      alt="Reference upload"
                      className="object-cover"
                      fill
                      sizes="(max-width: 1024px) 100vw, 40vw"
                      src={imageDataUrl}
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center p-8 text-center text-sm text-[var(--muted)]">
                    Paste any screenshot from your clipboard, or upload one here.
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <div className="rounded-[1.6rem] border border-[var(--line)] bg-white/65 p-4">
                  <p className="text-sm font-medium text-[var(--muted)]">Image</p>
                  <p className="mt-1 truncate text-lg font-semibold">{imageName}</p>
                </div>

                <label className="flex flex-1 flex-col rounded-[1.6rem] border border-[var(--line)] bg-white/65 p-4">
                  <span className="mb-3 text-sm font-medium text-[var(--muted)]">Prompt</span>
                  <textarea
                    className="min-h-56 flex-1 resize-none bg-transparent text-sm leading-6 outline-none"
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Tell the models what kind of build guidance you want."
                    value={prompt}
                  />
                </label>

                {errorMessage ? (
                  <div className="rounded-[1.25rem] border border-[color:color-mix(in_oklch,var(--danger)_30%,white)] bg-[color:color-mix(in_oklch,var(--danger)_10%,white)] px-4 py-3 text-sm text-[color:color-mix(in_oklch,var(--danger)_85%,black)]">
                    {errorMessage}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <aside className="panel rise-in rounded-[2rem] p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                  Local Memory
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Recent runs</h2>
              </div>
              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
                {runs.length}/{MAX_RUNS}
              </span>
            </div>

            <div className="space-y-3">
              {runs.length ? (
                runs.map((run, index) => (
                  <button
                    key={run.id}
                    className={cn(
                      "w-full rounded-[1.4rem] border px-4 py-4 text-left transition hover:-translate-y-0.5 hover:bg-white/70",
                      activeRunId === run.id
                        ? "border-[var(--foreground)] bg-white"
                        : "border-[var(--line)] bg-white/45",
                    )}
                    onClick={() => hydrateRun(run)}
                    type="button"
                  >
                    <div className="mb-3 flex items-center justify-between gap-4">
                      <span className="text-sm font-semibold text-[var(--muted)]">Run {runs.length - index}</span>
                      <span className="text-xs text-[var(--muted)]">{formatTimestamp(run.createdAt)}</span>
                    </div>
                    <p className="line-clamp-2 text-sm leading-6">{run.prompt}</p>
                  </button>
                ))
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-[var(--line)] px-5 py-8 text-sm leading-6 text-[var(--muted)]">
                  Your completed comparisons land here automatically. The in-progress draft and lineup
                  also stick across refreshes on this device.
                </div>
              )}
            </div>

            {activeRun ? (
              <div className="mt-4 rounded-[1.5rem] border border-[var(--line)] bg-white/60 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Active lineup
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {activeRun.models.map((model) => (
                    <span
                      key={model.id}
                      className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-medium"
                    >
                      {model.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </section>

        <section className="panel rise-in rounded-[2rem] p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                Lineup
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Generation panels</h2>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center overflow-hidden rounded-full border border-[var(--line)] bg-white/65">
                <button
                  className="px-3 py-2 text-sm font-medium transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!canRemovePanel || isRunning}
                  onClick={() => handleTargetPanelCount(selectedModels.length - 1)}
                  type="button"
                >
                  -
                </button>
                <span className="min-w-24 px-3 text-center text-sm font-medium text-[var(--muted)]">
                  {selectedModels.length} cards
                </span>
                <button
                  className="px-3 py-2 text-sm font-medium transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!canAddPanel || isRunning}
                  onClick={() => handleTargetPanelCount(selectedModels.length + 1)}
                  type="button"
                >
                  +
                </button>
              </div>

              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
                2-12 target
              </span>
            </div>
          </div>

          <div className="mb-4 rounded-[1.4rem] border border-[var(--line)] bg-white/55 px-4 py-3 text-sm leading-6 text-[var(--muted)]">
            The dropdown lists the full Vercel AI Gateway catalog. Only vision-capable language
            models are selectable for screenshot comparisons, and the lineup supports 2-12 live cards.
          </div>

          {modelsError ? (
            <div className="mb-4 rounded-[1.25rem] border border-[color:color-mix(in_oklch,var(--danger)_30%,white)] bg-[color:color-mix(in_oklch,var(--danger)_10%,white)] px-4 py-3 text-sm text-[color:color-mix(in_oklch,var(--danger)_85%,black)]">
              {modelsError}
            </div>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-2">
            {selectedModels.map((model, index) => {
              const selectedCatalogModel = catalog.find((entry) => entry.id === model.id) ?? null;

              return (
                <div
                  key={`${model.id}-${index}`}
                  className="rounded-[1.5rem] border border-[var(--line)] bg-white/65 p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                        Panel {index + 1}
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted)]">{model.id}</p>
                    </div>

                    <button
                      className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={!canRemovePanel || isRunning}
                      onClick={() => handleRemovePanel(index)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium">Model</span>
                    <ModelPicker
                      catalog={catalog}
                      disabled={isLoadingModels || isRunning}
                      index={index}
                      onSelect={(modelId) => handleModelChange(index, modelId)}
                      selectedModels={selectedModels}
                      value={model}
                    />
                  </label>

                  {selectedCatalogModel ? (
                    <div className="mt-3 rounded-[1.1rem] border border-[var(--line)] bg-[color:color-mix(in_oklch,var(--accent-soft)_28%,white)] p-3">
                      <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">
                          {selectedCatalogModel.ownedBy}
                        </span>
                        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">
                          released {formatMonthYear(selectedCatalogModel.releasedAt)}
                        </span>
                        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">
                          context {formatCompactTokenCount(selectedCatalogModel.contextWindow)}
                        </span>
                        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">
                          max out {formatCompactTokenCount(selectedCatalogModel.maxTokens)}
                        </span>
                        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">
                          in {formatRatePerMillion(selectedCatalogModel.pricing.input)}/1M
                        </span>
                        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">
                          out {formatRatePerMillion(selectedCatalogModel.pricing.output)}/1M
                        </span>
                      </div>

                      {selectedCatalogModel.description ? (
                        <p className="mt-3 line-clamp-3 text-sm leading-6 text-[color:color-mix(in_oklch,var(--foreground)_82%,black)]">
                          {selectedCatalogModel.description}
                        </p>
                      ) : null}

                      {selectedCatalogModel.tags.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedCatalogModel.tags.slice(0, 6).map((tag) => (
                            <span
                              className="rounded-full bg-white/75 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]"
                              key={tag}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          <article className="panel rise-in rounded-[2rem] p-4 sm:p-5 md:col-span-2">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                  Live outputs
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
                  Streaming model responses
                </h2>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-2 text-sm text-[var(--muted)]">
                <span className="pulse-dot h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
                updates in real time
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[1.3rem] border border-[var(--line)] bg-white/55 px-4 py-3">
              <p className="text-sm leading-6 text-[var(--muted)]">
                Preview mode renders the streamed HTML artifact live. Raw mode shows the exact model output.
              </p>

              <div className="flex items-center overflow-hidden rounded-full border border-[var(--line)] bg-white">
                <button
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition",
                    outputMode === "preview"
                      ? "bg-[var(--foreground)] text-white"
                      : "text-[var(--muted)] hover:bg-white/80",
                  )}
                  onClick={() => setOutputMode("preview")}
                  type="button"
                >
                  HTML preview
                </button>
                <button
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition",
                    outputMode === "raw"
                      ? "bg-[var(--foreground)] text-white"
                      : "text-[var(--muted)] hover:bg-white/80",
                  )}
                  onClick={() => setOutputMode("raw")}
                  type="button"
                >
                  Raw output
                </button>
              </div>
            </div>

            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
            >
              {results.map((result, index) => {
                const previewId = `${result.modelId}-${index}`;
                const cardPreviewErrors = previewErrors[previewId] ?? [];
                const hasHtml = looksLikeHtml(result.text);

                return (
                  <section
                    key={previewId}
                    className="overflow-hidden rounded-[1.7rem] border border-[var(--line)] bg-[color:color-mix(in_oklch,var(--foreground)_2%,white)]"
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                  <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-4">
                    <div>
                      <h3 className="text-xl font-semibold tracking-[-0.04em]">{result.label}</h3>
                      <p className={cn("mt-1 text-sm font-medium", statusTone(result.status))}>
                        {result.status === "streaming" && "Streaming"}
                        {result.status === "done" && "Complete"}
                        {result.status === "error" && (result.error || "Error")}
                        {result.status === "idle" && "Waiting"}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
                        {result.modelId}
                      </span>
                    </div>
                  </div>

                  <div className="border-b border-[var(--line)] px-4 py-3">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-[1rem] border border-[var(--line)] bg-white/55 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                          Latency
                        </p>
                        <p className="mt-1 text-sm font-semibold">{formatDuration(result.latencyMs)}</p>
                      </div>
                      <div className="rounded-[1rem] border border-[var(--line)] bg-white/55 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                          Runtime
                        </p>
                        <p className="mt-1 text-sm font-semibold">{formatDuration(result.runtimeMs)}</p>
                      </div>
                      <div className="rounded-[1rem] border border-[var(--line)] bg-white/55 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                          Tokens
                        </p>
                        <p className="mt-1 text-sm font-semibold">
                          {formatTokenCount(result.usage?.totalTokens)}
                        </p>
                      </div>
                      <div className="rounded-[1rem] border border-[var(--line)] bg-white/55 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                          Cost
                        </p>
                        <p className="mt-1 text-sm font-semibold">{formatCost(result.costs?.total)}</p>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                      <span className="rounded-full border border-[var(--line)] px-2.5 py-1">
                        in {formatTokenCount(result.usage?.inputTokens)}
                      </span>
                      <span className="rounded-full border border-[var(--line)] px-2.5 py-1">
                        out {formatTokenCount(result.usage?.outputTokens)}
                      </span>
                      {result.usage?.reasoningTokens != null ? (
                        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">
                          reasoning {formatTokenCount(result.usage.reasoningTokens)}
                        </span>
                      ) : null}
                      {result.usage?.cacheReadTokens != null ? (
                        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">
                          cache read {formatTokenCount(result.usage.cacheReadTokens)}
                        </span>
                      ) : null}
                      {result.usage?.cacheWriteTokens != null ? (
                        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">
                          cache write {formatTokenCount(result.usage.cacheWriteTokens)}
                        </span>
                      ) : null}
                      {result.finishReason ? (
                        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">
                          finish {result.finishReason}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="min-h-80 px-4 py-4">
                    {result.text ? (
                      outputMode === "preview" ? (
                        <div className="space-y-3">
                          {!hasHtml ? (
                            <div className="rounded-[1.1rem] border border-[var(--line)] bg-[color:color-mix(in_oklch,var(--accent-soft)_35%,white)] px-3 py-2 text-sm text-[var(--muted)]">
                              No HTML tags detected yet. The live preview will become meaningful once the model starts emitting markup.
                            </div>
                          ) : null}

                          {cardPreviewErrors.length ? (
                            <div className="rounded-[1.1rem] border border-[color:color-mix(in_oklch,var(--danger)_30%,white)] bg-[color:color-mix(in_oklch,var(--danger)_10%,white)] px-3 py-3 text-sm text-[color:color-mix(in_oklch,var(--danger)_85%,black)]">
                              {cardPreviewErrors.map((message, errorIndex) => (
                                <p key={`${previewId}-error-${errorIndex}`}>{message}</p>
                              ))}
                            </div>
                          ) : null}

                          <div className="overflow-hidden rounded-[1.2rem] border border-[var(--line)] bg-white">
                            <iframe
                              className="min-h-72 w-full bg-white"
                              sandbox="allow-scripts"
                              srcDoc={createPreviewSrcDoc(result.text, previewId)}
                              title={`${result.label} HTML preview`}
                            />
                          </div>
                        </div>
                      ) : (
                        <pre className="whitespace-pre-wrap break-words font-[450] leading-7 text-[15px]">
                          {result.text}
                        </pre>
                      )
                    ) : (
                      <div className="flex min-h-72 items-center justify-center text-center text-sm leading-6 text-[var(--muted)]">
                        {isRunning
                          ? "This panel will fill as soon as the model starts sending tokens."
                          : "Run the harness to compare how each model sees the screenshot."}
                      </div>
                    )}
                  </div>
                  </section>
                );
              })}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
