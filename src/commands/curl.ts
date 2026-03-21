import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { MachineId } from '../filesystem/machineFileSystems';
import type { UserType } from '../session/SessionContext';
import { isValidIP } from '../utils/network';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type CurlContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
  readonly readFileFromMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    userType: UserType,
  ) => string | null;
  readonly onHttpRequest?: (
    targetIP: string,
    method: string,
    path: string,
    status: number,
    size: number,
  ) => void;
};

type ParsedUrl = {
  readonly protocol: string;
  readonly host: string;
  readonly port: number;
  readonly path: string;
};

type ServerConfig = {
  readonly serverName: string;
  readonly extraHeaders: Readonly<Record<string, string>>;
};

type HttpResponse = {
  readonly statusCode: number;
  readonly statusText: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
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

const parseUrl = (urlStr: string): ParsedUrl | null => {
  const fullMatch = urlStr.match(/^(https?):\/\/([^:/]+)(?::(\d+))?(\/.*)?$/);
  if (fullMatch) {
    const [, protocol, host, portStr, path] = fullMatch;
    return {
      protocol,
      host,
      port: portStr ? parseInt(portStr, 10) : protocol === 'https' ? 443 : 80,
      path: path || '/',
    };
  }

  // Shorthand: "hostname/path" without protocol — defaults to HTTP (like real curl)
  const shortMatch = urlStr.match(/^([^:/]+)(\/.*)?$/);
  if (shortMatch) {
    const [, host, path] = shortMatch;
    return { protocol: 'http', host, port: 80, path: path || '/' };
  }

  return null;
};

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
  context: CurlContext,
  machineId: MachineId,
  webPath: string,
): readonly (readonly [string, string])[] => {
  const sidecarPath = `${webPath}.headers`;
  const sidecarContent = context.readFileFromMachine(machineId, sidecarPath, '/', 'root');
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

const handleGet = (context: CurlContext, machineId: MachineId, path: string): HttpResponse => {
  const webPath = path === '/' ? '/var/www/html/index.html' : `/var/www/html${path}`;
  const content = context.readFileFromMachine(machineId, webPath, '/', 'root');

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

const handlePost = (context: CurlContext, machineId: MachineId, path: string): HttpResponse => {
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
  const content = context.readFileFromMachine(machineId, apiPath, '/', 'root');

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

const formatResponse = (response: HttpResponse, includeHeaders: boolean): string => {
  if (!includeHeaders) return response.body;

  const headerLines = response.headers.map(([key, value]) => `${key}: ${value}`).join('\n');

  return `HTTP/1.1 ${response.statusCode} ${response.statusText}\n${headerLines}\n\n${response.body}`;
};

const isHttpService = (service: string): boolean => HTTP_SERVICES.some((s) => s === service);

export const createCurlCommand = (context: CurlContext): Command => ({
  name: 'curl',
  category: 'network',
  description: 'Transfer data from or to a server',
  manual: {
    synopsis: 'curl([flags], url)',
    description:
      'Transfer data from or to a server using HTTP protocol. Supports GET and POST requests. Use -i flag to include HTTP response headers in output. Use -X POST to make POST requests to /api/* endpoints. Flags and URL can be in any order.',
    arguments: [
      {
        name: 'url',
        description: 'URL to fetch (e.g., "http://192.168.1.1/")',
        required: true,
      },
      {
        name: 'flags',
        description: 'Optional flags: -i (include headers), -X POST (POST request)',
        required: false,
      },
    ],
    examples: [
      { command: 'curl("http://192.168.1.1/")', description: 'Fetch a web page' },
      {
        command: 'curl("192.168.1.1/index.html")',
        description: 'Fetch without protocol (defaults to http)',
      },
      {
        command: 'curl("-i", "http://192.168.1.1/")',
        description: 'Include HTTP response headers',
      },
      {
        command: 'curl("http://192.168.1.1/", "-i")',
        description: 'Flags work in any position',
      },
      {
        command: 'curl("-X POST", "http://192.168.1.1/api/users")',
        description: 'POST request to API',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, resolveDomain } = context;

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

    const parsed = parseUrl(urlStr);
    if (!parsed) {
      throw new Error(`curl: invalid URL: ${urlStr}`);
    }

    const dnsRecord = resolveDomain(parsed.host);
    const targetIP = dnsRecord?.ip ?? parsed.host;

    if (!isValidIP(targetIP)) {
      throw new Error(`curl: Could not resolve host: ${parsed.host}`);
    }

    const machine = getMachine(targetIP);
    if (!machine) {
      throw new Error(
        `curl: Failed to connect to ${parsed.host} port ${parsed.port}: Connection refused`,
      );
    }

    const port = machine.ports.find((p) => p.port === parsed.port);
    if (!port || !port.open || !isHttpService(port.service)) {
      throw new Error(
        `curl: Failed to connect to ${parsed.host} port ${parsed.port}: Connection refused`,
      );
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        const delay = jitter(500);

        token.schedule(() => {
          if (token.isCancelled()) return;

          // NAT resolution: in forwarded mode, the router's public IP maps to the
          // internal entry machine. Filesystem reads must target the actual machine.
          const filesystemIP = context.resolveNat(targetIP, parsed.port ?? 80).ip as MachineId;

          const response = isPost
            ? handlePost(context, filesystemIP, parsed.path)
            : handleGet(context, filesystemIP, parsed.path);

          context.onHttpRequest?.(
            targetIP,
            isPost ? 'POST' : 'GET',
            parsed.path,
            response.statusCode,
            response.body.length,
          );

          const output = formatResponse(response, includeHeaders);
          output.split('\n').forEach((line) => onLine(line));

          onComplete();
        }, delay);
      },
      cancel: token.cancel,
    };
  },
});
