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
 *  `/bin/passwd` binary beside `/bin/su`, so each landmark's boxes carry one more file;
 *  and when `cp` and `mv` shipped, which put `/bin/cp` and `/bin/mv` on every box. */
const FINGERPRINTS: Readonly<Record<string, string>> = {
  'ACME-CORP': 'bf6604ea3f9ab8ee7b0fb6ddf329699e',
  'INITECH-5G': '5f9245fd53347411d397464587be63d4',
  'GLOBEX-NET': 'ec1410301b6dedd716074b8074cbb307',
  'WAYSTAR-WIFI': '5b495d30318a89f79fcb7f6b38f63373',
  'DUNDER-LAN': '7669415868193a8b9312e0b853a7ba68',
  'HOOLI-SEC': '4045367b31a507499614cdb492cc3712',
  'UMBRELLA-NET': '8ea6ffc72bb3ccf14cba45e4ad87ef31',
  'STARK-WIFI': 'a3667b6393f1d38ba0c20201cc985d1b',
  'CYBERDYNE-5G': 'b35f7eb1e10d942682ac6583ee2d5e74',
  'OSCORP-GUEST': '4855ca4955361369fce187585b30decb',
  'WEYLAND-NET': '7c2947feea3ddfe091c35b78e8f20264',
  'TYRELL-CORP': 'e4b7a36865f9cf32a4766267a80a4848',
  'APERTURE-WIFI': '66ab8d0068b3c6165e814d6733b58b4f',
  'SHINRA-5G': 'aaa4598e702bb4551d963a3db32ac0d7',
  'ABSTERGO-NET': 'd867959281a68c518601437f7244c689',
  'WONKA-LABS': '97de9875750b8bd1183abd58c6296443',
  'OMNI-CORP': '809f3fccfcd75b7b89059a8aed40aea5',
  'PIED-PIPER': '4acb479129c632b23888f974b5620e4d',
  'VANDELAY-INDUSTRIES': 'ad4a9b1a1b2162acb0c3233f9e376eb2',
  'NAKATOMI-PLAZA': '4638c1b0dcb02eb0faf2d89168885fcd',
  'BREW-AND-CODE': 'c5cc4dd23f9b65b797cb8f8254cf1a53',
  'BEAN-THERE-WIFI': 'bbfacc08148a2c30e13b4ea2bae28914',
  'MIDNIGHT-DINER': '44f41849be2c8c9a311e1acda02cd536',
  'NIGHT-OWL-CAFE': '4caa1dc3f8e36be3a09c70c8ec85c106',
  'GROUND-ZERO-COFFEE': '23a5cf12bfffe36782b036321e97ea42',
  'ESPRESSO-EXPRESS': 'd2c4e6401c36378c5f6344b09190a27b',
  'APT-3B-WIFI': '3cca9c8ed2f19c59d658d2645d4b60d7',
  'UPSTAIRS-NEIGHBOR': '66e7e8211cfc769fd67a3170e3b23ef1',
  'FAMILY-WIFI-2G': '0ff928d2a073803291b0ef55c94c2778',
  'CASA-DE-RAMIREZ': '83a0e3d053981b5ea9888d5695507461',
  'SUITE-401': 'd77f581aa0d7b3babc023e352a41f36f',
  'HOUSE-OF-CARDS': 'cbde658cc87f86e0b990facd87872785',
  'UNIV-DORM-7': '4b74e3a7f049074c17d342a619e266da',
  'CS-DEPT-LAB': '3acd9177ad0f3de2467c072a32721684',
  'GRAD-STUDENT-WIFI': '542ca0d9809a39eda26841fc36a85e92',
  'CAMPUS-GUEST-OPEN': 'a0ad0a1536145c5854682c5dfdfc1403',
  'LIB-2ND-FLOOR': '7b487c15f1ab3323d534f769977921ce',
  'LIBRARY-PATRON': 'c7c12767fbb045d79ee69596a6703fbf',
  'CITY-PARK-WIFI': '989d1f92e32b684588b1c82e7f35c153',
  'METRO-COMMUTER': 'd5c434c592409b1958402425f578362d',
  'AIRPORT-LOUNGE-VIP': 'f765042983c235b5c823ff96271fec2f',
  'TRAIN-STATION-FREE': '2ea4b19191174f6dfaf5f3eeb2da9476',
  'SMART-FRIDGE-NET': '26c7f2339c446396a9660b81aa0da1d8',
  'EV-CHARGER-LOT-3': '4e9af030c20a57fb4f198fc3a349737c',
  'DOORBELL-CAM-OPEN': '8506cc80dcc7a04f804fa98708924b06',
  'ROBOVAC-AP': '68a22ef80b40343b12d5912228ca0ac3',
  'DEFCON-VILLAGE': '0cbf3dc1d4d799c6ce7ca765d498ed90',
  'HACKERSPACE-2600': '7d1686296c2299b75e2edc9d738a93e3',
  'BOFH-KEEPOUT': 'eb8f2ce221392934a68ac67d030ad3c0',
  'NULL-BYTE': 'ce1bdceb8a4f4ec80d4160191a42df79',
  'RIDGEMONT-PD': 'cb27a7599aa107484b88ad214744f260',
  'CITY-HALL-WIFI': '5b0dbd30989b98ca284910ebbc8a8ec6',
  'COURTHOUSE-GUEST': 'f9b55f9cea51cb7912ae3e378759598a',
  'KWIK-E-MART': '55ff77dd66465551f166e3c088a1415e',
  MONSTROMART: 'eabbeef9e869900ea13c9cf562fa0ba2',
  'BUY-N-LARGE': '570da28ec15cf35d783b0db96e800c70',
  'MEGA-LO-MART': '73ba73fc675e9d4234894628bea76cdc',
};

