import type { ThemeDefinition } from './themes';

const camelToKebab = (str: string): string =>
  str.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);

export const applyTheme = (theme: ThemeDefinition): void => {
  const style = document.documentElement.style;
  Object.entries(theme.colors).forEach(([key, value]) => {
    style.setProperty(`--theme-${camelToKebab(key)}`, value);
  });
};
