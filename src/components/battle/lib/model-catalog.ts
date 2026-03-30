import {
  getModelConfig,
  getModelLabel,
  parseModelConfig,
  supportsAgenticModel,
  toCompareModel,
} from "@/lib/models";
import type { CompareModel, GatewayModel } from "@/lib/types";

export type ModelSortMode = "released" | "name" | "provider";

const MIN_MODEL_CARDS = 2;
const MAX_MODEL_CARDS = 12;
const RECENT_MODEL_LIMIT = 24;

export function syncModelLabels(models: CompareModel[], catalog: GatewayModel[]) {
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

export function getModelSourceLabel(
  model: Pick<CompareModel, "id" | "config"> | GatewayModel,
) {
  const { host } = parseModelConfig(model);

  if (host === "openrouter.ai") return "OpenRouter";
  if (host === "ai-gateway.vercel.sh") return "Vercel";
  return host;
}

export function getProviderTone(source: string) {
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

export function mergeRecentModelConfigs(current: string[], additions: string[]) {
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

export function getSelectableCatalogModels(
  catalog: GatewayModel[],
  agenticEnabled: boolean,
) {
  return catalog.filter(
    (model) =>
      model.supportsImageInput
      && (!agenticEnabled || supportsAgenticModel(model)),
  );
}

export function getMaxSelectableModelCards(
  catalog: GatewayModel[],
  agenticEnabled: boolean,
) {
  if (!catalog.length) return MAX_MODEL_CARDS;
  return Math.min(
    MAX_MODEL_CARDS,
    getSelectableCatalogModels(catalog, agenticEnabled).length,
  );
}

export function getMinSelectableModelCards(
  catalog: GatewayModel[],
  agenticEnabled: boolean,
) {
  if (!catalog.length) return MIN_MODEL_CARDS;
  return Math.min(
    MIN_MODEL_CARDS,
    Math.max(1, getMaxSelectableModelCards(catalog, agenticEnabled)),
  );
}

export function getPreferredAvailableModels(
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

export function getPreferredModelsForModeSwitch(
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

export function buildModelSections(models: GatewayModel[], mode: ModelSortMode) {
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

export function modelMatchesQuery(model: GatewayModel, query: string) {
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
