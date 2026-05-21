import type { RemoteMachine, DnsRecord, Port } from './types';
import type { MachineId } from '../filesystem/machineFileSystems';
import type { MachineFileOp } from '../filesystem/types';
import type { RequestHandler, HandlerResponse } from '../themedNetworks/types';
import { isValidIP } from '../utils/network';

export type ParsedUrl = {
  readonly protocol: string;
  readonly host: string;
  readonly port: number;
  readonly path: string;
  // Raw query string (everything after `?`, no leading `?`). Empty
  // string when the URL has no query. Decoding/key-splitting is the
  // caller's job — parseUrl only splits.
  readonly query: string;
};

export type HttpResponse = {
  readonly statusCode: number;
  readonly statusText: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
};

export type ResolveHttpTargetContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
  // Async sibling of getMachine. Triggers the cross-LAN seed-regen
  // resolver when the target IP is a publicly-addressable IPv4 that
  // the sync view doesn't know yet. Optional — when omitted (single-
  // player tests / legacy callers), the resolver functions keep the
  // pre-extension sync-throw contract on a sync miss.
  readonly findMachineByIpAsync?: (ip: string) => Promise<RemoteMachine | undefined>;
};

export type DispatchHttpRequestContext = {
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
  readonly readFileFromMachine: (op: MachineFileOp) => string | null;
  readonly getHandler?: (machineIp: string) => RequestHandler | undefined;
};

export type ValidatedHttpTarget = {
  readonly parsed: ParsedUrl;
  readonly targetIP: string;
  readonly machine: RemoteMachine;
  readonly port: Port;
};

export type DispatchOptions = {
  readonly method: 'GET' | 'POST';
};

export type HttpRequestResult = {
  readonly response: HttpResponse;
  readonly targetIP: string;
  readonly port: number;
  readonly method: 'GET' | 'POST';
  readonly path: string;
};

type ServerConfig = {
  readonly serverName: string;
  readonly extraHeaders: Readonly<Record<string, string>>;
};

const HTTP_SERVICES = ['http', 'https', 'http-alt'] as const;

const SERVER_CONFIGS: Readonly<Record<string, ServerConfig>> = {
  '192.168.1.1': {
    serverName: 'nginx/1.18.0 (Ubuntu)',
    extraHeaders: { 'X-Powered-By': 'PHP/7.4.3' },
  },
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=UTF-8',
  '.php': 'text/html; charset=UTF-8',
  '.json': 'application/json',
};

export const parseUrl = (urlStr: string): ParsedUrl | null => {
  const fullMatch = urlStr.match(/^(https?):\/\/([^:/?]+)(?::(\d+))?(\/[^?]*)?(?:\?(.*))?$/);
  if (fullMatch) {
    const [, protocol, host, portStr, path, query] = fullMatch;
    return {
      protocol,
      host,
      port: portStr ? parseInt(portStr, 10) : protocol === 'https' ? 443 : 80,
      path: path || '/',
      query: query ?? '',
    };
  }

  // Shorthand: "hostname/path" without protocol — defaults to HTTP (like real curl)
  const shortMatch = urlStr.match(/^([^:/?]+)(\/[^?]*)?(?:\?(.*))?$/);
  if (shortMatch) {
    const [, host, path, query] = shortMatch;
    return { protocol: 'http', host, port: 80, path: path || '/', query: query ?? '' };
  }

  return null;
};

const isHttpService = (service: string): boolean => HTTP_SERVICES.some((s) => s === service);

const getContentType = (path: string): string => {
  const ext = path.match(/\.[^.]+$/)?.[0] ?? '';
  return CONTENT_TYPES[ext] ?? 'text/plain';
};

const buildHeaders = (
  ip: string,
  contentType: string,
  contentLength: number,
  customHeaders?: readonly (readonly [string, string])[],
): readonly (readonly [string, string])[] => {
  const config = SERVER_CONFIGS[ip];
  const base: readonly (readonly [string, string])[] = [
    ['Date', new Date().toUTCString()],
    ['Server', config?.serverName ?? 'nginx/1.18.0'],
    ['Content-Type', contentType],
    ['Content-Length', String(contentLength)],
    ['Connection', 'keep-alive'],
  ];
  const extra: readonly (readonly [string, string])[] = config
    ? Object.entries(config.extraHeaders)
    : [];
  return [...base, ...extra, ...(customHeaders ?? [])];
};

