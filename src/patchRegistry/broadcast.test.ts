import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publishPatchChange } from './broadcast';

const ORIGINATOR_KEY = 'aa'.repeat(32);

describe('publishPatchChange', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('calls broadcastFn with channel name "patches:<machine_id>"', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishPatchChange(broadcast, '10.0.0.1', ORIGINATOR_KEY);

    expect(broadcast).toHaveBeenCalledWith(
      'patches:10.0.0.1',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('uses event name "patch_change"', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishPatchChange(broadcast, '10.0.0.1', ORIGINATOR_KEY);

    expect(broadcast).toHaveBeenCalledWith(expect.any(String), 'patch_change', expect.any(Object));
  });

  it('ships a hint payload — { machine_id, originator_key } — NOT the full patch', async () => {
    // Hint-only design: forgery becomes harmless because there's no
    // content payload to inject. Receivers refetch via the signed
    // /api/patches endpoint to obtain authoritative state. See
    // project_realtime_publish_authorization memory.
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishPatchChange(broadcast, '10.0.0.1', ORIGINATOR_KEY);

    expect(broadcast).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      machine_id: '10.0.0.1',
      originator_key: ORIGINATOR_KEY,
    });
  });

  it('uses the supplied machine_id verbatim in the channel (e.g. "localhost")', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishPatchChange(broadcast, 'localhost', ORIGINATOR_KEY);

    expect(broadcast).toHaveBeenCalledWith(
      'patches:localhost',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('uses the supplied machine_id verbatim in the hint payload', async () => {
    // Hint payload's machine_id mirrors the channel's machine_id.
    // Receivers can rely on either, but we send both for clarity and
    // robustness against future channel-name renames.
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishPatchChange(broadcast, '10.0.0.5', ORIGINATOR_KEY);

    const payload = broadcast.mock.calls[0][2];
    expect(payload).toMatchObject({ machine_id: '10.0.0.5' });
  });

  it('forwards originator_key verbatim to the hint payload', async () => {
    // The originator_key lets receivers distinguish "this is my own
    // change" (skip refetch) from "another player changed something"
    // (refetch via listPatchesForMachines).
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const writerKey = 'cc'.repeat(32);

    await publishPatchChange(broadcast, '10.0.0.1', writerKey);

    const payload = broadcast.mock.calls[0][2];
    expect(payload).toMatchObject({ originator_key: writerKey });
  });

  it('resolves when broadcastFn resolves', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await expect(
      publishPatchChange(broadcast, '10.0.0.1', ORIGINATOR_KEY),
    ).resolves.toBeUndefined();
  });

  it('catches broadcastFn errors, logs, and resolves anyway (fire-and-forget semantics)', async () => {
    const error = new Error('realtime down');
    const broadcast = vi.fn().mockRejectedValue(error);

    await expect(
      publishPatchChange(broadcast, '10.0.0.1', ORIGINATOR_KEY),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[patches] broadcast error:'),
      error,
    );
  });
});
