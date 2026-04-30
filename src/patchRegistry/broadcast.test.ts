import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publishPatchChange } from './broadcast';
import type { PatchSummary } from './types';

const samplePatch: PatchSummary = {
  machine_id: '10.0.0.1',
  path: '/etc/hosts',
  content: '127.0.0.1 localhost',
  owner: 'root',
  permissions: null,
  is_new: false,
  node_type: 'file',
};

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

    await publishPatchChange(broadcast, '10.0.0.1', samplePatch);

    expect(broadcast).toHaveBeenCalledWith(
      'patches:10.0.0.1',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('uses event name "patch_change"', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishPatchChange(broadcast, '10.0.0.1', samplePatch);

    expect(broadcast).toHaveBeenCalledWith(expect.any(String), 'patch_change', expect.any(Object));
  });

  it('forwards the patch payload verbatim as the broadcast payload', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishPatchChange(broadcast, '10.0.0.1', samplePatch);

    expect(broadcast).toHaveBeenCalledWith(expect.any(String), expect.any(String), samplePatch);
  });

  it('uses the supplied machine_id verbatim in the channel (e.g. "localhost")', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await publishPatchChange(broadcast, 'localhost', samplePatch);

    expect(broadcast).toHaveBeenCalledWith(
      'patches:localhost',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('resolves when broadcastFn resolves', async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);

    await expect(publishPatchChange(broadcast, '10.0.0.1', samplePatch)).resolves.toBeUndefined();
  });

  it('catches broadcastFn errors, logs, and resolves anyway (fire-and-forget semantics)', async () => {
    const error = new Error('realtime down');
    const broadcast = vi.fn().mockRejectedValue(error);

    await expect(publishPatchChange(broadcast, '10.0.0.1', samplePatch)).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[patches] broadcast error:'),
      error,
    );
  });
});
