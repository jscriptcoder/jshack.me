import { describe, expect, it, vi } from 'vitest';
import { xterm } from './xterm';
import { mockCommandEnv } from '../../test/factories/commandEnv';

const NO_FLAGS = new Map<string, string | true>();

describe('xterm command', () => {
  it('asks the UI for another terminal and says one is on the way', async () => {
    const openTerminal = vi.fn();

    const result = await xterm.execute(mockCommandEnv({ openTerminal }), [], NO_FLAGS);

    // Asked at the env seam, because `core/` has no window to open and must not
    // grow one: the command decides that another terminal should exist, and the
    // UI is the only layer that knows what a tab is.
    expect(openTerminal).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // A line, because a tab that opens behind a popup blocker leaves the player
    // looking at a prompt that did nothing — the shell should have said what it
    // tried to do.
    expect(result.lines).toEqual([{ kind: 'text', content: 'Opening new terminal...' }]);
    expect(result.exitCode).toBe(0);
  });
});
