"use client";

import type { ChangeEvent, Dispatch, SetStateAction } from "react";

import {
  createEmptyResult,
  toDataUrl,
} from "@/components/battle/lib/client-state";
import {
  getMinSelectableModelCards,
  getMaxSelectableModelCards,
  getPreferredAvailableModels,
  getSelectableCatalogModels,
  mergeRecentModelConfigs,
} from "@/components/battle/lib/model-catalog";
import type { VisualDiffState } from "@/components/battle/lib/view-shared";
import { getModelConfig, toCompareModel } from "@/lib/models";
import type { CompareModel, GatewayModel, ModelResult } from "@/lib/types";

type UseBattlePanelControllerArgs = {
  agenticEnabled: boolean;
  catalog: GatewayModel[];
  recentModelConfigs: string[];
  selectedModels: CompareModel[];
  setErrorMessage: Dispatch<SetStateAction<string>>;
  setFreshModelIds: Dispatch<SetStateAction<string[]>>;
  setImageDataUrl: Dispatch<SetStateAction<string>>;
  setImageName: Dispatch<SetStateAction<string>>;
  setRecentModelConfigs: Dispatch<SetStateAction<string[]>>;
  setResults: Dispatch<SetStateAction<ModelResult[]>>;
  setSelectedModels: Dispatch<SetStateAction<CompareModel[]>>;
  setVisualDiffs: Dispatch<SetStateAction<Record<string, VisualDiffState>>>;
  resetLiveStreamMetric: (modelId: string) => void;
};

export function useBattlePanelController({
  agenticEnabled,
  catalog,
  recentModelConfigs,
  resetLiveStreamMetric,
  selectedModels,
  setErrorMessage,
  setFreshModelIds,
  setImageDataUrl,
  setImageName,
  setRecentModelConfigs,
  setResults,
  setSelectedModels,
  setVisualDiffs,
}: UseBattlePanelControllerArgs) {
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const dataUrl = await toDataUrl(file);
    setImageDataUrl(dataUrl);
    setImageName(file.name);
    setVisualDiffs({});
    setErrorMessage("");
  }

  function applyCatalogModelSelection(
    index: number,
    nextModelConfig: string,
    catalogSnapshot: GatewayModel[],
  ) {
    const currentModelConfig = getModelConfig(selectedModels[index]);
    const selectedConfigsExcludingCurrent = selectedModels
      .filter((_, currentIndex) => currentIndex !== index)
      .map((model) => getModelConfig(model));

    let resolvedModelConfig = nextModelConfig;

    if (selectedConfigsExcludingCurrent.includes(nextModelConfig)) {
      const fallbackModel = getPreferredAvailableModels(
        catalogSnapshot,
        selectedConfigsExcludingCurrent,
        1,
        recentModelConfigs.filter(
          (config) =>
            config !== nextModelConfig && config !== currentModelConfig,
        ),
        agenticEnabled,
      )[0];

      if (fallbackModel) {
        resolvedModelConfig = fallbackModel.config;
      } else if (!selectedConfigsExcludingCurrent.includes(currentModelConfig)) {
        resolvedModelConfig = currentModelConfig;
      } else {
        return;
      }
    }

    const nextModel = catalogSnapshot.find(
      (model) => model.config === resolvedModelConfig,
    );
    if (
      !nextModel ||
      !getSelectableCatalogModels(catalogSnapshot, agenticEnabled).some(
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

  function handleModelChange(
    index: number,
    nextModelConfig: string,
    catalogSnapshot = catalog,
  ) {
    applyCatalogModelSelection(index, nextModelConfig, catalogSnapshot);
  }

  function handleTargetPanelCount(nextCount: number) {
    const minCards = getMinSelectableModelCards(catalog, agenticEnabled);
    const maxCards = getMaxSelectableModelCards(catalog, agenticEnabled);
    const clampedCount = Math.max(minCards, Math.min(maxCards, nextCount));

    if (clampedCount === selectedModels.length) return;

    if (clampedCount > selectedModels.length) {
      const additions = getPreferredAvailableModels(
        catalog,
        selectedModels.map((model) => getModelConfig(model)),
        clampedCount - selectedModels.length,
        recentModelConfigs,
        agenticEnabled,
      ).map(toCompareModel);

      if (!additions.length) return;

      setFreshModelIds(additions.map((model) => model.id));
      setSelectedModels((current) => [...current, ...additions]);
      setResults((current) => [...current, ...additions.map(createEmptyResult)]);
    } else {
      setSelectedModels((current) => current.slice(0, clampedCount));
      setResults((current) => current.slice(0, clampedCount));
    }

    setErrorMessage("");
  }

  function handleRemovePanel(index: number) {
    if (selectedModels.length <= getMinSelectableModelCards(catalog, agenticEnabled)) {
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

  return {
    handleFileChange,
    handleModelChange,
    handleRemovePanel,
    handleTargetPanelCount,
  };
}
