export type GameState = {
  readonly seed: string;
  readonly workstationName: string;
};

export const isValidGameState = (value: unknown): value is GameState =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).seed === 'string' &&
  typeof (value as Record<string, unknown>).workstationName === 'string';
