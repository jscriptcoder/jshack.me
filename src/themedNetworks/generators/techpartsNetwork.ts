import type { GeneratedMachine, MissionNetwork, SubnetLayer } from '../../generation/types';
import type {
  NetworkInterface,
  Port,
  RemoteMachine,
  RemoteUser,
  VulnerabilityEffect,
} from '../../network/types';
import type { FileNode } from '../../filesystem/types';
import { createFileSystem } from '../../filesystem/fileSystemFactory';
import { mkDir, mkFile } from '../../generation/filesystem/helpers';
import type { ThemedGenerator } from '../../worldNetworks/generate';
import { TECHPARTS_PAGES, type TechpartsPage } from '../content/techparts/pages';
import { buildTimeline, buildGeneratedVuln, CVE_TIMING_CONFIG } from '../../generation/timeline';

// techparts.io network builder. Produces a single-machine MissionNetwork
// where the router IS the only machine — no inner layers, no NAT, no
// objective. The site is read-only at boot: ports 80/443 are decorative
// in this step (filled in step A6) and the filesystem ships only the
// default factory layout (manifest pages laid in step A7).
//
// Mirrors generateSearchEngineNetwork's shape: same single-machine
// pattern, same fileSystems-keyed-by-publicIp layout, same network-as-
// router collapse. If a third themed network shows up, the shared
// scaffolding is a fair candidate for extraction (see step A5 REFACTOR
// note in plans/techparts-network.md).

const FALLBACK_DOMAIN = 'techparts.io';

// Walk budget for the procedural CVE picker — ~year+ of game time. Match
// rate for shell_full at user tier in the http effect pool is ~9.5%
// (shellFull is 2/7 of the pool × user is 1/3 of tiers), so a 100-entry
// walk yields ~9-10 viable candidates. Bounded so the lookup is constant-
// time at module use.
const APACHE_CVE_WALK_BUDGET_DAYS = CVE_TIMING_CONFIG.maxSafeWindowDays * 100;

type ApachePick = {
  readonly version: string;
  readonly effect: VulnerabilityEffect;
};

// Picks an Apache version from the http procedural timeline whose rolled
// CVE effect is shell_full at user tier. Walks forward from the timeline's
// starting tuple (Apache/2.4.60 — see serviceTemplates.ts), computing each
// entry's effect via buildGeneratedVuln, and returns the first match.
//
// The narrow allowlist (shell_full at user tier only) caps damage at
// /var/www/html defacement: a www-data shell cannot touch /etc/passwd or
// system files. Recovery is a generator re-run + DELETE FROM patches scoped
// to /var/www/html. Excluding root tier prevents the brick scenarios (wipe
// /etc/passwd → CVE flow breaks; wipe libc → site dies).
//
// Determinism is load-bearing: every browser must compute the same
// techparts.io CVE so cross-player visibility stays consistent. The picker
// reads only stable inputs (serviceTemplates['http'].startTuple + the
// service-keyed PRNG seeds inside the walker / generatedVuln modules).
//
// Throws if no match found within the walk budget. The current http effect
// pool yields a shell_full:user roll roughly every 10 entries, so a 100-
// entry walk has effectively zero chance of empty result. The throw is
// defensive against future pool drift — if it ever fires, the allowlist
// or pool needs reconciliation, not silent fallback to a non-allowlisted
// effect (which could expose techparts.io to a brick-tier CVE).
export const pickApacheCveVersion = (): ApachePick => {
  const timeline = buildTimeline('http', APACHE_CVE_WALK_BUDGET_DAYS, CVE_TIMING_CONFIG);
  const candidates = timeline.map((entry) => ({
    version: entry.version,
    effect: buildGeneratedVuln('http', entry).effect,
  }));
  const match = candidates.find(
    (c) => c.effect.kind === 'shell_full' && c.effect.tier === 'user',
  );
  if (!match) {
    throw new Error(
      'pickApacheCveVersion: no shell_full:user match in http procedural timeline within walk budget — verify effect pool / allowlist alignment',
    );
  }
  return match;
};

type DirChildren = Readonly<Record<string, FileNode>>;

