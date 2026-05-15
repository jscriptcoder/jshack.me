import type { GeneratedMachine, MissionNetwork, SubnetLayer } from '../../generation/types';
import type { Port, RemoteMachine, RemoteUser, NetworkInterface } from '../../network/types';
import { createFileSystem, mergeFileNodeChildren } from '../../filesystem/fileSystemFactory';
import { mkDir, mkFile } from '../../generation/filesystem/helpers';
import { buildInfrastructurePidFiles } from '../../generation/filesystem/infraPidFiles';
import type { WorldNetwork } from '../../worldNetworks/types';
import type { ThemedGenerator } from '../../worldNetworks/generate';
import { INDEX_PATH } from '../handlers/searchEngine';

// findit.io network builder. Produces a single-machine MissionNetwork
// where the router IS the only machine — no inner layers, no NAT, no
// objective. The machine exposes ports 80 + 443 (both http-shaped per
// plan; no TLS handshake simulation), serves a static landing page at
// /var/www/html/index.html, and ships /etc/findit/index.json built
// from peer rows' search_metadata + public_domain.
//
// The index file is snapshotted at network-generation time (browser
// boot). New world_networks rows added later won't appear in the
// index until the next page load triggers regeneration. That matches
// the plan's snapshot model and keeps the search handler purely
// filesystem-driven.

const FALLBACK_DOMAIN = 'findit.io';

// Derive the directory + file name from INDEX_PATH so a path rename
// in the handler module flows here without code edits. We assume the
// path is `/etc/<dir>/<file>` — a sufficient invariant given the
// handler also reads from /etc/findit/index.json today.
const indexPathSegments = INDEX_PATH.split('/').filter((s) => s.length > 0);
const INDEX_DIR_NAME = indexPathSegments[1] ?? 'findit';
const INDEX_FILE_NAME = indexPathSegments[2] ?? 'index.json';

type SearchIndexEntry = {
  readonly domain: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
};

const buildIndexEntries = (rows: ReadonlyArray<WorldNetwork>): readonly SearchIndexEntry[] =>
  rows.flatMap((r) => {
    if (!r.search_metadata || !r.public_domain) return [];
    return [
      {
        domain: r.public_domain,
        title: r.search_metadata.title,
        description: r.search_metadata.description,
        keywords: r.search_metadata.keywords,
      },
    ];
  });

// In-world content shipped to /var/www/html/index.html. The page is
// authored as if intended for a graphical browser — players read the
// raw HTML through curl, see the form (action="/" method="GET",
// name="q"), and infer the URL pattern from the markup the same way
// real recon does. Deliberately no curl-flavored tutorial copy: the
// form IS the documentation.
const renderLandingPage = (domain: string): string =>
  `<!DOCTYPE html>
<html>
  <head><title>${domain}</title></head>
  <body>
    <h1>${domain}</h1>
    <p>Find websites and services across the public web.</p>
    <form action="/" method="GET">
      <input type="text" name="q" placeholder="Search the public web">
      <button type="submit">Search</button>
    </form>
  </body>
</html>
`;

// /var/www/html container with the landing page. World-readable so any
// user (including unauthenticated curl-as-root) can fetch it. The
// outer `var` entry merges with the factory-created /var via
// mergeFileNodeChildren — preserves /var/log + /var/run and adds www.
const buildVarWwwHtml = (landing: string): Readonly<Record<string, FileNodeShim>> => ({
  var: mkDir(
    'var',
    {
      www: mkDir(
        'www',
        {
          html: mkDir('html', { 'index.html': mkFile('index.html', landing) }, 'root', true),
        },
        'root',
        true,
      ),
    },
    'root',
    true,
  ),
});

// /etc/findit/index.json container.
const buildEtcFindit = (indexJson: string): Readonly<Record<string, FileNodeShim>> => ({
  [INDEX_DIR_NAME]: mkDir(
    INDEX_DIR_NAME,
    { [INDEX_FILE_NAME]: mkFile(INDEX_FILE_NAME, indexJson) },
    'root',
    true,
  ),
});

