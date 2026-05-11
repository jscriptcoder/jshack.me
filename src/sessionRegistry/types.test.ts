import { describe, it, expect } from 'vitest';
import { sessionsSignedPayloadSchema } from './types';

// Schema-shape tests for the `authCreateSession` action arm.
//
// authCreateSession collapses validation + session-creation into one
// atomic operation. The auth method (password vs saved-key fingerprint)
// is a nested discriminated union under the `auth` field — zod's
// discriminatedUnion can't carry mutual-exclusion via .refine(), and
// the nested shape keeps the wire payload self-describing.

const baseEnvelope = {
  ts: 1_700_000_000,
  nonce: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

const baseAuthCreateSession = {
  action: 'authCreateSession' as const,
  ...baseEnvelope,
  machine_id: 'target-host',
  kind: 'ssh' as const,
  username: 'alice',
};

const passwordAuth = { method: 'password' as const, password: 'secret' };
const savedKeyAuth = {
  method: 'savedKey' as const,
  fingerprint: 'a'.repeat(32),
  targetIp: '10.0.0.5',
};
const pidfileAuth = { method: 'pidfile' as const, port: 4444 };

describe('authCreateSession schema arm', () => {
  it('parses a valid envelope with password auth', () => {
    const result = sessionsSignedPayloadSchema.parse({
      ...baseAuthCreateSession,
      auth: passwordAuth,
    });
    expect(result.action).toBe('authCreateSession');
    if (result.action === 'authCreateSession' && result.auth.method === 'password') {
      expect(result.auth.password).toBe('secret');
      expect(result.username).toBe('alice');
      expect(result.kind).toBe('ssh');
    }
  });

  it('parses a valid envelope with savedKey auth', () => {
    const result = sessionsSignedPayloadSchema.parse({
      ...baseAuthCreateSession,
      auth: savedKeyAuth,
    });
    expect(result.action).toBe('authCreateSession');
    if (result.action === 'authCreateSession' && result.auth.method === 'savedKey') {
      expect(result.auth.fingerprint).toBe('a'.repeat(32));
    }
  });

  it('rejects envelope with method=password but no password field', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        auth: { method: 'password' },
      }),
    ).toThrow();
  });

  it('rejects envelope with method=savedKey but no fingerprint field', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        auth: { method: 'savedKey', targetIp: '10.0.0.5' },
      }),
    ).toThrow();
  });

  it('rejects envelope with method=savedKey but no targetIp field', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        auth: { method: 'savedKey', fingerprint: 'a'.repeat(32) },
      }),
    ).toThrow();
  });

  it('rejects envelope with extra fields in auth (strict)', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        auth: { method: 'password', password: 'secret', fingerprint: 'oops' },
      }),
    ).toThrow();
  });

  it('rejects envelope missing the auth field entirely', () => {
    expect(() => sessionsSignedPayloadSchema.parse(baseAuthCreateSession)).toThrow();
  });

  it('rejects unknown auth method', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        auth: { method: 'biometric', token: 'x' },
      }),
    ).toThrow();
  });

  it('accepts kind=ssh', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        kind: 'ssh',
        auth: passwordAuth,
      }),
    ).not.toThrow();
  });

  it('accepts kind=scp', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        kind: 'scp',
        auth: passwordAuth,
      }),
    ).not.toThrow();
  });

  it('accepts kind=su', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        kind: 'su',
        auth: passwordAuth,
      }),
    ).not.toThrow();
  });

  it('accepts kind=ftp', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        kind: 'ftp',
        auth: passwordAuth,
      }),
    ).not.toThrow();
  });

  it.each(['mysql', 'redis', 'snmp'] as const)('accepts kind=%s', (kind) => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        kind,
        auth: passwordAuth,
      }),
    ).not.toThrow();
  });

  it('rejects kind=exploit (uses createSession with signed-envelope tier trust)', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        kind: 'exploit',
        auth: passwordAuth,
      }),
    ).toThrow();
  });

  // Pidfile auth method (third arm of authMethodSchema) for nc-connect
  // to a backdoor. Server reads /var/run/nc-<port>.pid and derives
  // credentials.
  it('accepts kind=nc with method=pidfile', () => {
    const result = sessionsSignedPayloadSchema.parse({
      ...baseAuthCreateSession,
      kind: 'nc',
      auth: pidfileAuth,
    });
    expect(result.action).toBe('authCreateSession');
    if (result.action === 'authCreateSession' && result.auth.method === 'pidfile') {
      expect(result.auth.port).toBe(4444);
      expect(result.kind).toBe('nc');
    }
  });

  it('accepts pidfile method on existing kinds too — handler decides validity', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        kind: 'ssh',
        auth: pidfileAuth,
      }),
    ).not.toThrow();
  });

  it('rejects pidfile method with no port', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        kind: 'nc',
        auth: { method: 'pidfile' },
      }),
    ).toThrow();
  });

  it('rejects pidfile method with port out of range (low)', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        kind: 'nc',
        auth: { method: 'pidfile', port: 0 },
      }),
    ).toThrow();
  });

  it('rejects pidfile method with port out of range (high)', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        kind: 'nc',
        auth: { method: 'pidfile', port: 65536 },
      }),
    ).toThrow();
  });

  it('rejects pidfile method with non-integer port', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        kind: 'nc',
        auth: { method: 'pidfile', port: 4444.5 },
      }),
    ).toThrow();
  });

  it('rejects pidfile method with extra fields (strict)', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        kind: 'nc',
        auth: { method: 'pidfile', port: 4444, password: 'leaked' },
      }),
    ).toThrow();
  });

  it('rejects empty username (min 1)', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        username: '',
        auth: passwordAuth,
      }),
    ).toThrow();
  });

  it('rejects oversized password (> 256)', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        auth: { method: 'password', password: 'x'.repeat(257) },
      }),
    ).toThrow();
  });

  it('rejects empty password (min 1)', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        auth: { method: 'password', password: '' },
      }),
    ).toThrow();
  });

  it('rejects oversized fingerprint (> 128)', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        auth: { method: 'savedKey', fingerprint: 'a'.repeat(129) },
      }),
    ).toThrow();
  });

  it('accepts optional parent_session_id and source_ip', () => {
    const result = sessionsSignedPayloadSchema.parse({
      ...baseAuthCreateSession,
      auth: passwordAuth,
      parent_session_id: '00000000-0000-0000-0000-000000000000',
      source_ip: '10.0.0.1',
    });
    expect(result.action).toBe('authCreateSession');
    if (result.action === 'authCreateSession') {
      expect(result.parent_session_id).toBe('00000000-0000-0000-0000-000000000000');
      expect(result.source_ip).toBe('10.0.0.1');
    }
  });

  it('rejects unknown top-level fields (strict)', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        auth: passwordAuth,
        unknown_field: 'oops',
      }),
    ).toThrow();
  });

  it('rejects oversized machine_id (> 256)', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        ...baseAuthCreateSession,
        machine_id: 'x'.repeat(257),
        auth: passwordAuth,
      }),
    ).toThrow();
  });
});

describe('existing createSession arm continues to parse (regression)', () => {
  it('parses a valid createSession envelope', () => {
    const result = sessionsSignedPayloadSchema.parse({
      action: 'createSession',
      ...baseEnvelope,
      machine_id: 'target-host',
      credentials: { username: 'alice', userType: 'user' },
      kind: 'exploit',
    });
    expect(result.action).toBe('createSession');
  });

  it('rejects createSession without kind (now required)', () => {
    expect(() =>
      sessionsSignedPayloadSchema.parse({
        action: 'createSession',
        ...baseEnvelope,
        machine_id: 'target-host',
        credentials: { username: 'alice', userType: 'user' },
      }),
    ).toThrow();
  });
});
