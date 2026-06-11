import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { handleCreateSession, type SessionRow } from '../src/core/sessions/createSession';
import {
  handleAuthCreateSession,
  type AuthSessionRow,
} from '../src/core/sessions/authCreateSession';
import {
  handleListSessions,
  type ListSessionsQuery,
  type SessionSummary,
} from '../src/core/sessions/listSessions';
import { handleEndSession, type EndSessionParams } from '../src/core/sessions/endSession';
import type { NonceStore } from '../src/core/signedRequest/nonceStore';

// Vercel adapter for POST /api/sessions.
//
// Two signed actions share this endpoint, routed on the (unverified) payload
// `action` — each handler re-verifies the envelope itself, so routing on the
// raw action is safe:
//   - createSession: persist a pushed shell session (own-workstation gated)
//   - listSessions:  read the caller's OWN active sessions to rebuild the hop
//     chain on boot
//
// Replay protection uses a noop nonce store locally (Upstash wiring lands when
// cross-player flows need it). Same posture as /api/patches.
const noopNonceStore: NonceStore = async () => ({ fresh: true });

const actionOf = (body: unknown): string | undefined => {
  const payload = (body as { payload?: unknown } | null)?.payload;
  if (typeof payload !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(payload);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as { action?: string }).action
      : undefined;
  } catch {
    return undefined;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'not_configured' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (actionOf(req.body) === 'listSessions') {
    // No machine filter: the hop chain spans machines (su rows carry the own
    // workstation id, ssh rows the remote host's), and player_key scoping is
    // the boundary — handleListSessions stamps it from the verified pubkey.
    const listSessions = async ({ player_key }: ListSessionsQuery) => {
      const { data, error } = await supabase
        .from('sessions')
        .select('session_id, machine_id, credentials, parent_session_id, source_ip, kind, created_at')
        .eq('player_key', player_key)
        .is('ended_at', null)
        .order('created_at', { ascending: true });
      if (error) console.error('[sessions] list error:', error);
      return { data: data as readonly SessionSummary[] | null, error };
    };
    const { status, body } = await handleListSessions(req.body, {
      nonceStore: noopNonceStore,
      listSessions,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'endSession') {
    // Scope the update to the verified player_key so a caller can only end
    // their OWN sessions; a non-owned session_id matches zero rows (no-op).
    const endSession = async ({ session_id, player_key }: EndSessionParams) => {
      const { error } = await supabase
        .from('sessions')
        .update({ ended_at: new Date().toISOString(), end_reason: 'user_exit' })
        .eq('session_id', session_id)
        .eq('player_key', player_key);
      if (error) console.error('[sessions] end error:', error);
      return { error };
    };
    const { status, body } = await handleEndSession(req.body, {
      nonceStore: noopNonceStore,
      endSession,
    });
    res.status(status).json(body);
    return;
  }

  if (actionOf(req.body) === 'authCreateSession') {
    // Cross-machine ssh session: the handler regenerates the remote FS and
    // validates the password server-side before this insert ever runs.
    const insertSession = async (row: AuthSessionRow) => {
      const { error } = await supabase.from('sessions').insert(row);
      if (error) console.error('[sessions] auth insert error:', error);
      return { error };
    };
    const { status, body } = await handleAuthCreateSession(req.body, {
      nonceStore: noopNonceStore,
      insertSession,
    });
    res.status(status).json(body);
    return;
  }

  const insertSession = async (row: SessionRow) => {
    const { error } = await supabase.from('sessions').insert(row);
    if (error) console.error('[sessions] insert error:', error);
    return { error };
  };
  const { status, body } = await handleCreateSession(req.body, {
    nonceStore: noopNonceStore,
    insertSession,
  });
  res.status(status).json(body);
}
