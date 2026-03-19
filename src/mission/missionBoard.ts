export type MissionListing = {
  readonly id: string;
  readonly client: string;
  readonly clientEmail: string;
  readonly target: string;
  readonly objective: string;
  readonly difficulty: string;
  readonly seed: string;
};

export const MISSION_BOARD: readonly MissionListing[] = [
  // --- EASY (one per entry variant: ssh, ftp, nc, http, exploit) ---
  {
    id: 'DKC-001',
    client: 'xR0gu3x',
    clientEmail: 'xR0gu3x@darkmail.onion',
    target: 'Greenleaf Medical Group — patient records server',
    objective: 'Exfiltrate the ACCESS-KEY from their records archive',
    difficulty: 'EASY',
    seed: 'GREENLEAF-ssh-easy-exfiltrate',
  },
  {
    id: 'DKC-002',
    client: 'gh0st_',
    clientEmail: 'gh0st_@darkmail.onion',
    target: 'Ridgemont University — student database',
    objective: "Tamper with a student's academic records",
    difficulty: 'EASY',
    seed: 'RIDGEMONT-ftp-easy-tamper',
  },
  {
    id: 'DKC-003',
    client: 'cyph3rpunk',
    clientEmail: 'cyph3rpunk@darkmail.onion',
    target: 'QuickShip Logistics — warehouse workstation',
    objective: 'Fix a broken inventory script and retrieve the access code',
    difficulty: 'EASY',
    seed: 'QUICKSHIP-nc-easy-script-fix',
  },
  {
    id: 'DKC-004',
    client: 'darkfl0w',
    clientEmail: 'darkfl0w@darkmail.onion',
    target: 'Pinnacle HR Solutions — payroll server',
    objective: 'Steal the root credentials from their file server',
    difficulty: 'EASY',
    seed: 'PINNACLE-http-easy-credential-theft',
  },
  {
    id: 'DKC-005',
    client: 'zer0day_',
    clientEmail: 'zer0day_@darkmail.onion',
    target: 'BrightStar Energy — grid monitoring station',
    objective: 'Destroy the monitoring station — brick the machine',
    difficulty: 'EASY',
    seed: 'BRIGHTSTAR-exploit-easy-sabotage',
  },
  // --- MEDIUM (one per entry variant: ssh, ftp, nc, exploit, http, snmp) ---
  {
    id: 'DKC-006',
    client: 'n3twr4ith',
    clientEmail: 'n3twr4ith@darkmail.onion',
    target: 'Obsidian Financial — trading platform backend',
    objective: 'Tamper with trading records to manipulate account balances',
    difficulty: 'MEDIUM',
    seed: 'OBSIDIAN-ssh-medium-tamper',
  },
  {
    id: 'DKC-007',
    client: 'silkr0ad',
    clientEmail: 'silkr0ad@darkmail.onion',
    target: 'NovaTech Labs — research file server',
    objective: 'Steal root password from their research infrastructure',
    difficulty: 'MEDIUM',
    seed: 'NOVATECH-ftp-medium-credential-theft',
  },
  {
    id: 'DKC-008',
    client: 'bl4ckh4t',
    clientEmail: 'bl4ckh4t@darkmail.onion',
    target: 'Meridian Defense Corp — encrypted data vault',
    objective: 'Exfiltrate encrypted ACCESS-KEY from their data vault',
    difficulty: 'MEDIUM',
    seed: 'MERIDIAN-nc-medium-exfiltrate-gpg',
  },
  {
    id: 'DKC-009',
    client: 'v0id_agent',
    clientEmail: 'v0id_agent@darkmail.onion',
    target: 'Sentinel Security — surveillance server cluster',
    objective: 'Fix a broken audit script to extract the access code',
    difficulty: 'MEDIUM',
    seed: 'SENTINEL-exploit-medium-script-fix',
  },
  {
    id: 'DKC-010',
    client: 'ph4nt0m',
    clientEmail: 'ph4nt0m@darkmail.onion',
    target: 'Axiom Biotech — gene sequencing lab server',
    objective: 'Sabotage their primary analysis machine',
    difficulty: 'MEDIUM',
    seed: 'AXIOM-http-medium-sabotage',
  },
  {
    id: 'DKC-011',
    client: 'darkfl0w',
    clientEmail: 'darkfl0w@darkmail.onion',
    target: 'Cobalt Dynamics — network gateway infrastructure',
    objective: 'Breach their router via SNMP and exfiltrate the ACCESS-KEY',
    difficulty: 'MEDIUM',
    seed: 'COBALT-snmp-medium-exfiltrate',
  },
  // --- HARD (one per entry variant: ssh, ftp, nc, exploit, http, snmp) ---
  {
    id: 'DKC-012',
    client: 'zer0day_',
    clientEmail: 'zer0day_@darkmail.onion',
    target: 'Vanguard Gov Systems — classified document server',
    objective: 'Destroy their classified archive — leave no trace',
    difficulty: 'HARD',
    seed: 'VANGUARD-ssh-hard-sabotage',
  },
  {
    id: 'DKC-013',
    client: 'cyph3rpunk',
    clientEmail: 'cyph3rpunk@darkmail.onion',
    target: 'Nexus Pharma — drug trial data processing cluster',
    objective: 'Fix the corrupted validation script deep in their network',
    difficulty: 'HARD',
    seed: 'NEXUS-ftp-hard-script-fix',
  },
  {
    id: 'DKC-014',
    client: 'xR0gu3x',
    clientEmail: 'xR0gu3x@darkmail.onion',
    target: 'IronClad Insurance — claims database cluster',
    objective: 'Extract root credentials from their claims network',
    difficulty: 'HARD',
    seed: 'IRONCLAD-nc-hard-credential-theft',
  },
  {
    id: 'DKC-015',
    client: 'n3twr4ith',
    clientEmail: 'n3twr4ith@darkmail.onion',
    target: 'Cerberus Bank — core transaction network',
    objective: 'Exfiltrate encrypted ACCESS-KEY from the vault — GPG required',
    difficulty: 'HARD',
    seed: 'CERBERUS-exploit-hard-exfiltrate-gpg-domain',
  },
  {
    id: 'DKC-016',
    client: 'bl4ckh4t',
    clientEmail: 'bl4ckh4t@darkmail.onion',
    target: 'Helios Aerospace — mission control infrastructure',
    objective: 'Tamper with flight system access controls',
    difficulty: 'HARD',
    seed: 'HELIOS-http-hard-tamper-domain',
  },
  {
    id: 'DKC-017',
    client: 'gh0st_',
    clientEmail: 'gh0st_@darkmail.onion',
    target: 'Zenith Federal — core banking router network',
    objective: 'Breach their SNMP gateway and steal root credentials',
    difficulty: 'HARD',
    seed: 'ZENITH-snmp-hard-credential-theft-domain',
  },
];

export const formatMissionBoard = (listings: readonly MissionListing[]): string => {
  const header = [
    '============================================',
    '  DARKNET CONTRACTS — AVAILABLE JOBS',
    '============================================',
    '',
  ];

  const entries = listings.flatMap((listing) => [
    `[${listing.id}] CLIENT: ${listing.client}`,
    `      TARGET: ${listing.target}`,
    `      OBJECTIVE: ${listing.objective}`,
    `      REPLY TO: ${listing.clientEmail}`,
    `      DIFFICULTY: ${listing.difficulty}`,
    `      SEED: ${listing.seed}`,
    '',
  ]);

  const footer = ['> Type accept("SEED") to start a mission'];

  return [...header, ...entries, ...footer].join('\n');
};
