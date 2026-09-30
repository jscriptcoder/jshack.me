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

/** Each landmark's fingerprint before the world had towns, moved once on purpose: when a
 *  workstation's ssh shortcut and a gateway's example forward stopped naming addresses
 *  no network holds. */
const FINGERPRINTS: Readonly<Record<string, string>> = {
  'ACME-CORP': '30ea4a2ffa91187718d8e0d19ef5bc1d',
  'INITECH-5G': 'b009625af5a29ee3c05722e9a0dfc97d',
  'GLOBEX-NET': '2a51230f219a85d7f872523c9ea163e5',
  'WAYSTAR-WIFI': '7a69874bff900f263e699f71ad03f02e',
  'DUNDER-LAN': 'abe84421c9960fd0cee5681920816de3',
  'HOOLI-SEC': 'c81b2dd821fa144411365365ad3b2c2f',
  'UMBRELLA-NET': 'da04b882b4ea0b344de867b603a56133',
  'STARK-WIFI': 'f136e8b85541bb6db581fb9ea77ba4aa',
  'CYBERDYNE-5G': 'ff88611920d436196ebf949329f19c5f',
  'OSCORP-GUEST': 'db53cd513f7868a62a6fe4d32434f85c',
  'WEYLAND-NET': '483c611dbbc1d24f15e8e9456d7880b0',
  'TYRELL-CORP': 'eda6bc0cc13e0bd4ca98dce3404b7789',
  'APERTURE-WIFI': '786836a324a0ad0c41b98bcb62912807',
  'SHINRA-5G': '197561f56285ac4f0430eb1949ef7eac',
  'ABSTERGO-NET': 'fc4ddb45e9ac566eb48b18377f3a6a80',
  'WONKA-LABS': '0613107365af581815ea3a29604c83bf',
  'OMNI-CORP': '85194e7b3180b16c99d6516e9b0a0199',
  'PIED-PIPER': 'da7aa4aff7f3cb59046c4063178bb66e',
  'VANDELAY-INDUSTRIES': '3780ed6934d964b03ea6b0c83c8182f3',
  'NAKATOMI-PLAZA': '3eb108f60de70ebc18dd2884c5ec706c',
  'BREW-AND-CODE': '3b192af9ea152bd6dc248b829e0f7087',
  'BEAN-THERE-WIFI': '7c59036f128a5e417a3ce836c4346e88',
  'MIDNIGHT-DINER': '5b707fd6512e8cac8ea3e770ca9edcd1',
  'NIGHT-OWL-CAFE': 'dbe5fdadcfec62465cf59b59a6f0f5d9',
  'GROUND-ZERO-COFFEE': '237b1538fb73fe7ea47b7252baefd001',
  'ESPRESSO-EXPRESS': 'fceec52487f2e832ef3cace9690299c1',
  'APT-3B-WIFI': '9f48290ac49df95db0bfe1184607ea2c',
  'UPSTAIRS-NEIGHBOR': '441014598250d66af4f301100a0ba23f',
  'FAMILY-WIFI-2G': 'bcd69fefc5e0a0af31715e952196856d',
  'CASA-DE-RAMIREZ': '32cff890ca7452688be8432ffaddd8b7',
  'SUITE-401': '4d697c021afa7adc7a99cda12357a9a5',
  'HOUSE-OF-CARDS': '0cc15e0185461c3057ba8f7572af2fe6',
  'UNIV-DORM-7': '411b62fddafea140ffab132ddd9cab1f',
  'CS-DEPT-LAB': '68aafc5693d60fb92a2976f447d8f755',
  'GRAD-STUDENT-WIFI': '4bf0b0f5968a8b63f3d9170ccf899e91',
  'CAMPUS-GUEST-OPEN': '3b2a8342d084e4bff9e173e4f9c0b781',
  'LIB-2ND-FLOOR': '25df2cf1079155a874c9718aa0734a66',
  'LIBRARY-PATRON': 'b866a543e73f178ecc9da85b66af2ecf',
  'CITY-PARK-WIFI': 'a05d68189d599bd1dd0fe999b728487f',
  'METRO-COMMUTER': '717d4eb55056d996c9db29d198d03941',
  'AIRPORT-LOUNGE-VIP': 'bdbc748c8217c0dcca6c909a1464e424',
  'TRAIN-STATION-FREE': 'ef89b295bfd6712577ae3bbf93d0b1cf',
  'SMART-FRIDGE-NET': '79a6874b4b8b48dfaac34ecf5259dbf6',
  'EV-CHARGER-LOT-3': 'acfaee6ba524ba5324338eaa1213398b',
  'DOORBELL-CAM-OPEN': '2f5ed8d0bdaf0310b7ca3def11e72ce0',
  'ROBOVAC-AP': 'f4ce3d8d4d3d455489a9776b30f8e3a2',
  'DEFCON-VILLAGE': 'b60417a29977a58e60d159bb675c644a',
  'HACKERSPACE-2600': '47fe169073fbce7fdd9ed4fd51fde8c7',
  'BOFH-KEEPOUT': 'b62a0b8718ac1e0a39bfb66b550d8b8d',
  'NULL-BYTE': 'c24f901e1a3de55299d4cf00287c1468',
  'RIDGEMONT-PD': '21c72265bad0e8c78caa1614ae307162',
  'CITY-HALL-WIFI': '1af8acab720e24fd033a739f3685700b',
  'COURTHOUSE-GUEST': '0c63930532c50481dd1fabf4ff7d8144',
  'KWIK-E-MART': '23c3a458f87e62ba80eee38fdc8bc4fc',
  MONSTROMART: '6ff67f60bfc13e700cc4e334a4803d55',
  'BUY-N-LARGE': 'd283daa80b17f59a7aaaa576b07216c0',
  'MEGA-LO-MART': 'a2168202c748c354c4721a6e4b01abfa',
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
