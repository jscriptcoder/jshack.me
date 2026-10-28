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
 *  mailboxes are written from them; and when `passwd` shipped and every box gained a
 *  `/bin/passwd` binary beside `/bin/su`, so each landmark's boxes carry one more file. */
const FINGERPRINTS: Readonly<Record<string, string>> = {
  'ACME-CORP': 'cc270a04cacbd03afc7f06ae36d35191',
  'INITECH-5G': '2a45b2b551e015b5ac6ee8bbab2ae65a',
  'GLOBEX-NET': '2015330056e65580b0f8129f23213183',
  'WAYSTAR-WIFI': '3d44eff2df179d56584ccffc7f9e81b4',
  'DUNDER-LAN': 'c61c61ebb251f26432b628d0854fb325',
  'HOOLI-SEC': '1a0e76b23de556ebbdbf769d802627bd',
  'UMBRELLA-NET': '539807eb5524a63958bbb82babbaab12',
  'STARK-WIFI': '03d0cf98dab7809c765c99047fd93ca1',
  'CYBERDYNE-5G': '845b3b893e9b2d70d9429bb668ee6f44',
  'OSCORP-GUEST': 'b293aee9b07d2a28beb0bdf0f1a1546f',
  'WEYLAND-NET': '373c4eef6df567161fbaa3301288e61e',
  'TYRELL-CORP': '7a70e0eee0bc054b0da0d4f7fbc043e3',
  'APERTURE-WIFI': 'ea7283ddcf7e45fd78d4870df7d5a1fa',
  'SHINRA-5G': 'e4f06650bb05253dbcf067f569c57e22',
  'ABSTERGO-NET': '426ed89efe486e97bdff799cfac154a5',
  'WONKA-LABS': 'fcf14ec6fc1e3f6f7cad6a85c2d544cc',
  'OMNI-CORP': '7e7056b9c50ffb9cb41f87cc8c1e850f',
  'PIED-PIPER': '9eaa502f1ca520eeace504de3f07c26d',
  'VANDELAY-INDUSTRIES': '3edfef8eb2b0e965fc183fc20027a00f',
  'NAKATOMI-PLAZA': 'd5834f50c296f8cdd62dab09cd6b192c',
  'BREW-AND-CODE': 'a6c4fc049dade2575e7c373558498f96',
  'BEAN-THERE-WIFI': 'e36e65b0d76f5284586c5a893dbf89cf',
  'MIDNIGHT-DINER': '7f16c727adbdf2306237a5fcfeaaa121',
  'NIGHT-OWL-CAFE': '43d164e31679d94756aca95411fb3b2b',
  'GROUND-ZERO-COFFEE': 'ac4f009fe3251aa599d6d69a0b8426f3',
  'ESPRESSO-EXPRESS': 'f68183dc8cbd71d3230d347379567a0d',
  'APT-3B-WIFI': 'ec873eb7947bed7d5ce87a095a6bed7e',
  'UPSTAIRS-NEIGHBOR': '605cdd70ee680f1d4ce3e7358d2cb860',
  'FAMILY-WIFI-2G': '721e0991d1e677b76c63c0d867d6053b',
  'CASA-DE-RAMIREZ': '2bce1e3c0f56e2bba6ddfed592fdda5e',
  'SUITE-401': 'ce0a01a913b0693066680b5bc785b58f',
  'HOUSE-OF-CARDS': 'da564f5dd3b556781fa6eabe021cc824',
  'UNIV-DORM-7': 'b7b1067c2ffc35b921336f1b2bfceab6',
  'CS-DEPT-LAB': '4da961671f6474be73b98b332b5fbc73',
  'GRAD-STUDENT-WIFI': '3e982233c0be6e2e60ea1d4dbe015b37',
  'CAMPUS-GUEST-OPEN': 'b29cef920e323280fda7f99b0b4d1c10',
  'LIB-2ND-FLOOR': '202e39b20adbb8326f778055432f01a3',
  'LIBRARY-PATRON': '476605d62e056492a4f814ddc7a9bec1',
  'CITY-PARK-WIFI': '2353ec261c5a2881cac8bc01e241f7a0',
  'METRO-COMMUTER': '27f1d3405d3a40691fa76879c64ad717',
  'AIRPORT-LOUNGE-VIP': '82065043be99ba11d6b86fa05c110277',
  'TRAIN-STATION-FREE': '5392d1d04d278b598d1635ad95956cc5',
  'SMART-FRIDGE-NET': '477c12153b4e022471324d0b4022077f',
  'EV-CHARGER-LOT-3': '078a8ade7bcd256d080e077c6cd1d313',
  'DOORBELL-CAM-OPEN': '055cd5e834e02141d7e46d7c7fc765cd',
  'ROBOVAC-AP': '692eaebd8778578dc4c6e3746d4bd56f',
  'DEFCON-VILLAGE': '2d9f76ec5ab0be5db04735bcd3064a66',
  'HACKERSPACE-2600': 'd2d24ae06d2ad7e2fb922f8d3f91e8f4',
  'BOFH-KEEPOUT': '38cb44ea41f4d2f2a6cff25cf9d381ed',
  'NULL-BYTE': 'ae84c0c7236ca9c363fe7500a13788a9',
  'RIDGEMONT-PD': 'f61b89d223d8799fc3205f03b6a16f18',
  'CITY-HALL-WIFI': '87685c6460b04ff6e0ffc6c0acfe4ef6',
  'COURTHOUSE-GUEST': '8ad7502b60adba24a2409e7e7e8b9a6b',
  'KWIK-E-MART': 'c7faca2bbb2adfd4d02746a1448f56f5',
  MONSTROMART: 'cf7b91598caa2b508dc175617270d435',
  'BUY-N-LARGE': '8f7a712dae006c862927ac4e774c35f9',
  'MEGA-LO-MART': 'a3dac5442c296105f81d5f533177f3db',
};

