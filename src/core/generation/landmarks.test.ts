import { describe, expect, it } from 'vitest';
import { DECLARED_NETWORKS, RIDGEMONT } from './world.js';
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

/** Each landmark's fingerprint before the world had towns. */
const FINGERPRINTS: Readonly<Record<string, string>> = {
  'ACME-CORP': '8f0ac9d47110cb653a730b78076f0d31',
  'INITECH-5G': '0317d60ae9e7559b35d9b440fe24b6d5',
  'GLOBEX-NET': 'c4783fc9dbb89d17cd5a7fbcc41bd30f',
  'WAYSTAR-WIFI': 'aaf8da6b452ed46e7d100e65d695e521',
  'DUNDER-LAN': 'd3d0a381f3e6cf0c96d05aff548fa0f8',
  'HOOLI-SEC': '4dfe0d94cddae44a7051741584ed673f',
  'UMBRELLA-NET': '531d69d710d2f5b6a31cbb5d709d4347',
  'STARK-WIFI': '8eb3ab647d82dccf54c0706cf72d273c',
  'CYBERDYNE-5G': '7c1572308ac90b85f43408df17137b8a',
  'OSCORP-GUEST': '7a8c478e3a4cb8791630c3b48646cbcb',
  'WEYLAND-NET': '39bcc39455990aa81693fce97885c0de',
  'TYRELL-CORP': 'a23e1145e5b04779c05d9bbb81c15ebf',
  'APERTURE-WIFI': '416ad810047e43e864e7d29b07f6fbbd',
  'SHINRA-5G': '93413113384f89b75740d7e28f32b561',
  'ABSTERGO-NET': '944cdb9cc0f05c18e683374172cebdc8',
  'WONKA-LABS': 'a4d2f7566629bfb544cc1ebf70e53781',
  'OMNI-CORP': '4d1b195fd91483275a58bec5b8dd7b83',
  'PIED-PIPER': '7da2a679adafc145f71ae81a85163758',
  'VANDELAY-INDUSTRIES': '9c6934caefc5f37a14f1ea3e19ef4747',
  'NAKATOMI-PLAZA': 'd8c0697fae356209f2632d4dca044d60',
  'BREW-AND-CODE': '98b12a62c5e916d720781d602bb365d8',
  'BEAN-THERE-WIFI': '08c594440d0748c1623194810f9cd16e',
  'MIDNIGHT-DINER': 'b0154097b8cf46d4f0a270f3673bc1cc',
  'NIGHT-OWL-CAFE': 'a8236afb2f70051f5681d90061030e70',
  'GROUND-ZERO-COFFEE': 'bcb145ec3e14eef4542c8f82565015fa',
  'ESPRESSO-EXPRESS': 'f84c50e4e892646467637a1d46f071f8',
  'APT-3B-WIFI': '67fdc9522b812f356f7ffe4ce06ca142',
  'UPSTAIRS-NEIGHBOR': '5ac182594883608326525e20502f279c',
  'FAMILY-WIFI-2G': '98abc58e8e7fe5a8d5a089b3e2772417',
  'CASA-DE-RAMIREZ': '6f425e96b959b2073a0cd9aa2771ae59',
  'SUITE-401': 'e4eb8b4016f42c8aa76fd2c7924aa4ea',
  'HOUSE-OF-CARDS': '425df21c6e43fb99a8958a69cc36bc4b',
  'UNIV-DORM-7': 'd5bbb33f366c8292408bfbde2d165f0b',
  'CS-DEPT-LAB': 'ae5ccf4233764e3c9534c0ffef1c919f',
  'GRAD-STUDENT-WIFI': '33d2d139d03e5df28e0402453f4c8c66',
  'CAMPUS-GUEST-OPEN': 'a2d74c3beee194e52222daf33b06a063',
  'LIB-2ND-FLOOR': 'a2dfad880a6f61518d9e088e14f2c790',
  'LIBRARY-PATRON': '170ac0ad48b590113a0da48d37ea285f',
  'CITY-PARK-WIFI': '9d02d1e49d2233eef72ed64505c63f9e',
  'METRO-COMMUTER': '9da42c4f72ed13bec37d088085feddae',
  'AIRPORT-LOUNGE-VIP': '5004a9839557ba79116607eb6a165493',
  'TRAIN-STATION-FREE': '9d2fd469ba843f31908c7fd2cd525fc0',
  'SMART-FRIDGE-NET': '632d314f618c7a3eaf395443f65a2300',
  'EV-CHARGER-LOT-3': 'ffa17aff90c4f3718dc63c776b8f474b',
  'DOORBELL-CAM-OPEN': '724870e26b0d354fb6e05bbc232c18df',
  'ROBOVAC-AP': 'b4d5b74ee2b6385d1722cbdefde897e7',
  'DEFCON-VILLAGE': '52b7f927415f5fe43416b2c3b241d1ff',
  'HACKERSPACE-2600': '5ece49d0a444ed192c33624dc1f136a4',
  'BOFH-KEEPOUT': 'ee3b5166cf022a6e3201ee2873b8a086',
  'NULL-BYTE': 'ad6acb6b573d415f606b2bf6744ddec2',
  'RIDGEMONT-PD': '908f3a5cafce8b6bb45bf423e4abe862',
  'CITY-HALL-WIFI': '627f4b04dc43b825c6fe4dcbae9f1e97',
  'COURTHOUSE-GUEST': '5251993c939618eb1f342ba86f3e83bc',
  'KWIK-E-MART': '2dff3ceb861474aa77525e34c73dc1ee',
  MONSTROMART: '2c93dafbd9295dc96befa9d15bd358c7',
  'BUY-N-LARGE': '23dffef8508656901207c9a560145b82',
  'MEGA-LO-MART': '344d98878d6cb9e0738258db95f4d08c',
};

describe('the landmarks', () => {
  it('each keep everything but their public address from before the world had towns', () => {
    const landmarks = DECLARED_NETWORKS.filter((network) => network.town === RIDGEMONT);

    const fingerprints = Object.fromEntries(
      landmarks.map((network) => [network.key, fingerprint(network.key)]),
    );

    expect(fingerprints).toEqual(FINGERPRINTS);
  });
});
