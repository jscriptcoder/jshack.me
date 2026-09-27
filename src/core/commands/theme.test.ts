import { describe, expect, it, vi } from 'vitest';
import { theme } from './theme';
import { mockCommandEnv } from '../../test/factories/commandEnv';

const NO_FLAGS = new Map<string, string | true>();

describe('theme command', () => {
  it('lists every theme with the active one marked', async () => {
    const env = mockCommandEnv({ currentTheme: () => 'amber' });

    const result = await theme.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    // Column-aligned so the marker reads down the left edge, and the id is
    // padded so the display names line up whatever their length.
    expect(result.lines).toEqual([
      { kind: 'text', content: '  * amber    Amber' },
      { kind: 'text', content: '    green    Green Phosphor' },
      { kind: 'text', content: '    cyan     Cyan' },
      { kind: 'text', content: '    light    Light' },
    ]);
  });

  it('moves the marker to whichever theme is active', async () => {
    // A listing that always marked the first entry would pass the test above,
    // so the marker is asserted against a DIFFERENT active theme too.
    const env = mockCommandEnv({ currentTheme: () => 'cyan' });

    const result = await theme.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    const marked = result.lines.filter((line) => line.content.startsWith('  *'));
    expect(marked).toEqual([{ kind: 'text', content: '  * cyan     Cyan' }]);
  });

  it('does not switch anything when it is only listing', async () => {
    const setTheme = vi.fn();
    const env = mockCommandEnv({ currentTheme: () => 'amber', setTheme });

    await theme.execute(env, [], NO_FLAGS);

    expect(setTheme).not.toHaveBeenCalled();
  });

  it('switches to a named theme and says which one it took', async () => {
    const setTheme = vi.fn();
    const env = mockCommandEnv({ currentTheme: () => 'amber', setTheme });

    const result = await theme.execute(env, ['green'], NO_FLAGS);

    expect(setTheme).toHaveBeenCalledWith('green');
    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    // The display name, not the id: it is what the listing shows against that
    // row, so the confirmation names the thing the player just read.
    expect(result.lines).toEqual([{ kind: 'text', content: 'Switched to Green Phosphor theme' }]);
  });

  it('refuses an unknown theme, names the ones there are, and switches nothing', async () => {
    const setTheme = vi.fn();
    const env = mockCommandEnv({ currentTheme: () => 'amber', setTheme });

    const result = await theme.execute(env, ['nope'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      {
        kind: 'error',
        content: "theme: unknown theme 'nope'. Available: amber, green, cyan, light",
      },
    ]);
    // A refusal that still fired the seam would repaint the terminal on a typo
    // — the error line alone would not catch that.
    expect(setTheme).not.toHaveBeenCalled();
  });
});
