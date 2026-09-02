import { describe, expect, it, vi } from 'vitest';
import { clear } from './clear';
import { mockCommandEnv } from '../../test/factories/commandEnv';

const NO_FLAGS = new Map<string, string | true>();

describe('clear command', () => {
  it('empties the screen and prints nothing at all', async () => {
    const clearScreen = vi.fn();

    const result = await clear.execute(mockCommandEnv({ clearScreen }), [], NO_FLAGS);

    expect(clearScreen).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Not one line, not even a blank one: anything it printed would be the only
    // thing standing on the screen it had just emptied.
    expect(result.lines).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});
