import { describe, expect, it } from 'vitest';
import { apGatewayLogWriterKey } from './apGatewayLogWriter';

/**
 * The row every ownerless box on a network keeps its logs in. It belongs to the network,
 * so it is the same however many players come and go, and it exists before any of them
 * has ever joined.
 */

describe('apGatewayLogWriterKey', () => {
  it('is the same key every time for one network', () => {
    expect(apGatewayLogWriterKey('CAMPUS-GUEST-OPEN')).toBe(apGatewayLogWriterKey('CAMPUS-GUEST-OPEN'));
  });

  it('gives two networks two different keys', () => {
    expect(apGatewayLogWriterKey('CAMPUS-GUEST-OPEN')).not.toBe(apGatewayLogWriterKey('ACME-CORP'));
  });

  it('can never be mistaken for a player, whose key is 64 hex digits', () => {
    expect(apGatewayLogWriterKey('a'.repeat(64))).not.toMatch(/^[0-9a-f]{64}$/);
  });
});
