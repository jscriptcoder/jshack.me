import { describe, expect, it } from 'vitest';
import { buildCommandEnv } from './env';
import { SEED_HOME, seedFs, seedIdentity, seedSession } from './seed';
import { asAbsPath } from '../core/types';

const seedEnv = (userType: 'guest' | 'user' | 'root' = 'user') =>
  buildCommandEnv({
    identity: seedIdentity(),
    session: { ...seedSession(), userType },
    root: seedFs(),
    cwd: () => SEED_HOME,
    onCwdChange: () => undefined,
  });

describe('buildCommandEnv', () => {
  it('reads /etc/passwd at the session user tier', () => {
    const result = seedEnv('user').fs.read(asAbsPath('/etc/passwd'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a readable /etc/passwd');
    expect(result.content).toContain('alice');
  });

  it('denies /etc/passwd to a guest-tier session', () => {
    expect(seedEnv('guest').fs.read(asAbsPath('/etc/passwd'))).toEqual({
      ok: false,
      error: 'permission_denied',
    });
  });

  it('exposes the provided session and working directory', () => {
    const session = seedSession();
    const env = buildCommandEnv({
      identity: seedIdentity(),
      session,
      root: seedFs(),
      cwd: () => SEED_HOME,
    onCwdChange: () => undefined,
    });

    expect(env.session).toBe(session);
    expect(env.fs.cwd()).toBe(SEED_HOME);
  });
});
