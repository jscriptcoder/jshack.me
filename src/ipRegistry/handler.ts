import { allocateIp, type AllocateIpDeps } from './allocate';
import type { RateLimiter } from './rateLimit';
import { allocateIpRequestSchema } from './types';

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers?: Record<string, string>;
};

export type HandlerDeps = AllocateIpDeps & {
  readonly rateLimiter: RateLimiter;
};

// Pure request handler — takes untrusted JSON, the caller's identity, and
// typed dependencies; returns an HTTP-shaped response. Separated from the
// Vercel req/res glue so it can be unit-tested without HTTP plumbing.
//
// Order of checks matters:
//   1. Rate-limit first — protects CPU/DB from a flood of garbage requests.
//      A malicious actor sending malformed payloads still hits the limiter.
//   2. Schema validation — reject anything that doesn't match before
//      touching game state. See memory: project_multiplayer_security_model.md
//      (layer 7, "Strict input hygiene at the function boundary").
//   3. Allocation — server-side roll + INSERT-with-retry on PK conflict.
export const handleAllocateRequest = async (
  body: unknown,
  callerKey: string,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const limit = await deps.rateLimiter(callerKey);
  if (!limit.allowed) {
    return {
      status: 429,
      body: { error: 'rate_limited' },
      headers: { 'Retry-After': String(limit.retryAfterSeconds) },
    };
  }

  const parsed = allocateIpRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: 'invalid_request', issues: parsed.error.issues },
    };
  }

  const result = await allocateIp(parsed.data, deps);
  if (!result.ok) {
    return { status: 500, body: { error: result.error } };
  }

  return { status: 200, body: { ip: result.ip } };
};
