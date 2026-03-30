"use client";

type BattleAuthGateProps = {
  allowLocalDevAutoAuth: boolean;
  authError: string;
  githubConfigured: boolean;
  isAuthActionPending: boolean;
  onAnonymousSignIn: () => void;
  onGitHubSignIn: () => void;
};

export function BattleAuthGate({
  allowLocalDevAutoAuth,
  authError,
  githubConfigured,
  isAuthActionPending,
  onAnonymousSignIn,
  onGitHubSignIn,
}: BattleAuthGateProps) {
  const missingGitHubConfig = !githubConfigured;

  return (
    <main className="relative min-h-screen [overflow-x:clip] px-4 py-6 text-(--foreground) sm:px-6 lg:px-8">
      <div className="grain" />

      <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="glass-shell rise-in rounded-[2rem] px-5 py-5 sm:px-7 sm:py-6">
          <p className="eyebrow-label text-xs font-semibold uppercase tracking-[0.35em]">
            Visual Eval Harness
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">
            {allowLocalDevAutoAuth
              ? "Preparing your localhost dev session"
              : "Sign in to save and compare battle runs"}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-(--muted) sm:text-base">
            {allowLocalDevAutoAuth
              ? "GitHub OAuth is not configured for this development environment, so Better Auth will create a temporary local account for this browser and keep it signed in for up to two weeks."
              : "GitHub OAuth is now wired through Better Auth. Once you sign in, run history stays tied to your account instead of mixing together across the whole app."}
          </p>
        </header>

        <section className="panel rise-in rounded-[2rem] p-6 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-(--muted)">
                Authentication
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
                {allowLocalDevAutoAuth
                  ? "Create a local dev account"
                  : missingGitHubConfig
                    ? "GitHub auth needs setup"
                    : "Continue with GitHub"}
              </h2>
              <p className="mt-3 text-sm leading-6 text-(--muted)">
                {allowLocalDevAutoAuth
                  ? "Your local draft still stays in the browser, and database-backed runs will attach to this temporary localhost account automatically."
                  : missingGitHubConfig
                    ? "GitHub OAuth env vars are missing. Open the app on localhost in development for automatic guest access, or add the GitHub Better Auth config."
                    : "Your local draft still stays in the browser, but database-backed runs and new comparisons are only available after sign-in."}
              </p>
            </div>

            {allowLocalDevAutoAuth ? (
              <button
                className="rounded-full bg-(--foreground) px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55"
                disabled={isAuthActionPending}
                onClick={onAnonymousSignIn}
                type="button"
              >
                {isAuthActionPending
                  ? "Creating local session..."
                  : "Retry local sign-in"}
              </button>
            ) : missingGitHubConfig ? null : (
              <button
                className="rounded-full bg-(--foreground) px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55"
                disabled={isAuthActionPending}
                onClick={onGitHubSignIn}
                type="button"
              >
                {isAuthActionPending
                  ? "Redirecting..."
                  : "Continue with GitHub"}
              </button>
            )}
          </div>

          {authError ? (
            <div className="mt-4 rounded-[1.1rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-4 py-3 text-sm text-(--danger)">
              {authError}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
