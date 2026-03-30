"use client";

type BattleLoadingStateProps = {
  title: string;
  message: string;
};

export function BattleLoadingState({
  title,
  message,
}: BattleLoadingStateProps) {
  return (
    <main className="relative min-h-screen [overflow-x:clip] px-4 py-6 text-(--foreground) sm:px-6 lg:px-8">
      <div className="grain" />

      <section className="mx-auto flex min-h-[70vh] w-full max-w-4xl items-center justify-center">
        <div className="panel rise-in w-full rounded-[2rem] p-8 text-center sm:p-10">
          <p className="eyebrow-label text-xs font-semibold uppercase tracking-[0.35em]">
            Visual Eval Harness
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em]">
            {title}
          </h1>
          <p className="mt-3 text-sm text-(--muted)">
            {message}
          </p>
        </div>
      </section>
    </main>
  );
}
