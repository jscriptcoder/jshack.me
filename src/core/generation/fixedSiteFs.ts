/**
 * The machine a fixed site runs on — findit.io, the search engine the public web is found
 * by, and the others in `fixedSites`.
 *
 * Each is a place on the internet and nowhere else: a single machine that owns its public
 * address, with no wifi anybody can join and no LAN behind it. Everything that reaches
 * a network by its public address reaches a fixed site the same way, as a network whose
 * gateway IS the box.
 */

import { createPrng } from './prng.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { daemonName, formatPidfileContent, PIDFILE_PERMISSIONS } from '../services/pidfile.js';
import { binariesForService } from '../packages/aptPackages.js';
import {
  createBinaryEntries,
  LOCALHOST_PREINSTALLED_TOOLS,
  SERVICE_CONTROL_TOOLS,
  SYSTEM_DAEMON_NAMES,
  SYSTEM_UTILITY_NAMES,
} from './binaries.js';
import { createLibraryEntries, SYSTEM_LIBRARIES } from './libraries.js';
import { withPackageManifest } from '../packages/packageManifest.js';
import {
  bootDir,
  dir,
  file,
  generatePasswd,
  PASSWD_FILE,
  SERVICE_CONFIG_FILE,
  SHELL,
  TMP_DIR,
  TRAVERSABLE_DIR,
  WEB_PAGE_FILE,
  withFiles,
} from './baseFs.js';
import { md5 } from './md5.js';
import { drawPassword } from './passwordPools.js';
import { ACCESS_LOG_PERMISSIONS } from '../logging/accessLog.js';
import { AUTH_LOG_PERMISSIONS } from '../logging/authLog.js';
import { KERN_LOG_PERMISSIONS } from '../logging/kernLog.js';
import { FINDIT_FRONT_PAGE } from '../findit/page.js';
import type { Directory, FileEntry } from '../filesystem/types.js';

import { HACKADEMY_PAGES } from '../hackademy/pages.js';
import { FINDIT_NETWORK, HACKADEMY_NETWORK, type FixedSite } from './fixedSites.js';

/** The chance a fixed site's root password is one a wordlist holds: none. It is a real
 *  host run by people who meant it to stay up, so the way in is the software it runs,
 *  when a hole in that software opens — never a guess. */
const CRACKABLE_ROOT_CHANCE = 0;

/** The two doors a fixed site keeps, on their ordinary ports. */
const SERVICES = [SERVICE_CATALOG.http, SERVICE_CATALOG.ssh] as const;

const configFile = (content: string): FileEntry => file(content, SERVICE_CONFIG_FILE);

/** What each fixed site publishes under its document root, by path from that root —
 *  `scripts/hello.js` lands in a `scripts` directory, as a site's own upload would. */
const WEB_ROOTS: ReadonlyMap<string, Readonly<Record<string, string>>> = new Map([
  [FINDIT_NETWORK, { 'index.html': FINDIT_FRONT_PAGE }],
  [HACKADEMY_NETWORK, HACKADEMY_PAGES],
]);

/**
 * The machine a fixed site runs on, as generated: a web host with one account, the web
 * server that publishes its pages and the sshd its operators log in by. Built from the
 * same parts as every generated box, so what a rooted site holds reads like any other
 * server.
 */
export const buildFixedSiteFs = (site: FixedSite): Directory => {
  const prng = createPrng(`host-fs-${site.key}`);
  const passwd = generatePasswd([
    {
      username: 'root',
      passwordHash: md5(drawPassword(prng, CRACKABLE_ROOT_CHANCE)),
      uid: 0,
      gid: 0,
      gecos: 'root',
      home: '/root',
      shell: SHELL,
    },
  ]);
  const toolchain = SERVICES.flatMap((spec) =>
    binariesForService({ service: spec.service, daemon: daemonName(spec) }),
  );

  const tree = dir(
    {
      bin: dir(createBinaryEntries(SYSTEM_UTILITY_NAMES), TRAVERSABLE_DIR),
      boot: bootDir(),
      etc: dir(
        {
          hostname: configFile(`${site.hostname}\n`),
          hosts: configFile(
            `127.0.0.1\tlocalhost\n127.0.1.1\t${site.hostname}.${site.domain} ${site.hostname}\n`,
          ),
          passwd: file(passwd, PASSWD_FILE),
        },
        TRAVERSABLE_DIR,
      ),
      lib: dir(createLibraryEntries(SYSTEM_LIBRARIES), TRAVERSABLE_DIR),
      root: dir({}, TRAVERSABLE_DIR),
      tmp: dir({}, TMP_DIR),
      usr: dir(
        {
          bin: dir(
            createBinaryEntries([
              ...LOCALHOST_PREINSTALLED_TOOLS,
              ...SERVICE_CONTROL_TOOLS,
              ...toolchain.filter(({ isDaemon }) => !isDaemon).map(({ binary }) => binary),
            ]),
            TRAVERSABLE_DIR,
          ),
          sbin: dir(
            createBinaryEntries([
              ...SYSTEM_DAEMON_NAMES,
              ...toolchain.filter(({ isDaemon }) => isDaemon).map(({ binary }) => binary),
            ]),
            TRAVERSABLE_DIR,
          ),
        },
        TRAVERSABLE_DIR,
      ),
      var: dir(
        {
          log: dir(
            {
              'auth.log': file('', AUTH_LOG_PERMISSIONS),
              'kern.log': file('', KERN_LOG_PERMISSIONS),
              'access.log': file('', ACCESS_LOG_PERMISSIONS),
            },
            TRAVERSABLE_DIR,
          ),
          run: dir(
            Object.fromEntries(
              SERVICES.map((spec) => [
                spec.pidfile,
                file(formatPidfileContent(spec, spec.defaultPort), PIDFILE_PERMISSIONS, spec.runUser),
              ]),
            ),
            TRAVERSABLE_DIR,
          ),
          www: dir(
            {
              html: withFiles(
                dir({}, TRAVERSABLE_DIR),
                Object.entries(WEB_ROOTS.get(site.key) ?? {}).map(([path, page]) => [
                  path,
                  file(page, WEB_PAGE_FILE),
                ]),
              ),
            },
            TRAVERSABLE_DIR,
          ),
        },
        TRAVERSABLE_DIR,
      ),
    },
    TRAVERSABLE_DIR,
  );
  return withPackageManifest(tree);
};
