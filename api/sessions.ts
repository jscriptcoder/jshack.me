import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { handleSessionsRequest } from '../src/sessionRegistry/handler.js';
import { createSupabaseInsertSession } from '../src/sessionRegistry/supabaseInsert.js';
import { createSupabaseEndSession } from '../src/sessionRegistry/supabaseUpdate.js';
import { createSupabaseListSessions } from '../src/sessionRegistry/supabaseSelect.js';
import {
  createSupabaseFindEtcPasswdContent,
  type FindEtcPasswdContentParams,
} from '../src/sessionRegistry/supabaseFindEtcPasswdContent.js';
import {
  createSupabaseFindVirtualUsersConfContent,
  type FindVirtualUsersConfContentParams,
} from '../src/sessionRegistry/supabaseFindVirtualUsersConfContent.js';
import {
  createSupabaseFindFsContent,
  type FindFsContentParams,
} from '../src/sessionRegistry/supabaseFindFsContent.js';
import type {
  EndSessionParams,
  ListSessionsParams,
  SessionRow,
} from '../src/sessionRegistry/types.js';
import {
  createUpstashRateLimiter,
  noopRateLimiter,
  type RateLimiter,
} from '../src/ipRegistry/rateLimit.js';
import {
  createUpstashNonceStore,
  noopNonceStore,
  type NonceStore,
} from '../src/signedRequest/nonceStore.js';

// Vercel adapter for POST /api/sessions.
//
// Single endpoint, action-dispatched by the signed payload's `action`
// field — currently `createSession`; `endSession` and `listSessions`
// added in subsequent steps. Same Supabase + Upstash wiring pattern as
// /api/allocate-ip.

// Per-pubkey rate limit. Sessions are created on every SSH/su/exploit-
// shell, so the limit needs headroom — 60/min covers heavy nested
// pivoting while still stopping a script.
const RATE_LIMIT_PER_MINUTE = 60;

const buildUpstashAdapters = (): { rateLimiter: RateLimiter; nonceStore: NonceStore } => {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.warn('[sessions] Upstash not configured — rate limit + replay protection disabled');
    return { rateLimiter: noopRateLimiter, nonceStore: noopNonceStore };
  }

  const redis = new Redis({ url, token });
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_PER_MINUTE, '1 m'),
    analytics: false,
    prefix: 'sessions',
  });
  const rateLimiter = createUpstashRateLimiter((id) => ratelimit.limit(id));
  const nonceStore = createUpstashNonceStore((key, value, opts) =>
    redis.set(key, value, { ex: opts.ex, nx: opts.nx }),
  );
  return { rateLimiter, nonceStore };
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

  const insertSession = createSupabaseInsertSession(async (row: SessionRow) => {
    const { data, error } = await supabase
      .from('sessions')
      .insert(row)
      .select('session_id')
      .single();
    if (error) console.error('[sessions] supabase insert error:', error);
    return { data, error };
  });

  const endSession = createSupabaseEndSession(
    async (params: EndSessionParams) => {
      const { data, error } = await supabase
        .from('sessions')
        .update({ ended_at: new Date().toISOString(), end_reason: params.reason })
        .eq('session_id', params.session_id)
        .eq('player_key', params.player_key)
        .is('ended_at', null)
        .select('session_id');
      if (error) console.error('[sessions] supabase update error:', error);
      return { data, error };
    },
    async (parent_session_id: string) => {
      const { data, error } = await supabase
        .from('sessions')
        .select('session_id')
        .eq('parent_session_id', parent_session_id)
        .is('ended_at', null);
      if (error) console.error('[sessions] supabase find-children error:', error);
      return { data, error };
    },
  );

  const listSessions = createSupabaseListSessions(async (params: ListSessionsParams) => {
    const { data, error } = await supabase
      .from('sessions')
      .select('session_id, machine_id, credentials, parent_session_id, source_ip, created_at, kind')
      .eq('player_key', params.player_key)
      .is('ended_at', null)
      .order('created_at', { ascending: true });
    if (error) console.error('[sessions] supabase select error:', error);
    return { data, error };
  });

  // Server-side userType validation reads /etc/passwd from the
  // machine_filesystems projection. /etc/passwd content is dual-written
  // there for paths in FS_PROJECTED_CONTENT_PATHS (see
  // 20260507100000_machine_fs_selective_content.sql).
  const findEtcPasswdContent = createSupabaseFindEtcPasswdContent(
    async (params: FindEtcPasswdContentParams) => {
      const { data, error } = await supabase
        .from('machine_filesystems')
        .select('content')
        .eq('machine_id', params.machine_id)
        .eq('path', '/etc/passwd')
        .limit(1);
      if (error) console.error('[sessions] supabase find /etc/passwd error:', error);
      return { data, error };
    },
  );

  // FTP overlay (/etc/vsftpd/virtual_users.conf) used by
  // authCreateSession's kind='ftp' arm. Falls back to /etc/passwd when
  // the overlay row is absent or the username isn't listed.
  const findVirtualUsersConfContent = createSupabaseFindVirtualUsersConfContent(
    async (params: FindVirtualUsersConfContentParams) => {
      const { data, error } = await supabase
        .from('machine_filesystems')
        .select('content')
        .eq('machine_id', params.machine_id)
        .eq('path', '/etc/vsftpd/virtual_users.conf')
        .limit(1);
      if (error) console.error('[sessions] supabase find virtual_users.conf error:', error);
      return { data, error };
    },
  );

  // Generic (path-parameterized) FS content adapter used by the
  // mysql / redis / snmp arms of authCreateSession. Reads from
  // machine_filesystems where (machine_id, path) matches.
  const findFsContent = createSupabaseFindFsContent(async (params: FindFsContentParams) => {
    const { data, error } = await supabase
      .from('machine_filesystems')
      .select('content')
      .eq('machine_id', params.machine_id)
      .eq('path', params.path)
      .limit(1);
    if (error) console.error('[sessions] supabase findFsContent error:', error);
    return { data, error };
  });

  const { rateLimiter, nonceStore } = buildUpstashAdapters();

  const { status, body, headers } = await handleSessionsRequest(req.body, {
    insertSession,
    endSession,
    listSessions,
    findEtcPasswdContent,
    findVirtualUsersConfContent,
    findFsContent,
    rateLimiter,
    nonceStore,
  });

  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
  }
  res.status(status).json(body);
}
