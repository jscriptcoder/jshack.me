import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, hostServices } from './remoteHostFs';
import { buildDeepHostFs } from './deepHostFs';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { roleOfHostname } from './pools/hostnames';
import { createFsView } from '../filesystem/fsView';
import { parseHttpUrl, resolveHref, resolveWebPath } from '../network/http';
import { resolveLanName } from '../network/resolveName';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import { ALL_ESSIDS, deepBoxes, filesUnder, lanBoxes, type Box } from '../../test/worldContent';

/**
 * A web server that serves a site: pages that link each other, read the way a player
 * reads them — `lynx` on `/`, then following the numbered links — and every link held
 * to the rule that it goes somewhere real.
 */

type Built = { readonly box: Box; readonly tree: Directory; readonly port: number };

const httpPort = (box: Box): number | null =>
  hostServices(box.essid, box.host).find(({ spec }) => spec.service === 'http')?.port ?? null;

/** Every NPC box on every network, LAN and deep, that serves the web — built inside
 *  each test that asks, never once for the file, so every test that reads a site also
 *  exercises the builder that made it. `isWanted` narrows to one kind of box. */
const servingBoxes = (isWanted: (host: LanHost) => boolean): readonly Built[] =>
  [
    ...lanBoxes(ALL_ESSIDS).map((box) => ({ box, build: () => buildRemoteHostFs(box.essid, box.host) })),
    ...deepBoxes(ALL_ESSIDS).map(({ essid, host }) => ({
      box: { essid, host },
      build: () => buildDeepHostFs(essid, host),
    })),
  ]
    .filter(({ box }) => isWanted(box.host))
    .flatMap(({ box, build }) => {
      const port = httpPort(box);
      return port === null ? [] : [{ box, tree: build(), port }];
    });

const isWebserver = (host: LanHost): boolean => roleOfHostname(host.hostname) === 'webserver';

const webRootOf = (tree: Directory): ReadonlyMap<string, string> => {
  const html = ['var', 'www', 'html'].reduce<Directory | null>((current, name) => {
    const next = current?.entries.get(name);
    return next?.kind === 'directory' ? next : null;
  }, tree);
  return html === null ? new Map() : filesUnder(html);
};

/** What a request for `path` returns, read the way a fetch reads it. */
const served = (tree: Directory, path: string): string | null => {
  const file = resolveWebPath(path);
  if (file === null) return null;
  const read = createFsView(tree, { userType: 'root' }).read(file);
  return read.ok ? read.content : null;
};

const hrefsIn = (page: string): readonly string[] =>
  Array.from(page.matchAll(/<a\s[^>]*href="([^"]*)"/g)).map((match) => match[1]!);

const originOf = ({ box, port }: Built): string =>
  `http://${box.host.ip}${port === 80 ? '' : `:${port}`}`;

/** The pages a reader reaches from `/` by following links that stay on this host. */
const crawl = (built: Built): ReadonlyMap<string, string> => {
  const origin = originOf(built);
  const visit = (
    queue: readonly string[],
    seen: ReadonlyMap<string, string>,
  ): ReadonlyMap<string, string> => {
    const [path, ...rest] = queue;
    if (path === undefined) return seen;
    if (seen.has(path)) return visit(rest, seen);
    const page = served(built.tree, path);
    if (page === null) return visit(rest, seen);
    const onward = hrefsIn(page).flatMap((href) => {
      const target = resolveHref({ base: `${origin}${path}`, href });
      const url = target === null ? null : parseHttpUrl(target);
      return url !== null && `http://${url.host}${url.port === 80 ? '' : `:${url.port}`}` === origin
        ? [url.path]
        : [];
    });
    return visit([...rest, ...onward], new Map(seen).set(path, page));
  };
  return visit(['/'], new Map());
};

/** Why `href` on the page at `path` goes nowhere, or null when it goes somewhere real:
 *  a page this host serves, or a page a generated web host on the same LAN serves on
 *  the port it really listens on. A href a browser does not number (`mailto:`, `#`) is
 *  text, and goes nowhere by design. */
