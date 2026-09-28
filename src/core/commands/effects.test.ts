import { describe, expect, it, vi } from 'vitest';
import { effects } from './effects.js';
import { ALL_EFFECTS_ON } from '../theme/effects.js';
import { mockCommandEnv } from '../../test/factories/commandEnv.js';

const NO_FLAGS = new Map<string, string | true>();

const linesOf = async (env: ReturnType<typeof mockCommandEnv>, args: readonly string[]) => {
  const result = await effects.execute(env, args, NO_FLAGS);
  if (result.kind !== 'sync') throw new Error('effects answers synchronously');
  return result;
};

describe('effects command', () => {
  it('lists every effect with whether it is on, column-aligned', async () => {
    const env = mockCommandEnv({
      currentTheme: () => 'neon',
      currentEffects: () => ({ ...ALL_EFFECTS_ON, glitch: false, hud: false }),
    });

    const result = await linesOf(env, []);

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([
      { kind: 'text', content: '  glow     on' },
      { kind: 'text', content: '  glitch   off' },
      { kind: 'text', content: '  hud      off' },
      { kind: 'text', content: '  cursor   on' },
    ]);
  });

  it('says under a plain theme that the effects show only under a neon one', async () => {
    // The settings still stand under Amber, so the listing still shows them; the
    // closing line is what stops a player wondering why switching one did nothing.
    const env = mockCommandEnv({
      currentTheme: () => 'amber',
      currentEffects: () => ({ ...ALL_EFFECTS_ON, cursor: false }),
    });

    const result = await linesOf(env, []);

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([
      { kind: 'text', content: '  glow     on' },
      { kind: 'text', content: '  glitch   on' },
      { kind: 'text', content: '  hud      on' },
      { kind: 'text', content: '  cursor   off' },
      { kind: 'dim', content: 'Effects show only under the neon themes: neon, redline, synth.' },
    ]);
  });

  it('switches nothing when it is only listing', async () => {
    const setEffect = vi.fn();

    await linesOf(mockCommandEnv({ setEffect }), []);

    expect(setEffect).not.toHaveBeenCalled();
  });

  it.each([
    ['glow', 'off', false],
    ['glitch', 'off', false],
    ['hud', 'off', false],
    ['cursor', 'off', false],
    ['glitch', 'on', true],
  ] as const)('switches %s %s and says what it did', async (name, state, on) => {
    const setEffect = vi.fn();

    const result = await linesOf(mockCommandEnv({ setEffect }), [name, state]);

    expect(setEffect).toHaveBeenCalledTimes(1);
    expect(setEffect).toHaveBeenCalledWith(name, on);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([{ kind: 'text', content: `Switched ${name} ${state}` }]);
  });

  it('refuses an unknown effect, names the ones there are, and switches nothing', async () => {
    const setEffect = vi.fn();

    const result = await linesOf(mockCommandEnv({ setEffect }), ['scanlines', 'on']);

    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      {
        kind: 'error',
        content: "effects: unknown effect 'scanlines'. Available: glow, glitch, hud, cursor",
      },
    ]);
    expect(setEffect).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing state', ['glow']],
    ['an unrecognised state', ['glow', 'dim']],
    ['a state in the wrong case', ['glow', 'OFF']],
  ])('refuses %s with the usage line and switches nothing', async (_case, args) => {
    const setEffect = vi.fn();

    const result = await linesOf(mockCommandEnv({ setEffect }), args);

    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      { kind: 'error', content: 'effects: usage: effects [<effect> <on|off>]' },
    ]);
    expect(setEffect).not.toHaveBeenCalled();
  });
});
