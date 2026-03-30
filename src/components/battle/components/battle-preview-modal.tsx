"use client";

import { createPortal } from "react-dom";

import { LiveHtmlPreview } from "@/components/battle/components/live-html-preview";
import { RevisionNavigator } from "@/components/battle/components/revision-navigator";
import { TraceTimeline } from "@/components/battle/components/trace-timeline";
import { VisualComparisonPanel } from "@/components/battle/components/visual-comparison-panel";
import type { ModelOutputRevision, ModelResult, ModelTraceEvent } from "@/lib/types";

import type { VisualDiffState } from "../lib/view-shared";

type BattlePreviewModalProps = {
  activePreviewErrors: string[];
  activePreviewId: string;
  activePreviewResult: ModelResult;
  activePreviewToolErrors: string[];
  activePreviewVisualDiff?: VisualDiffState;
  closePreview: () => void;
  imageDataUrl: string;
  interactiveMarkup: string;
  isOpen: boolean;
  isStreaming: boolean;
  onDismissToolErrors: (previewId: string) => void;
  onIframeRef: (element: HTMLIFrameElement | null) => void;
  onRefreshVisualDiff: () => void;
  onSelectRevision: (revisionId: string) => void;
  previewViewportRef: React.RefObject<HTMLDivElement | null>;
  revisions: ModelOutputRevision[];
  selectedRevisionIndex: number;
  traceEvents: ModelTraceEvent[];
};

export function BattlePreviewModal({
  activePreviewErrors,
  activePreviewId,
  activePreviewResult,
  activePreviewToolErrors,
  activePreviewVisualDiff,
  closePreview,
  imageDataUrl,
  interactiveMarkup,
  isOpen,
  isStreaming,
  onDismissToolErrors,
  onIframeRef,
  onRefreshVisualDiff,
  onSelectRevision,
  previewViewportRef,
  revisions,
  selectedRevisionIndex,
  traceEvents,
}: BattlePreviewModalProps) {
  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      aria-modal="true"
      className="preview-modal-backdrop"
      onClick={closePreview}
      role="dialog"
    >
      <div
        className="preview-modal-sheet h-full"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="preview-modal__header">
          <div>
            <p className="preview-modal__eyebrow">Interactive preview</p>
            <h2 className="preview-modal__title">
              {activePreviewResult.label}
            </h2>
          </div>
          <button
            className="preview-modal__close"
            onClick={closePreview}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="preview-modal__body flex-1">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,0.9fr)]">
            <div className="flex min-h-0 flex-col gap-3">
              <RevisionNavigator
                onSelect={onSelectRevision}
                revisions={revisions}
                selectedIndex={selectedRevisionIndex}
              />
              {activePreviewErrors.length ? (
                <div className="rounded-[1rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-3 py-2 text-xs text-(--danger)">
                  {activePreviewErrors.map((msg, i) => (
                    <p key={`${activePreviewId}-modal-err-${i}`}>{msg}</p>
                  ))}
                </div>
              ) : null}

              <div
                className="preview-modal__viewport"
                ref={previewViewportRef}
              >
                <LiveHtmlPreview
                  iframeRef={onIframeRef}
                  interactive
                  isStreaming={isStreaming}
                  markup={interactiveMarkup}
                  overrideMarkup={interactiveMarkup}
                  previewId={activePreviewId}
                  title={`${activePreviewResult.label} interactive preview`}
                />
              </div>

              {activePreviewToolErrors.length ? (
                <div className="rounded-[1.1rem] border border-[color-mix(in_oklch,var(--danger)_46%,var(--line))] bg-[linear-gradient(180deg,color-mix(in_oklch,var(--panel-strong)_84%,var(--danger)_16%),color-mix(in_oklch,var(--panel)_88%,black_8%))] p-3 text-sm text-[color-mix(in_oklch,var(--foreground)_96%,white)] shadow-[0_20px_60px_color-mix(in_oklch,var(--danger)_24%,transparent)] backdrop-blur-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color-mix(in_oklch,var(--danger)_72%,white)]">
                        Tool call failed
                      </p>
                      <div className="mt-2 space-y-2 text-sm leading-6 text-[color-mix(in_oklch,var(--foreground)_96%,white)]">
                        {activePreviewToolErrors.map((msg, i) => (
                          <p key={`${activePreviewId}-modal-tool-err-${i}`}>
                            {msg}
                          </p>
                        ))}
                      </div>
                    </div>
                    <button
                      className="shrink-0 rounded-full border border-[color-mix(in_oklch,var(--danger)_42%,transparent)] bg-[color-mix(in_oklch,var(--panel-strong)_82%,var(--danger)_18%)] px-3 py-1 text-xs font-semibold text-[color-mix(in_oklch,var(--foreground)_94%,white)] transition hover:bg-[color-mix(in_oklch,var(--panel-strong)_72%,var(--danger)_28%)]"
                      onClick={() => onDismissToolErrors(activePreviewId)}
                      type="button"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-col gap-3">
              <VisualComparisonPanel
                onRefresh={onRefreshVisualDiff}
                referenceImageUrl={imageDataUrl}
                visualState={activePreviewVisualDiff}
              />
              <div className="rounded-[1rem] border border-(--line) bg-(--panel) p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
                  Agent trace
                </p>
                <div className="mt-3 max-h-[34rem] overflow-auto pr-1">
                  <TraceTimeline events={traceEvents} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
