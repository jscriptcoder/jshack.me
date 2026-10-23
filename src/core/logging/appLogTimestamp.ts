/**
 * The timestamp a public site's own application log prints: `2026-10-19 14:37:02`, in UTC,
 * as the sites print their times, with the seconds a log needs. Shared by every such log
 * (talkit's, rideit's) so their lines read alike.
 *
 * Pure, framework-agnostic (core/): the time is supplied by the caller.
 */

import type { GameTime } from '../types.js';

const padZero = (value: number): string => value.toString().padStart(2, '0');

/** `2026-10-19 14:37:02`, in UTC. */
export const formatAppLogTimestamp = (time: GameTime): string => {
  const date = new Date(time);
  const day = `${date.getUTCFullYear()}-${padZero(date.getUTCMonth() + 1)}-${padZero(date.getUTCDate())}`;
  return `${day} ${padZero(date.getUTCHours())}:${padZero(date.getUTCMinutes())}:${padZero(date.getUTCSeconds())}`;
};
