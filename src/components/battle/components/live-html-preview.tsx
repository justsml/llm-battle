"use client";

import { useDeferredValue, useEffect, useState } from "react";

import {
  createPreviewSrcDoc,
  unwrapHtmlCodeFence,
} from "@/components/battle/lib/preview";
import { cn } from "@/lib/utils";

const PREVIEW_STREAM_DEBOUNCE_MS = 180;

type LiveHtmlPreviewProps = {
  markup: string;
  overrideMarkup?: string;
  previewId: string;
  title: string;
  isStreaming: boolean;
  iframeRef?: (element: HTMLIFrameElement | null) => void;
  interactive?: boolean;
};

type PreviewFrameProps = {
  iframeRef?: (element: HTMLIFrameElement | null) => void;
  interactive: boolean;
  markup: string;
  previewId: string;
  title: string;
};

function PreviewFrame({
  iframeRef,
  interactive,
  markup,
  previewId,
  title,
}: PreviewFrameProps) {
  return (
    <iframe
      className={cn(
        "h-full w-full bg-white",
        !interactive && "pointer-events-none",
      )}
      ref={iframeRef}
      sandbox="allow-scripts"
      srcDoc={createPreviewSrcDoc(markup, previewId, !interactive)}
      tabIndex={interactive ? 0 : -1}
      title={title}
    />
  );
}

type DebouncedStreamingPreviewFrameProps = PreviewFrameProps;

function DebouncedStreamingPreviewFrame({
  iframeRef,
  interactive,
  markup,
  previewId,
  title,
}: DebouncedStreamingPreviewFrameProps) {
  const [committedMarkup, setCommittedMarkup] = useState(markup);

  useEffect(() => {
    if (committedMarkup === markup) return;

    const timeoutId = window.setTimeout(() => {
      setCommittedMarkup(markup);
    }, PREVIEW_STREAM_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [committedMarkup, markup]);

  return (
    <PreviewFrame
      iframeRef={iframeRef}
      interactive={interactive}
      markup={committedMarkup}
      previewId={previewId}
      title={title}
    />
  );
}

export function LiveHtmlPreview({
  markup,
  overrideMarkup,
  previewId,
  title,
  isStreaming,
  iframeRef,
  interactive = false,
}: LiveHtmlPreviewProps) {
  const normalizedMarkup = unwrapHtmlCodeFence(overrideMarkup ?? markup);
  const deferredMarkup = useDeferredValue(normalizedMarkup);

  if (isStreaming) {
    return (
      <DebouncedStreamingPreviewFrame
        key={previewId}
        iframeRef={iframeRef}
        interactive={interactive}
        markup={deferredMarkup}
        previewId={previewId}
        title={title}
      />
    );
  }

  return (
    <PreviewFrame
      iframeRef={iframeRef}
      interactive={interactive}
      markup={normalizedMarkup}
      previewId={previewId}
      title={title}
    />
  );
}
