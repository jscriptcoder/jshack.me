export type MissionListing = {
  readonly client: string;
  readonly clientEmail: string;
  readonly target: string;
  readonly objective: string;
  readonly difficulty: string;
  readonly seed: string;
};

export const MISSION_BOARD: readonly MissionListing[] = [
  // --- EASY ---
  {
    client: 'xR0gu3x',
    clientEmail: 'xR0gu3x@darkmail.onion',
    target: 'Greenleaf Medical Group — patient records server',
    objective: 'Exfiltrate the ACCESS-KEY from their records archive',
    difficulty: 'EASY',
    seed: 'GREENLEAF-ssh-easy-exfiltrate',
  },
  {
    client: 'gh0st_',
    clientEmail: 'gh0st_@darkmail.onion',
    target: 'Ridgemont University — student database',
    objective: "Tamper with a student's academic records",
    difficulty: 'EASY',
    seed: 'RIDGEMONT-ftp-easy-tamper',
  },
  {
    client: 'cyph3rpunk',
    clientEmail: 'cyph3rpunk@darkmail.onion',
    target: 'QuickShip Logistics — warehouse workstation',
    objective: 'Repair a broken inventory validation script on their workstation',
    difficulty: 'EASY',
    seed: 'QUICKSHIP-ssh-easy-script-fix',
  },
  {
    client: 'darkfl0w',
    clientEmail: 'darkfl0w@darkmail.onion',
    target: 'Pinnacle HR Solutions — payroll server',
    objective: 'Steal the root credentials from their file server',
    difficulty: 'EASY',
    seed: 'PINNACLE-http-easy-credential-theft',
  },
  {
    client: 'zer0day_',
    clientEmail: 'zer0day_@darkmail.onion',
    target: 'BrightStar Energy — grid monitoring station',
    objective: 'Destroy the monitoring station — brick the machine',
    difficulty: 'EASY',
    seed: 'BRIGHTSTAR-exploit-easy-sabotage',
  },
  {
    client: 'v0id_agent',
    clientEmail: 'v0id_agent@darkmail.onion',
    target: 'Apex Courier Services — fleet tracking server',
    objective: 'Plant a backdoor on their tracking server for persistent access',
    difficulty: 'EASY',
    seed: 'APEX-ssh-easy-backdoor',
  },
  {
    client: 'n3twr4ith',
    clientEmail: 'n3twr4ith@darkmail.onion',
    target: 'Solaris Telecom — border gateway router',
    objective: 'Hack the router and expose an internal service via port forwarding',
    difficulty: 'EASY',
    seed: 'SOLARIS-snmp-easy-portforward',
  },
  {
    client: 'v0id_agent',
    clientEmail: 'v0id_agent@darkmail.onion',
    target: 'Pinecrest Logistics — compromised shipping database',
    objective: 'Investigate the breach: find who broke in and where they came from',
    difficulty: 'EASY',
    seed: 'PINECREST-easy-forensics',
  },
  {
    client: 'cyph3rpunk',
    clientEmail: 'cyph3rpunk@darkmail.onion',
    target: 'Coastal Freight — shipping container IoT hub',
    objective: 'Write and deploy an automated monitoring script on their IoT gateway',
    difficulty: 'EASY',
    seed: 'COASTAL-ssh-easy-script-auto',
  },
  {
    client: 'sh4d0w_',
    clientEmail: 'sh4d0w_@darkmail.onion',
    target: 'Redstone Mining Corp — operations data server',
    objective: 'Exfiltrate the ACCESS-KEY from their mining operations archive',
    difficulty: 'EASY',
    seed: 'REDSTONE-nc-easy-exfiltrate',
  },
  {
    client: 'n1ghtcr4wl',
    clientEmail: 'n1ghtcr4wl@darkmail.onion',
    target: 'Silverline Transit Authority — fare management server',
    objective: 'Steal root credentials from their fare processing system',
    difficulty: 'EASY',
    seed: 'SILVERLINE-snmp-easy-credential-theft',
  },
  {
    client: 'gh0st_',
    clientEmail: 'gh0st_@darkmail.onion',
    target: 'Crestview Academy — enrollment database',
    objective: 'Tamper with enrollment records in their student portal',
    difficulty: 'EASY',
    seed: 'CRESTVIEW-exploit-easy-tamper',
  },
  {
    client: 'h4rdl1nk',
    clientEmail: 'h4rdl1nk@darkmail.onion',
    target: 'Lakeview Hosting — shared web server',
    objective: 'Find and neutralize malware running on their web server',
    difficulty: 'EASY',
    seed: 'LAKEVIEW-ssh-easy-malware',
  },
  {
    client: 'sqlph4nt0m',
    clientEmail: 'sqlph4nt0m@darkmail.onion',
    target: 'Trident Pharma — clinical trials database',
    objective: 'Exfiltrate the access key from their database records',
    difficulty: 'EASY',
    seed: 'TRIDENT-ssh-easy-db-exfiltrate',
  },
  {
    client: 'r00tk1ll',
    clientEmail: 'r00tk1ll@darkmail.onion',
    target: 'NovaTech Solutions — customer database',
    objective: 'Tamper with user records in the database',
    difficulty: 'EASY',
    seed: 'NOVATECH-ftp-easy-db-tamper',
  },
  {
    client: 'v4ult_br3ak',
    clientEmail: 'v4ult_br3ak@darkmail.onion',
    target: 'Arclight Industries — internal database',
    objective: 'Wipe a critical table from their database',
    difficulty: 'EASY',
    seed: 'ARCLIGHT-exploit-easy-db-sabotage',
  },
  {
    client: 'dbm3dic',
    clientEmail: 'dbm3dic@darkmail.onion',
    target: 'Harborview Medical — patient management database',
    objective: 'Fix corrupted records in their database — a deployment went wrong',
    difficulty: 'EASY',
    seed: 'HARBORVIEW-ssh-easy-db-fix',
  },
  // --- MEDIUM ---
  {
    client: 'n3twr4ith',
    clientEmail: 'n3twr4ith@darkmail.onion',
    target: 'Obsidian Financial — trading platform backend',
    objective: 'Tamper with trading records to manipulate account balances',
    difficulty: 'MEDIUM',
    seed: 'OBSIDIAN-ssh-medium-tamper',
  },
  {
    client: 'silkr0ad',
    clientEmail: 'silkr0ad@darkmail.onion',
    target: 'NovaTech Labs — research file server',
    objective: 'Steal root password from their research infrastructure',
    difficulty: 'MEDIUM',
    seed: 'NOVATECH-ftp-medium-credential-theft',
  },
  {
    client: 'bl4ckh4t',
    clientEmail: 'bl4ckh4t@darkmail.onion',
    target: 'Meridian Defense Corp — encrypted data vault',
    objective: 'Exfiltrate encrypted ACCESS-KEY from their data vault',
    difficulty: 'MEDIUM',
    seed: 'MERIDIAN-nc-medium-exfiltrate-gpg',
  },
  {
    client: 'v0id_agent',
    clientEmail: 'v0id_agent@darkmail.onion',
    target: 'Sentinel Security — surveillance server cluster',
    objective: 'Repair a broken audit script on their monitoring infrastructure',
    difficulty: 'MEDIUM',
    seed: 'SENTINEL-ssh-medium-script-fix',
  },
  {
    client: 'ph4nt0m',
    clientEmail: 'ph4nt0m@darkmail.onion',
    target: 'Axiom Biotech — gene sequencing lab server',
    objective: 'Sabotage their primary analysis machine',
    difficulty: 'MEDIUM',
    seed: 'AXIOM-http-medium-sabotage',
  },
  {
    client: 'darkfl0w',
    clientEmail: 'darkfl0w@darkmail.onion',
    target: 'Cobalt Dynamics — network gateway infrastructure',
    objective: 'Breach their router via SNMP and exfiltrate the ACCESS-KEY',
    difficulty: 'MEDIUM',
    seed: 'COBALT-snmp-medium-exfiltrate',
  },
  {
    client: 'silkr0ad',
    clientEmail: 'silkr0ad@darkmail.onion',
    target: 'Prism Analytics — data processing cluster',
    objective: 'Plant a root backdoor on their analytics engine',
    difficulty: 'MEDIUM',
    seed: 'PRISM-ftp-medium-backdoor',
  },
  {
    client: 'darkfl0w',
    clientEmail: 'darkfl0w@darkmail.onion',
    target: 'Apex Industrial — network perimeter router',
    objective: 'Breach the gateway and set up port forwarding to an internal machine',
    difficulty: 'MEDIUM',
    seed: 'APEXIND-snmp-medium-portforward',
  },
  {
    client: 'sh4d0w_',
    clientEmail: 'sh4d0w_@darkmail.onion',
    target: 'Meridian Health Systems — breached patient portal',
    objective: 'Trace the attacker through the network and identify them',
    difficulty: 'MEDIUM',
    seed: 'MERIDIAN-medium-forensics',
  },
  {
    client: 'sh4d0w_',
    clientEmail: 'sh4d0w_@darkmail.onion',
    target: 'Sterling Dynamics — internal build cluster',
    objective: 'Write a cron job that verifies their deployment pipeline',
    difficulty: 'MEDIUM',
    seed: 'STERLING-ssh-medium-script-auto',
  },
  {
    client: 'n1ghtcr4wl',
    clientEmail: 'n1ghtcr4wl@darkmail.onion',
    target: 'Vertex Logistics — shipment tracking platform',
    objective: 'Tamper with shipment routing data to reroute a high-value cargo',
    difficulty: 'MEDIUM',
    seed: 'VERTEX-exploit-medium-tamper',
  },
  {
    client: 'zer0day_',
    clientEmail: 'zer0day_@darkmail.onion',
    target: 'Cascade Power Systems — grid monitoring cluster',
    objective: 'Sabotage their grid monitoring infrastructure',
    difficulty: 'MEDIUM',
    seed: 'CASCADE-nc-medium-sabotage',
  },
  {
    client: 'ph4nt0m',
    clientEmail: 'ph4nt0m@darkmail.onion',
    target: 'Irongate Manufacturing — production control network',
    objective: 'Breach the switch gateway and tamper with production records',
    difficulty: 'MEDIUM',
    seed: 'IRONGATE-snmp-medium-tamper-switch',
  },
  {
    client: 'darkfl0w',
    clientEmail: 'darkfl0w@darkmail.onion',
    target: 'Helix Genomics — research authentication server',
    objective: 'Exploit a vulnerability and extract root credentials',
    difficulty: 'MEDIUM',
    seed: 'HELIX-exploit-medium-credential-theft',
  },
  {
    client: 'cyb3rg00d',
    clientEmail: 'cyb3rg00d@darkmail.onion',
    target: 'Thornfield Hospital — patient database server',
    objective: 'Investigate and neutralize malware compromising patient data',
    difficulty: 'MEDIUM',
    seed: 'THORNFIELD-ssh-medium-malware',
  },
  {
    client: 'sqlph4nt0m',
    clientEmail: 'sqlph4nt0m@darkmail.onion',
    target: 'Meridian Finance — trading platform database',
    objective: 'Exfiltrate the secret access key from their trading database',
    difficulty: 'MEDIUM',
    seed: 'MERIDIAN-ssh-medium-db-exfiltrate',
  },
  {
    client: 'dbm3dic',
    clientEmail: 'dbm3dic@darkmail.onion',
    target: 'Crestline Logistics — fleet management database',
    objective: 'Fix corrupted maintenance records that are grounding vehicles',
    difficulty: 'MEDIUM',
    seed: 'CRESTLINE-ssh-medium-db-fix',
  },
  // --- HARD ---
  {
    client: 'zer0day_',
    clientEmail: 'zer0day_@darkmail.onion',
    target: 'Vanguard Gov Systems — classified document server',
    objective: 'Destroy their classified archive — leave no trace',
    difficulty: 'HARD',
    seed: 'VANGUARD-ssh-hard-sabotage',
  },
  {
    client: 'cyph3rpunk',
    clientEmail: 'cyph3rpunk@darkmail.onion',
    target: 'Nexus Pharma — drug trial data processing cluster',
    objective: 'Repair a corrupted validation script deep in their network',
    difficulty: 'HARD',
    seed: 'NEXUS-ssh-hard-script-fix',
  },
  {
    client: 'xR0gu3x',
    clientEmail: 'xR0gu3x@darkmail.onion',
    target: 'IronClad Insurance — claims database cluster',
    objective: 'Extract root credentials from their claims network',
    difficulty: 'HARD',
    seed: 'IRONCLAD-nc-hard-credential-theft',
  },
  {
    client: 'n3twr4ith',
    clientEmail: 'n3twr4ith@darkmail.onion',
    target: 'Cerberus Bank — core transaction network',
    objective: 'Exfiltrate encrypted ACCESS-KEY from the vault — GPG required',
    difficulty: 'HARD',
    seed: 'CERBERUS-exploit-hard-exfiltrate-gpg-domain',
  },
  {
    client: 'bl4ckh4t',
    clientEmail: 'bl4ckh4t@darkmail.onion',
    target: 'Helios Aerospace — mission control infrastructure',
    objective: 'Tamper with flight system access controls',
    difficulty: 'HARD',
    seed: 'HELIOS-http-hard-tamper-domain',
  },
  {
    client: 'gh0st_',
    clientEmail: 'gh0st_@darkmail.onion',
    target: 'Zenith Federal — core banking router network',
    objective: 'Breach their SNMP gateway and steal root credentials',
    difficulty: 'HARD',
    seed: 'ZENITH-snmp-hard-credential-theft-domain',
  },
  {
    client: 'ph4nt0m',
    clientEmail: 'ph4nt0m@darkmail.onion',
    target: 'Titan Defense — weapons research network',
    objective: 'Plant a root backdoor deep in their research cluster',
    difficulty: 'HARD',
    seed: 'TITAN-exploit-hard-backdoor-domain',
  },
  {
    client: 'zer0day_',
    clientEmail: 'zer0day_@darkmail.onion',
    target: 'Bastion Federal — classified network gateway',
    objective: 'Penetrate the gateway and forward a port to expose their internal infrastructure',
    difficulty: 'HARD',
    seed: 'BASTION-snmp-hard-portforward-domain',
  },
  {
    client: 'n1ghtcr4wl',
    clientEmail: 'n1ghtcr4wl@darkmail.onion',
    target: 'Obsidian Defense Corp — infiltrated classified network',
    objective: 'Full incident response: trace the intrusion chain and unmask the attacker',
    difficulty: 'HARD',
    seed: 'OBSIDIAN-hard-forensics',
  },
  {
    client: 'bl4ckh4t',
    clientEmail: 'bl4ckh4t@darkmail.onion',
    target: 'Obsidian Labs — deep research network',
    objective: 'Write an automated health-check script deep in their infrastructure',
    difficulty: 'HARD',
    seed: 'OBSIDIANLAB-ssh-hard-script-auto-domain',
  },
  {
    client: 'xR0gu3x',
    clientEmail: 'xR0gu3x@darkmail.onion',
    target: 'Polaris Satellite Corp — orbital control network',
    objective: 'Destroy their orbital telemetry systems — wipe it clean',
    difficulty: 'HARD',
    seed: 'POLARIS-ftp-hard-sabotage',
  },
  {
    client: 'silkr0ad',
    clientEmail: 'silkr0ad@darkmail.onion',
    target: 'Onyx Intelligence Group — encrypted signals archive',
    objective: 'Exfiltrate encrypted ACCESS-KEY through a switch-gated classified network',
    difficulty: 'HARD',
    seed: 'ONYX-nc-hard-exfiltrate-gpg-switch',
  },
  {
    client: 'cyph3rpunk',
    clientEmail: 'cyph3rpunk@darkmail.onion',
    target: 'Aurora Pharmaceuticals — clinical trial network',
    objective: 'Tamper with drug trial results deep in their switch-managed infrastructure',
    difficulty: 'HARD',
    seed: 'AURORA-ftp-hard-tamper-switch',
  },
  {
    client: 'darkfl0w',
    clientEmail: 'darkfl0w@darkmail.onion',
    target: 'Sovereign Systems — classified communications network',
    objective: 'Tamper with encrypted communications records in their classified network',
    difficulty: 'HARD',
    seed: 'SOVEREIGN-exploit-hard-tamper-domain',
  },
  {
    client: 'wh1t3h4t',
    clientEmail: 'wh1t3h4t@darkmail.onion',
    target: 'Titanium Defense — weapons research network',
    objective: 'Hunt and eliminate deeply hidden malware in their classified infrastructure',
    difficulty: 'HARD',
    seed: 'TITANIUM-ssh-hard-malware',
  },
  {
    client: 'v4ult_br3ak',
    clientEmail: 'v4ult_br3ak@darkmail.onion',
    target: 'Obsidian Corp — executive database behind multi-layer network',
    objective: 'Destroy the audit trail in their deeply buried database',
    difficulty: 'HARD',
    seed: 'OBSIDIAN-ssh-hard-db-sabotage',
  },
];

