"use client";

import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import type { RemoteHostModelEntry } from "../lib/view-shared";

type HostModelExplorerModalProps = {
  apiKey: string;
  error: string;
  hostUrl: string;
  isLoading: boolean;
  isOpen: boolean;
  isSaving: boolean;
  models: RemoteHostModelEntry[];
  onApiKeyChange: (value: string) => void;
  onClose: () => void;
  onHostUrlChange: (value: string) => void;
  onImport: (model: RemoteHostModelEntry) => void;
  onLoadModels: () => void;
  onSupportsImageInputChange: (value: boolean) => void;
  resolvedBaseUrl: string;
  selectedModelId: string;
  setSelectedModelId: (value: string) => void;
  supportsImageInput: boolean;
};

export function HostModelExplorerModal({
  apiKey,
  error,
  hostUrl,
  isLoading,
  isOpen,
  isSaving,
  models,
  onApiKeyChange,
  onClose,
  onHostUrlChange,
  onImport,
  onLoadModels,
  onSupportsImageInputChange,
  resolvedBaseUrl,
  selectedModelId,
  setSelectedModelId,
  supportsImageInput,
}: HostModelExplorerModalProps) {
  if (!isOpen) return null;

  const selectedModel =
    models.find((model) => model.id === selectedModelId) ?? models[0] ?? null;

  return createPortal(
    <div
      aria-modal="true"
      className="preview-modal-backdrop"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="preview-modal-sheet max-w-4xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="preview-modal__header">
          <div>
            <p className="preview-modal__eyebrow">Model explorer</p>
            <h2 className="preview-modal__title">Add OpenAI-compatible host models</h2>
          </div>
          <button
            className="preview-modal__close"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="preview-modal__body space-y-4">
          <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_auto]">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                  Models URL
                </span>
                <input
                  className="rounded-[0.9rem] border border-(--line) bg-(--card) px-3 py-2 outline-none transition focus:border-(--foreground)"
                  onChange={(event) => onHostUrlChange(event.target.value)}
                  placeholder="http://192.168.50.173:1234/v1/models"
                  value={hostUrl}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                  API key
                </span>
                <input
                  className="rounded-[0.9rem] border border-(--line) bg-(--card) px-3 py-2 outline-none transition focus:border-(--foreground)"
                  onChange={(event) => onApiKeyChange(event.target.value)}
                  placeholder="Optional"
                  type="password"
                  value={apiKey}
                />
              </label>
              <div className="flex items-end">
                <button
                  className="rounded-[0.9rem] border border-(--line) bg-(--card) px-4 py-2 text-sm font-medium transition hover:bg-(--card-active) disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isLoading || !hostUrl.trim()}
                  onClick={onLoadModels}
                  type="button"
                >
                  {isLoading ? "Loading…" : "Load models"}
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-(--foreground)">
                <input
                  checked={supportsImageInput}
                  onChange={(event) => onSupportsImageInputChange(event.target.checked)}
                  type="checkbox"
                />
                Imported model supports image input
              </label>
              {resolvedBaseUrl ? (
                <span className="text-xs text-(--muted)">
                  Base URL: {resolvedBaseUrl}
                </span>
              ) : null}
            </div>

            {error ? (
              <p className="mt-3 rounded-[0.9rem] border border-[color-mix(in_oklch,var(--danger)_36%,transparent)] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-3 py-2 text-sm text-(--danger)">
                {error}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
            <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) p-2">
              <div className="max-h-[24rem] overflow-auto">
                {models.length ? (
                  <div className="space-y-2">
                    {models.map((model) => (
                      <button
                        className={cn(
                          "w-full rounded-[1rem] border px-3 py-3 text-left transition",
                          selectedModelId === model.id
                            ? "border-(--foreground) bg-(--card-active)"
                            : "border-(--line) bg-(--card) hover:bg-(--card-active)",
                        )}
                        key={model.id}
                        onClick={() => setSelectedModelId(model.id)}
                        type="button"
                      >
                        <p className="text-sm font-semibold text-(--foreground)">{model.id}</p>
                        <p className="mt-1 text-xs text-(--muted)">
                          {model.ownedBy} · {model.object}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-10 text-center text-sm text-(--muted)">
                    Load a host URL to inspect its `/models` response.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                Import target
              </p>
              {selectedModel ? (
                <>
                  <p className="mt-2 text-lg font-semibold text-(--foreground)">
                    {selectedModel.id}
                  </p>
                  <p className="mt-2 text-sm text-(--muted)">
                    This creates a custom model config pointed at the selected OpenAI-compatible host so you can use it in head-to-head runs.
                  </p>
                  <div className="mt-4 space-y-2 text-sm text-(--muted)">
                    <p>Host: {resolvedBaseUrl || "Not loaded yet"}</p>
                    <p>Owner: {selectedModel.ownedBy}</p>
                    <p>Image input: {supportsImageInput ? "Enabled" : "Disabled"}</p>
                  </div>
                  <button
                    className="mt-5 rounded-[0.95rem] border border-(--line) bg-(--card) px-4 py-2 text-sm font-medium transition hover:bg-(--card-active) disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!resolvedBaseUrl || isSaving}
                    onClick={() => onImport(selectedModel)}
                    type="button"
                  >
                    {isSaving ? "Importing…" : "Import and use this model"}
                  </button>
                </>
              ) : (
                <p className="mt-2 text-sm text-(--muted)">
                  Select a model from the host list to import it.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
