"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { looksLikeHtml, unwrapHtmlCodeFence } from "@/components/battle/lib/preview";
import type {
  PreviewScreenshot,
  VisualDiffState,
} from "@/components/battle/lib/view-shared";
import type {
  CompareModel,
  ModelResult,
  SavedRun,
} from "@/lib/types";

import {
  animateBetweenRects,
  appendOutputRevision,
  applyLiveMetricDelta,
  buildVisualDiff,
  createOutputRevision,
  createLiveMetricBuffer,
  getDisplayOutputMetrics,
  getSelectedOutputRevision,
  getToolLabel,
  getVisualDiffRequestKey,
  liveElapsed,
  readTraceEvents,
  shouldReduceMotion,
  snapshotRect,
  type LiveStreamMetricSnapshot,
  type OutputMode,
  uid,
} from "@/components/battle/lib/client-state";

type UseBattlePreviewControllerArgs = {
  activeRunId: string | null;
  imageDataUrl: string;
  outputMode: OutputMode;
  previewErrors: Record<string, string[]>;
  previewOverrides: Record<string, string>;
  previewToolErrors: Record<string, string[]>;
  results: ModelResult[];
  selectedModels: CompareModel[];
  selectedRevisionIds: Record<string, string>;
  setPreviewErrors: Dispatch<SetStateAction<Record<string, string[]>>>;
  setPreviewOverrides: Dispatch<SetStateAction<Record<string, string>>>;
  setPreviewToolErrors: Dispatch<SetStateAction<Record<string, string[]>>>;
  setResults: Dispatch<SetStateAction<ModelResult[]>>;
  setSelectedRevisionIds: Dispatch<SetStateAction<Record<string, string>>>;
  setVisualDiffs: Dispatch<SetStateAction<Record<string, VisualDiffState>>>;
  updateRun: (runId: string, updater: (run: SavedRun) => SavedRun) => void;
  visualDiffs: Record<string, VisualDiffState>;
};

