"use client";

import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import { useEffect, useEffectEvent } from "react";

import {
  type AgenticCardState,
  createEmptyResult,
  createEmptyResults,
  createInitialModelCardWorkspaceState,
  DEFAULT_AGENTIC_OPTIONS,
  getModelCardModeKey,
  getRouteAgenticEnabled,
  LOCAL_DRAFT_KEY,
  LOCAL_RECENT_MODELS_KEY,
  toDataUrl,
  type ModelCardModeKey,
  type ModelCardWorkspaceState,
} from "@/components/battle/lib/client-state";
import type { VisualDiffState } from "@/components/battle/lib/view-shared";
import {
  getMaxSelectableModelCards,
  getMinSelectableModelCards,
  getPreferredAvailableModels,
  getSelectableCatalogModels,
  mergeRecentModelConfigs,
  syncModelLabels,
} from "@/components/battle/lib/model-catalog";
import { toCompareModel } from "@/lib/models";
import type {
  AgenticOptions,
  CompareModel,
  GatewayModel,
  ModelResult,
  SavedRun,
} from "@/lib/types";

type UseBattleWorkspaceEffectsArgs = {
  activeRunId: string | null;
  agenticActivity: Record<string, AgenticCardState>;
  agenticOptions: AgenticOptions;
  allowLocalDevAutoAuth: boolean;
  buildCurrentModelCardWorkspaceState: () => ModelCardWorkspaceState;
  catalog: GatewayModel[];
  currentModelCardModeKey: ModelCardModeKey;
  freshModelIds: string[];
  handleAnonymousSignIn: () => Promise<void>;
  hasBootstrappedClientStateSetter: Dispatch<SetStateAction<boolean>>;
  hydrateRouteRun: (runId: string) => Promise<void>;
  hydrateRun: (
    run: SavedRun,
    options?: {
      syncRoute?: boolean;
      replaceRoute?: boolean;
    },
  ) => void;
  imageDataUrl: string;
  imageName: string;
  initialAgenticEnabled: boolean;
  initialRunId: string | null;
  isRunning: boolean;
  isSessionPending: boolean;
  isSiteMenuOpen: boolean;
  loadRuns: (options?: { hydrateLatest?: boolean }) => Promise<void>;
  modelCardStatesByMode: Record<ModelCardModeKey, ModelCardWorkspaceState>;
  pathname: string;
  pendingDraftModeKeyRef: MutableRefObject<ModelCardModeKey>;
  pendingDraftModelConfigsByModeRef: MutableRefObject<
    Partial<Record<ModelCardModeKey, string[]>> | null
  >;
  previewErrors: Record<string, string[]>;
  previewOverrides: Record<string, string>;
  previewToolErrors: Record<string, string[]>;
  prompt: string;
  recentModelConfigs: string[];
  restoredDraftRef: MutableRefObject<boolean>;
  results: ModelResult[];
  routeRunHydratedRef: MutableRefObject<string | null>;
  runsSetter: Dispatch<SetStateAction<SavedRun[]>>;
  runsErrorSetter: Dispatch<SetStateAction<string>>;
  selectedModels: CompareModel[];
  selectedRevisionIds: Record<string, string>;
  sessionUserId: string | null;
  setActiveRunId: Dispatch<SetStateAction<string | null>>;
  setAgenticActivity: Dispatch<SetStateAction<Record<string, AgenticCardState>>>;
  setAgenticOptions: Dispatch<SetStateAction<AgenticOptions>>;
  setCatalog: Dispatch<SetStateAction<GatewayModel[]>>;
  setErrorMessage: Dispatch<SetStateAction<string>>;
  setFreshModelIds: Dispatch<SetStateAction<string[]>>;
  setImageDataUrl: Dispatch<SetStateAction<string>>;
  setImageName: Dispatch<SetStateAction<string>>;
  setIsInitialRouteRunPending: Dispatch<SetStateAction<boolean>>;
  setIsLoadingModels: Dispatch<SetStateAction<boolean>>;
  setIsLoadingRuns: Dispatch<SetStateAction<boolean>>;
  setIsSiteMenuOpen: Dispatch<SetStateAction<boolean>>;
  setModelCardStatesByMode: Dispatch<
    SetStateAction<Record<ModelCardModeKey, ModelCardWorkspaceState>>
  >;
  setModelsError: Dispatch<SetStateAction<string>>;
  setNowMs: Dispatch<SetStateAction<number>>;
  setPreviewErrors: Dispatch<SetStateAction<Record<string, string[]>>>;
  setPreviewOverrides: Dispatch<SetStateAction<Record<string, string>>>;
  setPreviewToolErrors: Dispatch<SetStateAction<Record<string, string[]>>>;
  setPrompt: Dispatch<SetStateAction<string>>;
  setRecentModelConfigs: Dispatch<SetStateAction<string[]>>;
  setResults: Dispatch<SetStateAction<ModelResult[]>>;
  setSelectedModels: Dispatch<SetStateAction<CompareModel[]>>;
  setSelectedRevisionIds: Dispatch<SetStateAction<Record<string, string>>>;
  setVisualDiffs: Dispatch<SetStateAction<Record<string, VisualDiffState>>>;
  signedInUser: unknown;
  siteMenuRef: RefObject<HTMLDivElement | null>;
  startBlankWorkspace: (options?: {
    agenticEnabled?: boolean;
    syncRoute?: boolean;
  }) => void;
  attemptedLocalDevSignInRef: MutableRefObject<boolean>;
  visualDiffs: Record<string, VisualDiffState>;
  lastSavedDraftRef: MutableRefObject<string | null>;
};