const deadLink = (built: Built, path: string, href: string): string | null => {
  const target = resolveHref({ base: `${originOf(built)}${path}`, href });
  if (target === null) return null;
  const url = parseHttpUrl(target);
  if (url === null) return `${href} is not a url`;
  const { essid, host } = built.box;
  if (url.host === host.ip && url.port === built.port) {
    return served(built.tree, url.path) === null ? `${url.path} is not served here` : null;
  }
  const lan = generateHomeLan(essid).hosts;
  const onLan = lan.some((candidate) => candidate.ip === host.ip && candidate.hostname === host.hostname);
  if (!onLan) return `${target} leaves a deep box, which names no neighbour`;
  const address = resolveLanName(essid, url.host)?.ip ?? url.host;
  const neighbour = lan.find((candidate) => candidate.ip === address && candidate.kind === 'machine');
  if (neighbour === undefined || neighbour.ip === host.ip) return `${url.host} is not a neighbour`;
  if (httpPort({ essid, host: neighbour }) !== url.port) return `${url.host} serves no web on ${url.port}`;
  return served(buildRemoteHostFs(essid, neighbour), url.path) === null
    ? `${url.path} is not served on ${url.host}`
    : null;
};

const deadLinksOn = (built: Built): readonly string[] =>
  [...webRootOf(built.tree)]
    .filter(([file]) => file.endsWith('.html'))
    .flatMap(([file, page]) =>
      hrefsIn(page).flatMap((href) => {
        const reason = deadLink(built, `/${file}`, href);
        return reason === null ? [] : [`${built.box.host.hostname} /${file}: ${reason}`];
      }),
    );

describe('a web server serves a site', () => {
  it('serves every webserver, LAN and deep, a site of 4 to 12 pages a reader walks from /', () => {
    const sites = servingBoxes(isWebserver);
    expect(sites.length).toBeGreaterThan(50);

    const sizes = sites.map((built) => crawl(built).size);
    expect(sizes.filter((size) => size < 4 || size > 12)).toEqual([]);
    // Both ends of the range are met somewhere, so neither bound is decorative.
    expect(Math.min(...sizes)).toBe(4);
    expect(Math.max(...sizes)).toBe(12);
  });

  it('links every page it reaches back to the front page', () => {
    const strays = servingBoxes(isWebserver).flatMap((built) =>
      [...crawl(built)]
        .filter(([, page]) => !hrefsIn(page).includes('/'))
        .map(([path]) => `${built.box.host.hostname} ${path}`),
    );
    expect(strays).toEqual([]);
  });

  it('never links a page nothing serves, on any network', () => {
    const offenders = servingBoxes(isWebserver).flatMap(deadLinksOn);
    expect(offenders).toEqual([]);
  });

  it('recognises a dead link when there is one', () => {
    // The property above passes vacuously once nothing links anywhere, so this pins
    // that the check reads a link it could fail.
    const [built] = servingBoxes(isWebserver);
    if (built === undefined) throw new Error('expected a web server');
    expect(deadLink(built, '/', '/nothing-here.html')).toBe('/nothing-here.html is not served here');
    expect(deadLink(built, '/', '/')).toBeNull();
    expect(deadLink(built, '/', 'mailto:info@example.lan')).toBeNull();
  });

  it('publishes every file world-readable and root-write-only, never executable', () => {
    const files = servingBoxes(isWebserver).flatMap(({ tree }) => {
      const view = createFsView(tree, { userType: 'root' });
      return [...webRootOf(tree).keys()].map((file) => view.stat(asAbsPath(`/var/www/html/${file}`)));
    });
    expect(files.length).toBeGreaterThan(200);
    files.forEach((node) => {
      expect(node).toMatchObject({
        owner: 'root',
        perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
      });
    });
  });

  it('leaves every other box that serves the web exactly one page', () => {
    const roots = servingBoxes((host) => !isWebserver(host)).map(({ tree }) => [...webRootOf(tree).keys()]);
    expect(roots.length).toBeGreaterThan(50);
    expect(roots.filter((files) => files.join() !== 'index.html')).toEqual([]);
  });
});
