export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toProxyTarget(rawUrl: string | null) {
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function toPreviewProxyUrl(assetUrl: string, requestUrl: string) {
  const target = assetUrl.trim();
  if (!target || target.startsWith("#") || target.startsWith("data:") || target.startsWith("blob:")) {
    return assetUrl;
  }

  try {
    const resolved = new URL(assetUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return assetUrl;
    }

    const origin = new URL(requestUrl).origin;
    return `${origin}/api/preview-asset?url=${encodeURIComponent(resolved.toString())}`;
  } catch {
    return assetUrl;
  }
}

function rewriteCssAssetUrls(cssText: string, assetUrl: string, requestUrl: string) {
  const rewriteAsset = (rawAssetUrl: string) => {
    const trimmed = rawAssetUrl.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      return rawAssetUrl;
    }

    try {
      return toPreviewProxyUrl(new URL(trimmed, assetUrl).toString(), requestUrl);
    } catch {
      return rawAssetUrl;
    }
  };

  return cssText
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, quote, rawAssetUrl) => {
      const proxied = rewriteAsset(rawAssetUrl);
      if (proxied === rawAssetUrl) return match;
      return `url(${quote}${proxied}${quote})`;
    })
    .replace(/@import\s+(?:url\(\s*)?(['"])(.*?)\1\s*\)?/gi, (match, quote, rawAssetUrl) => {
      const proxied = rewriteAsset(rawAssetUrl);
      if (proxied === rawAssetUrl) return match;
      return match.replace(rawAssetUrl, proxied);
    });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const target = toProxyTarget(requestUrl.searchParams.get("url"));
  if (!target) {
    return Response.json({ error: "A valid http(s) url query parameter is required." }, { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      redirect: "follow",
      headers: {
        Accept: request.headers.get("accept") ?? "*/*",
      },
    });

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", upstream.headers.get("cache-control") ?? "public, max-age=3600");
    headers.set("Content-Type", contentType);

    if (contentType.includes("text/css")) {
      const cssText = await upstream.text();
      return new Response(
        rewriteCssAssetUrls(cssText, upstream.url || target.toString(), request.url),
        {
          status: upstream.status,
          headers,
        },
      );
    }

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to proxy the requested preview asset.",
      },
      { status: 502 },
    );
  }
}
