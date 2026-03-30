"use client";

import Image from "next/image";

import { cn } from "@/lib/utils";

import {
  formatMismatchLabel,
  formatSimilarityLabel,
  type VisualDiffState,
} from "../lib/view-shared";

type VisualComparisonPanelProps = {
  referenceImageUrl: string;
  visualState?: VisualDiffState;
  onRefresh?: () => void;
  compact?: boolean;
};

export function VisualComparisonPanel({
  referenceImageUrl,
  visualState,
  onRefresh,
  compact = false,
}: VisualComparisonPanelProps) {
  const hasAssets =
    !!visualState?.screenshot?.dataUrl && !!visualState?.heatmapDataUrl;

  return (
    <div className="rounded-[1rem] border border-(--line) bg-(--panel-strong) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(--muted)">
            Visual match
          </p>
          <p className="mt-1 text-sm text-(--foreground)">
            Similarity <strong>{formatSimilarityLabel(visualState?.similarity)}</strong>
            {" · "}
            Mismatch <strong>{formatMismatchLabel(visualState?.mismatchRatio)}</strong>
          </p>
        </div>
        {onRefresh ? (
          <button
            className="rounded-full border border-(--line) px-3 py-1 text-xs font-medium transition hover:bg-(--card-active)"
            onClick={onRefresh}
            type="button"
          >
            {visualState?.status === "running" ? "Refreshing…" : "Refresh diff"}
          </button>
        ) : null}
      </div>

      {visualState?.status === "error" ? (
        <p className="mt-2 text-sm text-(--danger)">{visualState.error}</p>
      ) : null}

      {hasAssets ? (
        <div className={cn("mt-3 grid gap-3", compact ? "sm:grid-cols-3" : "lg:grid-cols-3")}>
          <div className="overflow-hidden rounded-[0.9rem] border border-(--line) bg-white">
            <Image
              alt="Reference screenshot"
              className="h-auto w-full"
              height={visualState?.height ?? 480}
              src={referenceImageUrl}
              unoptimized
              width={visualState?.width ?? 640}
            />
          </div>
          <div className="overflow-hidden rounded-[0.9rem] border border-(--line) bg-white">
            <Image
              alt="Generated output screenshot"
              className="h-auto w-full"
              height={visualState?.height ?? 480}
              src={visualState?.screenshot?.dataUrl ?? ""}
              unoptimized
              width={visualState?.width ?? 640}
            />
          </div>
          <div className="overflow-hidden rounded-[0.9rem] border border-(--line) bg-[#11141a]">
            <Image
              alt="Visual mismatch heatmap"
              className="h-auto w-full"
              height={visualState?.height ?? 480}
              src={visualState?.heatmapDataUrl ?? ""}
              unoptimized
              width={visualState?.width ?? 640}
            />
          </div>
        </div>
      ) : visualState?.status === "running" ? (
        <p className="mt-3 text-sm text-(--muted)">Capturing the rendered output and building a diff…</p>
      ) : (
        <p className="mt-3 text-sm text-(--muted)">
          Capture a rendered screenshot to compare the output against the reference.
        </p>
      )}
    </div>
  );
}
