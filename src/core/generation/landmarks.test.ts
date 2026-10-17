import { describe, expect, it } from 'vitest';
import { DECLARED_NETWORKS, isLandmark } from './world.js';
import { generateHomeLan } from './generateHomeLan.js';
import { resolveLanHostIdentity } from './lanHostIdentity.js';
import { buildApGatewayBaseFs } from './routerFs.js';
import { createPrng } from './prng.js';
import { md5 } from './md5.js';
import { lanZoneName } from '../network/resolveName.js';
import { createFsView } from '../filesystem/fsView.js';
import { walkTree } from '../filesystem/walkTree.js';
import { secrets } from '../secrets/__encoded.js';
import { asAbsPath } from '../types.js';
import type { Directory } from '../filesystem/types.js';

/**
 * Ridgemont's networks are hand-authored landmarks, and the procedural world is built
 * beside them, never over them. Every landmark keeps the LAN, WiFi password and files it
 * had before the world had towns: only its public address moved, once, when
 * addresses began to be derived from a network's place in the world.
 *
 * The generators the landmarks come from are the same ones every procedural network
 * draws on, so a change meant for the new towns can reach a landmark without anybody
 * noticing. Each landmark is pinned here by one fingerprint of everything it is except
 * its public address. A fingerprint that moves names the landmark that changed; if the
 * change is meant, the new value is copied in deliberately.
 */

const WIFI_PASSWORDS = JSON.parse(secrets.WIFI_PASSWORDS) as readonly string[];

/** Every file under `tree`, by path, as root reads it. */
const filesOf = (tree: Directory): string =>
  JSON.stringify(
    walkTree(createFsView(tree, { userType: 'root' }), asAbsPath('/'), (path, node) =>
      node.kind === 'file' ? [[path, node.content] as const] : [],
    ),
  );

/** Everything a landmark is except its public address: its `.lan` zone, its WiFi
 *  password, its gateway's files and every LAN box's address, name and files, the site
 *  server's pages among them. Its persona is not itself here: it matters only through
 *  what the boxes are written from, and those are. */
const fingerprint = (key: string): string => {
  const boxes = generateHomeLan(key).hosts.map(
    (host) => `${host.ip}/${host.hostname}:${filesOf(resolveLanHostIdentity(host, key).baseFs)}`,
  );
  return md5(
    [
      lanZoneName(key),
      createPrng(`wifi-pw-${key}`).pick(WIFI_PASSWORDS),
      filesOf(buildApGatewayBaseFs(key)),
      ...boxes,
    ].join('\n'),
  );
};

/** Each landmark's fingerprint before the world had towns, moved on purpose: when a
 *  workstation's ssh shortcut and a gateway's example forward stopped naming addresses
 *  no network holds, when planted shell histories stopped holding lines the shell
 *  refuses (`tail -f` became `tail -n 50`), when a generated host that serves the web
 *  began running apache2 half the time (a host running nginx is byte-for-byte what it
 *  was), and whenever the uncrackable pool in `JSHACK_SECRETS` changes, since every
 *  landmark holds a door that drew from it. */
