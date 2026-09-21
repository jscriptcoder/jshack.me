/**
 * The crackable networks of the world, each with the kind of place that broadcasts it.
 *
 * A network is somewhere before it is anything else: an office, a café, a flat. What
 * the machines behind it keep — the notes on a desk, the history of a shell — reads as
 * that place, so the place travels with the ESSID rather than being guessed from it.
 * `place` is how the people there would name it in their own writing.
 *
 * The ORDER is load-bearing. The scan draws its crackable networks from this list by
 * position, so reordering it would offer every player different networks. New entries
 * go at the end.
 *
 * Convention: crackable ESSIDs are fictional or parody; real-world brand names live in
 * the noise pool.
 */

export const NETWORK_CATEGORIES = [
  'corporate',
  'cafe',
  'residential',
  'university',
  'public',
  'iot',
  'hacker',
] as const;

export type NetworkCategory = (typeof NETWORK_CATEGORIES)[number];

export type EssidCatalogEntry = {
  readonly essid: string;
  readonly category: NetworkCategory;
  readonly place: string;
};

const entries = (
  category: NetworkCategory,
  rows: readonly (readonly [essid: string, place: string])[],
): readonly EssidCatalogEntry[] => rows.map(([essid, place]) => ({ essid, category, place }));

export const ESSID_CATALOG: readonly EssidCatalogEntry[] = [
  // Pop-culture and sci-fi mega-corps, and small offices.
  ...entries('corporate', [
    ['ACME-CORP', 'Acme Corporation'],
    ['INITECH-5G', 'Initech'],
    ['GLOBEX-NET', 'Globex Corporation'],
    ['WAYSTAR-WIFI', 'Waystar Royco'],
    ['DUNDER-LAN', 'Dunder Mifflin'],
    ['HOOLI-SEC', 'Hooli'],
    ['UMBRELLA-NET', 'Umbrella Corporation'],
    ['STARK-WIFI', 'Stark Industries'],
    ['CYBERDYNE-5G', 'Cyberdyne Systems'],
    ['OSCORP-GUEST', 'Oscorp'],
    ['WEYLAND-NET', 'Weyland-Yutani'],
    ['TYRELL-CORP', 'Tyrell Corporation'],
    ['APERTURE-WIFI', 'Aperture Science'],
    ['SHINRA-5G', 'Shinra Electric'],
    ['ABSTERGO-NET', 'Abstergo Industries'],
    ['WONKA-LABS', 'Wonka Labs'],
    ['OMNI-CORP', 'Omni Consumer Products'],
    ['PIED-PIPER', 'Pied Piper'],
    ['VANDELAY-INDUSTRIES', 'Vandelay Industries'],
    ['NAKATOMI-PLAZA', 'Nakatomi Trading'],
  ]),
  // Public seating, high foot traffic.
  ...entries('cafe', [
    ['BREW-AND-CODE', 'Brew & Code'],
    ['BEAN-THERE-WIFI', 'Bean There'],
    ['MIDNIGHT-DINER', 'the Midnight Diner'],
    ['NIGHT-OWL-CAFE', 'the Night Owl'],
    ['GROUND-ZERO-COFFEE', 'Ground Zero Coffee'],
    ['ESPRESSO-EXPRESS', 'Espresso Express'],
  ]),
  // Apartments and family homes.
  ...entries('residential', [
    ['APT-3B-WIFI', 'apartment 3B'],
    ['UPSTAIRS-NEIGHBOR', 'the upstairs flat'],
    ['FAMILY-WIFI-2G', 'the family house'],
    ['CASA-DE-RAMIREZ', 'Casa Ramirez'],
    ['SUITE-401', 'suite 401'],
    ['HOUSE-OF-CARDS', 'the shared house'],
  ]),
  // Dorms, labs, campus open networks.
  ...entries('university', [
    ['UNIV-DORM-7', 'Dorm 7'],
    ['CS-DEPT-LAB', 'the CS department lab'],
    ['GRAD-STUDENT-WIFI', 'the grad office'],
    ['CAMPUS-GUEST-OPEN', 'the campus'],
    ['LIB-2ND-FLOOR', 'the library second floor'],
  ]),
  // Libraries, parks, transit.
  ...entries('public', [
    ['LIBRARY-PATRON', 'the public library'],
    ['CITY-PARK-WIFI', 'City Park'],
    ['METRO-COMMUTER', 'the metro'],
    ['AIRPORT-LOUNGE-VIP', 'the airport lounge'],
    ['TRAIN-STATION-FREE', 'the train station'],
  ]),
  // Single-device access points left in their factory configuration.
  ...entries('iot', [
    ['SMART-FRIDGE-NET', 'the kitchen'],
    ['EV-CHARGER-LOT-3', 'parking lot 3'],
    ['DOORBELL-CAM-OPEN', 'the front door'],
    ['ROBOVAC-AP', 'the living room'],
  ]),
  // Hacker-scene easter eggs.
  ...entries('hacker', [
    ['DEFCON-VILLAGE', 'the village'],
    ['HACKERSPACE-2600', 'the hackerspace'],
    ['BOFH-KEEPOUT', 'the server room'],
    ['NULL-BYTE', 'Null Byte'],
  ]),
];
