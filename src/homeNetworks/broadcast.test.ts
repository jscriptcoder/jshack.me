import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publishOccupantChange } from './broadcast';

const ORIGINATOR_KEY = 'aa'.repeat(32);

describe('publishOccupantChange', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('calls broadcastFn with channel name "occupants:<network_id>"', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishOccupantChange(broadcast, '203.0.113.42', ORIGINATOR_KEY);

    expect(broadcast).toHaveBeenCalledWith(
      'occupants:203.0.113.42',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('uses event name "occupant_change"', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishOccupantChange(broadcast, '203.0.113.42', ORIGINATOR_KEY);

    expect(broadcast).toHaveBeenCalledWith(
      expect.any(String),
      'occupant_change',
      expect.any(Object),
    );
  });

  it('ships a hint payload — { network_id, originator_key } — NOT the full occupant row', async () => {
    // Hint-only design: forgery becomes harmless because there's no
    // content payload to inject. Receivers refetch via the anon SELECT
    // listOccupants for authoritative state.
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishOccupantChange(broadcast, '203.0.113.42', ORIGINATOR_KEY);

    expect(broadcast).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      network_id: '203.0.113.42',
      originator_key: ORIGINATOR_KEY,
    });
  });

  it('uses the supplied network_id verbatim in the channel', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishOccupantChange(broadcast, '198.51.100.7', ORIGINATOR_KEY);

    expect(broadcast).toHaveBeenCalledWith(
      'occupants:198.51.100.7',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('uses the supplied network_id verbatim in the hint payload', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishOccupantChange(broadcast, '198.51.100.7', ORIGINATOR_KEY);

    const payload = broadcast.mock.calls[0][2];
    expect(payload).toMatchObject({ network_id: '198.51.100.7' });
  });

  it('forwards originator_key verbatim to the hint payload', async () => {
    // The originator_key lets receivers distinguish "this is my own join"
    // (skip refetch — own join already updated local state) from "another
    // player joined" (refetch via listOccupants).
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const writerKey = 'cc'.repeat(32);

    await publishOccupantChange(broadcast, '203.0.113.42', writerKey);

    const payload = broadcast.mock.calls[0][2];
    expect(payload).toMatchObject({ originator_key: writerKey });
  });

  it('resolves when broadcastFn resolves', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await expect(
      publishOccupantChange(broadcast, '203.0.113.42', ORIGINATOR_KEY),
    ).resolves.toBeUndefined();
  });

  it('catches broadcastFn errors, logs, and resolves anyway (fire-and-forget semantics)', async () => {
    const error = new Error('realtime down');
    const broadcast = vi.fn().mockRejectedValue(error);

    await expect(
      publishOccupantChange(broadcast, '203.0.113.42', ORIGINATOR_KEY),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[homeNetworks] broadcast error:'),
      error,
    );
  });
});
