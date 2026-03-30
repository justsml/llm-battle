"use client";

import { useEffect, useRef, useState } from "react";

import {
  buildModelSections,
  getModelSourceLabel,
  getProviderTone,
  getSelectableCatalogModels,
  mergeRecentModelConfigs,
  modelMatchesQuery,
  type ModelSortMode,
} from "@/components/battle/lib/model-catalog";
import {
  formatMonthYear,
  formatTimeAgo,
  getCollapsedModelLabel,
  getModelPricingSummary,
} from "@/components/battle/lib/view-shared";
import {
  getModelConfig,
  getModelLabel,
  supportsAgenticModel,
} from "@/lib/models";
import type { CompareModel, GatewayModel } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  onOpenHostExplorer?: () => void;
  onOpenChange?: (isOpen: boolean) => void;
  variant?: "default" | "header";
};

export function ModelPicker({
  value,
  catalog,
  disabled,
  agenticEnabled,
  sortMode,
  onSortModeChange,
  selectedModels,
  recentModelConfigs,
  onSelect,
  onOpenHostExplorer,
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
          <div className="border-t border-(--line) bg-(--panel-strong) p-2">
            <button
              className="w-full rounded-[0.95rem] border border-(--line) bg-(--card) px-3 py-2 text-left text-sm font-medium transition hover:bg-(--card-active)"
              onClick={() => {
                setQuery("");
                setIsOpen(false);
                onOpenChange?.(false);
                onOpenHostExplorer?.();
              }}
              type="button"
            >
              Explore host URL
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