const WHITE_HAT_KEYWORDS = ['script-fix', 'script-auto', 'forensics', 'malware', 'db-fix'] as const;

const isWhiteHat = (seed: string): boolean => {
  const lower = seed.toLowerCase();
  return WHITE_HAT_KEYWORDS.some((keyword) => lower.includes(keyword));
};

const SEPARATOR = '  │  ';

const formatEntry = (listing: MissionListing): readonly string[] => [
  `[${listing.difficulty}]`,
  `  ${listing.target}`,
  `  ${listing.objective}`,
  `  SEED: ${listing.seed}`,
  '',
];

const buildColumn = (title: string, missions: readonly MissionListing[]): readonly string[] => {
  const entries = missions.flatMap(formatEntry);
  const width = Math.max(title.length + 4, ...entries.map((l) => l.length));
  const rule = '='.repeat(width);
  return [rule, `  ${title}`, rule, '', ...entries];
};

const mergeColumns = (
  leftLines: readonly string[],
  rightLines: readonly string[],
): readonly string[] => {
  const leftWidth = Math.max(...leftLines.map((l) => l.length));
  const maxLines = Math.max(leftLines.length, rightLines.length);
  return Array.from({ length: maxLines }, (_, i) => {
    const left = (leftLines[i] ?? '').padEnd(leftWidth);
    const right = rightLines[i] ?? '';
    return right ? `${left}${SEPARATOR}${right}` : (leftLines[i] ?? '');
  });
};

export const formatMissionBoard = (listings: readonly MissionListing[]): string => {
  const blackHat = listings.filter((l) => !isWhiteHat(l.seed));
  const whiteHat = listings.filter((l) => isWhiteHat(l.seed));

  const leftLines = buildColumn('DARKNET CONTRACTS', blackHat);
  const rightLines = buildColumn('SECURITY CONTRACTS', whiteHat);

  const footer = ['', '> Type accept("SEED") to start a mission'];

  return [...mergeColumns(leftLines, rightLines), ...footer].join('\n');
};