/** Each landmark of a town beyond Ridgemont as it was written, under its key, its wifi
 *  above it. They came after the towns, so they keep their public address too. */
const TOWN_FINGERPRINTS: Readonly<Record<string, string>> = {
  // THE-SLAUGHTERED-LAMB
  'r0/t1/n18': '33092aad85f06e47eb5e46e14743b378',
  // LOCAL-SHOP-LOCAL-PEOPLE
  'r0/t1/n19': 'f312a9e0d1882630791afb1f0f90e74d',
  // WRONG-TROUSERS
  'r0/t1/n20': '34569346d8eca0b766e49394a5d63e3c',
  // THE-WOOLPACK
  'r0/t2/n18': '0233cb44c0ac6b8f621c329260f40738',
  // GREENDALE-POST-OFFICE
  'r0/t2/n19': 'f27f1cff517603614a2be24cd4e79266',
  // SKELDALE-HOUSE
  'r0/t2/n20': 'c9922f5e953215ff4e0e56bb8e8f9c84',
  // SARIF-INDUSTRIES
  'r0/t3/n47': 'a860e2810e7d4e26659d58588e322d62',
  // DOUBLE-R-DINER
  'r0/t3/n48': 'd6655cc19c4f951b32ef8f47cb691f61',
  // NOOKS-CRANNY
  'r0/t3/n49': 'a5288850cf2df9594627d6cf02ad165e',
  // LOG-LADY-CABIN
  'r0/t3/n50': '600408b4d0d315c714c0faf333ebbdd1',
  // JOHNNY-5-AP
  'r0/t3/n51': 'd1a272b185b0c262d01d1546f91c12b1',
  // LUMON-INDUSTRIES
  'r0/t4/n166': 'a54615f46a22a812784b1da816270c4d',
  // E-CORP-GUEST
  'r0/t4/n167': 'd6203bcc7439debc08adbb131bb61696',
  // ENCOM-NET
  'r0/t4/n168': 'dbfae67b3efa974a537fc117f741e448',
  // REYNHOLM-INDUSTRIES
  'r0/t4/n169': '568c98caebf7bbf3ab1a8612463a4ad4',
  // CENTRAL-PERK
  'r0/t4/n170': 'bb9eeb9a588f112b8ee56650d29af16a',
  // LOS-POLLOS-HERMANOS
  'r0/t4/n171': '1f100de282c974e0befbe8d75a576cfc',
  // JOJAMART
  'r0/t4/n172': '5b10d8716e938f6baf2c72c89eec19ca',
  // 221B-WIFI
  'r0/t4/n173': 'cf7ac432062c8ee72f07de39925a9643',
  // HAL-9000
  'r0/t4/n174': '396d45664c07608d1c2bd10fc7bf68b3',
  // FSOCIETY
  'r0/t4/n175': '97d1b63b500626657f78a46ee0a07879',
  // THE-GREEN-MAN
  'r0/t5/n15': '0689e0e2098872faaf1824cf67dc591d',
  // LON-LON-RANCH
  'r0/t5/n16': '3da1f537477f91cb60839ae0ac493567',
  // TALKIE-TOASTER
  'r0/t5/n17': 'a81792bfc00c9db6380e97d284138c80',
  // FAWLTY-TOWERS
  'r0/t6/n20': 'acbd410d422f6407801647aba4f4c0a2',
  // PIERRES-GENERAL-STORE
  'r0/t6/n21': '125f2d8af679db328978df3430970e3e',
  // THE-GIBSON
  'r0/t6/n22': '5bd3cfbe80cfe7386fc7abece65b1070',
  // THE-THREE-BROOMSTICKS
  'r0/t7/n17': 'dbfaddb6fb1c04f8fd38107f1e6b5968',
  // JUPITER-MINING
  'r0/t7/n18': 'c7df55b6e9989bbd7d0cc7c454784b4c',
  // THE-BURROW
  'r0/t7/n19': 'd1fa964a97aa0f78e56f971a192930ce',
  // THE-HORSE-AND-GROOM
  'r0/t8/n16': 'c1a70112f154fff5f9bf66732e091242',
  // BLACK-BOOKS
  'r0/t8/n17': '00ea3d99c1208ca6fae873b605df57df',
  // DEEP-THOUGHT
  'r0/t8/n18': '3f0cbe721538926b03270db64ecba847',
  // INGEN-LABS
  'r0/t9/n38': 'e930e165ba8ed4387bd0231bc16d67c0',
  // LUKES-DINER
  'r0/t9/n39': 'dbcca60e36074df6d08ea94cd81f4b87',
  // SCOOPS-AHOY
  'r0/t9/n40': '2d440e078293d05a46f74259bb8d6cf1',
  // BAG-END
  'r0/t9/n41': '41f443f13857acf386afdd38a058ca57',
  // SETEC-ASTRONOMY
  'r0/t9/n42': 'f3625cd7576f80683282deaabf38cc7a',
  // WERNHAM-HOGG
  'r0/t10/n51': '51f7aadefb5f484eaef33639826859a5',
  // THE-WINCHESTER
  'r0/t10/n52': '0e7b9623b7ec444b968fe40695a6a59f',
  // TROTTERS-INDEPENDENT-TRADERS
  'r0/t10/n53': '4350b9cec86120083b7d21fa50a377e2',
  // METEOR-STREET-FLAT
  'r0/t10/n54': '6f6b95ba8e3890fdf0524a635d2c3573',
  // THE-LONE-GUNMEN
  'r0/t10/n55': '2cf7f79e65772167e7c4e7cbb47fa5de',
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

  it('of every other town each keep everything they were written with', () => {
    const landmarks = DECLARED_NETWORKS.filter(
      (network) => isLandmark(network.key) && network.town !== RIDGEMONT,
    );

    const fingerprints = Object.fromEntries(
      landmarks.map((network) => [network.key, fingerprint(network.key)]),
    );

    expect(fingerprints).toEqual(TOWN_FINGERPRINTS);
  });
});
