import type { OutputDomCssStats } from "@/lib/types";
import { sanitizePositiveCount } from "@/lib/utils";

function countMatches(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0;
}

export function computeOutputDomCssStats(markup: string): OutputDomCssStats {
  const html = markup.trim();

  if (!html) {
    return {};
  }

  const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b[^>]*>|[^<]+/gi) ?? [];
  let domNodeCount = 0;
  let elementCount = 0;
  let textNodeCount = 0;
  let commentCount = 0;
  let maxDomDepth = 0;
  let depth = 0;

  for (const token of tokens) {
    if (token.startsWith("<!--")) {
      commentCount += 1;
      domNodeCount += 1;
      continue;
    }

    if (token.startsWith("<")) {
      if (/^<\//.test(token)) {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (/^<!/i.test(token)) {
        continue;
      }

      elementCount += 1;
      domNodeCount += 1;

      const selfClosing = /\/\s*>$/.test(token) || /^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(token);
      if (!selfClosing) {
        depth += 1;
        maxDomDepth = Math.max(maxDomDepth, depth);
      }
      continue;
    }

    if (token.trim()) {
      textNodeCount += 1;
      domNodeCount += 1;
    }
  }

  return {
    htmlBytes: sanitizePositiveCount(new TextEncoder().encode(html).length),
    domNodeCount: sanitizePositiveCount(domNodeCount),
    elementCount: sanitizePositiveCount(elementCount),
    textNodeCount: sanitizePositiveCount(textNodeCount),
    commentCount: sanitizePositiveCount(commentCount),
    maxDomDepth: sanitizePositiveCount(maxDomDepth),
    styleTagCount: sanitizePositiveCount(countMatches(html, /<style\b/gi)),
    inlineStyleAttrCount: sanitizePositiveCount(countMatches(html, /\sstyle\s*=/gi)),
    stylesheetLinkCount: sanitizePositiveCount(countMatches(html, /<link\b[^>]*rel\s*=\s*(["'])?stylesheet\1/gi)),
    scriptTagCount: sanitizePositiveCount(countMatches(html, /<script\b/gi)),
    imageCount: sanitizePositiveCount(countMatches(html, /<(img|svg|picture|canvas)\b/gi)),
    buttonCount: sanitizePositiveCount(countMatches(html, /<button\b/gi)),
    inputCount: sanitizePositiveCount(countMatches(html, /<(input|textarea|select)\b/gi)),
    formCount: sanitizePositiveCount(countMatches(html, /<form\b/gi)),
    idCount: sanitizePositiveCount(countMatches(html, /\sid\s*=/gi)),
    classCount: sanitizePositiveCount(countMatches(html, /\sclass\s*=/gi)),
  };
}
