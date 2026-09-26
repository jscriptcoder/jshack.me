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

/** The website an institution publishes to the whole world, under a domain of its own. */
export type PublishedSite = {
  readonly domain: string;
  /** What the site calls the institution, which is its own place name unless it says otherwise. */
  readonly name: string;
};

export type EssidCatalogEntry = {
  readonly essid: string;
  readonly category: NetworkCategory;
  readonly place: string;
  /** Only institutions publish; a home, a gadget or a hacker hangout never has one. */
  readonly site?: PublishedSite;
};

const entries = (
  category: NetworkCategory,
  rows: readonly (readonly [essid: string, place: string, domain?: string, siteName?: string])[],
): readonly EssidCatalogEntry[] =>
  rows.map(([essid, place, domain, siteName]) =>
    domain === undefined
      ? { essid, category, place }
      : { essid, category, place, site: { domain, name: siteName ?? place } },
  );

export const ESSID_CATALOG: readonly EssidCatalogEntry[] = [
  // Pop-culture and sci-fi mega-corps, and small offices.
  ...entries('corporate', [
    ['ACME-CORP', 'Acme Corporation', 'acme.com'],
    ['INITECH-5G', 'Initech', 'initech.com'],
    ['GLOBEX-NET', 'Globex Corporation', 'globex.com'],
    ['WAYSTAR-WIFI', 'Waystar Royco', 'waystar.com'],
    ['DUNDER-LAN', 'Dunder Mifflin', 'dundermifflin.com'],
    ['HOOLI-SEC', 'Hooli', 'hooli.com'],
    ['UMBRELLA-NET', 'Umbrella Corporation', 'umbrellacorp.com'],
    ['STARK-WIFI', 'Stark Industries', 'starkindustries.com'],
    ['CYBERDYNE-5G', 'Cyberdyne Systems', 'cyberdyne.com'],
    ['OSCORP-GUEST', 'Oscorp', 'oscorp.com'],
    ['WEYLAND-NET', 'Weyland-Yutani', 'weyland-yutani.com'],
    ['TYRELL-CORP', 'Tyrell Corporation', 'tyrellcorp.com'],
    ['APERTURE-WIFI', 'Aperture Science', 'aperturescience.com'],
    ['SHINRA-5G', 'Shinra Electric', 'shinra.com'],
    ['ABSTERGO-NET', 'Abstergo Industries', 'abstergo.com'],
    ['WONKA-LABS', 'Wonka Labs', 'wonkalabs.com'],
    ['OMNI-CORP', 'Omni Consumer Products', 'ocp.com'],
    ['PIED-PIPER', 'Pied Piper', 'piedpiper.com'],
    ['VANDELAY-INDUSTRIES', 'Vandelay Industries', 'vandelayindustries.com'],
    ['NAKATOMI-PLAZA', 'Nakatomi Trading', 'nakatomi.com'],
  ]),
  // Public seating, high foot traffic.
  ...entries('cafe', [
    ['BREW-AND-CODE', 'Brew & Code', 'brewandcode.com'],
    ['BEAN-THERE-WIFI', 'Bean There', 'beanthere.com'],
    ['MIDNIGHT-DINER', 'the Midnight Diner', 'midnightdiner.com'],
    ['NIGHT-OWL-CAFE', 'the Night Owl', 'nightowlcafe.com'],
    ['GROUND-ZERO-COFFEE', 'Ground Zero Coffee', 'groundzerocoffee.com'],
    ['ESPRESSO-EXPRESS', 'Espresso Express', 'espressoexpress.com'],
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
    ['CAMPUS-GUEST-OPEN', 'the campus', 'ridgemont.edu', 'Ridgemont University'],
    ['LIB-2ND-FLOOR', 'the library second floor'],
  ]),
  // Libraries, parks, transit.
  ...entries('public', [
    ['LIBRARY-PATRON', 'the public library', 'ridgemontlibrary.org', 'Ridgemont Public Library'],
    ['CITY-PARK-WIFI', 'City Park', 'ridgemontparks.gov', 'Ridgemont Parks Department'],
    ['METRO-COMMUTER', 'the metro', 'ridgemontmetro.gov', 'Ridgemont Metro'],
    ['AIRPORT-LOUNGE-VIP', 'the airport lounge', 'flyridgemont.com', 'Ridgemont International Airport'],
    ['TRAIN-STATION-FREE', 'the train station', 'ridgemontcentral.org', 'Ridgemont Central Station'],
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
