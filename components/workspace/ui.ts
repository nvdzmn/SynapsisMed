/** Shared control styles so every button in the workspace uses the same heights, padding, colours and states. */
export const button = {
  /** Violet call to action: start, send, draft, voice. */
  primary:
    "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-violet px-4 text-sm font-semibold text-white transition-colors hover:bg-violet-press disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400",
  /** Outlined companion to primary: retry, open, attach, talk. */
  secondary:
    "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50",
  /** Quiet inline action inside a panel: ungroup, clear, show. */
  small: "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 text-[11px] font-medium text-secondary transition-colors hover:bg-canvas hover:text-ink",
  /** Square icon-only control: close, zoom, remove. */
  icon: "grid h-8 w-8 shrink-0 place-items-center rounded-md text-secondary transition-colors hover:bg-canvas hover:text-ink",
} as const;