export function useBattleWorkspaceEffects({
  activeRunId,
  agenticActivity,
  agenticOptions,
  allowLocalDevAutoAuth,
  attemptedLocalDevSignInRef,
  buildCurrentModelCardWorkspaceState,
  catalog,
  currentModelCardModeKey,
  freshModelIds,
  handleAnonymousSignIn,
  hasBootstrappedClientStateSetter,
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
  runsErrorSetter,
  runsSetter,
  selectedModels,
  selectedRevisionIds,
  sessionUserId,
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
}: UseBattleWorkspaceEffectsArgs) {
  const loadRunsForCurrentSession = useEffectEvent(
    (options?: { hydrateLatest?: boolean }) => {
      void loadRuns(options);
    },
  );

  const hydrateRouteRunForCurrentSession = useEffectEvent((runId: string) => {
    void hydrateRouteRun(runId);
  });

  const bootstrapLocalDevSession = useEffectEvent(() => {
    void handleAnonymousSignIn();
  });

  useEffect(() => {
    try {
      const routeAgenticEnabled = getRouteAgenticEnabled(
        pathname,
        initialAgenticEnabled,
      );

      pendingDraftModeKeyRef.current = getModelCardModeKey(routeAgenticEnabled);
      const rawDraft = window.localStorage.getItem(LOCAL_DRAFT_KEY);
      if (rawDraft) {
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
            enabled: routeAgenticEnabled,
            maxTurns: Math.max(
              1,
              Math.min(
                12,
                Math.round(
                  draft.agenticOptions.maxTurns ??
                    DEFAULT_AGENTIC_OPTIONS.maxTurns,
                ),
              ),
            ),
          };
          pendingDraftModeKeyRef.current = getModelCardModeKey(
            routeAgenticEnabled,
          );
          setAgenticOptions(nextAgenticOptions);
        }
      }

      const rawRecentModels = window.localStorage.getItem(
        LOCAL_RECENT_MODELS_KEY,
      );
      if (rawRecentModels) {
        const parsedRecentModels = JSON.parse(rawRecentModels) as string[];
        if (Array.isArray(parsedRecentModels)) {
          setRecentModelConfigs(
            parsedRecentModels.filter((value) => typeof value === "string"),
          );
        }
      }
    } catch {
      // Ignore malformed local draft state.
    } finally {
      hasBootstrappedClientStateSetter(true);
    }
  }, [hasBootstrappedClientStateSetter, initialAgenticEnabled, pathname, pendingDraftModeKeyRef, pendingDraftModelConfigsByModeRef, restoredDraftRef, setAgenticOptions, setImageDataUrl, setImageName, setPrompt, setRecentModelConfigs]);

  useEffect(() => {
    if (isSessionPending) return;

    if (!sessionUserId) {
      runsSetter([]);
      runsErrorSetter("");
      setIsLoadingRuns(false);
      setIsInitialRouteRunPending(false);
      routeRunHydratedRef.current = null;
      return;
    }

    loadRunsForCurrentSession({ hydrateLatest: true });
  }, [isSessionPending, loadRunsForCurrentSession, routeRunHydratedRef, runsErrorSetter, runsSetter, sessionUserId, setIsInitialRouteRunPending, setIsLoadingRuns]);

  useEffect(() => {
    if (isSessionPending || !sessionUserId) return;

    if (!initialRunId) {
      setIsInitialRouteRunPending(false);
      routeRunHydratedRef.current = null;
      return;
    }

    if (routeRunHydratedRef.current === initialRunId) return;
    hydrateRouteRunForCurrentSession(initialRunId);
  }, [hydrateRouteRunForCurrentSession, initialRunId, isSessionPending, routeRunHydratedRef, sessionUserId, setIsInitialRouteRunPending]);

  useEffect(() => {
    if (!isSiteMenuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!siteMenuRef.current?.contains(event.target as Node)) {
        setIsSiteMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsSiteMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSiteMenuOpen, setIsSiteMenuOpen, siteMenuRef]);

  useEffect(() => {
    setIsSiteMenuOpen(false);
  }, [pathname, setIsSiteMenuOpen]);

  const handleHistoryPop = useEffectEvent(() => {
    const nextPath = window.location.pathname;
    const runId = (() => {
      const queryRunId = new URLSearchParams(window.location.search).get("runId");
      return queryRunId;
    })();

    if (runId) {
      routeRunHydratedRef.current = null;
      hydrateRouteRunForCurrentSession(runId);
      return;
    }

    if (nextPath === "/run-agentic") {
      startBlankWorkspace({ agenticEnabled: true, syncRoute: false });
      return;
    }

    if (nextPath === "/run-generate") {
      startBlankWorkspace({ agenticEnabled: false, syncRoute: false });
      return;
    }

    startBlankWorkspace({ syncRoute: false });
  });

  useEffect(() => {
    function handlePopState() {
      handleHistoryPop();
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [handleHistoryPop]);

  useEffect(() => {
    if (!allowLocalDevAutoAuth) return;
    if (attemptedLocalDevSignInRef.current) return;
    if (isSessionPending || signedInUser) return;

    attemptedLocalDevSignInRef.current = true;
    bootstrapLocalDevSession();
  }, [
    allowLocalDevAutoAuth,
    attemptedLocalDevSignInRef,
    bootstrapLocalDevSession,
    isSessionPending,
    signedInUser,
  ]);

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

        const resolveDraftModels = (
          configs: string[] | undefined,
          modeKey: ModelCardModeKey,
        ) =>
          (configs ?? [])
            .map((config) =>
              nextCatalog.find((model) => model.config === config),
            )
            .filter(
              (model): model is GatewayModel =>
                model != null &&
                getSelectableCatalogModels(nextCatalog, modeKey === "agentic").some(
                  (entry) => entry.config === model.config,
                ),
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
            "standard",
          ),
          agentic: resolveDraftModels(
            pendingDraftModelConfigsByModeRef.current?.agentic,
            "agentic",
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
            setSelectedRevisionIds({});
            setVisualDiffs({});
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

        runsSetter((current) =>
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
  }, [
    pendingDraftModeKeyRef,
    pendingDraftModelConfigsByModeRef,
    runsSetter,
    setActiveRunId,
    setAgenticActivity,
    setCatalog,
    setIsLoadingModels,
    setModelCardStatesByMode,
    setModelsError,
    setPreviewErrors,
    setPreviewOverrides,
    setPreviewToolErrors,
    setResults,
    setSelectedModels,
    setSelectedRevisionIds,
    setVisualDiffs,
  ]);

  useEffect(() => {
    try {
      const currentWorkspaceState = buildCurrentModelCardWorkspaceState();
      const selectedModelConfigsByMode: Record<ModelCardModeKey, string[]> = {
        standard:
          (
            currentModelCardModeKey === "standard"
              ? currentWorkspaceState
              : modelCardStatesByMode.standard
          ).selectedModels.map((model) => model.config ?? model.id),
        agentic:
          (
            currentModelCardModeKey === "agentic"
              ? currentWorkspaceState
              : modelCardStatesByMode.agentic
          ).selectedModels.map((model) => model.config ?? model.id),
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
    activeRunId,
    agenticActivity,
    agenticOptions,
    buildCurrentModelCardWorkspaceState,
    currentModelCardModeKey,
    imageDataUrl,
    imageName,
    lastSavedDraftRef,
    modelCardStatesByMode,
    previewErrors,
    previewOverrides,
    previewToolErrors,
    prompt,
    results,
    selectedModels,
    selectedRevisionIds,
    visualDiffs,
  ]);

  useEffect(() => {
    setRecentModelConfigs((current) =>
      mergeRecentModelConfigs(
        current,
        selectedModels.map((model) => model.config ?? model.id),
      ),
    );
  }, [selectedModels, setRecentModelConfigs]);

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
  }, [isRunning, setNowMs]);

  useEffect(() => {
    if (!freshModelIds.length) return;

    const timeoutId = window.setTimeout(() => {
      setFreshModelIds([]);
    }, 1100);

    return () => window.clearTimeout(timeoutId);
  }, [freshModelIds, setFreshModelIds]);

  useEffect(() => {
    if (!catalog.length) return;

    const minCards = getMinSelectableModelCards(catalog, agenticOptions.enabled);
    const maxCards = getMaxSelectableModelCards(catalog, agenticOptions.enabled);

    if (selectedModels.length >= minCards && selectedModels.length <= maxCards) {
      return;
    }

    if (selectedModels.length > maxCards) {
      setSelectedModels((current) => current.slice(0, maxCards));
      setResults((current) => current.slice(0, maxCards));
      return;
    }

    const additions = getPreferredAvailableModels(
      catalog,
      selectedModels.map((model) => model.config ?? model.id),
      minCards - selectedModels.length,
      recentModelConfigs,
      agenticOptions.enabled,
    ).map(toCompareModel);

    if (!additions.length) return;

    setSelectedModels((current) => [...current, ...additions]);
    setResults((current) => [...current, ...additions.map(createEmptyResult)]);
  }, [
    agenticOptions.enabled,
    catalog,
    recentModelConfigs,
    selectedModels,
    setResults,
    setSelectedModels,
  ]);

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
      setVisualDiffs({});
      setErrorMessage("");
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [setErrorMessage, setImageDataUrl, setImageName, setVisualDiffs]);
}
