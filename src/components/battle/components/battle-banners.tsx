"use client";

type BattleBannersProps = {
  authError: string;
  errorMessage: string;
  initialRunId: string | null;
  isHydratingRouteRun: boolean;
  modelsError: string;
};

export function BattleBanners({
  authError,
  errorMessage,
  initialRunId,
  isHydratingRouteRun,
  modelsError,
}: BattleBannersProps) {
  return (
    <div className="mx-auto max-w-[1600px] px-4 sm:px-0">
      {authError ? (
        <div className="rise-in mt-3 rounded-[1.4rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-4 py-3 text-sm text-(--danger)">
          {authError}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rise-in mt-3 rounded-[1.4rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-4 py-3 text-sm text-(--danger)">
          {errorMessage}
        </div>
      ) : null}
      {modelsError ? (
        <div className="rise-in mt-3 rounded-[1.4rem] border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] px-4 py-3 text-sm text-(--danger)">
          {modelsError}
        </div>
      ) : null}
      {isHydratingRouteRun ? (
        <div className="rise-in mt-3 rounded-[1.4rem] border border-[color-mix(in_oklch,var(--foreground)_12%,transparent)] bg-[color-mix(in_oklch,var(--foreground)_5%,transparent)] px-4 py-3 text-sm text-(--muted)">
          Loading run {initialRunId}…
        </div>
      ) : null}
    </div>
  );
}
