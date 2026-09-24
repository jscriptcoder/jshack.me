import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, hostServices, npcUsername } from './remoteHostFs';
import { buildDeepHostFs } from './deepHostFs';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { roleOfHostname } from './pools/hostnames';
import { deviceKindOf } from './device';
import { createFsView } from '../filesystem/fsView';
import { parseHttpUrl, resolveHref, resolveWebPath } from '../network/http';
import { lanZoneName, resolveLanName } from '../network/resolveName';
import { inhabitant, networkPersona } from './persona';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import {
  ALL_ESSIDS,
  deepBoxes,
  filesUnder,
  lanBoxes,
  softwareVersionsIn,
  type Box,
} from '../../test/worldContent';
import { DEFAULT_DIRLIST } from '../network/defaultDirlist';
import { API_PAGES, PORTAL_PAGES, ROBOTS_ONLY_DIRECTORIES } from './pools/webSites';
import { sweepWord } from '../network/webSweep';
import { parseMysqlDatabase } from '../mysql/types';

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
  const onLan = isOnLan(built.box);
  // A LAN box may name itself as its network does; nothing on a deep layer has a name.
  const address = onLan ? (resolveLanName(essid, url.host)?.ip ?? url.host) : url.host;
  if (address === host.ip && url.port === built.port) {
    return served(built.tree, url.path) === null ? `${url.path} is not served here` : null;
  }
  if (!onLan) return `${target} leaves a deep box, which names no neighbour`;
  const lan = generateHomeLan(essid).hosts;
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

  it('never links a page nothing serves, nor names one in robots.txt or a sitemap, on any network', () => {
    const offenders = servingBoxes(isWebserver).flatMap((built) => [
      ...deadLinksOn(built),
      ...[...robotsPathsOf(built), ...sitemapUrlsOf(built)].flatMap((href) => {
        const reason = deadLink(built, '/', href);
        return reason === null ? [] : [`${built.box.host.hostname} breadcrumb: ${reason}`];
      }),
    ]);
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
    // A printer, a camera or a recorder publishes its own UI instead; `device.test.ts`
    // holds those pages.
    const hasOwnUi = (host: LanHost): boolean =>
      ['printer', 'camera', 'recorder'].includes(deviceKindOf(host.hostname) ?? '');
    const roots = servingBoxes((host) => !isWebserver(host) && !hasOwnUi(host)).map(({ tree }) => [
      ...webRootOf(tree).keys(),
    ]);
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

  it('names no host in its text but itself or a neighbour, and a deep box names only its address', () => {
    const strangers = servingBoxes(isWebserver).flatMap(({ box, tree }) => {
      const text = siteText(tree);
      const zone = lanZoneName(box.essid).replace('.', '\\.');
      const names = [...text.matchAll(new RegExp(`\\b([a-z0-9-]+)\\.${zone}\\b`, 'g'))].map(
        ([, name]) => name ?? '',
      );
      const addresses = text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
      const known = new Set(
        [...neighboursOf(box), ...(isOnLan(box) ? [box.host] : [])].flatMap((host) => [
          host.hostname,
          host.ip,
        ]),
      );
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

/** The document-root files a reader never reaches by following links, keyed by the path a
 *  request names them by — a directory's page by the directory. */
const hiddenPaths = (built: Built): ReadonlyMap<string, string> => {
  const reached = new Set([...crawl(built).keys()]);
  return new Map(
    [...webRootOf(built.tree)]
      .map(([file, content]): readonly [string, string] => [
        file === 'index.html'
          ? ''
          : file.endsWith('/index.html')
            ? file.slice(0, -'/index.html'.length)
            : file,
        content,
      ])
      .filter(([path]) => !reached.has(`/${path}`) && !reached.has(`/${path}/`)),
  );
};

/** The paths a site's robots.txt asks crawlers to stay out of. */
const robotsPathsOf = (built: Built): readonly string[] =>
  [...(webRootOf(built.tree).get('robots.txt') ?? '').matchAll(/^Disallow: (\S+)$/gm)].map(
    ([, path]) => path ?? '',
  );

/** The addresses a site's sitemap lists. */
const sitemapUrlsOf = (built: Built): readonly string[] =>
  [...(webRootOf(built.tree).get('sitemap.xml') ?? '').matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    ([, url]) => url ?? '',
  );

/** Every path an HTML comment on the site names. */
const commentedPathsOf = (built: Built): readonly string[] =>
  htmlPagesOf(built.tree).flatMap(([, page]) =>
    [...page.matchAll(/<!--([\s\S]*?)-->/g)].flatMap(([, comment]) =>
      [...(comment ?? '').matchAll(/(?<![\w.])(\/[\w./-]*)/g)].map(([, path]) => path ?? ''),
    ),
  );

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Every date a text states, written either way a page writes one. */
const datesIn = (text: string): readonly string[] => [
  ...(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []),
  ...[...text.matchAll(new RegExp(`\\b(\\d{1,2}) (${MONTHS.join('|')}) (\\d{4})\\b`, 'g'))].map(
    ([, day, month, year]) =>
      `${year}-${String(MONTHS.indexOf(month ?? '') + 1).padStart(2, '0')}-${(day ?? '').padStart(2, '0')}`,
  ),
];

describe('a web server keeps paths nobody linked', () => {
  it('serves every webserver 1 to 4 paths no page links from the default path list, and at most the one other robots.txt names', () => {
    const counts = servingBoxes(isWebserver).map((built) => {
      const hidden = [...hiddenPaths(built).keys()].filter(
        (path) => !['robots.txt', 'sitemap.xml'].includes(path),
      );
      const offList = hidden.filter((path) => !DEFAULT_DIRLIST.includes(path));
      expect(offList.filter((path) => !robotsPathsOf(built).includes(`/${path}/`))).toEqual([]);
      expect(offList.length).toBeLessThanOrEqual(1);
      return hidden.length - offList.length;
    });
    expect(counts.filter((count) => count < 1 || count > 4)).toEqual([]);
    expect(Math.min(...counts)).toBe(1);
    expect(Math.max(...counts)).toBe(4);
  });

  it('lets a default sweep find something on every webserver that no page links', () => {
    const empty = servingBoxes(isWebserver).filter((built) => {
      const found = DEFAULT_DIRLIST.flatMap((word) => {
        const { found: hit } = sweepWord(built.tree, word);
        return hit === null ? [] : [word];
      });
      return found.filter((word) => !['index.html', 'robots.txt', 'sitemap.xml'].includes(word))
        .length === 0;
    });
    expect(empty.map(({ box }) => box.host.hostname)).toEqual([]);
  });

  it('keeps a schema-only dump beside a database, and never without one', () => {
    const webservers = servingBoxes(isWebserver);
    const withDump = webservers.filter(({ tree }) => webRootOf(tree).has('dump.sql'));
    expect(withDump.length).toBeGreaterThan(2);

    const wrong = webservers.flatMap(({ box, tree }) => {
      const dump = webRootOf(tree).get('dump.sql');
      const datafile = createFsView(tree, { userType: 'root' }).read(
        asAbsPath('/var/lib/mysql/data.json'),
      );
      const database = datafile.ok ? parseMysqlDatabase(datafile.content) : null;
      if (dump === undefined) return [];
      if (database === null) return [`${box.host.hostname} dumps a database it does not run`];
      if (/INSERT/i.test(dump)) return [`${box.host.hostname} dumps rows`];
      // Each column as mysqldump states it — name, type, whether it may be empty — then
      // the keys it carries, so a reader learns what the table really enforces.
      const typeOf: Readonly<Record<string, string>> = {
        INT: 'int',
        VARCHAR: 'varchar(255)',
        TEXT: 'text',
        DATETIME: 'datetime',
        BOOLEAN: 'tinyint(1)',
        FLOAT: 'float',
      };
      const dumped = [...dump.matchAll(/CREATE TABLE `([^`]+)` \(\n([\s\S]*?)\n\)/g)].map(
        ([, table, body]) => ({ table, lines: (body ?? '').split(',\n') }),
      );
      const expected = Object.entries(database.tables).map(([table, { columns }]) => ({
        table,
        lines: [
          ...columns.map(
            ({ name, type, nullable }) =>
              `  \`${name}\` ${typeOf[type]} ${nullable ? 'DEFAULT NULL' : 'NOT NULL'}`,
          ),
          ...columns.filter(({ key }) => key === 'PRI').map(({ name }) => `  PRIMARY KEY (\`${name}\`)`),
          ...columns
            .filter(({ key }) => key === 'UNI')
            .map(({ name }) => `  UNIQUE KEY \`${name}\` (\`${name}\`)`),
        ],
      }));
      return JSON.stringify(dumped) === JSON.stringify(expected)
        ? []
        : [`${box.host.hostname} dumps a schema its database does not have`];
    });
    expect(wrong).toEqual([]);
  });

  it('keeps no database password in an .env, and names its own site in APP_URL', () => {
    const envs = servingBoxes(isWebserver).flatMap((built) => {
      const env = webRootOf(built.tree).get('.env');
      return env === undefined ? [] : [{ built, env }];
    });
    expect(envs.length).toBeGreaterThan(2);

    const wrong = envs.flatMap(({ built, env }) => {
      const url = /^APP_URL=(.*)$/m.exec(env)?.[1];
      const own = isOnLan(built.box)
        ? `http://${built.box.host.hostname}.${lanZoneName(built.box.essid)}${built.port === 80 ? '' : `:${built.port}`}/`
        : `${originOf(built)}/`;
      return [
        ...(url === own ? [] : [`${built.box.host.hostname} APP_URL ${url} is not ${own}`]),
        ...env
          .split('\n')
          .filter((line) => /PASS|DB_/i.test(line))
          .map((line) => `${built.box.host.hostname} ${line}`),
      ];
    });
    expect(wrong).toEqual([]);
  });
});

describe('everything a web server publishes is true of the world', () => {
  it('quotes no version, fills every slot, and dates nothing after the world began', () => {
    const faults = servingBoxes(() => true).flatMap(({ box, tree }) =>
      [...webRootOf(tree)].flatMap(([file, content]) => [
        ...softwareVersionsIn(content).map((version) => `version ${version}`),
        ...(content.match(/\{\w+\}|\{\{|undefined|NaN/g) ?? []).map((slot) => `slot ${slot}`),
        ...datesIn(content)
          .filter((date) => date > '2026-07-11')
          .map((date) => `date ${date}`),
      ].map((fault) => `${box.host.hostname} /${file}: ${fault}`)),
    );
    expect(faults).toEqual([]);
  });

  it('reads a date either way a page writes one, so the rule above can fail', () => {
    expect(datesIn('On 14 June 2026, and again 2026-07-12.')).toEqual(['2026-07-12', '2026-06-14']);
  });
});

describe('a web server leaves breadcrumbs to what it did not link', () => {
  it('keeps a robots.txt on most sites and a sitemap on some', () => {
    const sites = servingBoxes(isWebserver);
    const robots = sites.filter(({ tree }) => webRootOf(tree).has('robots.txt')).length;
    const sitemaps = sites.filter(({ tree }) => webRootOf(tree).has('sitemap.xml')).length;
    expect(robots / sites.length).toBeGreaterThan(0.6);
    expect(robots).toBeLessThan(sites.length);
    expect(sitemaps / sites.length).toBeGreaterThan(0.25);
    expect(sitemaps / sites.length).toBeLessThan(0.75);
  });

  it('asks crawlers to stay out of paths it really serves and never links', () => {
    const wrong = servingBoxes(isWebserver).flatMap((built) => {
      const reached = new Set(crawl(built).keys());
      const paths = robotsPathsOf(built);
      if (webRootOf(built.tree).has('robots.txt') && paths.length === 0) {
        return [`${built.box.host.hostname} robots.txt names nothing`];
      }
      return paths.flatMap((path) => [
        ...(deadLink(built, '/robots.txt', path) === null ? [] : [`${path} is not served`]),
        ...(reached.has(path) ? [`${path} is linked`] : []),
      ]).map((fault) => `${built.box.host.hostname}: ${fault}`);
    });
    expect(wrong).toEqual([]);
  });

  it('names a path off the default list in a seeded share of robots files', () => {
    const robots = servingBoxes(isWebserver).filter(({ tree }) => webRootOf(tree).has('robots.txt'));
    const offList = robots.filter((built) =>
      robotsPathsOf(built).some((path) => !DEFAULT_DIRLIST.includes(path.replace(/^\/|\/$/g, ''))),
    );
    expect(offList.length / robots.length).toBeGreaterThan(0.15);
    expect(offList.length / robots.length).toBeLessThan(0.5);
  });

  it('draws that path from names the default list does not try', () => {
    expect(ROBOTS_ONLY_DIRECTORIES.filter((name) => DEFAULT_DIRLIST.includes(name))).toEqual([]);
    expect(ROBOTS_ONLY_DIRECTORIES.length).toBeGreaterThan(3);
  });

  it('lists in a sitemap exactly the pages a reader can walk to, at the address the site answers on', () => {
    const wrong = servingBoxes(isWebserver).flatMap((built) => {
      const urls = sitemapUrlsOf(built);
      if (urls.length === 0) return [];
      const zone = lanZoneName(built.box.essid);
      const own = isOnLan(built.box)
        ? `http://${built.box.host.hostname}.${zone}${built.port === 80 ? '' : `:${built.port}`}`
        : originOf(built);
      const listed = urls.map((url) => (url.startsWith(own) ? url.slice(own.length) : url));
      const walkable = [...crawl(built).keys()];
      return JSON.stringify([...listed].sort()) === JSON.stringify([...walkable].sort())
        ? []
        : [`${built.box.host.hostname} lists ${listed.join(' ')}`];
    });
    expect(wrong).toEqual([]);
  });

  it('leaves comments in some pages that name a path it serves', () => {
    const sites = servingBoxes(isWebserver);
    const commented = sites.filter((built) => commentedPathsOf(built).length > 0);
    expect(commented.length / sites.length).toBeGreaterThan(0.25);
    expect(commented.length / sites.length).toBeLessThan(0.75);

    const dead = commented.flatMap((built) =>
      commentedPathsOf(built)
        .filter((path) => served(built.tree, path) === null)
        .map((path) => `${built.box.host.hostname} ${path}`),
    );
    expect(dead).toEqual([]);
  });
});

describe('no two web servers read alike', () => {
  it('serves no file on one web server that another on its network serves byte for byte', () => {
    const copies = servingBoxes(isWebserver).reduce(
      ({ seen, repeated }, { box, tree }) => {
        const fresh = [...webRootOf(tree)].flatMap(([file, content]) => {
          const key = `${box.essid} ${content}`;
          const first = seen.get(key);
          return first === undefined ? [] : [`${box.essid}: ${first} = ${box.host.hostname} /${file}`];
        });
        return {
          seen: new Map([
            ...seen,
            ...[...webRootOf(tree)].map(
              ([file, content]): readonly [string, string] => [`${box.essid} ${content}`, `${box.host.hostname} /${file}`],
            ),
          ]),
          repeated: [...repeated, ...fresh],
        };
      },
      { seen: new Map<string, string>(), repeated: [] as readonly string[] },
    ).repeated;
    expect(copies).toEqual([]);
  });

  it('gives nearly every webserver a front page of its own across every network', () => {
    // Measured with every front page distinct; the band leaves room for the pools to
    // grow without a coincidence failing the build.
    const fronts = servingBoxes(isWebserver).map(({ tree }) => webRootOf(tree).get('index.html'));
    expect(new Set(fronts).size / fronts.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe('how a site is written out', () => {
  it('heads its pages with the place, titles each page after it, and signs every page', () => {
    const wrong = servingBoxes(isWebserver).flatMap(({ box, tree }) => {
      const { place } = networkPersona(box.essid);
      const site = place.charAt(0).toUpperCase() + place.slice(1);
      const { fullName } = inhabitant({ ...box, username: npcUsername(box.essid, box.host) });
      return htmlPagesOf(tree).flatMap(([file, page]) => {
        const heading = /<h1>([^<]*)<\/h1>/.exec(page)?.[1] ?? '';
        const title = /<title>([^<]*)<\/title>/.exec(page)?.[1];
        const expectedTitle = file === 'index.html' || !file.endsWith('.html') || file.includes('/')
          ? null
          : `${heading} — ${site}`;
        return [
          ...(page.startsWith('<html>\n<head><title>') ? [] : ['does not open as a page']),
          ...(page.endsWith(`<hr>\n<p>Page maintained by ${fullName}.</p>\n</body>\n</html>`)
            ? []
            : ['is not signed']),
          ...(file === 'index.html' && (heading !== site || title !== site) ? ['front is not headed by the place'] : []),
          ...(expectedTitle !== null && title !== expectedTitle ? [`title ${title}`] : []),
        ].map((fault) => `${box.host.hostname} /${file} ${fault}`);
      });
    });
    expect(wrong).toEqual([]);
  });

  it('opens its navigation with Home, then names each page by its heading', () => {
    const wrong = servingBoxes(isWebserver).flatMap(({ box, tree }) => {
      const front = webRootOf(tree).get('index.html') ?? '';
      const nav = [...(/<p>(<a href="\/".*?)<\/p>/.exec(front)?.[1] ?? '').matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)];
      const [home, ...rest] = nav;
      return [
        ...(home?.[1] === '/' && home[2] === 'Home' ? [] : ['navigation does not open with Home']),
        ...rest
          .filter(([, href, label]) => {
            const page = webRootOf(tree).get((href ?? '').slice(1)) ?? '';
            return !page.includes(`<h1>${label}</h1>`);
          })
          .map(([, href]) => `${href} is not named by its heading`),
      ].map((fault) => `${box.host.hostname}: ${fault}`);
    });
    expect(wrong).toEqual([]);
  });

  it('keeps a team page only where a place lists its people, as its kind of place calls it', () => {
    const wrong = servingBoxes(isWebserver).flatMap(({ box, tree }) => {
      const files = [...webRootOf(tree).keys()];
      const category = networkPersona(box.essid).category;
      const expected = hasPrefix('portal')(box.host)
        ? ['team.html']
        : hasPrefix('api')(box.host)
          ? []
          : category === 'corporate'
            ? ['team.html']
            : category === 'university'
              ? ['people.html']
              : [];
      const listed = files.filter((file) => ['team.html', 'people.html'].includes(file));
      return JSON.stringify(listed) === JSON.stringify(expected)
        ? []
        : [`${box.host.hostname} (${category}) lists people in ${listed.join() || 'nothing'}`];
    });
    expect(wrong).toEqual([]);
  });

  it('draws an intranet and an API only from the pages their kind of site keeps', () => {
    const allowed = (host: LanHost): ReadonlySet<string> =>
      new Set(
        hasPrefix('portal')(host)
          ? ['index.html', 'services.html', 'team.html', 'news.html', 'faq.html', 'contact.html', ...PORTAL_PAGES.map(({ file }) => file)]
          : ['index.html', 'about.html', 'contact.html', ...API_PAGES.map(({ file }) => file)],
      );
    const strays = servingBoxes((host) => hasPrefix('portal')(host) || hasPrefix('api')(host)).flatMap(
      (built) =>
        [...crawl(built).keys()]
          .filter((path) => path === '/' || path.endsWith('.html'))
          .map((path) => (path === '/' ? 'index.html' : path.slice(1)))
          .filter((file) => !allowed(built.box.host).has(file))
          .map((file) => `${built.box.host.hostname} ${file}`),
    );
    expect(strays).toEqual([]);
  });

  it('writes a service port into the services table only where it is not the standard one', () => {
    const portals = servingBoxes(hasPrefix('portal'));
    const pages = portals.map(({ tree }) => webRootOf(tree).get('services.html') ?? '');
    expect(pages.filter((page) => /\.lan:80\/|\.lan:21\//.test(page))).toEqual([]);
    expect(pages.some((page) => /\.lan:\d+\//.test(page))).toBe(true);
  });

  it('lists every machine that does something on the network, and says so when none does', () => {
    const wrong = servingBoxes(hasPrefix('portal')).flatMap(({ box, tree }) => {
      const page = webRootOf(tree).get('services.html') ?? '';
      const rows = [...page.matchAll(/<tr><td>/g)].length;
      const expected = neighboursOf(box).reduce(
        (total, neighbour) =>
          total +
          (portOf({ essid: box.essid, host: neighbour }, 'http') === null ? 0 : 1) +
          (portOf({ essid: box.essid, host: neighbour }, 'ftp') === null ? 0 : 1) +
          (roleOfHostname(neighbour.hostname) === 'mailserver' ? 1 : 0),
        0,
      );
      const table = page.match(/<table>[\s\S]*<\/table>/)?.[0];
      const stray = (table === undefined ? [] : table.split('\n')).filter((line) => !/^<\/?table>$|^<tr>.*<\/tr>$/.test(line));
      return [
        ...(rows === expected ? [] : [`${rows} rows for ${expected} services`]),
        ...(expected === 0 && !page.includes('Nothing else on the network is listed yet.') ? ['says nothing'] : []),
        ...stray.map((line) => `stray ${line}`),
      ].map((fault) => `${box.host.hostname}: ${fault}`);
    });
    expect(wrong).toEqual([]);
    expect(servingBoxes(hasPrefix('portal')).some(({ box }) => neighboursOf(box).length === 0)).toBe(true);
  });

  it('shows the status endpoint as its worked example, exactly as it answers', () => {
    const wrong = servingBoxes(hasPrefix('api')).flatMap(({ box, tree }) => {
      const front = webRootOf(tree).get('index.html') ?? '';
      const status = webRootOf(tree).get('api/v1/status');
      return front.includes(`<h2>Example</h2>\n<pre>\nGET /api/v1/status\n${status}\n</pre>`)
        ? []
        : [box.host.hostname];
    });
    expect(wrong).toEqual([]);
  });
});

describe('what an unlinked path holds', () => {
  /** What each unlinked word must hold, read the way a reader reads it. */
  const PROMISES: readonly (readonly [RegExp, RegExp])[] = [
    [/^old\/index\.html$/, /old site|old layout|previous/i],
    [/^(staging|test)\/index\.html$/, /draft|staging copy|test build/i],
    [/^(admin|dashboard)\/index\.html$/, /<input type="password" name="password">/],
    [/^internal\/index\.html$/, /<h1>Internal<\/h1>/],
    [/^status$/, /^status: ok\nuptime: \d+ days\n$/],
    [/^health$/, /^\{"status":"ok","host":"[a-z0-9-]+"\}$/],
    [/^server-status$/, /^Server Status for [a-z0-9-]+\nServer uptime: \d+ days \d+ hours\n/],
    [/^metrics$/, /^# HELP http_requests_total[\s\S]*\nprocess_open_fds \d+\n$/],
    [/^\.env$/, /^APP_ENV=production\nAPP_URL=\S+\nMAIL_API_KEY=key-[0-9a-f]{32}\nPAYMENT_PUBLIC_KEY=pk_live_[0-9a-f]{24}\nANALYTICS_ID=G-[0-9A-F]{10}\n$/],
    [/^(notes|todo|readme)\.txt$/, /^[A-Za-z ]+ — [A-Z][^\n]+\n\n(- [^\n]+\n){2,4}$/],
    [/^robots\.txt$/, /^User-agent: \*\n(Disallow: \/\S+\n)+$/],
    [/^sitemap\.xml$/, /^<urlset>\n( {2}<url><loc>http:\/\/\S+<\/loc><\/url>\n)+<\/urlset>\n$/],
  ];

  it('holds what its name promises', () => {
    const kept = servingBoxes(isWebserver).flatMap((built) =>
      [...hiddenPaths(built)].flatMap(([path]) => {
        const file = [...webRootOf(built.tree).keys()].find(
          (candidate) => candidate === path || candidate === `${path}/index.html`,
        );
        return file === undefined ? [] : [{ built, file, content: webRootOf(built.tree).get(file) ?? '' }];
      }),
    );
    const broken = kept.flatMap(({ built, file, content }) => {
      const promise = PROMISES.find(([name]) => name.test(file));
      if (promise === undefined) return [];
      return promise[1].test(content) ? [] : [`${built.box.host.hostname} /${file}`];
    });
    expect(broken).toEqual([]);
    // Every kind of unlinked path is met somewhere, so no promise above goes unread.
    const met = new Set(kept.map(({ file }) => PROMISES.findIndex(([name]) => name.test(file))));
    expect([...met].filter((index) => index >= 0).sort((left, right) => left - right)).toEqual(
      PROMISES.map((_, index) => index),
    );
  });

  it('writes notes about paths the site really serves, never about the notes themselves', () => {
    const wrong = servingBoxes(isWebserver).flatMap((built) =>
      [...webRootOf(built.tree)]
        .filter(([file]) => /^(notes|todo|readme)\.txt$/.test(file))
        .flatMap(([file, content]) =>
          [...content.matchAll(/(?<![\w.])(\/[\w./-]*)/g)]
            .map(([, path]) => path ?? '')
            .filter((path) => path === `/${file}` || served(built.tree, path) === null)
            .map((path) => `${built.box.host.hostname} /${file} names ${path}`),
        ),
    );
    expect(wrong).toEqual([]);
  });

  it('leaves its comment in one page at most', () => {
    const crowded = servingBoxes(isWebserver).filter(
      ({ tree }) => htmlPagesOf(tree).filter(([, page]) => page.includes('<!--')).length > 1,
    );
    expect(crowded.map(({ box }) => box.host.hostname)).toEqual([]);
  });
});
