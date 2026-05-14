// Adapts the synchronous `resolveHttpTarget` + `dispatchHttpRequest`
// pair into a Promise-returning fetch with the same jitter cadence
// curl uses, so the LynxBrowser overlay sees real network-feel latency
// and the same access-log entries fire per request.

import type { HttpResponse } from '../../network/http';
import {
  resolveHttpTarget,
  dispatchHttpRequest,
  type ResolveHttpTargetContext,
  type DispatchHttpRequestContext,
} from '../../network/http';
import type { HttpRequestHandler } from '../../logging/handlers/httpRequest';
import { jitter } from '../../utils/asyncCommand';

export type LynxFetchContext = ResolveHttpTargetContext &
  DispatchHttpRequestContext & {
    readonly onHttpRequest?: HttpRequestHandler;
  };

export type LynxFetch = (url: string) => Promise<HttpResponse>;

export const buildLynxFetch = (context: LynxFetchContext): LynxFetch => {
  return (url) =>
    new Promise<HttpResponse>((resolve, reject) => {
      // Validation runs synchronously (so DNS / port / bad-URL errors
      // reject the promise immediately), then the actual dispatch is
      // delayed by the same jitter curl applies — keeps the network-feel
      // consistent across the two commands.
      let target;
      try {
        target = resolveHttpTarget(context, url, 'lynx');
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const delay = jitter(500);
      setTimeout(() => {
        const result = dispatchHttpRequest(context, target, { method: 'GET' });
        context.onHttpRequest?.({
          targetIP: result.targetIP,
          port: result.port,
          method: result.method,
          path: result.path,
          status: result.response.statusCode,
          size: result.response.body.length,
        });
        resolve(result.response);
      }, delay);
    });
};
