export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function readDataUrlMeta(dataUrl: string) {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);

  if (!match) {
    throw new Error("Invalid image payload.");
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

export function sanitizeTokensPerSecond(value?: number) {
  if (value == null || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return value;
}

export function sanitizePositiveCount(value?: number) {
  if (value == null || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.round(value);
}
