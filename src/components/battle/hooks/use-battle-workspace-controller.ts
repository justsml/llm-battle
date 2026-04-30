"use client";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { getMaxSelectableModelCards, getMinSelectableModelCards, getPreferredAvailableModels, getPreferredModelsForModeSwitch, getSelectableCatalogModels, mergeRecentModelConfigs, syncModelLabels, type ModelSortMode } from "@/components/battle/lib/model-catalog";
import { useBattlePreviewController } from "@/components/battle/hooks/use-battle-preview-controller";
import { useBattlePanelController } from "@/components/battle/hooks/use-battle-panel-controller";
import { useBattleWorkspaceEffects } from "@/components/battle/hooks/use-battle-workspace-effects";
import { authClient } from "@/lib/auth-client";
import { DEFAULT_MODELS, DEFAULT_PROMPT, buildOpenAICompatibleModelConfig, getModelConfig, supportsAgenticModel, toCompareModel } from "@/lib/models";
import type {
  AgenticOptions,
  CompareModel,
  GatewayModel,
  ModelResult,
  OutputVoteValue,
  SavedRun,
} from "@/lib/types";
import {
  MAX_RUNS,
  applyEventToAgenticState,
  applyEventToResult,
  applyVoteSummaryToResult,
  buildAggregateStatusSummary,
  CARD_SIZE_CONFIG,
  createAgenticCardState,
  createEmptyResult,
  createEmptyResults,
  createInitialModelCardWorkspaceState,
  DEFAULT_AGENTIC_OPTIONS,
  formatTimestamp,
  getModelCardModeKey,
  getRouteAgenticEnabled,
  getRunHref,
  getRunImageSrc,
  getSelectedOutputRevision,
  getUserDisplayName,
  getUserMonogram,
  getVoteKey,
  EVAL_HARNESS_LINKS,
  toDataUrl,
  type BattleClientProps,
  type CardSize,
  type ModelCardModeKey,
  type ModelCardWorkspaceState,
  type OutputMode,
} from "@/components/battle/lib/client-state";
import type {
  RemoteHostModelEntry,
  VisualDiffState,
} from "@/components/battle/lib/view-shared";
import { withTransition } from "@/components/battle/lib/client-state";
type UseBattleWorkspaceControllerArgs = Pick<
  BattleClientProps,
  "authConfig" | "initialRunId" | "initialAgenticEnabled"
