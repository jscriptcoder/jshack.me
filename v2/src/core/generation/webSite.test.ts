import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, hostServices, npcUsername } from './remoteHostFs';
import { buildDeepHostFs } from './deepHostFs';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { roleOfHostname } from './pools/hostnames';
import { createFsView } from '../filesystem/fsView';
import { parseHttpUrl, resolveHref, resolveWebPath } from '../network/http';
import { lanZoneName, resolveLanName } from '../network/resolveName';
import { inhabitant, networkPersona } from './persona';
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

const hasPrefix =
  (prefix: string) =>
  (host: LanHost): boolean =>
    host.hostname.startsWith(`${prefix}-`);

const isOnLan = ({ essid, host }: Box): boolean =>
  generateHomeLan(essid).hosts.some(
    (candidate) => candidate.ip === host.ip && candidate.hostname === host.hostname,
  );

/** The other generated machines on a box's LAN; none for a deep box, which names no
 *  neighbour. */
const neighboursOf = (box: Box): readonly LanHost[] =>
  isOnLan(box)
    ? generateHomeLan(box.essid).hosts.filter(
        (candidate) => candidate.kind === 'machine' && candidate.ip !== box.host.ip,
      )
    : [];

const portOf = (box: Box, service: string): number | null =>
  hostServices(box.essid, box.host).find((entry) => entry.spec.service === service)?.port ?? null;

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

const htmlPagesOf = (tree: Directory): readonly (readonly [string, string])[] =>
  [...webRootOf(tree)].filter(([file]) => file.endsWith('.html'));

