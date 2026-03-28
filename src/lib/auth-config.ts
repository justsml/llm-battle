const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const AUTH_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export function isGitHubAuthConfigured() {
  return !!(
    process.env.GITHUB_CLIENT_ID?.trim()
    && process.env.GITHUB_CLIENT_SECRET?.trim()
  );
}

export function isDevAuthFallbackEnabled() {
  return process.env.NODE_ENV === "development" && !isGitHubAuthConfigured();
}

export function isLocalhostHost(value?: string | null) {
  if (!value) return false;

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;

  if (trimmed.startsWith("[")) {
    const closingBracketIndex = trimmed.indexOf("]");
    const hostname =
      closingBracketIndex >= 0 ? trimmed.slice(1, closingBracketIndex) : trimmed;
    return LOCALHOST_HOSTNAMES.has(hostname);
  }

  const hostname = trimmed.split(":")[0] ?? trimmed;
  return LOCALHOST_HOSTNAMES.has(hostname);
}

export function shouldUseLocalDevAuthForHost(value?: string | null) {
  return isDevAuthFallbackEnabled() && isLocalhostHost(value);
}
