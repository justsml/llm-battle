# Battle Client Refactor Plan

Last updated: 2026-03-30

## Goal

Get [`src/components/battle/client-impl.tsx`](/Users/dan/code/oss/llm-build-off/src/components/battle/client-impl.tsx) under 1,500 lines without just moving the same complexity into one new giant file.

## Current State

- `src/components/battle-client.tsx`: 1 line
- `src/components/battle/client-impl.tsx`: 306 lines
- `src/components/battle/lib/client-state.ts`: 1,363 lines
- `src/components/battle/hooks/use-battle-workspace-controller.ts`: 1,397 lines
- `src/components/battle/hooks/use-battle-workspace-effects.ts`: 721 lines
- `src/components/battle/hooks/use-battle-preview-controller.ts`: 837 lines
- `src/components/battle/hooks/use-battle-panel-controller.ts`: 189 lines
- `src/components/battle/components/battle-grid.tsx`: 272 lines
- `src/components/battle/components/battle-card.tsx`: 685 lines
- `src/components/battle/components/battle-input.tsx`: 98 lines
- Typecheck status: `pnpm exec tsc --noEmit` passing

## Completed

- [x] Rename the `build-off` surface area to `battle`
- [x] Move the main export to [`src/components/battle-client.tsx`](/Users/dan/code/oss/llm-build-off/src/components/battle-client.tsx) and keep the heavy implementation in [`src/components/battle/client-impl.tsx`](/Users/dan/code/oss/llm-build-off/src/components/battle/client-impl.tsx)
- [x] Extract battle loading and auth screens
- [x] Extract battle preview and prompt modals
- [x] Extract battle overlays and top-shell UI
- [x] Extract stats dashboard chart components
- [x] Extract model catalog helpers to [`src/components/battle/lib/model-catalog.ts`](/Users/dan/code/oss/llm-build-off/src/components/battle/lib/model-catalog.ts)
- [x] Extract preview markup/sandbox helpers to [`src/components/battle/lib/preview.ts`](/Users/dan/code/oss/llm-build-off/src/components/battle/lib/preview.ts)
- [x] Extract the standalone model picker to [`src/components/battle/components/model-picker.tsx`](/Users/dan/code/oss/llm-build-off/src/components/battle/components/model-picker.tsx)
- [x] Extract the standalone live preview to [`src/components/battle/components/live-html-preview.tsx`](/Users/dan/code/oss/llm-build-off/src/components/battle/components/live-html-preview.tsx)
- [x] Remove duplicated picker and preview implementations from the battle client

## Active Work

- [x] Extract the full card grid and model-card render path out of [`src/components/battle/client-impl.tsx`](/Users/dan/code/oss/llm-build-off/src/components/battle/client-impl.tsx)
- [x] Extract preview bridge, preview commands, and visual-diff lifecycle into a dedicated hook/module
- [x] Extract compare/run actions, voting, drag-drop, and host-model import actions into a dedicated hook/module
- [x] Extract route hydration, local draft persistence, and mode-switch workspace coordination into a dedicated hook/module

## Planned Milestones

### Milestone 1: Render Split

- [x] Create `src/components/battle/components/battle-grid.tsx`
- [x] Create `src/components/battle/components/battle-input.tsx`
- [x] Create `src/components/battle/components/battle-card.tsx`
- [x] Move the ghost add-card into the grid component

Exit criteria:

- `client-impl.tsx` owns orchestration, not the full card JSX tree

### Milestone 2: Preview Controller Split

- [x] Move preview message handling out of `client-impl.tsx`
- [x] Move preview command transport out of `client-impl.tsx`
- [x] Move live stream token metric buffering out of `client-impl.tsx`
- [x] Move visual diff refresh/build logic out of `client-impl.tsx`

Exit criteria:

- Preview-specific refs/effects/actions live outside the main client component

### Milestone 3: Workspace And Run Controller Split

- [x] Move draft bootstrap and localStorage persistence out of `client-impl.tsx`
- [x] Move run hydration and history loading out of `client-impl.tsx`
- [x] Move compare stream orchestration out of `client-impl.tsx`
- [x] Move model selection, panel count, drag-drop, and voting handlers out of `client-impl.tsx`

Exit criteria:

- `BattleClient` becomes a thin orchestrator with hooks + presentational components

### Milestone 4: Final Reduction Pass

- [x] Re-measure line counts
- [x] Trim any remaining utility code from `client-impl.tsx`
- [x] Keep every new extracted file under roughly 1,500 lines
- [x] Re-run `pnpm exec tsc --noEmit`

Exit criteria:

- `src/components/battle/client-impl.tsx` is under 1,500 lines

## Notes

- Prefer extracting by responsibility, not by arbitrary line ranges.
- Keep commits small and green.
- Avoid replacing one giant component with one giant hook.
