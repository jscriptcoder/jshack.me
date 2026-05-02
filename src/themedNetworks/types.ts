// Request-handler abstraction for themed world networks. A handler
// observes incoming HTTP requests to a specific machine and either
// produces a response (handled) or returns null to fall through to the
// static-file pipeline. Wired into curl via CurlContext.getHandler.
//
// Theme-keyed registry (handlerRegistry.ts) attaches handlers to world
// networks at hydration time based on the theme column of
// world_networks. Handlers are pure functions — no closures over DB or
// network state; everything they need comes from the request args + the
// target machine's filesystem.

export type RequestMethod = 'GET' | 'POST';

export type RequestArgs = {
  readonly method: RequestMethod;
  readonly path: string;
  // Raw query string (no leading `?`, empty when absent). Decoding /
  // key splitting is the handler's job.
  readonly query: string;
};

// Capability surface a handler has on the target machine's filesystem.
// Read-only by design — handlers don't mutate state. Always run as root
// (matches the static-file pipeline's view); per-user handler dispatch
// is out of scope until a real use case demands it.
export type MachineFsAccess = {
  readonly readFile: (path: string) => string | null;
};

// What a handler emits. Curl wraps this in standard HTTP framing
// (Date / Server / Content-Length / Connection headers) keyed off the
// target machine — handlers don't compose headers themselves.
export type HandlerResponse = {
  readonly statusCode: number;
  readonly statusText: string;
  readonly contentType: string;
  readonly body: string;
};

// Handler signature: returns null to indicate "I'm not handling this
// request — fall back to the static-file pipeline". Returning a
// response (any status code) means the handler took ownership.
export type RequestHandler = (args: RequestArgs, fs: MachineFsAccess) => HandlerResponse | null;
