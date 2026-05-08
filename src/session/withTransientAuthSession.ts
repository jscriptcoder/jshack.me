import type { Identity } from '../identity/identity.js';
import {
  authCreateSession,
  endSession as endServerSession,
} from '../sessionRegistry/client.js';
import type { AuthMethod, AuthRequiredKind } from '../sessionRegistry/types.js';

// Auth-required equivalent of withTransientSession (PR 2 step 8 of
// plans/cross-player-base-fs-replication.md). Validates credentials
// against /etc/passwd via authCreateSession, runs `body` inside the
// resulting session, and ends the session in `finally`.
//
// Used by SCP's transient transfer session and (in PR 3) FTP's
// per-login session, etc. Like its sibling, body's success or throw
// is preserved through the finally; an end-session failure is logged
// and swallowed.
//
// Result discriminates auth failure (server returned 401
// invalid_credentials, or 429 rate_limited) from body throws (network
// errors, transfer failures). Auth-fail short-circuits — body is NOT
// invoked, no session is created, no endSession is fired.

export type WithTransientAuthSessionParams = {
  readonly machine_id: string;
  readonly kind: AuthRequiredKind;
  readonly username: string;
  readonly auth: AuthMethod;
  readonly parent_session_id?: string;
  readonly source_ip?: string;
};

export type WithTransientAuthSessionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'invalid_credentials' | 'rate_limited' };

export const withTransientAuthSession = async <T>(
  identity: Identity,
  params: WithTransientAuthSessionParams,
  body: (sessionId: string) => Promise<T> | T,
): Promise<WithTransientAuthSessionResult<T>> => {
  const result = await authCreateSession(identity, {
    machine_id: params.machine_id,
    kind: params.kind,
    username: params.username,
    auth: params.auth,
    ...(params.parent_session_id !== undefined && {
      parent_session_id: params.parent_session_id,
    }),
    ...(params.source_ip !== undefined && { source_ip: params.source_ip }),
  });
  if (!result.ok) return result;

  try {
    const value = await body(result.session_id);
    return { ok: true, value };
  } finally {
    void endServerSession(identity, {
      session_id: result.session_id,
      reason: 'user_exit',
    }).catch((error) => {
      console.error('[withTransientAuthSession] endServerSession failed:', error);
    });
  }
};
