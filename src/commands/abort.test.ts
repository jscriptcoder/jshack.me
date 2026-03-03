import { describe, it, expect, vi } from 'vitest';
import { createAbortCommand } from './abort';

describe('abort command', () => {
  it('aborts an active mission', () => {
    const abortMission = vi.fn();
    const popAllSessions = vi.fn();
    const abort = createAbortCommand({
      abortMission,
      isMissionActive: () => true,
      popAllSessions,
    });

    const result = abort.fn();

    expect(popAllSessions).toHaveBeenCalled();
    expect(abortMission).toHaveBeenCalled();
    expect(typeof result).toBe('string');
    expect(result).toContain('Mission aborted');
  });

  it('pops all sessions before aborting', () => {
    const callOrder: string[] = [];
    const abort = createAbortCommand({
      abortMission: () => callOrder.push('abort'),
      isMissionActive: () => true,
      popAllSessions: () => callOrder.push('popAll'),
    });

    abort.fn();

    expect(callOrder).toEqual(['popAll', 'abort']);
  });

  it('throws when no mission is active', () => {
    const abort = createAbortCommand({
      abortMission: vi.fn(),
      isMissionActive: () => false,
      popAllSessions: vi.fn(),
    });

    expect(() => abort.fn()).toThrow('No active mission to abort');
  });
});
