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
 *  no network holds, and when planted shell histories stopped holding lines the shell
 *  refuses (`tail -f` became `tail -n 50`). */
const FINGERPRINTS: Readonly<Record<string, string>> = {
  'ACME-CORP': '7537e0bc9fbcec48daade65e1d32c60c',
  'INITECH-5G': 'daf50ee31bff1cb67882018e853f7374',
  'GLOBEX-NET': 'c53a84cf2f364d1b0b5b2a751f821f6c',
  'WAYSTAR-WIFI': 'f16afa11a9150f0f01817a1b24b1f0d8',
  'DUNDER-LAN': '55fb4bd00072b92f41eab35b58c62cbc',
  'HOOLI-SEC': '882dd26d9cbcbff0a0a505e88a947bcb',
  'UMBRELLA-NET': '4ef504f2f5065cfd88f1535e638daa8b',
  'STARK-WIFI': 'ef394c20fdc37ada211753e706e9a570',
  'CYBERDYNE-5G': '95abb2bd62260d57660362001377793d',
  'OSCORP-GUEST': '36f055c6e1983c649b920012dcde8f7d',
  'WEYLAND-NET': '102b4a65432cf67650274dc52be27539',
  'TYRELL-CORP': '01f8fb15ad0351a3c2a0b4bf309a5ae4',
  'APERTURE-WIFI': 'b733bcf464e18dfe321ac49f254bdcb1',
  'SHINRA-5G': '83d7fa69a32ad2995a429fed7ae2d76f',
  'ABSTERGO-NET': '38fe46eeefff183154af015b1f1e5f23',
  'WONKA-LABS': '1853bca9cef0b9c514c4809333251310',
  'OMNI-CORP': '6929e0f7de5134534cd1debdd109e3af',
  'PIED-PIPER': 'e6f377f46373bce2bd5efff05a7b55eb',
  'VANDELAY-INDUSTRIES': '382afa411e99c1e8c1598f7cf36e94e8',
  'NAKATOMI-PLAZA': '9e81ea7f68f6eefabd365be21871ac7c',
  'BREW-AND-CODE': '52460a2d1e6da769643e601fadf42dd4',
  'BEAN-THERE-WIFI': '868847f63285829d6971094e4b0c0052',
  'MIDNIGHT-DINER': 'd82099185fc34cae0fb429099d8d1b22',
  'NIGHT-OWL-CAFE': 'c6c56c4f73f035337ec3bd8101de6d72',
  'GROUND-ZERO-COFFEE': '5a9a5f21d724b75c3b75b0ac572d55f0',
  'ESPRESSO-EXPRESS': '65293d12124fe5fd99149049e6c3fa09',
  'APT-3B-WIFI': '5f877e0e7dd616f8e29a634954bee121',
  'UPSTAIRS-NEIGHBOR': 'cca2b7a47038c11977289f152b61925a',
  'FAMILY-WIFI-2G': '81d71985f4c86cb674c2a815ddb86ee8',
  'CASA-DE-RAMIREZ': 'dd5b1f1a8a1c4bb31d7efcb537fe40ad',
  'SUITE-401': 'b42300b8f32ccc1e29c25e4b8098a414',
  'HOUSE-OF-CARDS': '32b062da662c81f9e3cbac6323939af9',
  'UNIV-DORM-7': '850d9b9e6548f727a793d7a3a7d872ca',
  'CS-DEPT-LAB': 'f11b6625ab62a123e499610bcb40beda',
  'GRAD-STUDENT-WIFI': '0218083e511e10401feb60f1b9b8b24a',
  'CAMPUS-GUEST-OPEN': 'c4164a1504446ba4874fc63c709c9224',
  'LIB-2ND-FLOOR': '5cadd47db2e432f63ac9b77d9a88c722',
  'LIBRARY-PATRON': '567fff1c368cc3b2ba8af2f22f0ecdda',
  'CITY-PARK-WIFI': 'a53285cc2e1841447272ad784a519a3a',
  'METRO-COMMUTER': 'e326e114802c78017b90834f57818d4f',
  'AIRPORT-LOUNGE-VIP': 'a47b8edb08d158536804c1698d92b351',
  'TRAIN-STATION-FREE': '69be60c9c8bd2206cfd37cdf703bd109',
  'SMART-FRIDGE-NET': 'd464ea13690dcb383304368062ea9b1e',
  'EV-CHARGER-LOT-3': 'a3258625a59e8fc07b050da72aba09bc',
  'DOORBELL-CAM-OPEN': 'e6b21c5b0ed331104288b81d4224026c',
  'ROBOVAC-AP': 'd510a6b4ea11c429de68c6a12f4a29b6',
  'DEFCON-VILLAGE': 'b40efb484df3bdac8a8770dce48877da',
  'HACKERSPACE-2600': 'a577d8bf296b1fb21ae08eb2968c83d9',
  'BOFH-KEEPOUT': '6a053d670aa6a7812edcb7941755bd60',
  'NULL-BYTE': '771985b9a329a10836e1d06178ad6c9a',
  'RIDGEMONT-PD': '2881f1819f9a685c8120b06e2f372a52',
  'CITY-HALL-WIFI': 'da5ee05429fedd669e2f8a6bc0165f14',
  'COURTHOUSE-GUEST': '4ca715b775fd63a2e9f10c6270c96919',
  'KWIK-E-MART': '9923d088ba094d776a3289eb9101221b',
  MONSTROMART: 'b80d8dc5a30eeda2dc1618949b80ef50',
  'BUY-N-LARGE': 'ec642b967c712a8e6577908145d2ad95',
  'MEGA-LO-MART': 'fb50b1761c20041ec0df3e98c60a9f1b',
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
