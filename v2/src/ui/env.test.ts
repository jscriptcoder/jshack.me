import { describe, expect, it } from 'vitest';
import { buildCommandEnv } from './env';
import { homePathFor, SEED_CONFIG, seedFs, seedSession } from './seed';
import { generateIdentity } from '../core/identity/identity';
import { asAbsPath } from '../core/types';
import type { PatchApi } from '../core/commands/types';

const noopPatches: PatchApi = {
  write: async () => ({ ok: true }),
  remove: async () => ({ ok: true }),
  mkdir: async () => ({ ok: true }),
};

const seedHome = homePathFor(SEED_CONFIG.username);

const seedEnv = (userType: 'guest' | 'user' | 'root' = 'user') =>
  buildCommandEnv({
    identity: generateIdentity(),
    session: { ...seedSession(generateIdentity(), SEED_CONFIG), userType },
    root: seedFs(SEED_CONFIG),
    cwd: () => seedHome,
    onCwdChange: () => undefined,
    patches: noopPatches,
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
    const session = seedSession(generateIdentity(), SEED_CONFIG);
    const env = buildCommandEnv({
      identity: generateIdentity(),
      session,
      root: seedFs(SEED_CONFIG),
      cwd: () => seedHome,
      onCwdChange: () => undefined,
      patches: noopPatches,
    });

    expect(env.session).toBe(session);
    expect(env.fs.cwd()).toBe(seedHome);
  });
});
