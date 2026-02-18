export type ThemeId = 'amber' | 'green' | 'cyan' | 'light';

export type ThemeColors = {
  readonly bg: string;
  readonly text: string;
  readonly textBright: string;
  readonly textDim: string;
  readonly error: string;
  readonly accent: string;
  readonly accentText: string;
  readonly border: string;
  readonly scrollThumb: string;
  readonly scrollThumbHover: string;
  readonly caret: string;
  readonly link: string;
  readonly linkHover: string;
  readonly avatarBorder: string;
};

export type ThemeDefinition = {
  readonly id: ThemeId;
  readonly name: string;
  readonly colors: ThemeColors;
};

export const DEFAULT_THEME_ID: ThemeId = 'amber';

export const THEMES: Readonly<Record<ThemeId, ThemeDefinition>> = {
  amber: {
    id: 'amber',
    name: 'Amber',
    colors: {
      bg: '#000000',
      text: '#f59e0b',
      textBright: '#fcd34d',
      textDim: '#d97706',
      error: '#ef4444',
      accent: 'rgba(245, 158, 11, 0.9)',
      accentText: '#000000',
      border: 'rgba(120, 53, 15, 0.3)',
      scrollThumb: 'rgba(120, 53, 15, 0.5)',
      scrollThumbHover: 'rgba(146, 64, 14, 0.7)',
      caret: '#fbbf24',
      link: '#fbbf24',
      linkHover: '#fde68a',
      avatarBorder: '#f59e0b',
    },
  },
  green: {
    id: 'green',
    name: 'Green Phosphor',
    colors: {
      bg: '#000000',
      text: '#22c55e',
      textBright: '#86efac',
      textDim: '#16a34a',
      error: '#ef4444',
      accent: 'rgba(34, 197, 94, 0.9)',
      accentText: '#000000',
      border: 'rgba(20, 83, 45, 0.3)',
      scrollThumb: 'rgba(20, 83, 45, 0.5)',
      scrollThumbHover: 'rgba(22, 101, 52, 0.7)',
      caret: '#4ade80',
      link: '#4ade80',
      linkHover: '#bbf7d0',
      avatarBorder: '#22c55e',
    },
  },
  cyan: {
    id: 'cyan',
    name: 'Cyan',
    colors: {
      bg: '#000000',
      text: '#06b6d4',
      textBright: '#67e8f9',
      textDim: '#0891b2',
      error: '#ef4444',
      accent: 'rgba(6, 182, 212, 0.9)',
      accentText: '#000000',
      border: 'rgba(21, 94, 117, 0.3)',
      scrollThumb: 'rgba(21, 94, 117, 0.5)',
      scrollThumbHover: 'rgba(14, 116, 144, 0.7)',
      caret: '#22d3ee',
      link: '#22d3ee',
      linkHover: '#a5f3fc',
      avatarBorder: '#06b6d4',
    },
  },
  light: {
    id: 'light',
    name: 'Light',
    colors: {
      bg: '#f5f5f4',
      text: '#292524',
      textBright: '#0c0a09',
      textDim: '#57534e',
      error: '#dc2626',
      accent: '#e7e5e4',
      accentText: '#0c0a09',
      border: 'rgba(168, 162, 158, 0.3)',
      scrollThumb: 'rgba(168, 162, 158, 0.5)',
      scrollThumbHover: 'rgba(120, 113, 108, 0.7)',
      caret: '#292524',
      link: '#2563eb',
      linkHover: '#1d4ed8',
      avatarBorder: '#57534e',
    },
  },
};

const THEME_IDS = new Set<string>(Object.keys(THEMES));

export const isValidThemeId = (value: unknown): value is ThemeId =>
  typeof value === 'string' && THEME_IDS.has(value);
