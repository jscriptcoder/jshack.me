import type { Identity } from '../identity/identity.js';
import {
  createSession as createServerSession,
  endSession as endServerSession,
} from '../sessionRegistry/client.js';
import type { Credentials, SessionKind } from '../sessionRegistry/types.js';

// Pushes a server session, runs `body`, ends the session in `finally`.
// Used by one-shot writes that need an active session row at the
// moment a patch fires but don't keep an "active connection" in
// client state — scp transfers, snmpset, msfconsole one-shot effects,
// script_exec daemon-pidfile writes.
//
// Push is awaited (the patch fires AFTER the session row exists, so
// the L1 gate sees it). End is fire-and-forget — body's success or
// throw is preserved; an end failure is logged and swallowed.
//
// Race window: between push success and end completion, if the player
// reloads the page the session row stays open until cascade-end via a
// parent or a future GC sweeper. Same trade-off as FTP/mysql/redis.

export type WithTransientSessionParams = {
  readonly machine_id: string;
  readonly credentials: Credentials;
  readonly kind: SessionKind;
  readonly parent_session_id?: string;
  readonly source_ip?: string;
};

export const withTransientSession = async <T>(
  identity: Identity,
  params: WithTransientSessionParams,
  body: (sessionId: string) => Promise<T> | T,
): Promise<T> => {
  const sessionId = await createServerSession(identity, {
    machine_id: params.machine_id,
    credentials: params.credentials,
    kind: params.kind,
    ...(params.parent_session_id !== undefined && {
      parent_session_id: params.parent_session_id,
    }),
    ...(params.source_ip !== undefined && { source_ip: params.source_ip }),
  });
  try {
    return await body(sessionId);
  } finally {
    void endServerSession(identity, {
      session_id: sessionId,
      reason: 'user_exit',
    }).catch((error) => {
      console.error('[withTransientSession] endServerSession failed:', error);
    });
  }
};