export function useBattlePreviewController({
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
}: UseBattlePreviewControllerArgs) {
  const [activePreviewModelId, setActivePreviewModelId] = useState<string | null>(
    null,
  );
  const [isPreviewClosing, setIsPreviewClosing] = useState(false);
  const [liveStreamMetrics, setLiveStreamMetrics] = useState<
    Record<string, LiveStreamMetricSnapshot>
  >({});

  const previewCardShellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previewFrameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const activePreviewViewportRef = useRef<HTMLDivElement | null>(null);
  const previewOpenRectRef = useRef<ReturnType<typeof snapshotRect>>(null);
  const previewViewportAnimationRef = useRef<Animation | null>(null);
  const previewBackdropAnimationRef = useRef<Animation | null>(null);
  const activePreviewModelIdRef = useRef<string | null>(null);
  const isPreviewClosingRef = useRef(false);
  const liveStreamMetricBuffersRef = useRef<
    Record<string, ReturnType<typeof createLiveMetricBuffer>>
  >({});
  const resultsRef = useRef<ModelResult[]>(results);
  const previewOverridesRef = useRef<Record<string, string>>({});
  const previewCommandResolvers = useRef<
    Record<
      string,
      {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
      }
    >
  >({});
  const previewReadyRef = useRef<Record<string, boolean>>({});
  const previewReadyResolvers = useRef<
    Record<string, Array<{ resolve: () => void; reject: (error: Error) => void }>>
  >({});
  const visualDiffJobTokensRef = useRef<Record<string, string>>({});

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    activePreviewModelIdRef.current = activePreviewModelId;
  }, [activePreviewModelId]);

  useEffect(() => {
    isPreviewClosingRef.current = isPreviewClosing;
  }, [isPreviewClosing]);

  useEffect(() => {
    previewOverridesRef.current = previewOverrides;
  }, [previewOverrides]);

  const requestServerScreenshot = useCallback(async (markup: string) => {
    const response = await fetch("/api/preview-screenshot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        markup,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          dataUrl?: unknown;
          width?: unknown;
          height?: unknown;
          capturedAt?: unknown;
          error?: unknown;
        }
      | null;

    if (!response.ok) {
      throw new Error(
        typeof payload?.error === "string" && payload.error.trim()
          ? payload.error
          : "Preview screenshot capture failed.",
      );
    }

    if (typeof payload?.dataUrl !== "string" || !payload.dataUrl) {
      throw new Error("Preview screenshot capture returned an invalid payload.");
    }

    return {
      dataUrl: payload.dataUrl,
      width: typeof payload.width === "number" ? payload.width : undefined,
      height: typeof payload.height === "number" ? payload.height : undefined,
      capturedAt:
        typeof payload.capturedAt === "string"
          ? payload.capturedAt
          : new Date().toISOString(),
    } satisfies PreviewScreenshot;
  }, []);

  const waitForPreviewReady = useCallback((previewId: string) => {
    if (previewReadyRef.current[previewId]) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve: () => {
          window.clearTimeout(timeoutId);
          resolve();
        },
        reject: (error: Error) => {
          window.clearTimeout(timeoutId);
          reject(error);
        },
      };

      const timeoutId = window.setTimeout(() => {
        const pending = previewReadyResolvers.current[previewId];
        if (pending) {
          previewReadyResolvers.current[previewId] = pending.filter(
            (entry) => entry !== waiter,
          );
          if (!previewReadyResolvers.current[previewId].length) {
            delete previewReadyResolvers.current[previewId];
          }
        }
        waiter.reject(new Error("Preview frame is not ready yet."));
      }, 10_000);

      previewReadyResolvers.current[previewId] = [
        ...(previewReadyResolvers.current[previewId] ?? []),
        waiter,
      ];
    });
  }, []);

  const sendPreviewCommand = useCallback(
    async (previewId: string, action: string) => {
      await waitForPreviewReady(previewId);

      const frame = previewFrameRefs.current[previewId];
      const target = frame?.contentWindow;
      if (!target) {
        throw new Error("Preview frame is not ready yet.");
      }

      return new Promise<unknown>((resolve, reject) => {
        const commandId = uid();
        previewCommandResolvers.current[commandId] = { resolve, reject };

        target.postMessage(
          {
            source: "battle-preview-parent",
            previewId,
            commandId,
            action,
          },
          "*",
        );

        window.setTimeout(() => {
          const pending = previewCommandResolvers.current[commandId];
          if (!pending) return;
          delete previewCommandResolvers.current[commandId];
          pending.reject(new Error("Preview command timed out."));
        }, 20_000);
      });
    },
    [waitForPreviewReady],
  );

  const refreshVisualDiff = useCallback(
    async (previewId: string) => {
      if (!imageDataUrl) return;

      const previewIndex = selectedModels.findIndex(
        (entry, index) => `${entry.id}-${index}` === previewId,
      );
      if (previewIndex < 0) return;

      const model = selectedModels[previewIndex];
      const result = results[previewIndex];
      const revisionState = getSelectedOutputRevision(
        result,
        previewOverrides[model.id],
        selectedRevisionIds[model.id],
      );
      const markup = unwrapHtmlCodeFence(
        revisionState.selectedRevision?.html ?? "",
      );
      const requestKey = getVisualDiffRequestKey(result?.completedAt, markup);

      const jobToken = uid();
      visualDiffJobTokensRef.current[previewId] = jobToken;
      setVisualDiffs((current) => ({
        ...current,
        [previewId]: {
          ...(current[previewId] ?? { status: "idle" as const }),
          requestKey,
          status: "running",
          error: undefined,
        },
      }));

      try {
        const screenshot = await requestServerScreenshot(markup);
        const visualState = await buildVisualDiff(imageDataUrl, screenshot);
        if (visualDiffJobTokensRef.current[previewId] !== jobToken) return;

        setVisualDiffs((current) => ({
          ...current,
          [previewId]: {
            ...visualState,
            requestKey,
          },
        }));

        const modelId = model.id;
        setResults((current) =>
          current.map((entry) =>
            entry.modelId === modelId
              ? {
                  ...entry,
                  stats: {
                    ...(entry.stats ?? {}),
                    visualAnalysis: {
                      similarity: visualState.similarity,
                      mismatchRatio: visualState.mismatchRatio,
                      meanChannelDelta: visualState.meanChannelDelta,
                      width: visualState.width,
                      height: visualState.height,
                      capturedAt: visualState.capturedAt,
                    },
                  },
                }
              : entry,
          ),
        );
      } catch (error) {
        if (visualDiffJobTokensRef.current[previewId] !== jobToken) return;
        setVisualDiffs((current) => ({
          ...current,
          [previewId]: {
            ...(current[previewId] ?? { status: "idle" as const }),
            requestKey,
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : "Unable to capture preview for visual diff.",
          },
        }));
      }
    },
    [
      imageDataUrl,
      previewOverrides,
      requestServerScreenshot,
      results,
      selectedModels,
      selectedRevisionIds,
      setResults,
      setVisualDiffs,
    ],
  );

  useEffect(() => {
    if (!imageDataUrl) return;

    for (const [index, model] of selectedModels.entries()) {
      const result = results[index];
      if (!result) continue;

      const previewId = `${model.id}-${index}`;
      const visualState = visualDiffs[previewId];
      const revisionState = getSelectedOutputRevision(
        result,
        previewOverrides[model.id],
        selectedRevisionIds[model.id],
      );
      const markup = unwrapHtmlCodeFence(
        revisionState.selectedRevision?.html ?? "",
      );
      const requestKey = getVisualDiffRequestKey(result.completedAt, markup);
      const hasRenderableMarkup = looksLikeHtml(markup);
      const isFinalState =
        result.status === "done" || result.status === "error";
      const visualIsFresh = visualState?.requestKey === requestKey;

      if (
        hasRenderableMarkup &&
        isFinalState &&
        visualState?.status !== "running" &&
        !visualIsFresh
      ) {
        void refreshVisualDiff(previewId);
      }
    }
  }, [
    imageDataUrl,
    previewOverrides,
    refreshVisualDiff,
    results,
    selectedModels,
    selectedRevisionIds,
    visualDiffs,
  ]);

  const closePreview = useCallback(() => {
    const currentPreviewModelId = activePreviewModelIdRef.current;
    if (!currentPreviewModelId || isPreviewClosingRef.current) return;

    if (shouldReduceMotion()) {
      setActivePreviewModelId(null);
      return;
    }

    const viewport = activePreviewViewportRef.current;
    const sourceRect = snapshotRect(
      previewCardShellRefs.current[currentPreviewModelId],
    );
    const currentRect = snapshotRect(viewport);
    if (!viewport || !sourceRect || !currentRect) {
      setActivePreviewModelId(null);
      return;
    }

    setIsPreviewClosing(true);
    previewViewportAnimationRef.current?.cancel();
    previewViewportAnimationRef.current = animateBetweenRects(
      viewport,
      sourceRect,
      currentRect,
      "close",
    );

    const backdrop = viewport.closest(".preview-modal-backdrop");
    if (backdrop instanceof HTMLElement) {
      previewBackdropAnimationRef.current?.cancel();
      previewBackdropAnimationRef.current = backdrop.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        {
          duration: 180,
          easing: "ease-out",
          fill: "both",
        },
      );
    }

    const finalizeClose = () => {
      previewViewportAnimationRef.current = null;
      previewBackdropAnimationRef.current = null;
      setIsPreviewClosing(false);
      setActivePreviewModelId(null);
    };

    previewViewportAnimationRef.current.addEventListener("finish", finalizeClose, {
      once: true,
    });
    previewViewportAnimationRef.current.addEventListener("cancel", finalizeClose, {
      once: true,
    });
  }, []);

  useEffect(() => {
    if (outputMode !== "preview" && activePreviewModelId) {
      closePreview();
    }
  }, [activePreviewModelId, closePreview, outputMode]);

  useEffect(() => {
    if (!activePreviewModelId) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePreview();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePreviewModelId, closePreview]);

  useEffect(() => {
    if (!activePreviewModelId || shouldReduceMotion()) {
      previewOpenRectRef.current = null;
      return;
    }

    const sourceRect = previewOpenRectRef.current;
    const viewport = activePreviewViewportRef.current;
    if (!sourceRect || !viewport) return;

    const frameId = window.requestAnimationFrame(() => {
      const targetRect = snapshotRect(viewport);
      if (!targetRect) return;

      previewViewportAnimationRef.current?.cancel();
      previewViewportAnimationRef.current = animateBetweenRects(
        viewport,
        sourceRect,
        targetRect,
        "open",
      );
      previewOpenRectRef.current = null;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activePreviewModelId]);

  useEffect(() => {
    function handlePreviewMessage(event: MessageEvent) {
      const data = event.data;
      if (
        !data ||
        typeof data !== "object" ||
        data.source !== "battle-preview" ||
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

      if (data.kind === "ready") {
        previewReadyRef.current[data.previewId] = true;
        const pending = previewReadyResolvers.current[data.previewId] ?? [];
        delete previewReadyResolvers.current[data.previewId];
        pending.forEach(({ resolve }) => resolve());
        return;
      }

      if (
        data.kind === "error" &&
        typeof data.message === "string" &&
        data.message.trim()
      ) {
        setPreviewErrors((current) => {
          const existing = current[data.previewId] ?? [];
          if (existing.includes(data.message)) return current;

          return {
            ...current,
            [data.previewId]: [...existing, data.message],
          };
        });
        return;
      }

      if (
        (data.kind === "command-result" || data.kind === "command-error") &&
        typeof data.commandId === "string"
      ) {
        const pending = previewCommandResolvers.current[data.commandId];
        if (!pending) return;

        delete previewCommandResolvers.current[data.commandId];

        if (
          data.kind === "command-error" &&
          typeof data.error === "string" &&
          data.error.trim()
        ) {
          pending.reject(new Error(data.error));
          return;
        }

        pending.resolve(data.payload);
      }
    }

    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, [setPreviewErrors]);

  const getEffectiveMarkupForModelId = useCallback((modelId: string) => {
    const result = resultsRef.current.find((entry) => entry.modelId === modelId);
    return (
      previewOverridesRef.current[modelId] ??
      result?.repairedText ??
      result?.text ??
      ""
    );
  }, []);

  const dismissPreviewToolErrors = useCallback(
    (previewId: string) => {
      setPreviewToolErrors((current) => {
        if (!(previewId in current)) return current;

        const next = { ...current };
        delete next[previewId];
        return next;
      });
    },
    [setPreviewToolErrors],
  );

  const openPreview = useCallback(
    (modelId: string) => {
      if (isPreviewClosing) return;
      previewOpenRectRef.current = snapshotRect(
        previewCardShellRefs.current[modelId],
      );
      setActivePreviewModelId(modelId);
    },
    [isPreviewClosing],
  );

  const resetLiveStreamMetric = useCallback((modelId: string) => {
    delete liveStreamMetricBuffersRef.current[modelId];
    setLiveStreamMetrics((current) => {
      if (!(modelId in current)) return current;

      const next = { ...current };
      delete next[modelId];
      return next;
    });
  }, []);

  const resetAllLiveStreamMetrics = useCallback(() => {
    liveStreamMetricBuffersRef.current = {};
    setLiveStreamMetrics({});
  }, []);

  const applyLiveStreamDelta = useCallback((modelId: string, delta: string) => {
    if (!delta) return;

    const buffer =
      liveStreamMetricBuffersRef.current[modelId] ?? createLiveMetricBuffer();
    const next = applyLiveMetricDelta(buffer, delta);
    liveStreamMetricBuffersRef.current[modelId] = next.buffer;

    setLiveStreamMetrics((current) => ({
      ...current,
      [modelId]: next.snapshot,
    }));
  }, []);

  const syncLiveStreamMetricFromResult = useCallback((result: ModelResult) => {
    const currentLiveMetric =
      liveStreamMetricBuffersRef.current[result.modelId]?.peakTokensPerSecond;

    setLiveStreamMetrics((current) => ({
      ...current,
      [result.modelId]: {
        outputTokens: result.usage?.outputTokens,
        totalTokens: result.usage?.totalTokens,
        peakTokensPerSecond:
          currentLiveMetric ?? result.stats?.tokensPerSecond,
      },
    }));
  }, []);

  const getPreviewIdForModelId = useCallback(
    (modelId: string) => {
      const index = selectedModels.findIndex((model) => model.id === modelId);
      return index >= 0 ? `${selectedModels[index].id}-${index}` : null;
    },
    [selectedModels],
  );

  const handleToolCallEvent = useCallback(
    async (event: Record<string, unknown>) => {
      if (
        typeof event.modelId !== "string" ||
        typeof event.toolCallId !== "string" ||
        typeof event.toolName !== "string"
      ) {
        return;
      }

      if (
        event.toolName !== "get_screenshot" &&
        event.toolName !== "get_console_logs" &&
        event.toolName !== "get_html" &&
        event.toolName !== "set_html"
      ) {
        return;
      }

      if (event.toolName === "get_html") {
        await fetch("/api/compare/tool-response", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toolCallId: event.toolCallId,
            output: {
              html: getEffectiveMarkupForModelId(event.modelId),
            },
          }),
        });
        return;
      }

      if (event.toolName === "get_screenshot") {
        await fetch("/api/compare/tool-response", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toolCallId: event.toolCallId,
            output: await requestServerScreenshot(
              getEffectiveMarkupForModelId(event.modelId),
            ),
          }),
        });
        return;
      }

      if (event.toolName === "set_html") {
        const modelId = event.modelId;
        const input =
          typeof event.input === "object" && event.input ? event.input : null;
        const html =
          input && typeof (input as { html?: unknown }).html === "string"
            ? (input as { html: string }).html
            : "";

        if (!html.trim()) {
          await fetch("/api/compare/tool-response", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              toolCallId: event.toolCallId,
              error: "set_html requires a non-empty html string.",
            }),
          });
          return;
        }

        setPreviewOverrides((current) => ({
          ...current,
          [modelId]: html,
        }));
        previewOverridesRef.current = {
          ...previewOverridesRef.current,
          [modelId]: html,
        };
        const toolRevision = createOutputRevision(
          "tool",
          html,
          new Date().toISOString(),
          "Tool edit",
        );
        setResults((current) =>
          current.map((result) =>
            result.modelId === modelId
              ? {
                  ...result,
                  revisions: appendOutputRevision(
                    result.revisions,
                    toolRevision,
                  ),
                }
              : result,
          ),
        );
        setSelectedRevisionIds((current) => ({
          ...current,
          [modelId]: toolRevision.id,
        }));
        if (activeRunId) {
          updateRun(activeRunId, (existing) => ({
            ...existing,
            results: existing.results.map((result) =>
              result.modelId === modelId
                ? {
                    ...result,
                    revisions: appendOutputRevision(
                      result.revisions,
                      toolRevision,
                    ),
                  }
                : result,
            ),
          }));
        }
        await fetch("/api/compare/tool-response", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toolCallId: event.toolCallId,
            output: {
              ok: true,
              htmlLength: html.length,
            },
          }),
        });
        return;
      }

      const previewId = getPreviewIdForModelId(event.modelId);
      if (!previewId) {
        await fetch("/api/compare/tool-response", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toolCallId: event.toolCallId,
            error: "No preview is available for that tool call.",
          }),
        });
        return;
      }

      try {
        const output = await sendPreviewCommand(previewId, event.toolName);
        await fetch("/api/compare/tool-response", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toolCallId: event.toolCallId,
            output,
          }),
        });
      } catch (error) {
        await fetch("/api/compare/tool-response", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toolCallId: event.toolCallId,
            error:
              error instanceof Error
                ? error.message
                : "Preview tool execution failed.",
          }),
        });
      }
    },
    [
      activeRunId,
      getEffectiveMarkupForModelId,
      getPreviewIdForModelId,
      requestServerScreenshot,
      sendPreviewCommand,
      setPreviewOverrides,
      setResults,
      setSelectedRevisionIds,
      updateRun,
    ],
  );

  const addToolErrorMessage = useCallback(
    (modelId: string, toolName: string | undefined, errorMessage: unknown) => {
      const previewId = getPreviewIdForModelId(modelId);
      if (!previewId) return;

      const toolLabel = toolName ? getToolLabel(toolName) : "Tool";
      const message =
        typeof errorMessage === "string" && errorMessage.trim()
          ? `${toolLabel}: ${errorMessage}`
          : `${toolLabel}: Tool execution failed.`;

      setPreviewToolErrors((current) => {
        const existing = current[previewId] ?? [];
        if (existing.includes(message)) return current;

        return {
          ...current,
          [previewId]: [...existing, message],
        };
      });
    },
    [getPreviewIdForModelId, setPreviewToolErrors],
  );

  const clearToolErrorState = useCallback(
    (modelId: string) => {
      const previewId = getPreviewIdForModelId(modelId);
      setPreviewOverrides((current) => {
        if (!(modelId in current)) return current;

        const next = { ...current };
        delete next[modelId];
        return next;
      });
      setSelectedRevisionIds((current) => {
        if (!(modelId in current)) return current;

        const next = { ...current };
        delete next[modelId];
        return next;
      });
      if (previewId) {
        setPreviewToolErrors((current) => {
          if (!(previewId in current)) return current;

          const next = { ...current };
          delete next[previewId];
          return next;
        });
      }
    },
    [getPreviewIdForModelId, setPreviewOverrides, setPreviewToolErrors, setSelectedRevisionIds],
  );

  return {
    activePreviewModelId,
    activePreviewViewportRef,
    addToolErrorMessage,
    clearToolErrorState,
    closePreview,
    dismissPreviewToolErrors,
    getDisplayOutputMetrics: (result: ModelResult) =>
      getDisplayOutputMetrics(result, liveStreamMetrics),
    getPreviewIdForModelId,
    handleToolCallEvent,
    isPreviewClosing,
    liveElapsed,
    liveStreamMetrics,
    openPreview,
    previewCardShellRefs,
    previewErrors,
    previewFrameRefs,
    previewToolErrors,
    readTraceEvents,
    refreshVisualDiff,
    resetAllLiveStreamMetrics,
    resetLiveStreamMetric,
    setActivePreviewModelId,
    syncLiveStreamMetricFromResult,
    applyLiveStreamDelta,
  };
}
