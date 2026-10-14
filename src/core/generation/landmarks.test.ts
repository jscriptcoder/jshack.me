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

/** Each landmark's fingerprint before the world had towns, moved twice on purpose: when a
 *  workstation's ssh shortcut and a gateway's example forward stopped naming addresses
 *  no network holds, when planted shell histories stopped holding lines the shell
 *  refuses (`tail -f` became `tail -n 50`), and when a generated host that serves the web
 *  began running apache2 half the time (a host running nginx is byte-for-byte what it
 *  was). */
const FINGERPRINTS: Readonly<Record<string, string>> = {
  'ACME-CORP': '4fdcebdafdfb32c502deaf77ec3b4814',
  'INITECH-5G': '9e2fdefcd63a5a53ca6985371ec3d70e',
  'GLOBEX-NET': '8ccf1e31a6cb8c2c4d9c3ed708662797',
  'WAYSTAR-WIFI': '313a74236cb7df594ac4ff5913cd6632',
  'DUNDER-LAN': '1bb2fdcc47cfa3b965010fbd52c0c84c',
  'HOOLI-SEC': '1dbb6eb972cb14b61a232d5578d02b64',
  'UMBRELLA-NET': 'd84ed7e91f40529cd2719fabdc401535',
  'STARK-WIFI': '03287ede51fa7ce10a8a7a2ad070bfc1',
  'CYBERDYNE-5G': '309a06cceb1ebae0900fc8f6d1dab6d4',
  'OSCORP-GUEST': '5d50c720138cc8cf1b2a3f29c1e04bea',
  'WEYLAND-NET': 'a69e45577112811a72b92b92a42f230a',
  'TYRELL-CORP': '3e2d50ef94013a38480174fe7b7ac891',
  'APERTURE-WIFI': '42a7cb89b94ab2a3d117d11530446afe',
  'SHINRA-5G': '531b935f54b223bb4913a7f44335ce4f',
  'ABSTERGO-NET': '3f9db14353f8b9798b911c0ba24c6325',
  'WONKA-LABS': '2050ccf3d55e21f8599804be774d4942',
  'OMNI-CORP': '197b1f06d9b61eb53a1f339212f57799',
  'PIED-PIPER': '52a1cc6283cb319f5cece1c090f7485b',
  'VANDELAY-INDUSTRIES': 'e0e6030ebaa7fa88b91b63e1bcddb454',
  'NAKATOMI-PLAZA': '62ee42ce51e7f19a1543df622cd1c121',
  'BREW-AND-CODE': 'ba991e71f0fe33d9b586a49d2a337e30',
  'BEAN-THERE-WIFI': '94c9df4f92d893327640bbfec927c43a',
  'MIDNIGHT-DINER': '09167f3676e36b57e779c3e6956b0724',
  'NIGHT-OWL-CAFE': '42a38ef8aeb79783f7078c5d4647d76b',
  'GROUND-ZERO-COFFEE': '04cfbb7745be3b3aca27bd06009cdd9c',
  'ESPRESSO-EXPRESS': 'e2c475ef28f71195629f5331de905344',
  'APT-3B-WIFI': 'f160cb88fec854cc5ab1f23f84f66af7',
  'UPSTAIRS-NEIGHBOR': 'a471d2d3ec01135ed876b3c0dd01492e',
  'FAMILY-WIFI-2G': '194b0a5fe39a564722e7990c6e481f87',
  'CASA-DE-RAMIREZ': 'a11fcf1d77e076687395235801231181',
  'SUITE-401': 'e77473d216342047acb5b22ebd03c26c',
  'HOUSE-OF-CARDS': '03be4083b60f112f36df2085ac6893e9',
  'UNIV-DORM-7': '2deadd104b5352b2ba7005d2137e16a0',
  'CS-DEPT-LAB': 'bdbe9f61f6094d3efba3126d0a36ba52',
  'GRAD-STUDENT-WIFI': '6d3cfdeb1d8e7948dc8be6d83fa5bf7e',
  'CAMPUS-GUEST-OPEN': '80af5d38bc01307ada3497c2b125fa59',
  'LIB-2ND-FLOOR': 'f5874610d595fb736c4089ef46f15f37',
  'LIBRARY-PATRON': '6c28815c0f7e47f5e83c3bb3aeb1d3a7',
  'CITY-PARK-WIFI': 'ac9a92bd76bf36fbfe08954511b4d538',
  'METRO-COMMUTER': '94fa576e4d336e48c267b05afcb68c18',
  'AIRPORT-LOUNGE-VIP': '014eb759302c3d394b4c636dd8e053ca',
  'TRAIN-STATION-FREE': 'e892d6bd66987f12a85c5d9abd882a4f',
  'SMART-FRIDGE-NET': '8321b27245f3faee1a7565470c5ccd92',
  'EV-CHARGER-LOT-3': '4f6aa81ecbee5d420e2f575fd7c45a9e',
  'DOORBELL-CAM-OPEN': 'e8b09420b7807602d7df5f38a673760e',
  'ROBOVAC-AP': '9b2530024cda9bfdaabcdc02704cdc0e',
  'DEFCON-VILLAGE': '8ecd302f687091cb22fb7d6575acc39b',
  'HACKERSPACE-2600': '6c28b1f75ef85f2916089d97d85c2d89',
  'BOFH-KEEPOUT': 'c9734ac2d36ab376bd0fddca7c61514d',
  'NULL-BYTE': '839104dd880703c133daed9075d67a34',
  'RIDGEMONT-PD': '85032fc1b5f89fa5a88181145f53070b',
  'CITY-HALL-WIFI': '4716f29f96903ddcf7f14f302b14e241',
  'COURTHOUSE-GUEST': '719089079e5300b6359561e43f5aa378',
  'KWIK-E-MART': '698191a42803487fd5ef15cd3cdd471f',
  MONSTROMART: '5f8ea44bf3afe6a2988b66139aef4346',
  'BUY-N-LARGE': '495fed32d50bd4e1184c90b3742e7a64',
  'MEGA-LO-MART': 'd43dd40c566b5f262536732d553edfa3',
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