// Reads a .headers sidecar file and parses it as key:value lines.
// Sidecar files sit alongside web content (e.g. /var/www/html/page.html.headers)
// and inject custom HTTP response headers into curl responses.
const readSidecarHeaders = (
  context: DispatchHttpRequestContext,
  machineId: MachineId,
  webPath: string,
): readonly (readonly [string, string])[] => {
  const sidecarPath = `${webPath}.headers`;
  const sidecarContent = context.readFileFromMachine({
    machineId,
    path: sidecarPath,
    cwd: '/',
    userType: 'root',
  });
  if (!sidecarContent) return [];
  return sidecarContent
    .split('\n')
    .map((line) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx <= 0) return null;
      return [line.slice(0, colonIdx).trim(), line.slice(colonIdx + 1).trim()] as const;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null);
};

const handleGet = (
  context: DispatchHttpRequestContext,
  machineId: MachineId,
  path: string,
): HttpResponse => {
  const webPath = path === '/' ? '/var/www/html/index.html' : `/var/www/html${path}`;
  const content = context.readFileFromMachine({
    machineId,
    path: webPath,
    cwd: '/',
    userType: 'root',
  });

  if (content === null) {
    const body = '<html><body><h1>404 Not Found</h1></body></html>';
    return {
      statusCode: 404,
      statusText: 'Not Found',
      headers: buildHeaders(machineId, 'text/html; charset=UTF-8', body.length),
      body,
    };
  }

  const customHeaders = readSidecarHeaders(context, machineId, webPath);
  const contentType = getContentType(webPath);
  return {
    statusCode: 200,
    statusText: 'OK',
    headers: buildHeaders(machineId, contentType, content.length, customHeaders),
    body: content,
  };
};

const handlePost = (
  context: DispatchHttpRequestContext,
  machineId: MachineId,
  path: string,
): HttpResponse => {
  const endpointMatch = path.match(/^\/api\/(.+)$/);
  if (!endpointMatch) {
    const body = '{"error": "Invalid API endpoint"}';
    return {
      statusCode: 400,
      statusText: 'Bad Request',
      headers: buildHeaders(machineId, 'application/json', body.length),
      body,
    };
  }

  const endpoint = endpointMatch[1];
  const apiPath = `/var/www/api/${endpoint}.json`;
  const content = context.readFileFromMachine({
    machineId,
    path: apiPath,
    cwd: '/',
    userType: 'root',
  });

  if (content === null) {
    const body = '{"error": "Not Found"}';
    return {
      statusCode: 404,
      statusText: 'Not Found',
      headers: buildHeaders(machineId, 'application/json', body.length),
      body,
    };
  }

  return {
    statusCode: 200,
    statusText: 'OK',
    headers: buildHeaders(machineId, 'application/json', content.length),
    body: content,
  };
};

// Wraps a HandlerResponse in an HttpResponse with standard HTTP framing
// keyed off the target machine. Handler authors only deal with status /
// contentType / body — the Date / Server / Content-Length / Connection
// headers come from the same buildHeaders pipeline as static files,
// so per-machine SERVER_CONFIGS still apply.
const wrapHandlerResponse = (resp: HandlerResponse, machineId: string): HttpResponse => ({
  statusCode: resp.statusCode,
  statusText: resp.statusText,
  headers: buildHeaders(machineId, resp.contentType, resp.body.length),
  body: resp.body,
});

