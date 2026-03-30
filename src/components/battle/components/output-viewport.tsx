"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type OutputViewportProps = {
  title: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  contentStyle?: CSSProperties;
};

export function OutputViewport({
  title,
  children,
  className,
  contentClassName,
  contentStyle,
}: OutputViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === viewportRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  async function toggleFullscreen() {
    const viewport = viewportRef.current;
    if (!viewport) return;

    if (document.fullscreenElement === viewport) {
      await document.exitFullscreen();
      return;
    }

    await viewport.requestFullscreen();
  }

  return (
    <div className={cn("output-viewport relative", className)} ref={viewportRef}>
      <button
        aria-label={`${isFullscreen ? "Exit" : "Open"} ${title} full screen`}
        className="output-viewport__action absolute right-3 top-3 z-10 rounded-full border border-(--line) bg-(--card) px-3 py-1.5 text-xs font-medium text-(--foreground) shadow-[0_10px_30px_color-mix(in_oklch,var(--foreground)_12%,transparent)] transition hover:bg-(--card-active)"
        onClick={() => {
          void toggleFullscreen();
        }}
        type="button"
      >
        {isFullscreen ? "Exit full screen" : "Full screen"}
      </button>

      <div
        className={cn("output-viewport__content", contentClassName)}
        style={contentStyle}
      >
        {children}
      </div>
    </div>
  );
}
