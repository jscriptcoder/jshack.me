import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { HttpRequestHandler } from '../logging/handlers/httpRequest';
import {
  resolveHttpTarget,
  resolveHttpTargetAsync,
  dispatchHttpRequest,
  parseUrl,
  type ResolveHttpTargetContext,
  type DispatchHttpRequestContext,
  type HttpResponse,
  type ValidatedHttpTarget,
} from '../network/http';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type CurlContext = ResolveHttpTargetContext &
  DispatchHttpRequestContext & {
    readonly onHttpRequest?: HttpRequestHandler;
  };

// Re-exported so existing imports (e.g. curl.test.ts) keep working.
export { parseUrl };
export type { ParsedUrl } from '../network/http';

const formatResponse = (response: HttpResponse, includeHeaders: boolean): string => {
  if (!includeHeaders) return response.body;

  const headerLines = response.headers.map(([key, value]) => `${key}: ${value}`).join('\n');

  return `HTTP/1.1 ${response.statusCode} ${response.statusText}\n${headerLines}\n\n${response.body}`;
};

export const createCurlCommand = (context: CurlContext): Command => ({
  name: 'curl',
  category: 'network',
  description: 'Transfer data from or to a server',
  manual: {
    synopsis: 'curl [flags...] <url>',
    description:
      'Transfer data from or to a server using HTTP protocol. Supports GET and POST requests. Use -i flag to include HTTP response headers in output. Use -X POST to make POST requests to /api/* endpoints. Flags and URL can be in any order.',
    arguments: [
      {
        name: 'url',
        description: 'URL to fetch (e.g., "http://192.168.1.1/")',
        required: true,
      },
      {
        name: '-i',
        description: 'Include HTTP response headers in the output',
        required: false,
      },
      {
        name: '-X',
        description: 'HTTP method (e.g., `-X POST` for a POST request)',
        required: false,
      },
    ],
    examples: [
      { command: 'curl http://192.168.1.1/', description: 'Fetch a web page' },
      {
        command: 'curl 192.168.1.1/index.html',
        description: 'Fetch without protocol (defaults to http)',
      },
      {
        command: 'curl -i http://192.168.1.1/',
        description: 'Include HTTP response headers',
      },
      {
        command: 'curl http://192.168.1.1/ -i',
        description: 'Flags work in any position',
      },
      {
        command: 'curl -X POST http://192.168.1.1/api/users',
        description: 'POST request to API',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const stringArgs = args.filter((a): a is string => typeof a === 'string');

    // Separate flags (start with -) from the URL (positional arg)
    const flagArgs = stringArgs.filter((a) => a.startsWith('-'));
    const positionalArgs = stringArgs.filter((a) => !a.startsWith('-'));
    const urlStr = positionalArgs[0];
    const flags = flagArgs.join(' ');

    if (!urlStr) {
      throw new Error('curl: no URL specified');
    }

    const includeHeaders = flags.includes('-i');
    const isPost = flags.includes('-X POST');
    const method = isPost ? 'POST' : 'GET';

    const token = createCancellationToken();

    // Shared response renderer + access-log emission. Both the sync-hit
    // and async-resolved paths funnel through this once a target is
    // ready, so the formatResponse / onHttpRequest behavior stays
    // identical across the two paths.
    const dispatch = (
      onLine: (line: string) => void,
      onComplete: () => void,
      target: ValidatedHttpTarget,
    ) => {
      const result = dispatchHttpRequest(context, target, { method });

      context.onHttpRequest?.({
        targetIP: result.targetIP,
        port: result.port,
        method: result.method,
        path: result.path,
        status: result.response.statusCode,
        size: result.response.body.length,
      });

      const output = formatResponse(result.response, includeHeaders);
      output.split('\n').forEach((line) => onLine(line));

      onComplete();
    };

    // Try sync resolution first. If it succeeds, dispatch the synchronous
    // path. If it throws AND no async resolver is wired, propagate (legacy
    // contract). If it throws AND an async resolver IS wired, fall through
    // to the async path so cross-LAN public IPs (where sync getMachine
    // misses) materialize through findMachineByIpAsync.
    let syncTarget: ValidatedHttpTarget | undefined;
    let syncError: unknown;
    try {
      syncTarget = resolveHttpTarget(context, urlStr, 'curl');
    } catch (error) {
      syncError = error;
    }

    if (syncTarget) {
      const target = syncTarget;
      return {
        __type: 'async',
        start: (onLine, onComplete) => {
          const delay = jitter(500);
          token.schedule(() => {
            if (token.isCancelled()) return;
            dispatch(onLine, onComplete, target);
          }, delay);
        },
        cancel: token.cancel,
      };
    }

    if (!context.findMachineByIpAsync) {
      throw syncError;
    }

    // Cross-LAN fallback: sync miss + async resolver available. The
    // foreign network materializes via findMachineByIpAsync inside
    // resolveHttpTargetAsync; rejections surface via onLine. URL /
    // DNS errors raised before the machine lookup also land here
    // (resolveHttpTargetAsync runs URL + DNS validation itself).
    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        const delay = jitter(500);
        token.schedule(() => {
          if (token.isCancelled()) return;
          resolveHttpTargetAsync(context, urlStr, 'curl')
            .then((target) => {
              if (token.isCancelled()) return;
              dispatch(onLine, onComplete, target);
            })
            .catch((error: unknown) => {
              onLine(error instanceof Error ? error.message : String(error));
              onComplete();
            });
        }, delay);
      },
      cancel: token.cancel,
    };
  },
});
