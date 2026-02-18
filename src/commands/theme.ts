import type { Command } from '../components/Terminal/types';
import type { ThemeId } from '../theme/themes';
import { THEMES, isValidThemeId } from '../theme/themes';

type CreateThemeCommandOptions = {
  readonly setTheme: (theme: ThemeId) => void;
  readonly getCurrentTheme: () => ThemeId;
};

const THEME_IDS = Object.keys(THEMES) as readonly ThemeId[];

export const createThemeCommand = ({
  setTheme,
  getCurrentTheme,
}: CreateThemeCommandOptions): Command => ({
  name: 'theme',
  description: 'List or switch terminal color themes',
  manual: {
    synopsis: 'theme(name?: string)',
    description:
      'Without arguments, lists all available themes with the current one marked. With a theme name, switches to that theme. Theme choice persists across sessions.',
    arguments: [
      {
        name: 'name',
        description: 'The theme to switch to (amber, green, cyan, light)',
        required: false,
      },
    ],
    examples: [
      { command: 'theme()', description: 'List available themes' },
      { command: 'theme("green")', description: 'Switch to green phosphor theme' },
      { command: 'theme("light")', description: 'Switch to light theme' },
    ],
  },
  fn: (...args: readonly unknown[]): string => {
    if (args.length === 0 || args[0] === undefined) {
      const current = getCurrentTheme();
      return THEME_IDS.map(
        (id) => `  ${id === current ? '*' : ' '} ${id.padEnd(8)} ${THEMES[id].name}`,
      ).join('\n');
    }

    const name = args[0];
    if (typeof name !== 'string') {
      throw new Error(`theme: expected string argument, got ${typeof name}`);
    }

    if (!isValidThemeId(name)) {
      throw new Error(`theme: unknown theme '${name}'. Available: ${THEME_IDS.join(', ')}`);
    }

    setTheme(name);
    return `Switched to ${THEMES[name].name} theme`;
  },
});
