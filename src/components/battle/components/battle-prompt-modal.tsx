"use client";

type BattlePromptModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onPromptChange: (value: string) => void;
  prompt: string;
};

export function BattlePromptModal({
  isOpen,
  onClose,
  onPromptChange,
  prompt,
}: BattlePromptModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
    >
      <div
        className="modal-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-(--line) px-6 py-4">
          <h2 className="text-sm font-semibold tracking-[-0.02em]">
            Edit prompt
          </h2>
          <button
            className="rounded-full bg-(--foreground) px-4 py-1.5 text-xs font-semibold text-(--background) transition hover:opacity-90"
            onClick={onClose}
            type="button"
          >
            Done
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <textarea
            className="min-h-80 w-full resize-none bg-transparent text-sm leading-7 text-(--foreground) outline-none"
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Tell the models what kind of build guidance you want."
            value={prompt}
          />
        </div>
        <div className="shrink-0 border-t border-(--line) px-6 py-3">
          <p className="text-xs text-(--muted)">
            {prompt.length.toLocaleString()} characters
          </p>
        </div>
      </div>
    </div>
  );
}
