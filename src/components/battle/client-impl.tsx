"use client";

import { type CSSProperties } from "react";

import { BattleAgenticSettings } from "@/components/battle/components/battle-agentic-settings";
import { BattleAuthGate } from "@/components/battle/components/battle-auth-gate";
import { BattleBanners } from "@/components/battle/components/battle-banners";
import { BattleGrid } from "@/components/battle/components/battle-grid";
import { BattleHistoryPanel } from "@/components/battle/components/battle-history-panel";
import { BattleLoadingState } from "@/components/battle/components/battle-loading-state";
import { BattlePreviewModal } from "@/components/battle/components/battle-preview-modal";
import { BattlePromptModal } from "@/components/battle/components/battle-prompt-modal";
import { BattleShellHeader } from "@/components/battle/components/battle-shell-header";
import { BattleStatusStrip } from "@/components/battle/components/battle-status-strip";
import { HostModelExplorerModal } from "@/components/battle/components/host-model-explorer-modal";
import {
  getUserDisplayName,
  getUserMonogram,
  type BattleClientProps,
} from "@/components/battle/lib/client-state";
import { readTraceEvents } from "@/components/battle/lib/client-state";
import { withTransition } from "@/components/battle/lib/client-state";
import { useBattleWorkspaceController } from "@/components/battle/hooks/use-battle-workspace-controller";

