export type Token =
  | { readonly kind: 'word'; readonly value: string }
  | { readonly kind: 'pipe' }
  | { readonly kind: 'redirect' };

export type Stage = {
  readonly command: string;
  readonly args: readonly string[];
};

export type Pipeline = {
  readonly stages: readonly Stage[];
  readonly redirect?: { readonly path: string };
};

// Grows as shell features land: stdin (Phase B), env/stderr/signals (future).
// Commands opt in by implementing Command.fnShell instead of (or in addition to) fn.
export type ShellContext = {
  readonly stdin?: string;
};
