export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpenAICompatibleModelRecord = {
  id?: unknown;
  owned_by?: unknown;
  object?: unknown;
};

function normalizeModelsUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");

  if (!normalizedPath || normalizedPath === "") {
    parsed.pathname = "/v1/models";
  } else if (normalizedPath.endsWith("/models")) {
    parsed.pathname = normalizedPath;
  } else {
    parsed.pathname = `${normalizedPath}/models`;
  }

  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function getBaseUrlFromModelsUrl(modelsUrl: URL) {
  const basePath = modelsUrl.pathname.replace(/\/models\/?$/, "") || "/";
  return `${modelsUrl.protocol}//${modelsUrl.host}${basePath}`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    url?: string;
    apiKey?: string;
  } | null;

  const rawUrl = body?.url?.trim();
  if (!rawUrl) {
    return Response.json({ error: "A host URL is required." }, { status: 400 });
  }

  let modelsUrl: URL;
  try {
    modelsUrl = normalizeModelsUrl(rawUrl);
    if (modelsUrl.protocol !== "http:" && modelsUrl.protocol !== "https:") {
      throw new Error("Only http(s) URLs are supported.");
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Invalid host URL.",
      },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(modelsUrl, {
      headers: {
        Accept: "application/json",
        ...(body?.apiKey?.trim()
          ? { Authorization: `Bearer ${body.apiKey.trim()}` }
          : {}),
      },
      redirect: "follow",
    });

    const payload = (await response.json().catch(() => null)) as {
      data?: OpenAICompatibleModelRecord[];
      error?: { message?: string } | string;
    } | null;

    if (!response.ok) {
      const message =
        typeof payload?.error === "string"
          ? payload.error
          : payload?.error && typeof payload.error.message === "string"
            ? payload.error.message
            : `Model host returned ${response.status}.`;
      throw new Error(message);
    }

    const models = Array.isArray(payload?.data)
      ? payload.data
          .filter((entry) => typeof entry?.id === "string" && entry.id.trim())
          .map((entry) => ({
            id: String(entry.id),
            ownedBy:
              typeof entry.owned_by === "string" && entry.owned_by.trim()
                ? entry.owned_by
                : "local",
            object:
              typeof entry.object === "string" && entry.object.trim()
                ? entry.object
                : "model",
          }))
      : [];

    return Response.json({
      models,
      resolvedModelsUrl: response.url || modelsUrl.toString(),
      resolvedBaseUrl: getBaseUrlFromModelsUrl(new URL(response.url || modelsUrl.toString())),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load models from that host.",
      },
      { status: 502 },
    );
  }
}
