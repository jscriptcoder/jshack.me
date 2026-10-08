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
  'ACME-CORP': 'f11db89cc8c1c81ac7e56e01b4b7aef5',
  'INITECH-5G': 'f92f8607668ab22f89a33a7b4531de23',
  'GLOBEX-NET': '712095a158331b304b1a5a6fe55cbd06',
  'WAYSTAR-WIFI': 'eea9d0670fa03a58a1e0e56b087a1257',
  'DUNDER-LAN': '985449a42804eeebb6bc4158b894e15f',
  'HOOLI-SEC': '6768ccc92886d6ded6f58aa46f5918b1',
  'UMBRELLA-NET': '0ad59039ca265a78ea91304661a03e59',
  'STARK-WIFI': 'ef394c20fdc37ada211753e706e9a570',
  'CYBERDYNE-5G': '406b0ac1d992ca7654e845f80b233032',
  'OSCORP-GUEST': '376ec60d5f0b57f6d666cd2a5c2b0a54',
  'WEYLAND-NET': '038abc844a59f57090fa188b20d3e8ab',
  'TYRELL-CORP': '4f4fa073f8b3be984db765e52711313b',
  'APERTURE-WIFI': 'c393c7c987692d8a2538d9050b5084e3',
  'SHINRA-5G': 'fc72d0973202b6b1dfd168cdef011456',
  'ABSTERGO-NET': '6e7fa6ae38178bf767850fc5ac7daee7',
  'WONKA-LABS': '1853bca9cef0b9c514c4809333251310',
  'OMNI-CORP': 'c3aac1d701831cbf4fb3060cb8e14fff',
  'PIED-PIPER': '680c0c3cdb347852cd19d0ee463b7407',
  'VANDELAY-INDUSTRIES': '83ce7842c3b6e9b1feb9f59f8311a5f8',
  'NAKATOMI-PLAZA': '05e0319127adef3823bf400e9b0c6896',
  'BREW-AND-CODE': 'eb68efb5a102407bc53d7923858a216e',
  'BEAN-THERE-WIFI': '1549c1a6edc647be2970c8dbb8517eb9',
  'MIDNIGHT-DINER': '1fccc2b4241b2b9973756c0e0a938231',
  'NIGHT-OWL-CAFE': 'd7f3dd58cdc304343c1d626acb50d9e0',
  'GROUND-ZERO-COFFEE': '5078036c7979b485b2b3080ef3c6d989',
  'ESPRESSO-EXPRESS': '50852965f77afa6dae418abbdef99820',
  'APT-3B-WIFI': '2e0bb39dfbccb301368345b6a5eab5d9',
  'UPSTAIRS-NEIGHBOR': 'cca2b7a47038c11977289f152b61925a',
  'FAMILY-WIFI-2G': '27640e38aa9132c2aa5ad4e724c690b6',
  'CASA-DE-RAMIREZ': '989c8ea255b033fb04143df9d6747b27',
  'SUITE-401': '8332ed245756ba56a4500f043ac43dba',
  'HOUSE-OF-CARDS': 'ad050dcb3cd7ac67d0170d9def73b029',
  'UNIV-DORM-7': 'e717cbdb6739fab970b13526157c522b',
  'CS-DEPT-LAB': 'c9b1fb3b201693cab2a059b1a5e97d41',
  'GRAD-STUDENT-WIFI': 'df86ab55682b1873866834cd6ceb05c9',
  'CAMPUS-GUEST-OPEN': 'c4164a1504446ba4874fc63c709c9224',
  'LIB-2ND-FLOOR': '550c30097fcd02b60c5120544c279b4a',
  'LIBRARY-PATRON': 'f1c37e4f120ffc5b6c083e2b6c3055c8',
  'CITY-PARK-WIFI': 'fb80bcafc390963e779eea82ae180804',
  'METRO-COMMUTER': 'e326e114802c78017b90834f57818d4f',
  'AIRPORT-LOUNGE-VIP': 'b5fb27ebe87a279387b1dbc1399c023a',
  'TRAIN-STATION-FREE': 'a236be1064e18b30c8daab0e46a1d075',
  'SMART-FRIDGE-NET': 'd464ea13690dcb383304368062ea9b1e',
  'EV-CHARGER-LOT-3': 'ebe11291b3f64826b5868a1ee9a2048d',
  'DOORBELL-CAM-OPEN': 'e6b21c5b0ed331104288b81d4224026c',
  'ROBOVAC-AP': 'e7762f37c7e38b462969ab62eaf53c1e',
  'DEFCON-VILLAGE': 'c610340aecbe6b9eadbb6fd84cbb9c58',
  'HACKERSPACE-2600': 'd4b080de58fae9025f7886bb01a34d43',
  'BOFH-KEEPOUT': '6a053d670aa6a7812edcb7941755bd60',
  'NULL-BYTE': '42a03459fb4dfc86ad1c0a801ebfc9b3',
  'RIDGEMONT-PD': '70dc227b427a953b7c3dbbf97c852599',
  'CITY-HALL-WIFI': '3092efff7d1dd5e050d0b0c351945cd1',
  'COURTHOUSE-GUEST': '808b1fd93aefd18771014344742614b4',
  'KWIK-E-MART': 'f21e6c4da3407d12dae9a27e21a3217b',
  MONSTROMART: '4cb692789254b8775b9ffa2beb2873a2',
  'BUY-N-LARGE': '14443d00d73bb2de6e8836397277e89e',
  'MEGA-LO-MART': 'a7b42eb9dd111c014c270461a25321c9',
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
