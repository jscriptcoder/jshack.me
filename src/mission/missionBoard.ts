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
  // --- EASY ---
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
    seed: 'QUICKSHIP-ssh-easy-script-fix',
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
    seed: 'BRIGHTSTAR-ssh-easy-sabotage',
  },
  // --- MEDIUM ---
  {
    id: 'DKC-006',
    client: 'n3twr4ith',
    clientEmail: 'n3twr4ith@darkmail.onion',
    target: 'Obsidian Financial — trading platform backend',
    objective: 'Exfiltrate encrypted ACCESS-KEY from their data vault',
    difficulty: 'MEDIUM',
    seed: 'OBSIDIAN-nc-medium-exfiltrate-gpg',
  },
  {
    id: 'DKC-007',
    client: 'bl4ckh4t',
    clientEmail: 'bl4ckh4t@darkmail.onion',
    target: 'Meridian Defense Corp — internal web portal',
    objective: 'Tamper with access control records to escalate privileges',
    difficulty: 'MEDIUM',
    seed: 'MERIDIAN-exploit-medium-tamper',
  },
  {
    id: 'DKC-008',
    client: 'silkr0ad',
    clientEmail: 'silkr0ad@darkmail.onion',
    target: 'NovaTech Labs — research file server',
    objective: 'Steal root password from their research infrastructure',
    difficulty: 'MEDIUM',
    seed: 'NOVATECH-ftp-medium-credential-theft',
  },
  {
    id: 'DKC-009',
    client: 'v0id_agent',
    clientEmail: 'v0id_agent@darkmail.onion',
    target: 'Sentinel Security — surveillance server cluster',
    objective: 'Fix a broken audit script to extract the access code',
    difficulty: 'MEDIUM',
    seed: 'SENTINEL-http-medium-script-fix',
  },
  {
    id: 'DKC-010',
    client: 'ph4nt0m',
    clientEmail: 'ph4nt0m@darkmail.onion',
    target: 'Axiom Biotech — gene sequencing lab server',
    objective: 'Sabotage their primary analysis machine',
    difficulty: 'MEDIUM',
    seed: 'AXIOM-nc-medium-sabotage',
  },
  // --- HARD ---
  {
    id: 'DKC-011',
    client: 'zer0day_',
    clientEmail: 'zer0day_@darkmail.onion',
    target: 'Cerberus Bank — core transaction network',
    objective: 'Exfiltrate encrypted ACCESS-KEY from the vault — GPG required',
    difficulty: 'HARD',
    seed: 'CERBERUS-exploit-hard-exfiltrate-gpg-domain',
  },
  {
    id: 'DKC-012',
    client: 'xR0gu3x',
    clientEmail: 'xR0gu3x@darkmail.onion',
    target: 'IronClad Insurance — claims database cluster',
    objective: 'Tamper with claims records across their internal network',
    difficulty: 'HARD',
    seed: 'IRONCLAD-nc-hard-tamper',
  },
  {
    id: 'DKC-013',
    client: 'n3twr4ith',
    clientEmail: 'n3twr4ith@darkmail.onion',
    target: 'Helios Aerospace — mission control infrastructure',
    objective: 'Extract root credentials from their flight systems',
    difficulty: 'HARD',
    seed: 'HELIOS-exploit-hard-credential-theft-domain',
  },
  {
    id: 'DKC-014',
    client: 'cyph3rpunk',
    clientEmail: 'cyph3rpunk@darkmail.onion',
    target: 'Nexus Pharma — drug trial data processing cluster',
    objective: 'Fix the corrupted validation script deep in their network',
    difficulty: 'HARD',
    seed: 'NEXUS-ftp-hard-script-fix',
  },
  {
    id: 'DKC-015',
    client: 'bl4ckh4t',
    clientEmail: 'bl4ckh4t@darkmail.onion',
    target: 'Vanguard Gov Systems — classified document server',
    objective: 'Destroy their classified archive — leave no trace',
    difficulty: 'HARD',
    seed: 'VANGUARD-exploit-hard-sabotage-domain',
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