const FINGERPRINTS: Readonly<Record<string, string>> = {
  'ACME-CORP': '96fe6bf75e9b8dd4d432cb6aa98d6374',
  'INITECH-5G': '61b8cd448dbe0dee034ad0c4da9974d0',
  'GLOBEX-NET': 'e437b7eb68977e070dfeaaaf91717021',
  'WAYSTAR-WIFI': '294eb38bd764c5aea95adfdce0fbf39d',
  'DUNDER-LAN': '24df221ddf937bc3c9fc6371fb5e294a',
  'HOOLI-SEC': '666e086c66aff2c17d88843f3d302143',
  'UMBRELLA-NET': 'e072b0fb17d12c8b89f8953029b19810',
  'STARK-WIFI': '45a9503a87c77496dda671381392e63f',
  'CYBERDYNE-5G': 'a28a4cae0072a90521a17ec1e471e82e',
  'OSCORP-GUEST': 'c90f0146f493d1b6c9c5a594b12e65b1',
  'WEYLAND-NET': 'e0b32708037f42cb8ec8996500d2cf8e',
  'TYRELL-CORP': 'd81c164cfc135f6c1f20ede08cec2152',
  'APERTURE-WIFI': 'e02ed02e08cb88f162345fcb89900a96',
  'SHINRA-5G': '1ed8a586062b3e70e1cb098937e2a477',
  'ABSTERGO-NET': 'ee13286b3f6798d499547cbbf0544c1d',
  'WONKA-LABS': 'eabbce4e9ae04b1d3ec541aa4af4a2b5',
  'OMNI-CORP': 'e25a2753970abcc0a5278324fe80375e',
  'PIED-PIPER': '5e0994597f95963361917b95a57e4825',
  'VANDELAY-INDUSTRIES': 'c49eee1564d044eb8a8047d0a1110797',
  'NAKATOMI-PLAZA': 'bf85f8a612538a55c4cd3d9a0de80b32',
  'BREW-AND-CODE': '6bbd07c77fef886d8301f3672b0ae5ce',
  'BEAN-THERE-WIFI': '2bc2b99266868eee037cbf98bfcebb11',
  'MIDNIGHT-DINER': 'ff7760c17db32dd8a2fde8dcb2aaed71',
  'NIGHT-OWL-CAFE': 'e5b45ba28c8b3226e72cf56a44c46a43',
  'GROUND-ZERO-COFFEE': '58133720caa35a2d9d6dd2a833af56f6',
  'ESPRESSO-EXPRESS': '504a469003d4d80253509c10e9e9155d',
  'APT-3B-WIFI': '86272b8e26285e66900fb2fd7aca1850',
  'UPSTAIRS-NEIGHBOR': '937a9278e912b7b3d9ca52a7a5385522',
  'FAMILY-WIFI-2G': 'f62b96035cbfd8b134f6758b20c4f53a',
  'CASA-DE-RAMIREZ': '0a398a6597bdbf2e324aeede38d7e563',
  'SUITE-401': '48166417904b8071b10143eb84331ede',
  'HOUSE-OF-CARDS': 'f38c21af8a54a59d12d6acb3686786ba',
  'UNIV-DORM-7': 'fc80ecc6467f8485470616946a35a5e0',
  'CS-DEPT-LAB': 'aa01309cdf9376fb851b730086c182a8',
  'GRAD-STUDENT-WIFI': '911b21e594493cad3096f032245968aa',
  'CAMPUS-GUEST-OPEN': '1fd98fed3043562115a5cb69d46312a2',
  'LIB-2ND-FLOOR': '5d3d08ac8c3211b7229945b2a3a82ddd',
  'LIBRARY-PATRON': '96f16144e3a611891c11f5bef11c2299',
  'CITY-PARK-WIFI': '527d5f8b40bd4933a38d68a4e5ad6d85',
  'METRO-COMMUTER': 'ee4923813096d90fc2648f44cad8bf79',
  'AIRPORT-LOUNGE-VIP': '370da1ba1bf40ac1fd246b1d05a8bfbb',
  'TRAIN-STATION-FREE': '27d47862c5a9d6b3aa1a52aabf3ff6fd',
  'SMART-FRIDGE-NET': '5710adbedeb46a1f838c0b00fca57384',
  'EV-CHARGER-LOT-3': '0e28e7060dcd57ed131b0c543355364f',
  'DOORBELL-CAM-OPEN': 'c14726ca9e0d6a87a28a2c3f6553d430',
  'ROBOVAC-AP': '83bde3f3e23ad83487bbb8c25c15f285',
  'DEFCON-VILLAGE': '067365a1e4bf8fe85ad36ae3909c970c',
  'HACKERSPACE-2600': '9775290ab83ee2acd8a991043170e5b1',
  'BOFH-KEEPOUT': '27dcb4a796f5a43b63411fb4b2c27db2',
  'NULL-BYTE': '712d7f323fc84ad85d09691ac61ac743',
  'RIDGEMONT-PD': '2ff27c30f91fa47f6d87d424af5a8b0f',
  'CITY-HALL-WIFI': 'c928ad7c60cb68a077c1fcd3d51b5bcf',
  'COURTHOUSE-GUEST': '376a0d2069bc898b78ef24b44195d7d9',
  'KWIK-E-MART': '5afcbc8a28629ddb25d1db94a2029600',
  MONSTROMART: '581212024d6fa4fa06ebebd7c49736bf',
  'BUY-N-LARGE': 'a3baecbcef973f8539cedcdb1963a899',
  'MEGA-LO-MART': '76db6b74bbea1acc9895ca9f7a3524f0',
};

describe('the landmarks', () => {
  it('each keep everything but their public address from before the world had towns', () => {
    const landmarks = DECLARED_NETWORKS.filter((network) => isLandmark(network.key));

    const fingerprints = Object.fromEntries(
      landmarks.map((network) => [network.key, fingerprint(network.key)]),
    );

    expect(fingerprints).toEqual(FINGERPRINTS);
  });
});
