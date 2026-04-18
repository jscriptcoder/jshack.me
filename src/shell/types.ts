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
