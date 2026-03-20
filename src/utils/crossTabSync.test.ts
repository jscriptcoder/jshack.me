import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSyncChannel, type SyncMessage } from './crossTabSync';

describe('createSyncChannel', () => {
  describe('with BroadcastChannel available', () => {
    it('delivers messages between two channels', async () => {
      const sender = createSyncChannel();
      const receiver = createSyncChannel();
      const received: SyncMessage[] = [];

      receiver.onMessage((msg) => received.push(msg));

      sender.broadcast({
        type: 'wifi-changed',
        connection: { essid: 'TEST', bssid: 'AA:BB:CC:DD:EE:FF' },
      });

      // BroadcastChannel delivers asynchronously
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(received).toEqual([
        { type: 'wifi-changed', connection: { essid: 'TEST', bssid: 'AA:BB:CC:DD:EE:FF' } },
      ]);

      sender.close();
      receiver.close();
    });

    it('does not deliver messages to the posting channel', async () => {
      const channel = createSyncChannel();
      const received: SyncMessage[] = [];

      channel.onMessage((msg) => received.push(msg));
      channel.broadcast({ type: 'theme-changed', theme: 'green' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(received).toEqual([]);

      channel.close();
    });

    it('delivers filesystem-patch messages', async () => {
      const sender = createSyncChannel();
      const receiver = createSyncChannel();
      const received: SyncMessage[] = [];

      receiver.onMessage((msg) => received.push(msg));

      const patch = {
        machineId: 'localhost',
        path: '/tmp/test',
        content: 'hello',
        owner: 'user' as const,
      };
      sender.broadcast({ type: 'filesystem-patch', patch });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ type: 'filesystem-patch', patch });

      sender.close();
      receiver.close();
    });

    it('delivers mission-changed messages', async () => {
      const sender = createSyncChannel();
      const receiver = createSyncChannel();
      const received: SyncMessage[] = [];

      receiver.onMessage((msg) => received.push(msg));

      sender.broadcast({ type: 'mission-changed', seed: 'TEST-123' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(received).toEqual([{ type: 'mission-changed', seed: 'TEST-123' }]);

      sender.close();
      receiver.close();
    });

    it('delivers mission-changed with null seed', async () => {
      const sender = createSyncChannel();
      const receiver = createSyncChannel();
      const received: SyncMessage[] = [];

      receiver.onMessage((msg) => received.push(msg));

      sender.broadcast({ type: 'mission-changed', seed: null });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(received).toEqual([{ type: 'mission-changed', seed: null }]);

      sender.close();
      receiver.close();
    });

    it('does not throw when broadcasting after close', () => {
      const channel = createSyncChannel();
      channel.close();

      expect(() =>
        channel.broadcast({
          type: 'wifi-changed',
          connection: { essid: 'TEST', bssid: 'AA:BB:CC:DD:EE:FF' },
        }),
      ).not.toThrow();
    });

    it('stops receiving after close', async () => {
      const sender = createSyncChannel();
      const receiver = createSyncChannel();
      const received: SyncMessage[] = [];

      receiver.onMessage((msg) => received.push(msg));
      receiver.close();

      sender.broadcast({
        type: 'wifi-changed',
        connection: { essid: 'TEST', bssid: 'AA:BB:CC:DD:EE:FF' },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(received).toEqual([]);

      sender.close();
    });
  });

  describe('without BroadcastChannel', () => {
    let originalBroadcastChannel: typeof BroadcastChannel;

    beforeEach(() => {
      originalBroadcastChannel = globalThis.BroadcastChannel;
      // @ts-expect-error — removing global to test fallback
      delete globalThis.BroadcastChannel;
    });

    afterEach(() => {
      globalThis.BroadcastChannel = originalBroadcastChannel;
    });

    it('returns no-op stubs that do not throw', () => {
      const channel = createSyncChannel();

      expect(() =>
        channel.broadcast({
          type: 'wifi-changed',
          connection: { essid: 'TEST', bssid: 'AA:BB:CC:DD:EE:FF' },
        }),
      ).not.toThrow();
      expect(() => channel.onMessage(vi.fn())).not.toThrow();
      expect(() => channel.close()).not.toThrow();
    });
  });
});