const siteText = (tree: Directory): string => [...webRootOf(tree).values()].join('\n');

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

  it('links every page it reaches back to the front page, an API document being data', () => {
    const strays = servingBoxes(isWebserver).flatMap((built) =>
      [...crawl(built)]
        .filter(([path]) => path === '/' || path.endsWith('.html'))
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

describe('a site belongs to its kind of server', () => {
  it('links the other web hosts on its LAN from an intranet portal, by the name the LAN gives them', () => {
    const portals = servingBoxes(hasPrefix('portal')).filter(({ box }) => isOnLan(box));
    const withNeighbours = portals.filter(({ box }) =>
      neighboursOf(box).some((neighbour) => portOf({ essid: box.essid, host: neighbour }, 'http') !== null),
    );
    expect(withNeighbours.length).toBeGreaterThan(3);

    const unlinked = withNeighbours.filter(({ box, tree }) => {
      const zone = lanZoneName(box.essid);
      return !htmlPagesOf(tree).some(([, page]) =>
        hrefsIn(page).some((href) => href.startsWith('http://') && href.includes(`.${zone}`)),
      );
    });
    expect(unlinked.map(({ box }) => box.host.hostname)).toEqual([]);
  });

  it('says what each host on its services page is, truly', () => {
    // A portal's services table names the LAN's machines by what they do: a file
    // server a player can open with ftp, a mail host that really is one, a web site
    // that really answers.
    const portals = servingBoxes(hasPrefix('portal')).filter(({ box }) => isOnLan(box));
    const rows = portals.flatMap(({ box, tree }) => {
      const page = webRootOf(tree).get('services.html') ?? '';
      return [...page.matchAll(/<tr><td>([^<]+)<\/td><td>(.*?)<\/td><\/tr>/g)].map(
        ([, label, cell]) => ({ box, label: label ?? '', cell: cell ?? '' }),
      );
    });
    expect([...new Set(rows.map(({ label }) => label))].sort()).toEqual(['File server', 'Mail', 'Web']);

    const lies = rows.flatMap(({ box, label, cell }) => {
      const named = /(?:(?:ftp|http):\/\/)?([a-z0-9-]+)\.[a-z0-9-]+\.lan(?::(\d+))?/.exec(cell);
      const neighbour = neighboursOf(box).find((candidate) => candidate.hostname === named?.[1]);
      if (neighbour === undefined) return [`${label}: ${cell} is not a neighbour`];
      const at = { essid: box.essid, host: neighbour };
      const port = named?.[2] === undefined ? null : Number(named[2]);
      if (label === 'File server') {
        return portOf(at, 'ftp') === (port ?? 21) ? [] : [`${cell} runs no ftp there`];
      }
      if (label === 'Mail') {
        return roleOfHostname(neighbour.hostname) === 'mailserver' ? [] : [`${cell} is no mail host`];
      }
      return portOf(at, 'http') === (port ?? 80) ? [] : [`${cell} serves no web there`];
    });
    expect(lies).toEqual([]);
  });

  it('names no host in its text but a neighbour, and a deep box names none', () => {
    const strangers = servingBoxes(isWebserver).flatMap(({ box, tree }) => {
      const text = siteText(tree);
      const zone = lanZoneName(box.essid).replace('.', '\\.');
      const names = [...text.matchAll(new RegExp(`\\b([a-z0-9-]+)\\.${zone}\\b`, 'g'))].map(
        ([, name]) => name ?? '',
      );
      const addresses = text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
      const known = new Set(neighboursOf(box).flatMap((host) => [host.hostname, host.ip]));
      return [...names, ...addresses]
        .filter((named) => !known.has(named) && named !== box.host.ip)
        .map((named) => `${box.host.hostname}: ${named}`);
    });
    expect(strangers).toEqual([]);
  });

  it('documents an API whose documents a client can parse', () => {
    const apis = servingBoxes(hasPrefix('api'));
    expect(apis.length).toBeGreaterThan(5);

    const unparsed = apis.flatMap((built) => {
      const documents = [...crawl(built).entries()].filter(
        ([path]) => path !== '/' && !path.endsWith('.html'),
      );
      if (documents.length < 2) return [`${built.box.host.hostname} documents ${documents.length}`];
      return documents.flatMap(([path, body]) => {
        try {
          JSON.parse(body);
          return [];
        } catch {
          return [`${built.box.host.hostname} ${path} is not JSON`];
        }
      });
    });
    expect(unparsed).toEqual([]);
  });
});

describe('a site is written by the people who live on its network', () => {
  it('names the person the box belongs to, by their full name', () => {
    const unsigned = servingBoxes(isWebserver).filter(({ box, tree }) => {
      const { fullName } = inhabitant({ ...box, username: npcUsername(box.essid, box.host) });
      return !siteText(tree).includes(fullName);
    });
    expect(unsigned.map(({ box }) => box.host.hostname)).toEqual([]);
  });

  it('names a neighbour where a place would list its people', () => {
    // An office's team page, a department's people and an intranet's team all list
    // the people on the network — by the names they go by, never their logins.
    const listing = servingBoxes(isWebserver).filter(
      ({ box }) =>
        neighboursOf(box).length > 0 &&
        (hasPrefix('portal')(box.host) ||
          (['corporate', 'university'].includes(networkPersona(box.essid).category) &&
            !hasPrefix('api')(box.host))),
    );
    expect(listing.length).toBeGreaterThan(10);

    const lonely = listing.filter(({ box, tree }) => {
      const text = siteText(tree);
      return !neighboursOf(box).some((neighbour) =>
        text.includes(
          inhabitant({ essid: box.essid, host: neighbour, username: npcUsername(box.essid, neighbour) })
            .fullName,
        ),
      );
    });
    expect(lonely.map(({ box }) => box.host.hostname)).toEqual([]);
  });

  it('puts no account but root where a mail address or a home directory goes', () => {
    // A web tree is readable with no session at all, so the rule the rest of a box
    // keeps holds here: the only login a player is ever handed is root.
    const accounts = new Set([
      'guest',
      ...lanBoxes(ALL_ESSIDS).map((box) => npcUsername(box.essid, box.host)),
      ...deepBoxes(ALL_ESSIDS).map(({ essid, host }) => npcUsername(essid, host)),
    ]);
    const positions = [
      /mailto:([^@"]+)@/g,
      /\b([a-z0-9._-]+)@[a-z0-9-]+\.lan\b/g,
      /\/home\/([a-z0-9._-]+)/g,
    ];
    const named = servingBoxes(() => true).flatMap(({ tree }) =>
      positions.flatMap((position) =>
        [...siteText(tree).matchAll(position)].map(([, name]) => name ?? ''),
      ),
    );
    expect(named.length).toBeGreaterThan(50);
    expect([...new Set(named)].filter((name) => accounts.has(name))).toEqual([]);
  });
});
