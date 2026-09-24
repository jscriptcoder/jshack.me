/**
 * What a generated device is built from: the models a household or an office really
 * owns, and the configs their daemons really keep.
 *
 * No entry names a software version. A version dates a box, and only the package
 * manifest states one; a model number is the product's name, not its firmware.
 */

/** Printers people plug into a small print server over USB. Each is written as CUPS
 *  writes a queue's `Info`, which is also what `lpadmin` names the queue after. */
export const PRINTER_MODELS: readonly string[] = [
  'HP LaserJet Pro M404dn',
  'HP OfficeJet Pro 9015e',
  'Brother HL-L2350DW',
  'Brother MFC-L2710DW',
  'Canon PIXMA TS8350',
  'Canon imageCLASS MF264dw',
  'Epson WorkForce WF-2860',
  'Epson EcoTank ET-2760',
  'Kyocera ECOSYS P2040dw',
  'Lexmark B2236dw',
  'Samsung Xpress M2020W',
  'Xerox Phaser 6510',
];

/** The format CUPS writes `page_log` in when told to log pages at all: printer, user,
 *  job id, time, page number, copies, billing code, the host the job came from, its
 *  title, the media and the sides. Every scheduler config states it, so the log a player
 *  reads can be read against the config that asked for it. */
export const PAGE_LOG_FORMAT =
  '%p %u %j %T %P %C %{job-billing} %{job-originating-host-name} %{job-name} %{media} %{sides}';

/** The scheduler's config, as Debian ships it and an admin then tunes it. Every one
 *  listens on the loopback and its socket only, since nothing on the network answers
 *  on 631; logs pages; keeps a job's history for thirty days and its document for one,
 *  which is why the spool holds data files for the last day's jobs and no older. */
export const CUPSD_CONFS: readonly string[] = [
  [
    '# Configuration file for the CUPS scheduler.',
    'LogLevel warn',
    `PageLogFormat ${PAGE_LOG_FORMAT}`,
    'MaxLogSize 1m',
    'ErrorPolicy retry-job',
    'Listen localhost:631',
    'Listen /run/cups/cups.sock',
    'Browsing No',
    'DefaultAuthType Basic',
    'WebInterface Yes',
    'PreserveJobHistory 30d',
    'PreserveJobFiles 1d',
    '<Location />',
    '  Order allow,deny',
    '</Location>',
    '<Location /admin>',
    '  AuthType Default',
    '  Require user @SYSTEM',
    '  Order allow,deny',
    '</Location>',
    '',
  ].join('\n'),
  [
    '# Configuration file for the CUPS scheduler.',
    'LogLevel info',
    `PageLogFormat ${PAGE_LOG_FORMAT}`,
    'MaxLogSize 2m',
    'MaxJobs 200',
    'Listen localhost:631',
    'Listen /run/cups/cups.sock',
    'Browsing Yes',
    'BrowseLocalProtocols dnssd',
    'DefaultAuthType Basic',
    'WebInterface Yes',
    'IdleExitTimeout 60',
    'PreserveJobHistory 30d',
    'PreserveJobFiles 1d',
    '<Location />',
    '  Order allow,deny',
    '</Location>',
    '<Location /admin>',
    '  AuthType Default',
    '  Require user @SYSTEM',
    '  Order allow,deny',
    '</Location>',
    '',
  ].join('\n'),
  [
    '# Tuned for the office queue.',
    'LogLevel error',
    `PageLogFormat ${PAGE_LOG_FORMAT}`,
    'MaxLogSize 1m',
    'ErrorPolicy stop-printer',
    'JobRetryInterval 30',
    'Listen localhost:631',
    'Listen /run/cups/cups.sock',
    'Browsing No',
    'DefaultAuthType Basic',
    'DefaultEncryption IfRequested',
    'WebInterface Yes',
    'PreserveJobHistory 30d',
    'PreserveJobFiles 1d',
    '<Location />',
    '  Order allow,deny',
    '</Location>',
    '<Location /admin>',
    '  AuthType Default',
    '  Require user @SYSTEM',
    '  Order allow,deny',
    '</Location>',
    '',
  ].join('\n'),
];

/** The cameras a camera-kind box may be, each with the flavour of box it is: `cam` a
 *  fixed security camera, `doorbell` a video doorbell, `babycam` a baby monitor. Each
 *  make and model stands alone in a `strings` listing of a snapshot's Exif block, so
 *  every one is at least four characters, and none carries a decimal. */
