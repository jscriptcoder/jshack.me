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
 *  on 631; logs pages; keeps every job's history; and keeps a job's document for a day,
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
    'PreserveJobHistory Yes',
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
    'PreserveJobHistory Yes',
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
    'PreserveJobHistory Yes',
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
