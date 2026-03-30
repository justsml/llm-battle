const PREVIEW_ASSET_PROXY_PATH = "/api/preview-asset";

export function looksLikeHtmlDocument(value: string) {
  return /<!doctype html|<html[\s>]|<body[\s>]|<head[\s>]/i.test(value);
}

export function looksLikeHtml(value: string) {
  return /<\/?[a-z][\w:-]*(?:\s[^>]*)?>/i.test(value);
}

export function unwrapHtmlCodeFence(markup: string) {
  const trimmed = markup.trim();
  const fencedMatch = trimmed.match(
    /^```(?:html|htm)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i,
  );

  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const leadingFenceMatch = trimmed.match(/^```(?:html|htm)?[ \t]*\r?\n?/i);
  if (!leadingFenceMatch) {
    return markup;
  }

  const withoutLeadingFence = trimmed.slice(leadingFenceMatch[0].length);
  return withoutLeadingFence.replace(/\r?\n?```[ \t]*$/i, "").trim();
}

function toPreviewAssetProxyUrl(rawValue: string, baseUrl?: string) {
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return rawValue;
  }

  try {
    const resolved = new URL(
      trimmed,
      baseUrl
        ?? (typeof document !== "undefined" ? document.baseURI : "http://localhost"),
    );

    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return rawValue;
    }

    return `${PREVIEW_ASSET_PROXY_PATH}?url=${encodeURIComponent(resolved.toString())}`;
  } catch {
    return rawValue;
  }
}

function rewritePreviewCssAssetUrls(value: string, baseUrl?: string) {
  return value
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, quote, assetUrl) => {
      const proxied = toPreviewAssetProxyUrl(assetUrl, baseUrl);
      if (proxied === assetUrl) return match;
      return `url(${quote}${proxied}${quote})`;
    })
    .replace(/@import\s+(?:url\(\s*)?(['"])(.*?)\1\s*\)?/gi, (match, quote, assetUrl) => {
      const proxied = toPreviewAssetProxyUrl(assetUrl, baseUrl);
      if (proxied === assetUrl) return match;
      return match.replace(assetUrl, proxied);
    });
}

function rewritePreviewSrcSet(value: string, baseUrl?: string) {
  return value
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return trimmed;

      const [assetUrl, ...descriptor] = trimmed.split(/\s+/);
      const proxied = toPreviewAssetProxyUrl(assetUrl, baseUrl);
      return [proxied, ...descriptor].filter(Boolean).join(" ");
    })
    .join(", ");
}

function sanitizePreviewMarkup(markup: string): string {
  const normalizedAttributes = markup.replace(
    /\b(href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, attr, doubleQuoted, singleQuoted, unquoted) => {
      const rawValue = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
      const sanitizedValue = rawValue.replace(
        /^\s*url\(\s*(['"]?)(https?:[^'")\s]+)\1\s*\)\s*$/i,
        "$2",
      );

      if (sanitizedValue === rawValue) {
        return match;
      }

      if (doubleQuoted != null) {
        return `${attr}="${sanitizedValue}"`;
      }

      if (singleQuoted != null) {
        return `${attr}='${sanitizedValue}'`;
      }

      return `${attr}=${sanitizedValue}`;
    },
  );

  if (typeof DOMParser === "undefined") {
    return normalizedAttributes;
  }

  const isFullDocument = looksLikeHtmlDocument(normalizedAttributes);
  const parser = new DOMParser();
  const documentMarkup = isFullDocument
    ? normalizedAttributes
    : `<!DOCTYPE html><html><head></head><body>${normalizedAttributes}</body></html>`;
  const doc = parser.parseFromString(documentMarkup, "text/html");
  const baseUrl = typeof document !== "undefined" ? document.baseURI : undefined;

  doc.querySelectorAll("*").forEach((node) => {
    if (!(node instanceof Element)) return;

    const tagName = node.tagName.toLowerCase();
    if (node.hasAttribute("style")) {
      node.setAttribute(
        "style",
        rewritePreviewCssAssetUrls(node.getAttribute("style") ?? "", baseUrl),
      );
    }

    if (node instanceof HTMLStyleElement) {
      node.textContent = rewritePreviewCssAssetUrls(node.textContent ?? "", baseUrl);
    }

    if (node.hasAttribute("srcset")) {
      node.setAttribute(
        "srcset",
        rewritePreviewSrcSet(node.getAttribute("srcset") ?? "", baseUrl),
      );
    }

    if (node.hasAttribute("src")) {
      node.setAttribute(
        "src",
        toPreviewAssetProxyUrl(node.getAttribute("src") ?? "", baseUrl),
      );
    }

    if (node.hasAttribute("poster")) {
      node.setAttribute(
        "poster",
        toPreviewAssetProxyUrl(node.getAttribute("poster") ?? "", baseUrl),
      );
    }

    if (tagName === "link" && node.hasAttribute("href")) {
      node.setAttribute(
        "href",
        toPreviewAssetProxyUrl(node.getAttribute("href") ?? "", baseUrl),
      );
    }

    if (
      (tagName === "img" ||
        tagName === "audio" ||
        tagName === "video" ||
        tagName === "link" ||
        tagName === "script" ||
        tagName === "source") &&
      !node.hasAttribute("crossorigin") &&
      (node.hasAttribute("src") || node.hasAttribute("href") || node.hasAttribute("srcset"))
    ) {
      node.setAttribute("crossorigin", "anonymous");
    }
  });

  return isFullDocument ? doc.documentElement.outerHTML : doc.body.innerHTML;
}

export function createPreviewSrcDoc(
  markup: string,
  previewId: string,
  fitToViewport = true,
) {
  markup = sanitizePreviewMarkup(unwrapHtmlCodeFence(markup));
  const previewBridge = `
<script>
(() => {
  const previewId = ${JSON.stringify(previewId)};
  const consoleRecords = [];
  const send = (kind, message) => {
    try {
      window.parent.postMessage(
        {
          source: "battle-preview",
          previewId,
          kind,
          message: typeof message === "string" ? message : String(message ?? ""),
        },
        "*",
      );
    } catch {}
  };

  const sendCommandResult = (commandId, action, payload, error) => {
    try {
      window.parent.postMessage(
        {
          source: "battle-preview",
          previewId,
          kind: error ? "command-error" : "command-result",
          commandId,
          action,
          payload,
          error,
        },
        "*",
      );
    } catch {}
  };

  const recordConsole = (level, args) => {
    const message = args
      .map((value) => {
        if (typeof value === "string") return value;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      })
      .join(" ");

    consoleRecords.push({
      level,
      message,
      timestamp: new Date().toISOString(),
    });

    if (consoleRecords.length > 200) {
      consoleRecords.splice(0, consoleRecords.length - 200);
    }
  };

  ["log", "warn", "error", "info"].forEach((level) => {
    const original = console[level]?.bind(console);
    console[level] = (...args) => {
      recordConsole(level, args);
      original?.(...args);
    };
  });

  const captureScreenshot = async () => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("script").forEach((node) => node.remove());
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");

    const previewBaseUrl = document.baseURI || window.location.href;
    const previewBaseOrigin = (() => {
      try {
        return new URL(previewBaseUrl).origin;
      } catch {
        return "";
      }
    })();
    const transparentPixel =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    const isExportSafeUrl = (value) => {
      if (typeof value !== "string") return true;
      const normalized = value.trim().toLowerCase();
      if (
        !normalized ||
        normalized.startsWith("#") ||
        normalized.startsWith("data:") ||
        normalized.startsWith("blob:")
      ) {
        return true;
      }

      try {
        return new URL(value, previewBaseUrl).origin === previewBaseOrigin;
      } catch {
        return false;
      }
    };
    const stripUnsafeUrls = (value) =>
      value.replace(/url\\(([^)]+)\\)/gi, (match, rawUrl) => {
        const cleaned = rawUrl.trim().replace(/^['"]|['"]$/g, "");
        return isExportSafeUrl(cleaned) ? match : "none";
      });

    clone.querySelectorAll("*").forEach((node) => {
      if (!(node instanceof Element)) return;

      const inlineStyle = node.getAttribute("style");
      if (inlineStyle && /url\\(/i.test(inlineStyle)) {
        const sanitizedStyle = stripUnsafeUrls(inlineStyle);
        if (sanitizedStyle.trim()) {
          node.setAttribute("style", sanitizedStyle);
        } else {
          node.removeAttribute("style");
        }
      }

      if (node instanceof HTMLImageElement) {
        if (!isExportSafeUrl(node.currentSrc || node.src || "")) {
          node.setAttribute("src", transparentPixel);
          node.removeAttribute("srcset");
          node.removeAttribute("crossorigin");
        }
        return;
      }

      if (
        node instanceof HTMLAudioElement ||
        node instanceof HTMLVideoElement
      ) {
        if (!isExportSafeUrl(node.currentSrc || node.src || "")) {
          node.removeAttribute("src");
        }
        if (node instanceof HTMLVideoElement && !isExportSafeUrl(node.poster || "")) {
          node.removeAttribute("poster");
        }
        node.removeAttribute("srcset");
        return;
      }

      if (node instanceof HTMLSourceElement) {
        if (!isExportSafeUrl(node.src || "")) {
          node.remove();
          return;
        }
        node.removeAttribute("srcset");
        return;
      }

      if (node instanceof HTMLLinkElement) {
        if (!isExportSafeUrl(node.href || "")) {
          node.remove();
        }
        return;
      }

      if (
        node instanceof HTMLIFrameElement ||
        node instanceof HTMLEmbedElement ||
        node instanceof HTMLObjectElement
      ) {
        node.remove();
        return;
      }

      ["src", "srcset", "href", "poster"].forEach((attr) => {
        const value = node.getAttribute(attr);
        if (value && !isExportSafeUrl(value)) {
          node.removeAttribute(attr);
        }
      });
    });

    const width = Math.max(
      320,
      Math.min(
        1600,
        Math.max(
          document.documentElement.scrollWidth,
          document.body?.scrollWidth ?? 0,
          window.innerWidth,
        ),
      ),
    );
    const height = Math.max(
      240,
      Math.min(
        1200,
        Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight ?? 0,
          window.innerHeight,
        ),
      ),
    );

    const svg = \`<svg xmlns="http://www.w3.org/2000/svg" width="\${width}" height="\${height}" viewBox="0 0 \${width} \${height}">
      <foreignObject width="100%" height="100%">\${new XMLSerializer().serializeToString(clone)}</foreignObject>
    </svg>\`;

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const screenshotRenderTimeoutMs = 8000;

    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        const timeoutId = window.setTimeout(() => {
          img.onload = null;
          img.onerror = null;
          reject(new Error("Preview screenshot rendering took too long."));
        }, screenshotRenderTimeoutMs);

        img.onload = () => {
          window.clearTimeout(timeoutId);
          resolve(img);
        };
        img.onerror = () => {
          window.clearTimeout(timeoutId);
          reject(new Error("Unable to render preview screenshot."));
        };
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas 2D context is unavailable.");
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      let dataUrl = "";
      try {
        dataUrl = canvas.toDataURL("image/png");
      } catch (error) {
        if (error instanceof DOMException && error.name === "SecurityError") {
          throw new Error(
            "Unable to capture preview because it includes external assets that the browser will not export.",
          );
        }
        throw error;
      }

      return {
        dataUrl,
        width,
        height,
        capturedAt: new Date().toISOString(),
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const applyViewportFit = () => {
    const body = document.body;
    if (!body) return;

    body.style.transform = "";
    body.style.transformOrigin = "";
    body.style.width = "";
    body.style.minHeight = "";

    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      body.scrollWidth,
      body.offsetWidth,
    );
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || documentWidth;

    if (!documentWidth || !viewportWidth) return;

    const scale = Math.min(1, viewportWidth / documentWidth);
    if (scale > 0.98) return;

    body.style.transformOrigin = "top left";
    body.style.transform = \`scale(\${scale})\`;
    body.style.width = \`\${100 / scale}%\`;
    body.style.minHeight = \`\${Math.ceil(window.innerHeight / scale)}px\`;
  };

  send("clear", "");

  if (${fitToViewport ? "true" : "false"}) {
    window.addEventListener("load", applyViewportFit);
    window.addEventListener("resize", applyViewportFit);
    requestAnimationFrame(() => {
      requestAnimationFrame(applyViewportFit);
    });

    const fitObserver = new MutationObserver(() => {
      requestAnimationFrame(applyViewportFit);
    });

    fitObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }

  window.addEventListener("error", (event) => {
    recordConsole("error", [event.message || "Runtime error while rendering preview."]);
    send("error", event.message || "Runtime error while rendering preview.");
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    recordConsole("error", [
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection while rendering preview.",
    ]);
    send(
      "error",
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection while rendering preview.",
    );
  });

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (
      !data ||
      typeof data !== "object" ||
      data.source !== "battle-preview-parent" ||
      data.previewId !== previewId ||
      typeof data.commandId !== "string" ||
      typeof data.action !== "string"
    ) {
      return;
    }

    try {
      if (data.action === "get_console_logs") {
        sendCommandResult(data.commandId, data.action, {
          logs: consoleRecords.slice(-100),
        });
        return;
      }

      if (data.action === "get_screenshot") {
        sendCommandResult(
          data.commandId,
          data.action,
          await captureScreenshot(),
        );
      }
    } catch (error) {
      sendCommandResult(
        data.commandId,
        data.action,
        null,
        error instanceof Error ? error.message : "Preview command failed.",
      );
    }
  });
})();
</script>`;

  const previewBase = `
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; min-height: 100%; overflow: auto !important; background: white; }
</style>`;

  if (!looksLikeHtmlDocument(markup)) {
    return `<!DOCTYPE html><html><head>${previewBase}${previewBridge}</head><body>${markup}</body></html>`;
  }

  if (/<head[\s>]/i.test(markup)) {
    return markup.replace(
      /<head([^>]*)>/i,
      `<head$1>${previewBase}${previewBridge}`,
    );
  }

  if (/<html[\s>]/i.test(markup)) {
    return markup.replace(
      /<html([^>]*)>/i,
      `<html$1><head>${previewBase}${previewBridge}</head>`,
    );
  }

  if (/<body[\s>]/i.test(markup)) {
    return markup.replace(/<body([^>]*)>/i, `<body$1>${previewBridge}`);
  }

  return `<!DOCTYPE html><html><head>${previewBase}${previewBridge}</head><body>${markup}</body></html>`;
}
