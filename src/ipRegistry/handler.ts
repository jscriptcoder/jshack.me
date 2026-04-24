import { allocateIp, type AllocateIpDeps } from './allocate';
import { allocateIpRequestSchema } from './types';

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Pure request handler — takes untrusted JSON and typed dependencies, returns
// an HTTP-shaped response. Separated from the Vercel req/res glue so it can be
// unit-tested without HTTP plumbing.
//
// Validation policy: reject anything that doesn't match the strict schema
// BEFORE touching game state. See memory: project_multiplayer_security_model.md
// (layer 7, "Strict input hygiene at the function boundary").
export const handleAllocateRequest = async (
  body: unknown,
  deps: AllocateIpDeps,
): Promise<HandlerResponse> => {
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
