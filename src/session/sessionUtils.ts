import { DEFAULT_THEME_ID, isValidThemeId } from '../theme/themes';
import type {
  Session,
  SessionSnapshot,
  FtpSession,
  NcSession,
  PersistedState,
} from './SessionContext';

export const isValidUserType = (value: unknown): value is 'root' | 'user' | 'guest' =>
  value === 'root' || value === 'user' || value === 'guest';

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

export const isValidSession = (value: unknown): value is Session => {
  const obj = asRecord(value);
  if (!obj) return false;
  return (
    typeof obj.username === 'string' &&
    typeof obj.machine === 'string' &&
    typeof obj.currentPath === 'string' &&
    isValidUserType(obj.userType) &&
    (obj.theme === undefined || isValidThemeId(obj.theme))
  );
};

export const isValidSessionSnapshot = (value: unknown): value is SessionSnapshot =>
  isValidSession(value);

export const isValidFtpSession = (value: unknown): value is FtpSession => {
  const obj = asRecord(value);
  if (!obj) return false;
  return (
    typeof obj.remoteMachine === 'string' &&
    typeof obj.remoteUsername === 'string' &&
    typeof obj.remoteCwd === 'string' &&
    typeof obj.originMachine === 'string' &&
    typeof obj.originUsername === 'string' &&
    typeof obj.originCwd === 'string' &&
    isValidUserType(obj.remoteUserType) &&
    isValidUserType(obj.originUserType)
  );
};

export const isValidNcSession = (value: unknown): value is NcSession => {
  const obj = asRecord(value);
  if (!obj) return false;
  return (
    typeof obj.targetIP === 'string' &&
    typeof obj.targetPort === 'number' &&
    typeof obj.service === 'string' &&
    typeof obj.username === 'string' &&
    typeof obj.currentPath === 'string' &&
    isValidUserType(obj.userType)
  );
};

export const isValidPersistedState = (value: unknown): value is PersistedState => {
  const obj = asRecord(value);
  if (!obj) return false;
  return (
    isValidSession(obj.session) &&
    Array.isArray(obj.sessionStack) &&
    (obj.sessionStack as unknown[]).every(isValidSessionSnapshot) &&
    (obj.ftpSession === null || isValidFtpSession(obj.ftpSession)) &&
    // ncSession was added after v0 — old persisted data may have it as undefined (missing key)
    (obj.ncSession === null || obj.ncSession === undefined || isValidNcSession(obj.ncSession))
  );
};

export const createDefaultSession = (username: string): Session => ({
  username,
  userType: 'user',
  machine: 'localhost',
  currentPath: `/home/${username}`,
  theme: DEFAULT_THEME_ID,
  // Default localhost is the implicit untracked state — no server-side row.
  sessionId: null,
});

// Persisted sessions from before the sessionId field was added may lack it —
// default to null (untracked) so old saves keep working.
export const normalizeSession = (session: Session): Session => {
  const raw = session as Record<string, unknown>;
  return {
    ...session,
    theme: isValidThemeId(session.theme) ? session.theme : DEFAULT_THEME_ID,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
  };
};

export const isValidSessionReason = (value: unknown): value is 'ssh' | 'su' | 'exploit' =>
  value === 'ssh' || value === 'su' || value === 'exploit';

// Old persisted snapshots may lack `reason` or `sessionId` — default to 'ssh'
// and null respectively for backward compatibility with pre-Phase-5 saves.
export const normalizeSnapshot = (snapshot: SessionSnapshot): SessionSnapshot => {
  const raw = snapshot as Record<string, unknown>;
  return {
    ...snapshot,
    theme: isValidThemeId(snapshot.theme) ? snapshot.theme : DEFAULT_THEME_ID,
    reason: isValidSessionReason(raw.reason) ? raw.reason : 'ssh',
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
  };
};

// Persisted FTP sessions from before sessionId was added may lack it —
// default to null. The previous server-side session row (if any) is
// orphaned and will be cleaned up by a future sweeper. Acceptable for
// pre-launch.
export const normalizeFtpSession = (ftp: FtpSession): FtpSession => {
  const raw = ftp as Record<string, unknown>;
  return {
    ...ftp,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
  };
};