// Translates a manifest URL path to the filesystem path the curl pipeline
// reads (curl.ts:137). The root path is special-cased to index.html;
// everything else maps to /var/www/html<path> verbatim.
const fsPathForManifestPath = (manifestPath: string): string =>
  manifestPath === '/' ? '/var/www/html/index.html' : `/var/www/html${manifestPath}`;

// Inserts a file at the given segment path into a children record,
// constructing any missing directories along the way. Pure — returns a
// new record; the previous tree is left untouched. Directories are
// world-readable so post-shell-access exploration works at any tier.
const setFileAtPath = (
  current: DirChildren,
  dirSegments: readonly string[],
  fileName: string,
  content: string,
): DirChildren => {
  if (dirSegments.length === 0) {
    return { ...current, [fileName]: mkFile(fileName, content) };
  }
  const [dirName, ...rest] = dirSegments;
  const existingDir = current[dirName];
  const existingChildren: DirChildren =
    existingDir?.type === 'directory' && existingDir.children ? existingDir.children : {};
  const nextChildren = setFileAtPath(existingChildren, rest, fileName, content);
  return {
    ...current,
    [dirName]: mkDir(dirName, nextChildren, 'root', true),
  };
};

// Folds every manifest entry into the html-directory subtree. The
// resulting record is the children of /var/www/html — wrapped by
// buildVarWwwHtmlExtraDirs into the var/www/html ancestor chain that
// createFileSystem expects via `extraDirectories`.
const buildHtmlChildren = (pages: readonly TechpartsPage[]): DirChildren =>
  pages.reduce<DirChildren>((acc, page) => {
    const fsPath = fsPathForManifestPath(page.path);
    const relativeSegments = fsPath.slice('/var/www/html/'.length).split('/');
    const fileName = relativeSegments[relativeSegments.length - 1];
    const dirSegments = relativeSegments.slice(0, -1);
    return setFileAtPath(acc, dirSegments, fileName, page.body);
  }, {});

const buildVarWwwHtmlExtraDirs = (pages: readonly TechpartsPage[]): DirChildren => ({
  var: mkDir(
    'var',
    {
      www: mkDir(
        'www',
        {
          html: mkDir('html', buildHtmlChildren(pages), 'root', true),
        },
        'root',
        true,
      ),
    },
    'root',
    true,
  ),
});

export const generateTechpartsNetwork: ThemedGenerator = async (row, ctx) => {
  const publicIp = await ctx.allocateIp('mission_instance');
  const domain = row.public_domain ?? FALLBACK_DOMAIN;

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
    extraDirectories: buildVarWwwHtmlExtraDirs(TECHPARTS_PAGES),
  });

  // Port 80 ships Apache/2.4.49 — Layer-1 hand-authored CVE in
  // src/generation/pools/vulnerabilities.ts (CVE-2024-9001, shell_limited
  // at user tier). All Layer-1 entries have publishedAt=0
  // (vulnerabilityLookup.ts:16), so the site is exploitable from game
  // start — same as every other day-0 machine. The "over time" pressure
  // comes from Layer-2 procedural CVEs against newer versions of a
  // service; this port doesn't lean on that path. The www-data owner is
  // load-bearing: msfconsole.ts:216 rejects ports without an owner even
  // when a CVE template matches, and the shell_limited effect needs a
  // user identity to spawn the shell as.
  // Port 443 ships nginx/1.20.1 — no Layer-1 CVE template at port 443
  // in the catalog; matches findit.io's decorative HTTPS and stays
  // inert (no owner needed — msfconsole bails earlier on "no known
  // vulnerability"). See plans/techparts-network.md (locked decisions).
  const ports: readonly Port[] = [
    {
      port: 80,
      service: 'http',
      serviceVersion: 'Apache/2.4.49',
      open: true,
      owner: {
        username: 'www-data',
        userType: 'user',
        homePath: '/home/www-data',
      },
    },
    { port: 443, service: 'https', serviceVersion: 'nginx/1.20.1', open: true },
  ];

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
      mac: '02:00:00:00:00:02',
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
