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
