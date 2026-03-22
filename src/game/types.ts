export type GameState = {
  readonly seed: string;
  readonly workstationName: string;
  readonly username: string;
  readonly rootPassword: string;
};

export const isValidGameState = (value: unknown): value is GameState => {
  const obj = value as Record<string, unknown>;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof obj.seed === 'string' &&
    typeof obj.workstationName === 'string' &&
    typeof obj.username === 'string' &&
    typeof obj.rootPassword === 'string'
  );
};
