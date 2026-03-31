"use client";

import type {
  CSSProperties,
  MouseEventHandler,
  MutableRefObject,
  RefObject,
} from "react";

import { BattleCard } from "@/components/battle/components/battle-card";
import { BattleInput } from "@/components/battle/components/battle-input";
import { withTransition, type CardSize } from "@/components/battle/lib/client-state";
import type { ModelSortMode } from "@/components/battle/lib/model-catalog";
import type {
  AgenticCardState,
} from "@/components/battle/lib/client-state";
import type { VisualDiffState } from "@/components/battle/lib/view-shared";
import type {
  CompareModel,
  GatewayModel,
  ModelResult,
  OutputVoteValue,
} from "@/lib/types";

type BattleGridProps = {
  activeRunId: string | null;
  activePreviewModelId: string | null;
  agenticActivity: Record<string, AgenticCardState>;
  agenticEnabled: boolean;
  canAddPanel: boolean;
  canRemovePanel: boolean;
  cardSize: CardSize;
  cardSizeConfig: {
    minWidth: string;
    referenceHeight: string;
    viewportHeight: string;
    fullscreenViewportHeight: string;
  };
  catalog: GatewayModel[];
  dragOverIndex: number | null;
  dragSourceIndex: number | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  freshModelIds: string[];
  getDisplayOutputMetrics: (result: ModelResult) => {
    outputEstimated: boolean;
    outputTokens?: number;
    peakTokensPerSecond?: number;
    totalEstimated: boolean;
    totalTokens?: number;
  };
  imageDataUrl: string;
  imageName: string;
  isEditLocked: boolean;
  isLoadingModels: boolean;
  isRunning: boolean;
  maxSelectableCards: number;
  modelSortMode: ModelSortMode;
  nowMs: number;
  onDismissToolErrors: (previewId: string) => void;
  onDragEnd: () => void;
  onDragOver: (index: number) => void;
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
  onModelChange: (index: number, nextModelConfig: string) => void;
  onOpenHostExplorer: (index: number) => void;
  onOpenPickerChange: (index: number, isOpen: boolean) => void;
  onOpenPreview: (modelId: string) => void;
  onReferenceImageMouseMove: MouseEventHandler<HTMLDivElement>;
  onRefreshVisualDiff: (previewId: string) => void;
  onRemovePanel: (index: number) => void;
  onResetReferenceImagePan: () => void;
  onRevisionSelect: (modelId: string, revisionId: string) => void;
  onSortModeChange: (mode: ModelSortMode) => void;
  onTargetPanelCountChange: (count: number) => void;
  onVote: (index: number, vote: OutputVoteValue) => void;
  openPickerIndex: number | null;
  outputMode: "preview" | "raw" | "thinking";
  previewCardShellRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  previewErrors: Record<string, string[]>;
  previewFrameRefs: MutableRefObject<Record<string, HTMLIFrameElement | null>>;
  previewOverrides: Record<string, string>;
  previewToolErrors: Record<string, string[]>;
  referenceImageFrameRef: RefObject<HTMLDivElement | null>;
  recentModelConfigs: string[];
  results: ModelResult[];
  selectedModels: CompareModel[];
  selectedRevisionIds: Record<string, string>;
  visualDiffs: Record<string, VisualDiffState>;
  votePendingByKey: Record<string, boolean>;
};

