import { describe, expect, it } from 'vitest';
import { DECLARED_NETWORKS, isLandmark, RIDGEMONT } from './world.js';
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
 *  landmark holds a door that drew from it; and when each kind of place lost one of its
 *  ordinary mail threads to keep the bundle under its ceiling, since a landmark's
 *  mailboxes are written from them. */
const FINGERPRINTS: Readonly<Record<string, string>> = {
  'ACME-CORP': '96fe6bf75e9b8dd4d432cb6aa98d6374',
  'INITECH-5G': '61b8cd448dbe0dee034ad0c4da9974d0',
  'GLOBEX-NET': 'bcab2cc01f90e496adbb8aa7b943ca04',
  'WAYSTAR-WIFI': 'dab0f66cdf40a98b2ec275bfa9c5b325',
  'DUNDER-LAN': '24df221ddf937bc3c9fc6371fb5e294a',
  'HOOLI-SEC': 'fff28cb197ef2655c8b4c2dbef102fb4',
  'UMBRELLA-NET': 'd65ea867bd7236ab81ad70aa37356c33',
  'STARK-WIFI': '45a9503a87c77496dda671381392e63f',
  'CYBERDYNE-5G': 'a28a4cae0072a90521a17ec1e471e82e',
  'OSCORP-GUEST': '7fa4fd411b07916f45f5e5ffc2be4064',
  'WEYLAND-NET': 'ca57333b047e4c636c510ff2f9c3eb7f',
  'TYRELL-CORP': 'b0048643f94e1fa25c9c55c82e453fca',
  'APERTURE-WIFI': '3697cb486b1d0c4fda975e7c3823d374',
  'SHINRA-5G': '75b61d79895eddd7242f99632151033a',
  'ABSTERGO-NET': 'ee13286b3f6798d499547cbbf0544c1d',
  'WONKA-LABS': '2ff71bd7380360acd39bb7fa33c470fe',
  'OMNI-CORP': 'e25a2753970abcc0a5278324fe80375e',
  'PIED-PIPER': 'b46224baf59ea9e7a589aa40c0cba324',
  'VANDELAY-INDUSTRIES': '37a246b1687320a78055061733fed383',
  'NAKATOMI-PLAZA': 'b2b331ce4fa717d9670251e3c2d9d6b5',
  'BREW-AND-CODE': '6bbd07c77fef886d8301f3672b0ae5ce',
  'BEAN-THERE-WIFI': '72e106cdbc46a678fe08f4cbc1b35225',
  'MIDNIGHT-DINER': 'f7cfa6a1346308bb07c84aba8c13e828',
  'NIGHT-OWL-CAFE': 'e5b45ba28c8b3226e72cf56a44c46a43',
  'GROUND-ZERO-COFFEE': '8c11cc2797718a86b6f47cd18ab75b38',
  'ESPRESSO-EXPRESS': '70b91affee4a7ac6ee9387a17b4bc510',
  'APT-3B-WIFI': '86272b8e26285e66900fb2fd7aca1850',
  'UPSTAIRS-NEIGHBOR': 'b1912a14d7ad1763b2218df61cd20414',
  'FAMILY-WIFI-2G': 'f62b96035cbfd8b134f6758b20c4f53a',
  'CASA-DE-RAMIREZ': '0a398a6597bdbf2e324aeede38d7e563',
  'SUITE-401': '3a19c2d251316c8f9400dfa322f49ffd',
  'HOUSE-OF-CARDS': 'cbd2f9578ceef24dc1574fe29bee4443',
  'UNIV-DORM-7': '957caa4b5fe593adc4381581ee16a6c2',
  'CS-DEPT-LAB': '5b0e6dfc4c9f944c63ace994bb28bfb6',
  'GRAD-STUDENT-WIFI': '594be7a5daebd9112c46e4864acdee60',
  'CAMPUS-GUEST-OPEN': '4d05e5e81267353a0f293ea060e12535',
  'LIB-2ND-FLOOR': 'bba606a4ee5eb8e12518d6f14a9a039b',
  'LIBRARY-PATRON': '28d1b53855c7a57818bb2511846f1744',
  'CITY-PARK-WIFI': '0a48b3e74f01c7dd554fc3e8dedd8f60',
  'METRO-COMMUTER': '1fd469f28ee8e37613ea47af7ee31aa0',
  'AIRPORT-LOUNGE-VIP': '1ba5eeb8382c69382c3330cd61afd0a1',
  'TRAIN-STATION-FREE': '27d47862c5a9d6b3aa1a52aabf3ff6fd',
  'SMART-FRIDGE-NET': '5710adbedeb46a1f838c0b00fca57384',
  'EV-CHARGER-LOT-3': '0e28e7060dcd57ed131b0c543355364f',
  'DOORBELL-CAM-OPEN': 'c14726ca9e0d6a87a28a2c3f6553d430',
  'ROBOVAC-AP': '83bde3f3e23ad83487bbb8c25c15f285',
  'DEFCON-VILLAGE': 'd068f22e7f2e1186a5693bcaa689c4b3',
  'HACKERSPACE-2600': '8b5cc499c8c427122e5263a0e0ab8f66',
  'BOFH-KEEPOUT': '552c29b1b53e9cdada499ef012843bb0',
  'NULL-BYTE': '1b45b1d8fbc2cf4884940af10c279b3f',
  'RIDGEMONT-PD': '37ce7c2eade7494b6272195dd18c121e',
  'CITY-HALL-WIFI': 'c928ad7c60cb68a077c1fcd3d51b5bcf',
  'COURTHOUSE-GUEST': '132ee47eae01ab14d82e662ba83055b1',
  'KWIK-E-MART': '1ed0ad8a01ab9d6e31004ad92ce950eb',
  MONSTROMART: '3a6ddbc5e5576b2458f8a377ffe9613a',
  'BUY-N-LARGE': 'bf11aba57f9a8a680eea8efb8e2ba11a',
  'MEGA-LO-MART': 'a45b52aa846357a00c7c5d44b7b93c0b',
};

describe('the landmarks', () => {
  it('each keep everything but their public address from before the world had towns', () => {
    const landmarks = DECLARED_NETWORKS.filter(
      (network) => isLandmark(network.key) && network.town === RIDGEMONT,
    );

    const fingerprints = Object.fromEntries(
      landmarks.map((network) => [network.key, fingerprint(network.key)]),
    );

    expect(fingerprints).toEqual(FINGERPRINTS);
  });
});
