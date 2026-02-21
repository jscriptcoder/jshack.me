export type MissionListing = {
  readonly id: string;
  readonly client: string;
  readonly clientEmail: string;
  readonly target: string;
  readonly objective: string;
  readonly difficulty: string;
  readonly seed: string;
  // When set, the mission briefing shows this variant's hint instead of the actual entry variant.
  // Used for missions where the real entry path is discovered through gameplay (e.g., SSH as guest
  // is a recon dead-end, but the briefing shows it to set up the misdirection).
  readonly briefingVariantOverride?: import('../generation/types').EntryVariant;
};

export const MISSION_BOARD: readonly MissionListing[] = [
  {
    id: '001',
    client: 'xR0gu3x',
    clientEmail: 'xR0gu3x@darkmail.onion',
    target: 'MedTech Solutions — hospital records system',
    objective: 'Exfiltrate patient discharge records',
    difficulty: '* (Easy)',
    seed: 'MEDTECH-4A7F-easy',
  },
  {
    id: '002',
    client: 'gh0st_',
    clientEmail: 'gh0st_@darkmail.onion',
    target: 'Greenfield University — student records system',
    objective: 'Tamper with student grade records',
    difficulty: '** (Medium)',
    seed: 'GRADE-TAMPER-74',
    briefingVariantOverride: 'ssh',
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