/** Each landmark of a town beyond Ridgemont as it was written, under its key, its wifi
 *  above it. They came after the towns, so they keep their public address too. */
const TOWN_FINGERPRINTS: Readonly<Record<string, string>> = {
  // THE-SLAUGHTERED-LAMB
  'r0/t1/n18': '3070e49e633053f73e105311ee362429',
  // LOCAL-SHOP-LOCAL-PEOPLE
  'r0/t1/n19': 'ae1ba519bcc65e12e09f486b7292cc66',
  // WRONG-TROUSERS
  'r0/t1/n20': 'ec7b52764ddff4476951b773de06bc1e',
  // THE-WOOLPACK
  'r0/t2/n18': '57e558497965337557b46d3c5101a14b',
  // GREENDALE-POST-OFFICE
  'r0/t2/n19': '15e22669ab09e3fc71e8d4dfec788d0a',
  // SKELDALE-HOUSE
  'r0/t2/n20': '34c974ff0122f8bb2b43f7528040bff9',
  // SARIF-INDUSTRIES
  'r0/t3/n47': '3cc969bf226913857c0f86aca8148be1',
  // DOUBLE-R-DINER
  'r0/t3/n48': '825031ff01c85dd6f2ef96da6a2b37cc',
  // NOOKS-CRANNY
  'r0/t3/n49': '2e45b071a9b8a8c799d152e0c7cce7e8',
  // LOG-LADY-CABIN
  'r0/t3/n50': '243c1423c7a557d8206fcb68e9d68c56',
  // JOHNNY-5-AP
  'r0/t3/n51': '6f44ce1b2dc4d2a9ad6ca6b39c264ac7',
  // LUMON-INDUSTRIES
  'r0/t4/n166': 'e2ccb95fc95712a7a6e6b0833aa2afae',
  // E-CORP-GUEST
  'r0/t4/n167': '44d2eb7efe0bffb140abf846a45f4169',
  // ENCOM-NET
  'r0/t4/n168': '28373df568b73438be67ac1882589578',
  // REYNHOLM-INDUSTRIES
  'r0/t4/n169': 'c42e70240d7057f88e53a9385c715b60',
  // CENTRAL-PERK
  'r0/t4/n170': '5491a6ba68d26869c1451387b4e38e2b',
  // LOS-POLLOS-HERMANOS
  'r0/t4/n171': '253b08ae071c673da1a5ce3908ec1187',
  // JOJAMART
  'r0/t4/n172': '1398d10cabcedea963d6d7145498b9b3',
  // 221B-WIFI
  'r0/t4/n173': '7bee6ff27f3ca187b83118a2aab2ba9c',
  // HAL-9000
  'r0/t4/n174': '0c6913d9f6a1f8262e27d160400b6761',
  // FSOCIETY
  'r0/t4/n175': '34288720663a0a2ed20480dd17838dc1',
  // THE-GREEN-MAN
  'r0/t5/n15': '209042342ea1338e87e7acc16cfd03da',
  // LON-LON-RANCH
  'r0/t5/n16': 'b9265cd436ae3d783e8c27015eae9b96',
  // TALKIE-TOASTER
  'r0/t5/n17': 'fc44bb67a974719e40c96e7cf69ec982',
  // FAWLTY-TOWERS
  'r0/t6/n20': '0869340af4cb20e6e91c3b0f25fa58e0',
  // PIERRES-GENERAL-STORE
  'r0/t6/n21': '6b8d940382dc7232f3225b351eec4c91',
  // THE-GIBSON
  'r0/t6/n22': 'cd9505342c0b05f963d1af1c948d41d7',
  // THE-THREE-BROOMSTICKS
  'r0/t7/n17': '3a8992929af520245a0085c7bb48e1aa',
  // JUPITER-MINING
  'r0/t7/n18': 'f1162709bf19838fb2dcad37dcd7821b',
  // THE-BURROW
  'r0/t7/n19': '53db686587ebbd074d92eb7b92478492',
  // THE-HORSE-AND-GROOM
  'r0/t8/n16': '910b2f57da81dc402eda80e5c2391511',
  // BLACK-BOOKS
  'r0/t8/n17': 'b0b5f8ab2a2c464bd1a235d00947003f',
  // DEEP-THOUGHT
  'r0/t8/n18': 'c94adb323046fc8d3b2ac4af6ff7dca5',
  // INGEN-LABS
  'r0/t9/n38': '2f15999ca647486aeb285816430aafdc',
  // LUKES-DINER
  'r0/t9/n39': '36a7886b5d97ae95d24f1f9fd6513047',
  // SCOOPS-AHOY
  'r0/t9/n40': 'f489c228267bdd69614a907e9cd7860e',
  // BAG-END
  'r0/t9/n41': '0589c239aaa899ad86aa419ca47d0483',
  // SETEC-ASTRONOMY
  'r0/t9/n42': '88d7c149f29e2635afb0c7a03ad55475',
  // WERNHAM-HOGG
  'r0/t10/n51': '9c55fb9d91592c6d59a297b304b034f5',
  // THE-WINCHESTER
  'r0/t10/n52': '8dd15fed51e0324da9086c5c80adcddc',
  // TROTTERS-INDEPENDENT-TRADERS
  'r0/t10/n53': '8ce1390c6be417502054e76f59bf3cc2',
  // METEOR-STREET-FLAT
  'r0/t10/n54': '805aba10f05253d4ef480d5bd778600a',
  // THE-LONE-GUNMEN
  'r0/t10/n55': '23615a52b850463852feb5aeb0a512d3',
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
