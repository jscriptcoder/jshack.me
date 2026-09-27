/**
 * findit.io — the search engine the public web is found by.
 *
 * It is a place on the internet and nowhere else: a single machine that owns its public
 * address, with no wifi anybody can join and no LAN behind it. Everything that reaches
 * a network by its public address reaches findit the same way, as a network whose
 * gateway IS the box.
 */

import { createPrng } from './prng';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { daemonName, formatPidfileContent, PIDFILE_PERMISSIONS } from '../services/pidfile';
import { binariesForService } from '../packages/aptPackages';
import {
  createBinaryEntries,
  LOCALHOST_PREINSTALLED_TOOLS,
  SERVICE_CONTROL_TOOLS,
  SYSTEM_DAEMON_NAMES,
  SYSTEM_UTILITY_NAMES,
} from './binaries';
import { createLibraryEntries, SYSTEM_LIBRARIES } from './libraries';
import { withPackageManifest } from '../packages/packageManifest';
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
} from './baseFs';
import { md5 } from './md5';
import { drawPassword } from './passwordPools';
import { ACCESS_LOG_PERMISSIONS } from '../logging/accessLog';
import { AUTH_LOG_PERMISSIONS } from '../logging/authLog';
import { KERN_LOG_PERMISSIONS } from '../logging/kernLog';
import { FINDIT_FRONT_PAGE } from '../findit/page';
import type { Directory, FileEntry } from '../filesystem/types';

// findit's names live in a leaf module so `publisher` can place findit without importing
// this generator, which would close an initialization cycle. Imported for use here and
// re-exported so every importer that reaches for them through the generator keeps working.
import { FINDIT_DOMAIN, FINDIT_HOSTNAME, FINDIT_NETWORK } from './finditNetwork';
export { FINDIT_DOMAIN, FINDIT_HOSTNAME, FINDIT_NETWORK };

/** The chance findit's root password is one a wordlist holds: none. It is a real host
 *  run by people who meant it to stay up, so the way in is the software it runs, when
 *  a hole in that software opens — never a guess. */
const CRACKABLE_ROOT_CHANCE = 0;

/** The two doors findit keeps, on their ordinary ports. */
const SERVICES = [SERVICE_CATALOG.http, SERVICE_CATALOG.ssh] as const;

const configFile = (content: string): FileEntry => file(content, SERVICE_CONFIG_FILE);

/**
 * The machine findit.io runs on, as generated: a web host with one account, the web
 * server that publishes its search and the sshd its operators log in by. Built from
 * the same parts as every generated box, so what a rooted findit holds reads like any
 * other server.
 */
export const buildFinditFs = (): Directory => {
  const prng = createPrng(`host-fs-${FINDIT_NETWORK}`);
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
          hostname: configFile(`${FINDIT_HOSTNAME}\n`),
          hosts: configFile(
            `127.0.0.1\tlocalhost\n127.0.1.1\t${FINDIT_HOSTNAME}.${FINDIT_DOMAIN} ${FINDIT_HOSTNAME}\n`,
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
            { html: dir({ 'index.html': file(FINDIT_FRONT_PAGE, WEB_PAGE_FILE) }, TRAVERSABLE_DIR) },
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
