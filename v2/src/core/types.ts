/**
 * Cross-cutting primitive types for `core/`.
 *
 * Branded types carry zero runtime cost — the brand is a compile-time
 * fiction. Constructors (`asMachineId`, `asAbsPath`, etc.) are the
 * single entry point; passing a raw string anywhere a branded type is
 * expected is a compile error.
 */

declare const __brand: unique symbol;
type Brand<TName extends string> = { readonly [__brand]: TName };

// ---- Privilege tier ----

export type UserType = 'guest' | 'user' | 'root';

// ---- Identity & wire identifiers ----

export type PlayerKeyHex = string & Brand<'PlayerKeyHex'>;
export const asPlayerKeyHex = (value: string): PlayerKeyHex => value as PlayerKeyHex;

export type MachineId = string & Brand<'MachineId'>;
export const asMachineId = (value: string): MachineId => value as MachineId;

export type NetworkAddress = string & Brand<'NetworkAddress'>;
export const asNetworkAddress = (value: string): NetworkAddress => value as NetworkAddress;

// ---- Filesystem ----

export type AbsPath = string & Brand<'AbsPath'>;
export const asAbsPath = (value: string): AbsPath => value as AbsPath;

// ---- Time ----

export type GameTime = number & Brand<'GameTime'>;
export const asGameTime = (value: number): GameTime => value as GameTime;

export type EpochMs = number & Brand<'EpochMs'>;
export const asEpochMs = (value: number): EpochMs => value as EpochMs;

// ---- Hashes ----

export type Sha256Hex = string & Brand<'Sha256Hex'>;
export const asSha256Hex = (value: string): Sha256Hex => value as Sha256Hex;
