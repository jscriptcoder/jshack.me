export type MissionListing = {
  readonly id: string;
  readonly client: string;
  readonly clientEmail: string;
  readonly target: string;
  readonly objective: string;
  readonly difficulty: string;
  readonly seed: string;
};

export const MISSION_BOARD: readonly MissionListing[] = [];

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
