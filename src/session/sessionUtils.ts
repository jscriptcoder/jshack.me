import type { ThemeId } from '../theme/themes';
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

export const defaultSession: Session = {
  username: 'jshacker',
  userType: 'user',
  machine: 'localhost',
  currentPath: '/home/jshacker',
  theme: DEFAULT_THEME_ID as ThemeId,
};

export const normalizeSession = (session: Session): Session => ({
  ...session,
  theme: isValidThemeId(session.theme) ? session.theme : DEFAULT_THEME_ID,
});

export const normalizeSnapshot = (snapshot: SessionSnapshot): SessionSnapshot => ({
  ...snapshot,
  theme: isValidThemeId(snapshot.theme) ? snapshot.theme : DEFAULT_THEME_ID,
});
