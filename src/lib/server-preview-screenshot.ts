import { chromium, type Browser } from "playwright";

import {
  looksLikeHtmlDocument,
  unwrapHtmlCodeFence,
} from "@/components/battle/lib/preview";

type CapturePreviewScreenshotArgs = {
  markup: string;
  origin: string;
};

type PreviewScreenshotResult = {
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: string;
};

const DEFAULT_VIEWPORT_WIDTH = 1440;
const DEFAULT_VIEWPORT_HEIGHT = 900;
const MAX_SCREENSHOT_WIDTH = 1600;
const MAX_SCREENSHOT_HEIGHT = 4000;

let browserPromise: Promise<Browser> | null = null;

function getBrowser() {
  browserPromise ??= chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });

  return browserPromise;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildScreenshotDocument(markup: string, origin: string) {
  const normalizedMarkup = unwrapHtmlCodeFence(markup).trim();
  const baseTag = `<base href="${escapeHtmlAttribute(
    origin.endsWith("/") ? origin : `${origin}/`,
  )}">`;
  const screenshotStyle = `<style>html,body{margin:0;min-height:100%;background:#fff;}</style>`;

  if (!looksLikeHtmlDocument(normalizedMarkup)) {
    return `<!DOCTYPE html><html><head>${baseTag}${screenshotStyle}</head><body>${normalizedMarkup}</body></html>`;
  }

  if (/<head[\s>]/i.test(normalizedMarkup)) {
    return normalizedMarkup.replace(
      /<head([^>]*)>/i,
      `<head$1>${baseTag}${screenshotStyle}`,
    );
  }

  if (/<html[\s>]/i.test(normalizedMarkup)) {
    return normalizedMarkup.replace(
      /<html([^>]*)>/i,
      `<html$1><head>${baseTag}${screenshotStyle}</head>`,
    );
  }

  if (/<body[\s>]/i.test(normalizedMarkup)) {
    return `<!DOCTYPE html><html><head>${baseTag}${screenshotStyle}</head>${normalizedMarkup}</html>`;
  }

  return `<!DOCTYPE html><html><head>${baseTag}${screenshotStyle}</head><body>${normalizedMarkup}</body></html>`;
}

export async function capturePreviewScreenshot({
  markup,
  origin,
}: CapturePreviewScreenshotArgs): Promise<PreviewScreenshotResult> {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: {
      width: DEFAULT_VIEWPORT_WIDTH,
      height: DEFAULT_VIEWPORT_HEIGHT,
    },
    deviceScaleFactor: 1,
  });

  try {
    await page.setContent(buildScreenshotDocument(markup, origin), {
      waitUntil: "domcontentloaded",
    });

    await page
      .evaluate(async () => {
        const settle = (ms: number) =>
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, ms);
          });

        const imageLoads = Array.from(document.images)
          .filter((image) => !image.complete)
          .map(
            (image) =>
              new Promise<void>((resolve) => {
                image.addEventListener("load", () => resolve(), { once: true });
                image.addEventListener("error", () => resolve(), { once: true });
              }),
          );

        if (imageLoads.length) {
          await Promise.race([Promise.all(imageLoads), settle(1500)]);
        }

        const fontSet = document.fonts;
        if (fontSet?.ready) {
          await Promise.race([fontSet.ready.then(() => undefined), settle(1500)]);
        }

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });
      })
      .catch(() => undefined);

    const dimensions = await page.evaluate(() => ({
      width: Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0,
        document.documentElement.clientWidth,
        window.innerWidth,
      ),
      height: Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
        document.documentElement.clientHeight,
        window.innerHeight,
      ),
    }));

    const width = Math.max(
      320,
      Math.min(MAX_SCREENSHOT_WIDTH, Math.ceil(dimensions.width || DEFAULT_VIEWPORT_WIDTH)),
    );
    const height = Math.max(
      240,
      Math.min(MAX_SCREENSHOT_HEIGHT, Math.ceil(dimensions.height || DEFAULT_VIEWPORT_HEIGHT)),
    );

    await page.setViewportSize({
      width,
      height: Math.min(height, DEFAULT_VIEWPORT_HEIGHT),
    });

    const screenshot = await page.screenshot({
      type: "png",
      fullPage: true,
    });

    return {
      dataUrl: `data:image/png;base64,${screenshot.toString("base64")}`,
      width,
      height,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await page.close();
  }
}