// Sync phase: parse, DNS-resolve, validate machine + port + service.
// Throws Linux-style error messages on failure, prefixed with commandName
// so curl and lynx can share this helper without leaking the wrong tool's
// name into the error stream.
export const resolveHttpTarget = (
  context: ResolveHttpTargetContext,
  urlStr: string,
  commandName: string,
): ValidatedHttpTarget => {
  const parsed = parseUrl(urlStr);
  if (!parsed) {
    throw new Error(`${commandName}: invalid URL: ${urlStr}`);
  }

  const dnsRecord = context.resolveDomain(parsed.host);
  const targetIP = dnsRecord?.ip ?? parsed.host;

  if (!isValidIP(targetIP)) {
    throw new Error(`${commandName}: Could not resolve host: ${parsed.host}`);
  }

  const machine = context.getMachine(targetIP);
  if (!machine) {
    throw new Error(
      `${commandName}: Failed to connect to ${parsed.host} port ${parsed.port}: Connection refused`,
    );
  }

  const port = machine.ports.find((p) => p.port === parsed.port);
  if (!port || !port.open || !isHttpService(port.service)) {
    throw new Error(
      `${commandName}: Failed to connect to ${parsed.host} port ${parsed.port}: Connection refused`,
    );
  }

  return { parsed, targetIP, machine, port };
};

// Async variant: same validation contract as resolveHttpTarget, with a
// fallback to findMachineByIpAsync when sync getMachine misses. Returns
// a Promise; rejects on any validation failure (invalid URL, DNS,
// missing machine after async, closed port, non-HTTP service). Used by
// curl/gobuster/lynx to surface cross-LAN forwarded URLs — the public
// IP isn't in A's local network view until findMachineByIpAsync
// materializes the foreign HomeNetwork via the cross-LAN seed-regen
// resolver. URL + DNS validation stays synchronous so commands can
// still throw early on malformed input before returning AsyncOutput.
export const resolveHttpTargetAsync = async (
  context: ResolveHttpTargetContext,
  urlStr: string,
  commandName: string,
): Promise<ValidatedHttpTarget> => {
  const parsed = parseUrl(urlStr);
  if (!parsed) {
    throw new Error(`${commandName}: invalid URL: ${urlStr}`);
  }

  const dnsRecord = context.resolveDomain(parsed.host);
  const targetIP = dnsRecord?.ip ?? parsed.host;

  if (!isValidIP(targetIP)) {
    throw new Error(`${commandName}: Could not resolve host: ${parsed.host}`);
  }

  const syncMachine = context.getMachine(targetIP);
  const machine =
    syncMachine ??
    (context.findMachineByIpAsync ? await context.findMachineByIpAsync(targetIP) : undefined);
  if (!machine) {
    throw new Error(
      `${commandName}: Failed to connect to ${parsed.host} port ${parsed.port}: Connection refused`,
    );
  }

  const port = machine.ports.find((p) => p.port === parsed.port);
  if (!port || !port.open || !isHttpService(port.service)) {
    throw new Error(
      `${commandName}: Failed to connect to ${parsed.host} port ${parsed.port}: Connection refused`,
    );
  }

  return { parsed, targetIP, machine, port };
};

// Sync phase: NAT-resolve, dispatch through handler or static-file
// pipeline, return the response plus the pre-NAT identifiers needed for
// access logging.
export const dispatchHttpRequest = (
  context: DispatchHttpRequestContext,
  target: ValidatedHttpTarget,
  options: DispatchOptions,
): HttpRequestResult => {
  const { parsed, targetIP } = target;
  const filesystemIP: MachineId = context.resolveNat(targetIP, parsed.port).ip;

  const handler = context.getHandler?.(filesystemIP);
  const handlerResp =
    handler?.(
      { method: options.method, path: parsed.path, query: parsed.query },
      {
        readFile: (p) =>
          context.readFileFromMachine({
            machineId: filesystemIP,
            path: p,
            cwd: '/',
            userType: 'root',
          }),
      },
    ) ?? null;

  const response = handlerResp
    ? wrapHandlerResponse(handlerResp, filesystemIP)
    : options.method === 'POST'
      ? handlePost(context, filesystemIP, parsed.path)
      : handleGet(context, filesystemIP, parsed.path);

  return {
    response,
    targetIP,
    port: parsed.port,
    method: options.method,
    path: parsed.path,
  };
};
