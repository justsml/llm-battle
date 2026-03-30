"use client";

import Link from "next/link";
import type { RefObject } from "react";

import { cn } from "@/lib/utils";

type EvalHarnessLink = {
  href: string;
  label: string;
  meta: string;
  matchPathnames: readonly string[];
};

type BattleShellHeaderProps = {
  cardSize: "s" | "m" | "l" | "xl";
  evalHarnessLinks: readonly EvalHarnessLink[];
  historyCount: number;
  isAgenticEnabled: boolean;
  isAuthActionPending: boolean;
  isHistoryOpen: boolean;
  isRunning: boolean;
  outputMode: "preview" | "raw" | "thinking";
  pathname: string;
  signedInUserDisplayName: string;
  signedInUserMonogram: string;
  canStartRun: boolean;
  canToggleOutputWhileRunning: boolean;
  isEditLocked: boolean;
  isAnonymousUser: boolean;
  siteMenuRef: RefObject<HTMLDivElement | null>;
  isSiteMenuOpen: boolean;
  onCardSizeChange: (size: "s" | "m" | "l" | "xl") => void;
  onCompare: () => void;
  onHistoryToggle: () => void;
  onNewRun: () => void;
  onOpenPromptModal: () => void;
  onSignOut: () => void;
  onSiteMenuToggle: () => void;
  onToggleAgenticMode: () => void;
  onOutputModeChange: (mode: "preview" | "raw" | "thinking") => void;
  onNavigateToHistoryFromMenu: () => void;
  onCloseSiteMenu: () => void;
};

