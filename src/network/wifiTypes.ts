export type WifiConnection = {
  readonly essid: string;
  readonly bssid: string;
};

export const isValidWifiConnection = (value: unknown): value is WifiConnection =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).essid === 'string' &&
  typeof (value as Record<string, unknown>).bssid === 'string';
