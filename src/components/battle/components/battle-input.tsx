"use client";

import Image from "next/image";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

import type { CardSize } from "@/components/battle/lib/client-state";

type BattleInputProps = {
  cardSize: CardSize;
  imageDataUrl: string;
  imageName: string;
  inputRef: RefObject<HTMLInputElement | null>;
  isEditLocked: boolean;
  onReferenceImageMouseMove: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onResetReferenceImagePan: () => void;
  referenceHeight: string;
  referenceImageFrameRef: RefObject<HTMLDivElement | null>;
};

export function BattleInput({
  cardSize,
  imageDataUrl,
  imageName,
  inputRef,
  isEditLocked,
  onReferenceImageMouseMove,
  onResetReferenceImagePan,
  referenceHeight,
  referenceImageFrameRef,
}: BattleInputProps) {
  return (
    <div className="build-card" style={{ viewTransitionName: "card-ref" }}>
      <div className="build-card__header">
        <span className="flex-1 text-sm font-semibold tracking-[-0.02em]">
          Reference
        </span>
        {!isEditLocked ? (
          <button
            className="rounded-full border border-(--line) px-3 py-1 text-xs font-medium transition hover:bg-(--card-active)"
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            Upload
          </button>
        ) : null}
      </div>
      <div className="build-card__body">
        {imageDataUrl ? (
          <div
            className="relative w-full cursor-move overflow-hidden rounded-b-[1.75rem]"
            onMouseLeave={onResetReferenceImagePan}
            onMouseMove={onReferenceImageMouseMove}
            ref={referenceImageFrameRef}
            style={{ height: referenceHeight }}
          >
            <Image
              alt="Reference screenshot"
              className="object-cover transition-[object-position] duration-150 ease-out"
              fill
              sizes={
                cardSize === "xl"
                  ? "100vw"
                  : cardSize === "l"
                    ? "(max-width: 1024px) 100vw, 480px"
                    : cardSize === "m"
                      ? "(max-width: 768px) 100vw, 320px"
                      : "(max-width: 640px) 100vw, 240px"
              }
              src={imageDataUrl}
              style={{
                objectPosition:
                  "var(--reference-pan-x, 50%) var(--reference-pan-y, 50%)",
              }}
              unoptimized
            />
          </div>
        ) : (
          <button
            className="flex w-full flex-col items-center justify-center gap-3 rounded-b-[1.75rem] px-6 py-8 text-center transition hover:bg-[color-mix(in_oklch,var(--foreground)_3%,transparent)]"
            onClick={() => inputRef.current?.click()}
            style={{ minHeight: referenceHeight }}
            type="button"
          >
            <span className="text-2xl opacity-25">↑</span>
            <span className="text-sm leading-6 text-(--muted)">
              Paste a screenshot, or click to upload
            </span>
          </button>
        )}
      </div>
      {imageDataUrl ? (
        <div className="build-card__footer">
          <span className="truncate">{imageName}</span>
        </div>
      ) : null}
    </div>
  );
}
