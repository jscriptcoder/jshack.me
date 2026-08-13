/**
 * The HTTP request shape — URL parsing and document-root resolution.
 *
 * Pure and framework-free so every reader of the web surface shares one
 * interpretation of a URL: the `curl` client resolving a host on the player's own
 * LAN, and (once it lands) the server handler resolving a cross-player fetch behind
 * a NAT forward. A URL that means one thing locally and another remotely would let a
 * request reach a file through one path that the other refuses.
 *
 * Only `http://` parses. HTTPS is a separate scheme with its own port and a
 * certificate story, and nothing serves it yet.
 */

import { asAbsPath, type AbsPath } from '../types';
import { normalize } from '../filesystem/path';

/** The port a web server listens on absent an explicit `:port` in the URL. */
export const HTTP_DEFAULT_PORT = 80;

/** The document root every web server serves from. A request can name a file
 *  BENEATH this and nothing else — the whole rest of the box is unreachable over
 *  HTTP however the request path is written. */
export const WEB_ROOT = '/var/www/html';

/** The file served when a request names a directory rather than a file. */
const DIRECTORY_INDEX = 'index.html';

export type ParsedUrl = {
  /** The host as written — an IP address today; a name once DNS lands. */
  readonly host: string;
  readonly port: number;
  /** The request path, always leading-slashed (`/` when the URL omitted one). */
  readonly path: string;
};

// host, optional :port, optional /path. The host rejects whitespace, `/` and `:`
// so a malformed URL fails to parse rather than resolving to a surprising target.
const URL_PATTERN = /^http:\/\/([^\s/:]+)(?::(\d+))?(\/\S*)?$/;

const PORT_MIN = 1;
const PORT_MAX = 65535;

/** `raw` as a target, or null when it is not a well-formed `http://` URL. */
export const parseHttpUrl = (raw: string): ParsedUrl | null => {
  const match = URL_PATTERN.exec(raw);
  if (match === null) return null;
  const host = match[1];
  if (host === undefined) return null;
  const rawPort = match[2];
  const port = rawPort === undefined ? HTTP_DEFAULT_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) return null;
  return { host, port, path: match[3] ?? '/' };
};

/** A URL as written, with the default port left unwritten — so an address a reader
 *  sees, or one compared against another, has exactly one spelling. */
const formatUrl = ({ host, port, path }: ParsedUrl): string =>
  `http://${host}${port === HTTP_DEFAULT_PORT ? '' : `:${port}`}${path}`;

/** Anything of the form `scheme:` — the shape that makes a href absolute rather
 *  than relative to the page it sits on. */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/** The directory a request path sits in: up to and including its last slash, which
 *  is what a href with no leading slash is relative to. */
const directoryOf = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1);

/**
 * The absolute URL a link on `base` points at, or null when it points at nothing
 * this browser can fetch.
 *
 * Refusing is as much of the job as resolving. A browser numbers its links, and a
 * number is a promise that pressing Enter goes somewhere — so `mailto:`, `https:`,
 * an in-page `#anchor` and an empty href are not links at all here, they are text.
 * That is the same rule that took the dead paths out of the generated pages: a page
 * must not advertise what nothing can answer.
 *
 * A trailing slash survives resolution untouched, because it is what tells the fetch
 * to serve a directory's index rather than to look for a file with that name.
 */
export const resolveHref = ({
  base,
  href,
}: {
  readonly base: string;
  readonly href: string;
}): string | null => {
  const from = parseHttpUrl(base);
  if (from === null) return null;
  const target = href.trim();
  if (target === '' || target.startsWith('#')) return null;
  if (SCHEME_PATTERN.test(target)) {
    const absolute = parseHttpUrl(target);
    return absolute === null ? null : formatUrl(absolute);
  }
  const requested = target.startsWith('/') ? target : `${directoryOf(from.path)}${target}`;
  const resolved = normalize(requested);
  const path = requested.endsWith('/') && !resolved.endsWith('/') ? `${resolved}/` : resolved;
  return formatUrl({ host: from.host, port: from.port, path });
};

/**
 * The file on the target box that `requestPath` names, or null when the path does
 * not name one at all — because it climbs out of the document root.
 *
 * The confinement is NORMALIZED here rather than left to whoever reads the file.
 * Three `..` above the document root is `/`, which puts `/etc/passwd` one hop away
 * — a real, readable file on every generated box, fetched by a caller with no
 * session on it. It happens that the filesystem walker treats `..` as a literal
 * directory name and so fails to find it, but that is an accident of the walker, not
 * a guarantee of the protocol: the moment a walker normalizes (as path resolution
 * does everywhere else, which is how `cd ..` works) the accident stops protecting
 * anything. A published directory is an HTTP concept, so HTTP enforces it.
 *
 * A path ending in `/` (the bare `/` included) serves the directory index, mirroring
 * a real server.
 */
export const resolveWebPath = (requestPath: string): AbsPath | null => {
  const resolved = normalize(`${WEB_ROOT}${requestPath}`);
  // The trailing slash in the prefix check is load-bearing: a sibling directory whose
  // name merely BEGINS with the root's (`/var/www/htmlx`) is outside the root.
  const inside = resolved === WEB_ROOT || resolved.startsWith(`${WEB_ROOT}/`);
  if (!inside) return null;
  // Normalizing BEFORE choosing the index matters: a path that climbs back down to
  // the root (`/assets/..`) names the root, and a request for a directory serves that
  // directory's index — same as the bare `/`.
  const namesDirectory = resolved === WEB_ROOT || requestPath.endsWith('/');
  return asAbsPath(namesDirectory ? `${resolved}/${DIRECTORY_INDEX}` : resolved);
};
