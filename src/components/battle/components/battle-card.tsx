"use client";

import type { CSSProperties, DragEvent } from "react";

import { LiveHtmlPreview } from "@/components/battle/components/live-html-preview";
import { ModelPicker } from "@/components/battle/components/model-picker";
import { OutputViewport } from "@/components/battle/components/output-viewport";
import { RevisionNavigator } from "@/components/battle/components/revision-navigator";
import { TraceTimeline } from "@/components/battle/components/trace-timeline";
import { VisualComparisonPanel } from "@/components/battle/components/visual-comparison-panel";
import { getModelSourceLabel, type ModelSortMode } from "@/components/battle/lib/model-catalog";
import {
  buildDomCssStatItems,
  cardVtName,
  formatCost,
  formatLiveTokenCount,
  formatResultStatus,
  formatTokensPerSecond,
  formatVoteScore,
  getToolLabel,
  getSelectedOutputRevision,
  liveElapsed,
  statusLineClass,
} from "@/components/battle/lib/client-state";
import { looksLikeHtml, unwrapHtmlCodeFence } from "@/components/battle/lib/preview";
import {
  describeTraceEvent,
  formatDuration,
  formatMismatchLabel,
  formatSimilarityLabel,
  formatTimeAgo,
  formatTokenCount,
  type VisualDiffState,
} from "@/components/battle/lib/view-shared";
import { getModelConfig } from "@/lib/models";
import type {
  CompareModel,
  GatewayModel,
  ModelResult,
  OutputVoteValue,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import type {
  AgenticCardState,
  CardSize,
} from "@/components/battle/lib/client-state";

type BattleCardProps = {
  activeRunId: string | null;
  agenticEnabled: boolean;
  cardSize: CardSize;
  cardViewportStyle: CSSProperties;
  canRemovePanel: boolean;
  catalog: GatewayModel[];
  cardAgenticState?: AgenticCardState;
  cardPreviewErrors: string[];
  cardPreviewToolErrors: string[];
  cardVisualDiff?: VisualDiffState;
  fresh: boolean;
  getDisplayOutputMetrics: (result: ModelResult) => {
    outputEstimated: boolean;
    outputTokens?: number;
    peakTokensPerSecond?: number;
    totalEstimated: boolean;
    totalTokens?: number;
  };
  index: number;
  imageDataUrl: string;
  isDragged: boolean;
  isDragTarget: boolean;
  isEditLocked: boolean;
  isLoadingModels: boolean;
  isPreviewOpen: boolean;
  isRunning: boolean;
  isVotePending: boolean;
  model: CompareModel;
  modelSortMode: ModelSortMode;
  nowMs: number;
  onDismissToolErrors: (previewId: string) => void;
  onDragEnd: () => void;
  onDragOver: (targetIndex: number) => void;
  onDragStart: (index: number) => void;
  onDrop: (targetIndex: number) => void;
  onModelChange: (index: number, nextModelConfig: string) => void;
  onOpenHostExplorer: (index: number) => void;
  onOpenPickerChange: (index: number, isOpen: boolean) => void;
  onOpenPreview: (modelId: string) => void;
  onRefreshVisualDiff: (previewId: string) => void;
  onRemove: (index: number) => void;
  onRevisionSelect: (modelId: string, revisionId: string) => void;
  onSortModeChange: (mode: ModelSortMode) => void;
  onVote: (index: number, vote: OutputVoteValue) => void;
  openPickerIndex: number | null;
  outputMode: "preview" | "raw" | "thinking";
  previewFrameRef: (previewId: string, element: HTMLIFrameElement | null) => void;
  previewId: string;
  previewOverrides: Record<string, string>;
  previewShellRef: (modelId: string, element: HTMLDivElement | null) => void;
  recentModelConfigs: string[];
  result: ModelResult;
  selectedModels: CompareModel[];
  selectedRevisionId?: string;
  viewportHeight: string;
};

export function BattleCard({
  activeRunId,
  agenticEnabled,
  cardAgenticState,
  cardPreviewErrors,
  cardPreviewToolErrors,
  cardSize,
  cardViewportStyle,
  cardVisualDiff,
  canRemovePanel,
  catalog,
  fresh,
  getDisplayOutputMetrics,
  index,
  imageDataUrl,
  isDragged,
  isDragTarget,
  isEditLocked,
  isLoadingModels,
  isPreviewOpen,
  isRunning,
  isVotePending,
  model,
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
  onRefreshVisualDiff,
  onRemove,
  onRevisionSelect,
  onSortModeChange,
  onVote,
  openPickerIndex,
  outputMode,
  previewFrameRef,
  previewId,
  previewOverrides,
  previewShellRef,
  recentModelConfigs,
  result,
  selectedModels,
  selectedRevisionId,
  viewportHeight,
}: BattleCardProps) {
  const tokenMetrics = getDisplayOutputMetrics(result);
  const catalogModel =
    catalog.find((entry) => entry.config === getModelConfig(model)) ?? null;
  const revisionState = getSelectedOutputRevision(
    result,
    previewOverrides[model.id],
    selectedRevisionId,
  );
  const repairedMarkup = result.repairedText ?? result.text ?? "";
  const selectedRevisionMarkup = revisionState.selectedRevision?.html ?? "";
  const displayRawMarkup = selectedRevisionMarkup || repairedMarkup;
  const thinkingOutput = result.thinking?.trim() ?? "";
  const domCssStatItems = buildDomCssStatItems(result.domCssStats);
  const traceEvents = result.stats?.trace?.events?.slice().reverse() ?? [];
  const hasHtml = looksLikeHtml(unwrapHtmlCodeFence(displayRawMarkup));
  const voteSummary = result.vote ?? {
    score: 0,
    upvotes: 0,
    downvotes: 0,
  };
  const canVote =
    !!activeRunId && (result.status === "done" || result.status === "error");

  return (
    <div
      className={cn(
        "build-card",
        fresh && "build-card--fresh",
        openPickerIndex === index && "build-card--picker-open",
        isDragged && "build-card--drag-source",
        isDragTarget && "build-card--drag-target",
      )}
      draggable={!isEditLocked}
      onDragEnd={onDragEnd}
      onDragOver={(event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (!isEditLocked) onDragOver(index);
      }}
      onDragStart={() => {
        if (!isEditLocked) onDragStart(index);
      }}
      onDrop={() => {
        if (!isEditLocked) onDrop(index);
      }}
      style={{ viewTransitionName: cardVtName(model.id) }}
    >
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
            agenticEnabled={agenticEnabled}
            catalog={catalog}
            disabled={isLoadingModels}
            onOpenChange={(isOpen) => onOpenPickerChange(index, isOpen)}
            onOpenHostExplorer={() => onOpenHostExplorer(index)}
            onSelect={(modelId) => onModelChange(index, modelId)}
            onSortModeChange={onSortModeChange}
            recentModelConfigs={recentModelConfigs}
            selectedModels={selectedModels}
            sortMode={modelSortMode}
            value={model}
            variant="header"
          />
        )}
        {isEditLocked ? (
          <span className="shrink-0 rounded-full border border-(--line) px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-(--muted)">
            {catalogModel
              ? `${getModelSourceLabel(catalogModel)} · ${catalogModel.ownedBy}`
              : getModelSourceLabel(model)}
          </span>
        ) : null}
        <span
          aria-label={formatResultStatus(result)}
          className={statusLineClass(result.status)}
          title={formatResultStatus(result)}
        />
        {!isEditLocked && canRemovePanel ? (
          <button
            aria-label={`Remove ${model.label}`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-lg leading-none text-(--muted) transition hover:bg-(--card-active) hover:text-(--foreground)"
            onClick={() => onRemove(index)}
            type="button"
          >
            ×
          </button>
        ) : null}
      </div>

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
                        toolState.status === "error" && "bg-(--danger)",
                        toolState.status === "idle" && "bg-(--muted)",
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
              <RevisionNavigator
                compact
                onSelect={(revisionId) => onRevisionSelect(model.id, revisionId)}
                revisions={revisionState.revisions}
                selectedIndex={revisionState.selectedIndex}
              />
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-(--muted)">
                    Visual score
                  </p>
                  <p className="mt-1 text-sm font-semibold text-(--foreground)">
                    {formatSimilarityLabel(
                      cardVisualDiff?.similarity ??
                        result.stats?.visualAnalysis?.similarity,
                    )}
                  </p>
                </div>
                <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-(--muted)">
                    Mismatch
                  </p>
                  <p className="mt-1 text-sm font-semibold text-(--foreground)">
                    {formatMismatchLabel(
                      cardVisualDiff?.mismatchRatio ??
                        result.stats?.visualAnalysis?.mismatchRatio,
                    )}
                  </p>
                </div>
                <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-(--muted)">
                    Trace events
                  </p>
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
                  {cardPreviewErrors.map((msg, messageIndex) => (
                    <p key={`${previewId}-err-${messageIndex}`}>{msg}</p>
                  ))}
                </div>
              ) : null}
              {isPreviewOpen ? (
                <div
                  className="preview-card-placeholder"
                  style={{
                    minHeight:
                      cardSize === "xl"
                        ? "min(28.125rem, 60vh)"
                        : viewportHeight,
                  }}
                >
                  <span>Preview opened</span>
                </div>
              ) : (
                <div
                  className="preview-card-shell"
                  ref={(element) => previewShellRef(model.id, element)}
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
                      onClick={() => onOpenPreview(model.id)}
                      type="button"
                    >
                      <span className="preview-card-trigger__hint">
                        Open live preview
                      </span>
                    </button>
                    <div className="relative h-full w-full">
                      <LiveHtmlPreview
                        iframeRef={(element) => previewFrameRef(previewId, element)}
                        isStreaming={result.status === "streaming"}
                        markup={displayRawMarkup}
                        overrideMarkup={displayRawMarkup}
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
                                  {cardPreviewToolErrors.map((msg, messageIndex) => (
                                    <p key={`${previewId}-tool-err-${messageIndex}`}>
                                      {msg}
                                    </p>
                                  ))}
                                </div>
                              </div>
                              <button
                                className="shrink-0 rounded-full border border-[color-mix(in_oklch,var(--danger)_42%,transparent)] bg-[color-mix(in_oklch,var(--panel-strong)_82%,var(--danger)_18%)] px-3 py-1 text-xs font-semibold text-[color-mix(in_oklch,var(--foreground)_94%,white)] transition hover:bg-[color-mix(in_oklch,var(--panel-strong)_72%,var(--danger)_28%)]"
                                onClick={() => onDismissToolErrors(previewId)}
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
          ) : outputMode === "raw" ? (
            <div className="flex flex-col gap-2 p-3">
              <RevisionNavigator
                compact
                onSelect={(revisionId) => onRevisionSelect(model.id, revisionId)}
                revisions={revisionState.revisions}
                selectedIndex={revisionState.selectedIndex}
              />
              <div className="flex items-center justify-between rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-(--muted)">
                <span>DOM + CSS stats</span>
                <span>
                  {result.stats?.repairPassCount
                    ? "Includes repaired output"
                    : "Initial output"}
                </span>
              </div>
              <VisualComparisonPanel
                compact
                onRefresh={hasHtml ? () => onRefreshVisualDiff(previewId) : undefined}
                referenceImageUrl={imageDataUrl}
                visualState={cardVisualDiff}
              />
              {domCssStatItems.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {domCssStatItems.map(([label, value]) => (
                    <div
                      className="rounded-[1rem] border border-(--line) bg-(--panel-strong) px-3 py-2"
                      key={`${model.id}-${label}`}
                    >
                      <p className="text-[11px] uppercase tracking-[0.16em] text-(--muted)">
                        {label}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-(--foreground)">
                        {value}
                      </p>
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
                {agenticEnabled ? (
                  <TraceTimeline events={traceEvents} />
                ) : (
                  <pre className="m-0 whitespace-pre-wrap break-words text-[13px] font-[450] leading-7 text-(--muted)">
                    {thinkingOutput ||
                      "Thinking traces appear when the model emits reasoning output."}
                  </pre>
                )}
              </OutputViewport>
            </div>
          )
        ) : (
          <div
            className="flex flex-1 items-center justify-center px-6 py-8 text-center text-sm leading-6 text-(--muted)"
            style={{
              minHeight:
                cardSize === "xl"
                  ? "min(28.125rem, 60vh)"
                  : viewportHeight,
            }}
          >
            {isRunning
              ? "Waiting for tokens…"
              : isEditLocked
                ? "No output."
                : "Run to see output here."}
          </div>
        )}
      </div>

      {result.status !== "idle" ? (
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
              onClick={() => onVote(index, 1)}
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
              onClick={() => onVote(index, -1)}
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
          {tokenMetrics.outputTokens != null ? (
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
          {tokenMetrics.totalTokens != null ? (
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
          {tokenMetrics.peakTokensPerSecond != null ? (
            <span>
              Tps{" "}
              <strong className="font-semibold text-(--foreground)">
                {formatTokensPerSecond(tokenMetrics.peakTokensPerSecond)}
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
}