export function BattleShellHeader({
  cardSize,
  evalHarnessLinks,
  historyCount,
  isAgenticEnabled,
  isAnonymousUser,
  isAuthActionPending,
  isEditLocked,
  isHistoryOpen,
  isRunning,
  isSiteMenuOpen,
  onCardSizeChange,
  onCloseSiteMenu,
  onCompare,
  onHistoryToggle,
  onNavigateToHistoryFromMenu,
  onNewRun,
  onOpenPromptModal,
  onOutputModeChange,
  onSignOut,
  onSiteMenuToggle,
  onToggleAgenticMode,
  outputMode,
  pathname,
  signedInUserDisplayName,
  signedInUserMonogram,
  siteMenuRef,
  canStartRun,
  canToggleOutputWhileRunning,
}: BattleShellHeaderProps) {
  return (
    <header className="glass-shell floating-nav rise-in mx-auto flex max-w-[1600px] items-center gap-2 overflow-visible rounded-[3rem] px-3 py-1.5 sm:gap-3 sm:px-4">
      <div
        className={cn(
          "relative flex shrink-0 items-center gap-2.5 overflow-visible pl-1",
          isSiteMenuOpen && "z-50",
        )}
        ref={siteMenuRef}
      >
        <h1 className="text-sm font-semibold tracking-[-0.02em]">
          LLM Battle
        </h1>
        <span
          aria-hidden="true"
          className="h-3.5 w-px bg-(--foreground) opacity-20"
        />
        <button
          aria-expanded={isSiteMenuOpen}
          aria-haspopup="menu"
          className="site-menu-trigger eyebrow-label inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase"
          onClick={onSiteMenuToggle}
          type="button"
        >
          <span>Eval Harness</span>
          <span
            aria-hidden="true"
            className={cn(
              "text-[10px] transition-transform duration-250",
              isSiteMenuOpen && "rotate-180",
            )}
          >
            ▾
          </span>
        </button>
        {isSiteMenuOpen ? (
          <div className="site-menu-panel" role="menu">
            <div className="site-menu-panel__section">
              <p className="site-menu-panel__eyebrow">Navigate</p>
              {evalHarnessLinks.map((item) => (
                <Link
                  className={cn(
                    "site-menu-panel__item",
                    item.matchPathnames.includes(pathname) &&
                      "site-menu-panel__item--active",
                  )}
                  href={item.href}
                  key={item.href}
                  onClick={onCloseSiteMenu}
                  role="menuitem"
                >
                  <span className="site-menu-panel__label">{item.label}</span>
                  <span className="site-menu-panel__meta">{item.meta}</span>
                </Link>
              ))}
            </div>

            <div className="site-menu-panel__divider" />

            <div className="site-menu-panel__section">
              <p className="site-menu-panel__eyebrow">Workspace</p>
              <button
                className={cn(
                  "site-menu-panel__item text-left",
                  isHistoryOpen && "site-menu-panel__item--active",
                )}
                onClick={onNavigateToHistoryFromMenu}
                role="menuitem"
                type="button"
              >
                <span className="site-menu-panel__label">Run history</span>
                <span className="site-menu-panel__meta">
                  {historyCount ? `${historyCount} saved runs` : "Recent sessions"}
                </span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 items-center justify-center gap-0.5 overflow-x-auto">
        <button
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-(--muted) transition-colors hover:bg-(--card-active) hover:text-(--foreground)"
          onClick={onOpenPromptModal}
          type="button"
        >
          Edit prompt
        </button>

        <button
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            isAgenticEnabled
              ? "bg-[color-mix(in_oklch,var(--accent)_22%,transparent)] text-(--foreground)"
              : "text-(--muted) hover:bg-(--card-active) hover:text-(--foreground)",
          )}
          onClick={onToggleAgenticMode}
          type="button"
        >
          Agentic mode
        </button>

        <button
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            isHistoryOpen
              ? "bg-(--card-active) text-(--foreground)"
              : "text-(--muted) hover:bg-(--card-active) hover:text-(--foreground)",
          )}
          onClick={onHistoryToggle}
          type="button"
        >
          History{historyCount ? ` (${historyCount})` : ""}
        </button>

        <Link
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-(--muted) transition-colors hover:bg-(--card-active) hover:text-(--foreground)"
          href="/stats"
        >
          Stats
        </Link>

        <span
          aria-hidden="true"
          className="mx-1 hidden h-4 w-px shrink-0 bg-(--foreground) opacity-15 sm:block"
        />

        <div className="hidden shrink-0 items-center overflow-hidden rounded-full border border-(--line) sm:flex">
          {(["s", "m", "l", "xl"] as const).map((size) => (
            <button
              key={size}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition",
                cardSize === size
                  ? "bg-(--foreground) text-(--background)"
                  : "text-(--muted) hover:bg-(--card-active)",
              )}
              onClick={() => onCardSizeChange(size)}
              type="button"
            >
              {size.toUpperCase()}
            </button>
          ))}
        </div>

        <span
          aria-hidden="true"
          className="mx-1 hidden h-4 w-px shrink-0 bg-(--foreground) opacity-15 sm:block"
        />

        <div className="hidden shrink-0 items-center overflow-hidden rounded-full border border-(--line) sm:flex">
          <button
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
              outputMode === "preview"
                ? "bg-(--foreground) text-(--background)"
                : "text-(--muted) hover:bg-(--card-active)",
            )}
            disabled={!canToggleOutputWhileRunning}
            onClick={() => onOutputModeChange("preview")}
            type="button"
          >
            Preview
          </button>
          <button
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
              outputMode === "raw"
                ? "bg-(--foreground) text-(--background)"
                : "text-(--muted) hover:bg-(--card-active)",
            )}
            disabled={!canToggleOutputWhileRunning}
            onClick={() => onOutputModeChange("raw")}
            type="button"
          >
            Raw
          </button>
          <button
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition",
              outputMode === "thinking"
                ? "bg-(--foreground) text-(--background)"
                : "text-(--muted) hover:bg-(--card-active)",
            )}
            onClick={() => onOutputModeChange("thinking")}
            type="button"
          >
            Thinking
          </button>
        </div>

        <span
          aria-hidden="true"
          className="mx-1 h-4 w-px shrink-0 bg-(--foreground) opacity-15"
        />

        {isRunning ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-(--muted)">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-(--accent)" />
            Running…
          </span>
        ) : isEditLocked ? (
          <button
            className="shrink-0 rounded-full bg-(--foreground) px-4 py-1.5 text-xs font-semibold text-(--background) transition hover:opacity-90"
            onClick={onNewRun}
            type="button"
          >
            + New Run
          </button>
        ) : (
          <button
            className="shrink-0 rounded-full bg-(--accent) px-4 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canStartRun}
            onClick={onCompare}
            type="button"
          >
            Run ▸
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <div className="flex items-center gap-2 rounded-full py-1.5 pl-2 pr-3 [background:color-mix(in_oklch,var(--foreground)_7%,transparent)]">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--accent-soft) text-[10px] font-semibold uppercase tracking-wide">
            {signedInUserMonogram}
          </span>
          <span className="hidden max-w-45 truncate text-xs font-medium sm:block">
            {signedInUserDisplayName}
          </span>
        </div>
        <button
          className="rounded-full px-4 py-1.5 text-xs font-medium text-(--muted) transition-colors hover:bg-(--card-active) hover:text-(--foreground) disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isAuthActionPending}
          onClick={onSignOut}
          type="button"
        >
          {isAuthActionPending
            ? "Signing out…"
            : isAnonymousUser
              ? "Reset guest"
              : "Sign out"}
        </button>
      </div>
    </header>
  );
}