export const CAMERA_MODELS: readonly {
  readonly make: string;
  readonly model: string;
  readonly flavour: string;
}[] = [
  { make: 'Reolink', model: 'RLC-510A', flavour: 'cam' },
  { make: 'Hikvision', model: 'DS-2CD2043G2-I', flavour: 'cam' },
  { make: 'Amcrest', model: 'IP4M-1041B', flavour: 'cam' },
  { make: 'Axis', model: 'M3106-L', flavour: 'cam' },
  { make: 'TP-Link', model: 'Tapo C200', flavour: 'cam' },
  { make: 'Ring', model: 'Video Doorbell Pro', flavour: 'doorbell' },
  { make: 'Eufy', model: 'Video Doorbell Dual', flavour: 'doorbell' },
  { make: 'Reolink', model: 'Video Doorbell PoE', flavour: 'doorbell' },
  { make: 'Google', model: 'Nest Doorbell', flavour: 'doorbell' },
  { make: 'Nanit', model: 'Nanit Pro', flavour: 'babycam' },
  { make: 'Owlet', model: 'Owlet Cam', flavour: 'babycam' },
  { make: 'Motorola', model: 'VM44 Connect', flavour: 'babycam' },
  { make: 'Eufy', model: 'SpaceView Pro', flavour: 'babycam' },
];

/** What a camera of each flavour records beside plain motion: a doorbell its rings, a
 *  baby monitor the sound it hears. */
export const FLAVOUR_EVENTS: Readonly<Record<string, string>> = {
  doorbell: 'ring',
  babycam: 'sound',
};

/** The frame sizes a camera streams and snapshots at. */
export const CAMERA_RESOLUTIONS: readonly (readonly [number, number])[] = [
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
];

/** The temperature and humidity chips a climate board reads over I2C, each at the
 *  address that chip answers on out of the box. */
export const CLIMATE_CHIPS: readonly { readonly chip: string; readonly address: string }[] = [
  { chip: 'BME280', address: '0x76' },
  { chip: 'SHT31', address: '0x44' },
  { chip: 'HTU21D', address: '0x40' },
  { chip: 'AHT20', address: '0x38' },
  { chip: 'SHTC3', address: '0x70' },
];

/** Where a climate device is fitted, as its topic names it. */
export const CLIMATE_ROOMS: readonly string[] = [
  'hallway',
  'kitchen',
  'office',
  'living-room',
  'bedroom',
  'landing',
  'reception',
  'server-cupboard',
];

/** The televisions and speakers a media box may be, by flavour. */
export const MEDIA_MODELS: Readonly<Record<'tv' | 'speaker', readonly string[]>> = {
  tv: [
    'Samsung QN90B',
    'LG OLED C2',
    'Sony Bravia XR-55A80K',
    'TCL 55C735',
    'Hisense 55U8H',
    'Philips 55OLED807',
  ],
  speaker: [
    'Sonos One',
    'Sonos Era 100',
    'Bose Home Speaker 500',
    'Amazon Echo Studio',
    'Google Nest Audio',
    'Apple HomePod mini',
  ],
};

/** The apps each flavour installs. A television plays music too, so it may carry a music
 *  app; a speaker plays nothing with a picture. */
export const MEDIA_APPS: Readonly<Record<'tv' | 'speaker', readonly string[]>> = {
  tv: ['Netflix', 'YouTube', 'Prime Video', 'Disney+', 'BBC iPlayer', 'Plex', 'Twitch', 'Spotify'],
  speaker: ['Spotify', 'TuneIn', 'BBC Sounds', 'Apple Music', 'Deezer', 'Podcasts'],
};

/** What is played: programmes on an app with a picture, and audio on any other. */
export const MEDIA_TITLES: Readonly<Record<'video' | 'audio', readonly string[]>> = {
  video: [
    'Evening News',
    'The Long Coast',
    'Harbour Lights',
    'Cooking for Two',
    'Match of the Week',
    'The Quiet Valley',
    'Planet Underwater',
    'Detective Hale',
    'Late Show Highlights',
    'Cartoon Morning',
  ],
  audio: [
    'Morning Focus',
    'Deep Work Mix',
    'Rainy Day Jazz',
    'Kitchen Radio',
    'Evening Chill',
    'Daily Briefing',
    'Classic Rock Hour',
    'Sleep Sounds',
    'Workout Mix',
    'Sunday Papers',
  ],
};

/** Where a television or a speaker stands, as its friendly name gives it. */
export const MEDIA_ROOMS: readonly string[] = [
  'Living Room',
  'Kitchen',
  'Bedroom',
  'Office',
  'Meeting Room',
  'Reception',
  'Lounge',
  'Studio',
];

/** What a smart plug switches, and the load it draws while on, in watts. */
export const PLUG_APPLIANCES: readonly { readonly name: string; readonly watts: number }[] = [
  { name: 'Desk Lamp', watts: 12 },
  { name: 'Hallway Lamp', watts: 9 },
  { name: 'Coffee Machine', watts: 1100 },
  { name: 'Fish Tank', watts: 45 },
  { name: 'Desk Fan', watts: 35 },
  { name: 'Space Heater', watts: 1500 },
  { name: 'Dehumidifier', watts: 280 },
  { name: 'Grow Light', watts: 60 },
];

/** The days a plug's rule may run on: every day, working days, the weekend, or one day. */
export const PLUG_DAYS: readonly string[] = [
  'daily',
  'mon-fri',
  'sat-sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
];