export function BattleGrid({
  activeRunId,
  activePreviewModelId,
  agenticActivity,
  agenticEnabled,
  canAddPanel,
  canRemovePanel,
  cardSize,
  cardSizeConfig,
  catalog,
  dragOverIndex,
  dragSourceIndex,
  fileInputRef,
  freshModelIds,
  getDisplayOutputMetrics,
  imageDataUrl,
  imageName,
  isEditLocked,
  isLoadingModels,
  isRunning,
  maxSelectableCards,
  modelSortMode,
  nowMs,
  onDismissToolErrors,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onModelChange,
  onOpenHostExplorer,
  onOpenPickerChange,
  onOpenPreview,
  onReferenceImageMouseMove,
  onRefreshVisualDiff,
  onRemovePanel,
  onResetReferenceImagePan,
  onRevisionSelect,
  onSortModeChange,
  onTargetPanelCountChange,
  onVote,
  openPickerIndex,
  outputMode,
  previewCardShellRefs,
  previewErrors,
  previewFrameRefs,
  previewOverrides,
  previewToolErrors,
  referenceImageFrameRef,
  recentModelConfigs,
  results,
  selectedModels,
  selectedRevisionIds,
  visualDiffs,
  votePendingByKey,
}: BattleGridProps) {
  const cardViewportStyle = {
    "--output-viewport-height": cardSizeConfig.viewportHeight,
    "--output-viewport-fullscreen-height":
      cardSizeConfig.fullscreenViewportHeight,
  } as CSSProperties;

  return (
    <div
      className="mx-auto mt-3 grid max-w-[1600px] gap-3 px-4 sm:px-0"
      style={{
        gridTemplateColumns:
          cardSize === "xl"
            ? "1fr"
            : `repeat(auto-fill, minmax(min(100%, ${cardSizeConfig.minWidth}), 1fr))`,
      }}
    >
      <BattleInput
        cardSize={cardSize}
        imageDataUrl={imageDataUrl}
        imageName={imageName}
        inputRef={fileInputRef}
        isEditLocked={isEditLocked}
        onReferenceImageMouseMove={onReferenceImageMouseMove}
        onResetReferenceImagePan={onResetReferenceImagePan}
        referenceHeight={cardSizeConfig.referenceHeight}
        referenceImageFrameRef={referenceImageFrameRef}
      />

      {selectedModels.map((model, index) => {
        const result = results[index];
        if (!result) return null;

        const previewId = `${model.id}-${index}`;
        const voteKey = activeRunId ? `${activeRunId}:${index}` : null;

        return (
          <BattleCard
            activeRunId={activeRunId}
            agenticEnabled={agenticEnabled}
            cardAgenticState={agenticActivity[model.id]}
            cardPreviewErrors={previewErrors[previewId] ?? []}
            cardPreviewToolErrors={previewToolErrors[previewId] ?? []}
            cardSize={cardSize}
            cardViewportStyle={cardViewportStyle}
            cardVisualDiff={visualDiffs[previewId]}
            canRemovePanel={canRemovePanel}
            catalog={catalog}
            fresh={freshModelIds.includes(model.id)}
            getDisplayOutputMetrics={getDisplayOutputMetrics}
            index={index}
            imageDataUrl={imageDataUrl}
            isDragged={dragSourceIndex === index}
            isDragTarget={dragOverIndex === index && dragSourceIndex !== index}
            isEditLocked={isEditLocked}
            isLoadingModels={isLoadingModels}
            isPreviewOpen={activePreviewModelId === model.id}
            isRunning={isRunning}
            isVotePending={voteKey ? !!votePendingByKey[voteKey] : false}
            key={`${model.id}-${index}`}
            model={model}
            modelSortMode={modelSortMode}
            nowMs={nowMs}
            onDismissToolErrors={onDismissToolErrors}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDragStart={onDragStart}
            onDrop={onDrop}
            onModelChange={onModelChange}
            onOpenHostExplorer={onOpenHostExplorer}
            onOpenPickerChange={onOpenPickerChange}
            onOpenPreview={onOpenPreview}
            onRefreshVisualDiff={onRefreshVisualDiff}
            onRemove={(panelIndex) =>
              withTransition(() => onRemovePanel(panelIndex))
            }
            onRevisionSelect={onRevisionSelect}
            onSortModeChange={onSortModeChange}
            onVote={onVote}
            openPickerIndex={openPickerIndex}
            outputMode={outputMode}
            previewFrameRef={(id, element) => {
              previewFrameRefs.current[id] = element;
            }}
            previewId={previewId}
            previewOverrides={previewOverrides}
            previewShellRef={(modelId, element) => {
              previewCardShellRefs.current[modelId] = element;
            }}
            recentModelConfigs={recentModelConfigs}
            result={result}
            selectedModels={selectedModels}
            selectedRevisionId={selectedRevisionIds[model.id]}
            viewportHeight={cardSizeConfig.viewportHeight}
          />
        );
      })}

      {!isEditLocked && canAddPanel ? (
        <button
          className="ghost-card"
          onClick={() =>
            withTransition(() =>
              onTargetPanelCountChange(selectedModels.length + 1),
            )
          }
          style={{ viewTransitionName: "card-add" }}
          type="button"
        >
          <span aria-hidden="true" className="ghost-card__halo" />
          <span className="ghost-card__orb">
            <span className="ghost-card__plus">+</span>
          </span>
          <span className="ghost-card__content">
            <span className="ghost-card__eyebrow">Add contender</span>
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
  );
}
