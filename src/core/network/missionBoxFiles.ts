/**
 * What a door does with the files only the server can write onto a contract's key box: lay
 * them over the generated base before the journal replays, so a root's `rm` of one sticks
 * for the next reader. Each file says who may read it: see `missionLeak.ts`.
 */

import { file, withFiles } from '../generation/baseFs.js';
import type { Directory } from '../filesystem/types.js';
import type { MissionFile } from '../missions/missionLeak.js';

/** The files the server lays onto this box: none for any box but a contract's key box. An
 *  `error` means a deployment secret that box needs is unset, which a door answers 500. */
export type FindMissionFiles = (query: {
  readonly essid: string;
  readonly machine_id: string;
}) => Promise<{ readonly data: readonly MissionFile[] | null; readonly error: unknown }>;

/** The answer a door gives when the box's files cannot be made. There is no default. */
export const MISSION_FILES_MISSING = {
  status: 500,
  body: { error: 'mission_secret_missing' },
} as const;

/** The base with its files laid on, or null when they could not be made. */
export const withMissionFiles = async (
  findMissionFiles: FindMissionFiles,
  box: { readonly essid: string; readonly machineId: string; readonly baseFs: Directory },
): Promise<Directory | null> => {
  const files = await findMissionFiles({ essid: box.essid, machine_id: box.machineId });
  if (files.error || files.data === null) return null;
  return withFiles(
    box.baseFs,
    files.data.map(({ path, content, perms }) => [path, file(content, perms)] as const),
  );
};
