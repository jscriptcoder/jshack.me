// Adapts the synchronous `resolveHttpTarget` + `dispatchHttpRequest`
// pair into a Promise-returning fetch with the same jitter cadence
// curl uses, so the LynxBrowser overlay sees real network-feel latency
// and the same access-log entries fire per request.

import type { HttpResponse } from '../../network/http';
import {
  resolveHttpTargetAsync,
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
  return async (url) => {
    // Resolution runs through resolveHttpTargetAsync so cross-LAN
    // forwarded URLs (where sync getMachine misses) materialize the
    // foreign network via findMachineByIpAsync. The legacy sync-throw
    // contract is preserved when findMachineByIpAsync isn't wired —
    // resolveHttpTargetAsync still throws synchronously-equivalent
    // (rejects) on invalid URL / DNS / closed-port failures.
    const target = await resolveHttpTargetAsync(context, url, 'lynx');

    // Dispatch is still delayed by jitter so the network-feel matches
    // curl. Wrapping in a Promise here mirrors the pre-async cadence.
    return new Promise<HttpResponse>((resolve) => {
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
};