>;
export function useBattleWorkspaceController({
  authConfig,
  initialRunId,
  initialAgenticEnabled = false,
}: UseBattleWorkspaceControllerArgs) {
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
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [modelsError, setModelsError] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSiteMenuOpen, setIsSiteMenuOpen] = useState(false);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [isHostModelExplorerOpen, setIsHostModelExplorerOpen] = useState(false);
  const [hostModelTargetIndex, setHostModelTargetIndex] = useState<number | null>(
    null,
  );
  const [hostModelUrl, setHostModelUrl] = useState(
    "http://192.168.50.173:1234/v1/models",
  );
  const [hostModelApiKey, setHostModelApiKey] = useState("");
  const [hostModelEntries, setHostModelEntries] = useState<
    RemoteHostModelEntry[]
  >([]);
  const [hostModelError, setHostModelError] = useState("");
  const [hostModelLoading, setHostModelLoading] = useState(false);
  const [hostModelSaving, setHostModelSaving] = useState(false);
  const [hostModelResolvedBaseUrl, setHostModelResolvedBaseUrl] = useState("");
  const [hostModelSelectedId, setHostModelSelectedId] = useState("");
  const [hostModelSupportsImageInput, setHostModelSupportsImageInput] =
    useState(true);
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
  const [votePendingByKey, setVotePendingByKey] = useState<
    Record<string, boolean>
  >({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string[]>>(
    {},
  );
  const [previewToolErrors, setPreviewToolErrors] = useState<
    Record<string, string[]>
  >({});
  const [previewOverrides, setPreviewOverrides] = useState<
    Record<string, string>
  >({});
  const [selectedRevisionIds, setSelectedRevisionIds] = useState<
    Record<string, string>
  >({});
  const [visualDiffs, setVisualDiffs] = useState<Record<string, VisualDiffState>>(
    {},
  );
  const [agenticOptions, setAgenticOptions] = useState<AgenticOptions>(() => ({
    ...DEFAULT_AGENTIC_OPTIONS,
    enabled: initialAgenticEnabled,
  }));
  const [agenticActivity, setAgenticActivity] = useState<
    Record<string, ReturnType<typeof createAgenticCardState>>
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
  const lastSavedDraftRef = useRef<string | null>(null);
  const routeRunHydratedRef = useRef<string | null>(null);
  const restoredDraftRef = useRef(false);
  const attemptedLocalDevSignInRef = useRef(false);
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
  const isAnonymousUser = Boolean(
    (signedInUser as { isAnonymous?: boolean } | null)?.isAnonymous,
  );
  const currentModelCardModeKey = getModelCardModeKey(agenticOptions.enabled);
  const maxSelectableCards = getMaxSelectableModelCards(
    catalog,
    agenticOptions.enabled,
  );
  const minSelectableCards = getMinSelectableModelCards(
    catalog,
    agenticOptions.enabled,
  );
  const updateRun = useCallback(
    (runId: string, updater: (run: SavedRun) => SavedRun) => {
      setRuns((current) =>
        current.map((run) => (run.id === runId ? updater(run) : run)),
      );
    },
    [],
  );
  const preview = useBattlePreviewController({
    activeRunId,
    imageDataUrl,
    outputMode,
    previewErrors,
    previewOverrides,
    previewToolErrors,
    results,
    selectedModels,
    selectedRevisionIds,
    setPreviewErrors,
    setPreviewOverrides,
    setPreviewToolErrors,
    setResults,
    setSelectedRevisionIds,
    setVisualDiffs,
    updateRun,
    visualDiffs,
  });
  const activePreviewResult = preview.activePreviewModelId
    ? results.find((entry) => entry.modelId === preview.activePreviewModelId) ??
      null
    : null;
  const activePreviewModel = preview.activePreviewModelId
    ? selectedModels.find(
        (entry) => entry.id === preview.activePreviewModelId,
      ) ?? null
    : null;
  const activePreviewIndex = preview.activePreviewModelId
    ? selectedModels.findIndex(
        (entry) => entry.id === preview.activePreviewModelId,
      )
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
  const activePreviewRevisionState = getSelectedOutputRevision(
    activePreviewResult,
    activePreviewModel ? previewOverrides[activePreviewModel.id] : undefined,
    activePreviewModel ? selectedRevisionIds[activePreviewModel.id] : undefined,
  );
  const handleReferenceImageMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const { currentTarget, clientX, clientY } = event;
      const rect = currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
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
  useEffect(() => {
    setIsClient(true);
  }, []);
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
        selectableConfigs.has(config) &&
        models.findIndex((entry) => getModelConfig(entry) === config) === index
      );
    });
    const desiredCount = Math.min(selectedModels.length, maxSelectableCards);
    if (
      retained.length === selectedModels.length &&
      retained.length === desiredCount
    ) {
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
      const nextById = new Map(
        current.map((result) => [result.modelId, result] as const),
      );
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
      selectedRevisionIds,
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
    setSelectedRevisionIds(state.selectedRevisionIds);
    setVisualDiffs(state.visualDiffs);
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
    const target = agenticEnabled ? "/run-agentic" : "/run-generate";
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
      selectedRevisionIds: {},
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
    preview.resetAllLiveStreamMetrics();
    setErrorMessage("");
    setOpenPickerIndex(null);
    routeRunHydratedRef.current = null;
    if (options?.syncRoute !== false) {
      syncRouteToRun(null);
    }
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
      selectedRevisionIds: {},
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
    preview.resetAllLiveStreamMetrics();
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
  const persistRun = useCallback((run: SavedRun) => {
    setRuns((current) =>
      [run, ...current.filter((item) => item.id !== run.id)].slice(0, MAX_RUNS),
    );
  }, []);
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
      routeRunHydratedRef.current === previousRunId
        ? nextRunId
        : routeRunHydratedRef.current;
    syncRouteToRun(nextRunId, true, agenticOptions.enabled);
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
  async function loadRuns(options?: { hydrateLatest?: boolean }) {
    if (!signedInUser) {
      setRuns((current) => (current.length === 0 ? current : []));
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
        savedNextWorkspaceState.activeRunId &&
        savedNextWorkspaceState.selectedModels.length ===
          nextSelectedModels.length &&
        savedNextWorkspaceState.selectedModels.every(
          (model, index) =>
            getModelConfig(model) === getModelConfig(nextSelectedModels[index]),
        )
          ? savedNextWorkspaceState.results
          : createEmptyResults(nextSelectedModels),
      agenticActivity:
        savedNextWorkspaceState.activeRunId &&
        savedNextWorkspaceState.selectedModels.length ===
          nextSelectedModels.length &&
        savedNextWorkspaceState.selectedModels.every(
          (model, index) =>
            getModelConfig(model) === getModelConfig(nextSelectedModels[index]),
        )
          ? savedNextWorkspaceState.agenticActivity
          : {},
      previewErrors: {},
      previewToolErrors: {},
      previewOverrides: {},
      selectedRevisionIds: {},
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
    preview.resetAllLiveStreamMetrics();
  }
  useBattleWorkspaceEffects({
    activeRunId,
    agenticActivity,
    agenticOptions,
    allowLocalDevAutoAuth: authConfig.allowLocalDevAutoAuth,
    attemptedLocalDevSignInRef,
    buildCurrentModelCardWorkspaceState,
    catalog,
    currentModelCardModeKey,
    freshModelIds,
    handleAnonymousSignIn,
    hasBootstrappedClientStateSetter: setHasBootstrappedClientState,
    hydrateRouteRun,
    hydrateRun,
    imageDataUrl,
    imageName,
    initialAgenticEnabled,
    initialRunId,
    isRunning,
    isSessionPending,
    isSiteMenuOpen,
    lastSavedDraftRef,
    loadRuns,
    modelCardStatesByMode,
    pathname,
    pendingDraftModeKeyRef,
    pendingDraftModelConfigsByModeRef,
    previewErrors,
    previewOverrides,
    previewToolErrors,
    prompt,
    recentModelConfigs,
    restoredDraftRef,
    results,
    routeRunHydratedRef,
    runsErrorSetter: setRunsError,
    runsSetter: setRuns,
    selectedModels,
    selectedRevisionIds,
    sessionUserId: signedInUserId,
    setActiveRunId,
    setAgenticActivity,
    setAgenticOptions,
    setCatalog,
    setErrorMessage,
    setFreshModelIds,
    setImageDataUrl,
    setImageName,
    setIsInitialRouteRunPending,
    setIsLoadingModels,
    setIsLoadingRuns,
    setIsSiteMenuOpen,
    setModelCardStatesByMode,
    setModelsError,
    setNowMs,
    setPreviewErrors,
    setPreviewOverrides,
    setPreviewToolErrors,
    setPrompt,
    setRecentModelConfigs,
    setResults,
    setSelectedModels,
    setSelectedRevisionIds,
    setVisualDiffs,
    signedInUser,
    siteMenuRef,
    startBlankWorkspace,
    visualDiffs,
  });
  const panelController = useBattlePanelController({
    agenticEnabled: agenticOptions.enabled,
    catalog,
    recentModelConfigs,
    resetLiveStreamMetric: preview.resetLiveStreamMetric,
    selectedModels,
    setErrorMessage,
    setFreshModelIds,
    setImageDataUrl,
    setImageName,
    setRecentModelConfigs,
    setResults,
    setSelectedModels,
    setVisualDiffs,
  });
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
      await (
        authClient.signIn as typeof authClient.signIn & {
          anonymous: () => Promise<unknown>;
        }
      ).anonymous();
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
      setRuns((current) => (current.length === 0 ? current : []));
      setIsHistoryOpen(false);
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Unable to sign out right now.",
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
      setErrorMessage("Sign in to run a battle.");
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
        ? !match.supportsImageInput ||
            (agenticOptions.enabled && !supportsAgenticModel(match))
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
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    preview.resetAllLiveStreamMetrics();
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
    setSelectedRevisionIds({});
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
                  typeof event.imageObjectKey === "string" &&
                  event.imageObjectKey
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
              void preview.handleToolCallEvent(event);
            }
            if (
              (event.type === "start" || event.type === "replace-output") &&
              typeof event.modelId === "string"
            ) {
              if (event.type === "start") {
                preview.resetLiveStreamMetric(event.modelId);
              }
              preview.clearToolErrorState(event.modelId);
            }
            if (
              event.type === "tool-error" &&
              typeof event.modelId === "string"
            ) {
              preview.addToolErrorMessage(
                event.modelId,
                typeof event.toolName === "string" ? event.toolName : undefined,
                event.error,
              );
            }
            if (
              event.type === "delta" &&
              typeof event.modelId === "string" &&
              typeof event.delta === "string"
            ) {
              preview.applyLiveStreamDelta(event.modelId, event.delta);
            }
            setAgenticActivity((current) =>
              applyEventToAgenticState({
                agenticOptions,
                current,
                event,
              }),
            );
            let finalizedResult: ModelResult | undefined;
            setResults((current) => {
              const next = current.map((item) => applyEventToResult(item, event));
              if (
                (event.type === "done" || event.type === "error") &&
                typeof event.modelId === "string"
              ) {
                finalizedResult = next.find(
                  (item) => item.modelId === event.modelId,
                );
              }
              return next;
            });
            if (finalizedResult) {
              preview.syncLiveStreamMetricFromResult(finalizedResult);
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
          error instanceof Error ? error.message : "Unable to compare right now.";
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
  function openHostModelExplorer(index: number) {
    setHostModelTargetIndex(index);
    setHostModelError("");
    setHostModelSelectedId("");
    setIsHostModelExplorerOpen(true);
  }
  function closeHostModelExplorer() {
    if (hostModelLoading || hostModelSaving) return;
    setIsHostModelExplorerOpen(false);
    setHostModelError("");
  }
  async function loadHostModels() {
    setHostModelLoading(true);
    setHostModelError("");
    try {
      const response = await fetch("/api/models/explore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: hostModelUrl,
          apiKey: hostModelApiKey,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        models?: RemoteHostModelEntry[];
        resolvedBaseUrl?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to load models from that host.");
      }
      const nextModels = payload?.models ?? [];
      setHostModelEntries(nextModels);
      setHostModelResolvedBaseUrl(payload?.resolvedBaseUrl ?? "");
      setHostModelSelectedId(nextModels[0]?.id ?? "");
    } catch (error) {
      setHostModelEntries([]);
      setHostModelResolvedBaseUrl("");
      setHostModelSelectedId("");
      setHostModelError(
        error instanceof Error
          ? error.message
          : "Unable to load models from that host.",
      );
    } finally {
      setHostModelLoading(false);
    }
  }
  async function importHostModel(model: RemoteHostModelEntry) {
    if (hostModelTargetIndex == null || !hostModelResolvedBaseUrl) return;
    const nextConfig = buildOpenAICompatibleModelConfig(
      model.id,
      hostModelResolvedBaseUrl,
      hostModelApiKey.trim() || undefined,
    );
    const existingMatch = catalog.find((entry) => entry.config === nextConfig);
    if (existingMatch) {
      panelController.handleModelChange(hostModelTargetIndex, existingMatch.config);
      setIsHostModelExplorerOpen(false);
      return;
    }
    setHostModelSaving(true);
    setHostModelError("");
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: model.id,
          llmString: nextConfig,
          supportsImageInput: hostModelSupportsImageInput,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        model?: GatewayModel;
      } | null;
      if (!response.ok || !payload?.model) {
        throw new Error(payload?.error ?? "Unable to import that model.");
      }
      const updatedCatalog = catalog.some(
        (entry) => entry.config === payload.model?.config,
      )
        ? catalog
        : [payload.model, ...catalog];
      setCatalog(updatedCatalog);
      panelController.handleModelChange(
        hostModelTargetIndex,
        payload.model.config,
        updatedCatalog,
      );
      setIsHostModelExplorerOpen(false);
    } catch (error) {
      setHostModelError(
        error instanceof Error ? error.message : "Unable to import that model.",
      );
    } finally {
      setHostModelSaving(false);
    }
  }
  function handleNewRun() {
    startBlankWorkspace();
  }
  const shouldShowInitialLoadingState =
    isSessionPending ||
    !hasBootstrappedClientState ||
    (Boolean(initialRunId) && isInitialRouteRunPending);
  const initialLoadingTitle =
    initialRunId && !isSessionPending
      ? "Loading saved run"
      : "Preparing workspace";
  const initialLoadingMessage =
    initialRunId && !isSessionPending
      ? `Restoring run ${initialRunId} before the workspace renders.`
      : "Restoring session and local workspace state before we paint the app.";
  const canAddPanel =
    !isLoadingModels && selectedModels.length < maxSelectableCards;
  const canRemovePanel = selectedModels.length > minSelectableCards;
  const isEditLocked = isRunning || results.some((r) => r.status !== "idle");
  const cardSizeConfig = CARD_SIZE_CONFIG[cardSize];
  const aggregateStatus = buildAggregateStatusSummary({
    catalog,
    liveStreamMetrics: preview.liveStreamMetrics,
    results,
    selectedModels,
  });
  return {
    activeRunId,
    activePreviewErrors,
    activePreviewId,
    activePreviewModel,
    activePreviewResult,
    activePreviewRevisionState,
    activePreviewToolErrors,
    activePreviewVisualDiff,
    agenticActivity,
    agenticOptions,
    aggregateStatus,
    authError,
    canAddPanel,
    canRemovePanel,
    cardSize,
    cardSizeConfig,
    catalog,
    closeHostModelExplorer,
    currentModelCardModeKey,
    dragOverIndex,
    dragSourceIndex,
    errorMessage,
    evalHarnessLinks: EVAL_HARNESS_LINKS,
    fileInputRef,
    formatTimestamp,
    freshModelIds,
    getDisplayOutputMetrics: preview.getDisplayOutputMetrics,
    getUserDisplayName,
    getUserMonogram,
    handleAnonymousSignIn,
    handleCompare,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    handleDrop,
    handleFileChange: panelController.handleFileChange,
    handleGitHubSignIn,
    handleModelChange: panelController.handleModelChange,
    handleNewRun,
    handleReferenceImageMouseMove,
    handleRemovePanel: panelController.handleRemovePanel,
    handleSignOut,
    handleTargetPanelCount: panelController.handleTargetPanelCount,
    handleToggleAgenticMode,
    handleVote,
    hostModelApiKey,
    hostModelEntries,
    hostModelError,
    hostModelLoading,
    hostModelResolvedBaseUrl,
    hostModelSaving,
    hostModelSelectedId,
    hostModelSupportsImageInput,
    hostModelUrl,
    hydrateRun,
    imageDataUrl,
    imageName,
    importHostModel,
    initialLoadingMessage,
    initialLoadingTitle,
    isAnonymousUser,
    isAuthActionPending,
    isClient,
    isEditLocked,
    isHistoryOpen,
    isHostModelExplorerOpen,
    isHydratingRouteRun,
    isInitialRouteRunPending,
    isLoadingModels,
    isLoadingRuns,
    isPromptModalOpen,
    isRunning,
    isSessionPending,
    isSiteMenuOpen,
    loadHostModels,
    loadRuns,
    maxSelectableCards,
    minSelectableCards,
    modelSortMode,
    modelsError,
    nowMs,
    openHostModelExplorer,
    openPickerIndex,
    outputMode,
    pathname,
    preview,
    previewErrors,
    previewOverrides,
    previewToolErrors,
    prompt,
    recentModelConfigs,
    referenceImageFrameRef,
    resetReferenceImagePan,
    results,
    runs,
    runsError,
    selectedModels,
    selectedRevisionIds,
    setAgenticOptions,
    setCardSize,
    setHostModelApiKey,
    setHostModelSelectedId,
    setHostModelSupportsImageInput,
    setHostModelUrl,
    setIsHistoryOpen,
    setIsHostModelExplorerOpen,
    setIsPromptModalOpen,
    setIsSiteMenuOpen,
    setModelSortMode,
    setOpenPickerIndex,
    setOutputMode,
    setPrompt,
    setSelectedRevisionIds,
    shouldShowInitialLoadingState,
    signedInUser,
    siteMenuRef,
    visualDiffs,
    votePendingByKey,
  };
}