export function BattleClient(props: BattleClientProps) {
  const controller = useBattleWorkspaceController(props);

  if (controller.shouldShowInitialLoadingState) {
    return (
      <BattleLoadingState
        message={controller.initialLoadingMessage}
        title={controller.initialLoadingTitle}
      />
    );
  }

  if (!controller.signedInUser) {
    return (
      <BattleAuthGate
        allowLocalDevAutoAuth={props.authConfig.allowLocalDevAutoAuth}
        authError={controller.authError}
        githubConfigured={props.authConfig.githubConfigured}
        isAuthActionPending={controller.isAuthActionPending}
        onAnonymousSignIn={() => {
          void controller.handleAnonymousSignIn();
        }}
        onGitHubSignIn={() => {
          void controller.handleGitHubSignIn();
        }}
      />
    );
  }

  const cardViewportStyle = {
    "--output-viewport-height": controller.cardSizeConfig.viewportHeight,
    "--output-viewport-fullscreen-height":
      controller.cardSizeConfig.fullscreenViewportHeight,
  } as CSSProperties;

  return (
    <main className="relative min-h-screen [overflow-x:clip] pb-16 pt-4 text-(--foreground)">
      <div className="grain" />

      <BattleShellHeader
        canStartRun={Boolean(controller.imageDataUrl)}
        canToggleOutputWhileRunning={
          !(controller.isRunning && controller.agenticOptions.enabled)
        }
        cardSize={controller.cardSize}
        evalHarnessLinks={controller.evalHarnessLinks}
        historyCount={controller.runs.length}
        isAgenticEnabled={controller.agenticOptions.enabled}
        isAnonymousUser={controller.isAnonymousUser}
        isAuthActionPending={controller.isAuthActionPending}
        isEditLocked={controller.isEditLocked}
        isHistoryOpen={controller.isHistoryOpen}
        isRunning={controller.isRunning}
        isSiteMenuOpen={controller.isSiteMenuOpen}
        onCardSizeChange={(size) =>
          withTransition(() => controller.setCardSize(size))
        }
        onCloseSiteMenu={() => controller.setIsSiteMenuOpen(false)}
        onCompare={controller.handleCompare}
        onHistoryToggle={() => {
          const next = !controller.isHistoryOpen;
          controller.setIsHistoryOpen(next);
          if (next) void controller.loadRuns();
        }}
        onNavigateToHistoryFromMenu={() => {
          controller.setIsSiteMenuOpen(false);
          controller.setIsHistoryOpen((current) => {
            const next = !current;
            if (next) void controller.loadRuns();
            return next;
          });
        }}
        onNewRun={controller.handleNewRun}
        onOpenPromptModal={() => controller.setIsPromptModalOpen(true)}
        onOutputModeChange={controller.setOutputMode}
        onSignOut={() => {
          void controller.handleSignOut();
        }}
        onSiteMenuToggle={() =>
          controller.setIsSiteMenuOpen((current) => !current)
        }
        onToggleAgenticMode={controller.handleToggleAgenticMode}
        outputMode={controller.outputMode}
        pathname={controller.pathname}
        signedInUserDisplayName={getUserDisplayName(controller.signedInUser)}
        signedInUserMonogram={getUserMonogram(controller.signedInUser)}
        siteMenuRef={controller.siteMenuRef}
      />

      <BattleBanners
        authError={controller.authError}
        errorMessage={controller.errorMessage}
        initialRunId={props.initialRunId}
        isHydratingRouteRun={controller.isHydratingRouteRun}
        modelsError={controller.modelsError}
      />

      {controller.agenticOptions.enabled ? (
        <BattleAgenticSettings
          agenticOptions={controller.agenticOptions}
          onOptionsChange={(updater) => {
            controller.setAgenticOptions((current) => updater(current));
          }}
        />
      ) : null}

      {controller.isHistoryOpen ? (
        <BattleHistoryPanel
          activeRunId={controller.activeRunId}
          formatTimestamp={controller.formatTimestamp}
          isLoadingRuns={controller.isLoadingRuns}
          runs={controller.runs}
          runsError={controller.runsError}
          onSelectRun={controller.hydrateRun}
        />
      ) : null}

      {controller.aggregateStatus.activeCount ? (
        <BattleStatusStrip
          activeCount={controller.aggregateStatus.activeCount}
          cardCount={controller.selectedModels.length}
          costLabel={controller.aggregateStatus.costLabel}
          headline={controller.aggregateStatus.headline}
          tokenLabel={controller.aggregateStatus.tokenLabel}
        />
      ) : null}

      <BattleGrid
        activePreviewModelId={controller.preview.activePreviewModelId}
        activeRunId={controller.activeRunId}
        agenticActivity={controller.agenticActivity}
        agenticEnabled={controller.agenticOptions.enabled}
        canAddPanel={controller.canAddPanel}
        canRemovePanel={controller.canRemovePanel}
        cardSize={controller.cardSize}
        cardSizeConfig={controller.cardSizeConfig}
        catalog={controller.catalog}
        dragOverIndex={controller.dragOverIndex}
        dragSourceIndex={controller.dragSourceIndex}
        fileInputRef={controller.fileInputRef}
        freshModelIds={controller.freshModelIds}
        getDisplayOutputMetrics={controller.getDisplayOutputMetrics}
        imageDataUrl={controller.imageDataUrl}
        imageName={controller.imageName}
        isEditLocked={controller.isEditLocked}
        isLoadingModels={controller.isLoadingModels}
        isRunning={controller.isRunning}
        maxSelectableCards={controller.maxSelectableCards}
        modelSortMode={controller.modelSortMode}
        nowMs={controller.nowMs}
        onDismissToolErrors={controller.preview.dismissPreviewToolErrors}
        onDragEnd={controller.handleDragEnd}
        onDragOver={controller.handleDragOver}
        onDragStart={controller.handleDragStart}
        onDrop={controller.handleDrop}
        onModelChange={controller.handleModelChange}
        onOpenHostExplorer={controller.openHostModelExplorer}
        onOpenPickerChange={(index, isOpen) =>
          controller.setOpenPickerIndex((current) =>
            isOpen ? index : current === index ? null : current,
          )
        }
        onOpenPreview={controller.preview.openPreview}
        onReferenceImageMouseMove={controller.handleReferenceImageMouseMove}
        onRefreshVisualDiff={(previewId) => {
          void controller.preview.refreshVisualDiff(previewId);
        }}
        onRemovePanel={controller.handleRemovePanel}
        onResetReferenceImagePan={controller.resetReferenceImagePan}
        onRevisionSelect={(modelId, revisionId) =>
          controller.setSelectedRevisionIds((current) => ({
            ...current,
            [modelId]: revisionId,
          }))
        }
        onSortModeChange={controller.setModelSortMode}
        onTargetPanelCountChange={controller.handleTargetPanelCount}
        onVote={(index, vote) => {
          void controller.handleVote(index, vote);
        }}
        openPickerIndex={controller.openPickerIndex}
        outputMode={controller.outputMode}
        previewCardShellRefs={controller.preview.previewCardShellRefs}
        previewErrors={controller.previewErrors}
        previewFrameRefs={controller.preview.previewFrameRefs}
        previewOverrides={controller.previewOverrides}
        previewToolErrors={controller.previewToolErrors}
        recentModelConfigs={controller.recentModelConfigs}
        referenceImageFrameRef={controller.referenceImageFrameRef}
        results={controller.results}
        selectedModels={controller.selectedModels}
        selectedRevisionIds={controller.selectedRevisionIds}
        visualDiffs={controller.visualDiffs}
        votePendingByKey={controller.votePendingByKey}
      />

      {controller.isClient ? (
        <HostModelExplorerModal
          apiKey={controller.hostModelApiKey}
          error={controller.hostModelError}
          hostUrl={controller.hostModelUrl}
          isLoading={controller.hostModelLoading}
          isOpen={controller.isHostModelExplorerOpen}
          isSaving={controller.hostModelSaving}
          models={controller.hostModelEntries}
          onApiKeyChange={controller.setHostModelApiKey}
          onClose={controller.closeHostModelExplorer}
          onHostUrlChange={controller.setHostModelUrl}
          onImport={controller.importHostModel}
          onLoadModels={() => {
            void controller.loadHostModels();
          }}
          onSupportsImageInputChange={controller.setHostModelSupportsImageInput}
          resolvedBaseUrl={controller.hostModelResolvedBaseUrl}
          selectedModelId={controller.hostModelSelectedId}
          setSelectedModelId={controller.setHostModelSelectedId}
          supportsImageInput={controller.hostModelSupportsImageInput}
        />
      ) : null}

      <BattlePreviewModal
        activePreviewErrors={controller.activePreviewErrors}
        activePreviewId={controller.activePreviewId ?? ""}
        activePreviewResult={controller.activePreviewResult ?? controller.results[0]}
        activePreviewToolErrors={controller.activePreviewToolErrors}
        activePreviewVisualDiff={controller.activePreviewVisualDiff}
        closePreview={controller.preview.closePreview}
        imageDataUrl={controller.imageDataUrl}
        interactiveMarkup={
          controller.activePreviewRevisionState.selectedRevision?.html ?? ""
        }
        isOpen={Boolean(
          controller.isClient &&
            controller.activePreviewResult &&
            controller.activePreviewModel &&
            controller.activePreviewId,
        )}
        isStreaming={controller.activePreviewResult?.status === "streaming"}
        onDismissToolErrors={controller.preview.dismissPreviewToolErrors}
        onIframeRef={(element) => {
          if (!controller.activePreviewId) return;
          controller.preview.previewFrameRefs.current[
            controller.activePreviewId
          ] = element;
        }}
        onRefreshVisualDiff={() => {
          if (!controller.activePreviewId) return;
          void controller.preview.refreshVisualDiff(controller.activePreviewId);
        }}
        onSelectRevision={(revisionId) => {
          const activePreviewModel = controller.activePreviewModel;
          if (!activePreviewModel) return;
          controller.setSelectedRevisionIds((current) => ({
            ...current,
            [activePreviewModel.id]: revisionId,
          }));
        }}
        previewViewportRef={controller.preview.activePreviewViewportRef}
        revisions={controller.activePreviewRevisionState.revisions}
        selectedRevisionIndex={controller.activePreviewRevisionState.selectedIndex}
        traceEvents={readTraceEvents(controller.activePreviewResult?.stats)
          .slice()
          .reverse()}
      />

      <BattlePromptModal
        isOpen={controller.isPromptModalOpen}
        onClose={() => controller.setIsPromptModalOpen(false)}
        onPromptChange={controller.setPrompt}
        prompt={controller.prompt}
      />

      <input
        accept="image/*"
        className="hidden"
        onChange={controller.handleFileChange}
        ref={controller.fileInputRef}
        type="file"
      />
    </main>
  );
}