// Wraps infra pid file FileNodes into `var/run/<pid>.pid` directory
// structure. Returned as an extraDirectories fragment that
// mergeFileNodeChildren combines with /var/www/html.
const buildVarRunInfraExtraDirs = (
  ports: readonly Port[],
): Readonly<Record<string, FileNodeShim>> => {
  const infraPidFiles = buildInfrastructurePidFiles(ports);
  if (Object.keys(infraPidFiles).length === 0) return {};
  return {
    var: mkDir(
      'var',
      {
        run: mkDir('run', infraPidFiles, 'root', true),
      },
      'root',
      true,
    ),
  };
};

// Lightweight alias to avoid importing the FileNode type just for this
// module — mkDir/mkFile already produce the correct shape.
type FileNodeShim = ReturnType<typeof mkFile>;

export const generateSearchEngineNetwork: ThemedGenerator = async (row, ctx) => {
  const publicIp = await ctx.allocateIp('mission_instance');
  const domain = row.public_domain ?? FALLBACK_DOMAIN;

  const indexEntries = buildIndexEntries(ctx.allRows);
  const indexJson = JSON.stringify(indexEntries, null, 2);
  const landing = renderLandingPage(domain);

  const ports: readonly Port[] = [
    { port: 80, service: 'http', serviceVersion: 'nginx/1.20.1', open: true },
    { port: 443, service: 'https', serviceVersion: 'nginx/1.20.1', open: true },
  ];

  const fileSystem = createFileSystem({
    users: [
      {
        username: 'root',
        passwordHash: 'no-shell-access',
        userType: 'root',
        uid: 0,
      },
      {
        username: 'www-data',
        passwordHash: 'no-shell-access',
        userType: 'user',
        uid: 33,
      },
    ],
    extraDirectories: mergeFileNodeChildren(
      buildVarWwwHtml(landing),
      buildVarRunInfraExtraDirs(ports),
    ),
    etcExtraContent: buildEtcFindit(indexJson),
  });

  const users: readonly RemoteUser[] = [
    { username: 'root', userType: 'root' },
    { username: 'www-data', userType: 'user' },
  ];

  const remoteMachine: RemoteMachine = {
    ip: publicIp,
    hostname: domain,
    ports,
    users,
  };

  const generatedMachine: GeneratedMachine = {
    ip: publicIp,
    hostname: domain,
    role: 'router',
    accessVariant: 'http',
    remoteMachine,
  };

  const subnet = publicIp.split('.').slice(0, 3).join('.');

  const interfaces: readonly NetworkInterface[] = [
    {
      name: 'eth0',
      flags: ['UP', 'BROADCAST', 'RUNNING'],
      inet: publicIp,
      netmask: '255.255.255.0',
      gateway: '0.0.0.0',
      mac: '02:00:00:00:00:01',
    },
  ];

  const layer: SubnetLayer = {
    subnet,
    gateway: generatedMachine,
    gatewayType: 'router',
    entryVariant: 'http',
    machines: [],
    isForwarded: false,
  };

  const network: MissionNetwork = {
    seed: row.seed,
    difficulty: 'easy',
    entryPoint: publicIp,
    entryVariant: 'http',
    machines: [],
    fileSystems: { [publicIp]: fileSystem },
    networkConfig: {
      machineConfigs: {
        [publicIp]: {
          interfaces,
          machines: [],
          dnsRecords: [],
        },
      },
    },
    objective: {
      type: 'tamper',
      description: 'unused — world network',
      targetMachine: publicIp,
      targetPath: '/dev/null',
      targetContent: '',
      clientEmail: 'unused@example.com',
      expectedProof: '',
    },
    clientEmail: 'unused@example.com',
    routerPublicIp: publicIp,
    routerMachine: generatedMachine,
    routerDomain: domain,
    domainEntry: false,
    layers: [layer],
  };

  return network;
};
