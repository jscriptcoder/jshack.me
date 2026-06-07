import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { handleCreateSession, type SessionRow } from '../src/core/sessions/createSession';
import {
  handleListSessions,
  type ListSessionsQuery,
  type SessionSummary,
} from '../src/core/sessions/listSessions';
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
    const listSessions = async ({ player_key, machine_id }: ListSessionsQuery) => {
      const { data, error } = await supabase
        .from('sessions')
        .select('session_id, machine_id, credentials, parent_session_id, source_ip, kind, created_at')
        .eq('player_key', player_key)
        .eq('machine_id', machine_id)
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
