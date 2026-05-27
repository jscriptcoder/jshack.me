/**
 * buildCommandEnv — wire a `CommandEnv` from UI state + adapters.
 *
 * This is the one factory the UI constructs (per core-contracts). It is a
 * pure function: caller passes the current identity, session, FS tree, and
 * cwd (read out of signals at call time); the command sees only `env`.
 *
 * Slice scope: `fs` is wired for real (the only thing `cat` needs). Mutation,
 * streaming output, and cross-player APIs are loud stubs until a command
 * actually needs them — silent no-ops would hide missing wiring.
 */

import { asEpochMs, asGameTime, type AbsPath } from '../core/types';
import type {
  CommandEnv,
  Identity,
  LogApi,
  NetworkView,
  OutputSink,
  PatchApi,
  RemoteApi,
  Session,
} from '../core/commands/types';
import type { Directory } from '../core/filesystem/types';
import { createFsView } from '../core/filesystem/fsView';

export type BuildCommandEnvArgs = {
  readonly identity: Identity;
  readonly session: Session;
  readonly root: Directory;
  readonly cwd: AbsPath;
};

const notWired =
  (method: string) =>
  (): never => {
    throw new Error(`buildCommandEnv: ${method} is not wired in the terminal slice`);
  };

const networkStub = (session: Session): NetworkView => ({
  currentMachine: () => session.machineId,
  findMachineByAddress: () => null,
  resolveDns: () => null,
});

const outputStub = (): OutputSink => ({
  text: notWired('output.text'),
  error: notWired('output.error'),
  dim: notWired('output.dim'),
});

const patchStub = (): PatchApi => ({
  write: notWired('patches.write'),
  remove: notWired('patches.remove'),
  mkdir: notWired('patches.mkdir'),
});

const remoteStub = (): RemoteApi => ({ listPatches: notWired('remote.listPatches') });

const logStub = (): LogApi => ({
  appendAuthLog: async () => undefined,
  appendAccessLog: async () => undefined,
});

export const buildCommandEnv = (args: BuildCommandEnvArgs): CommandEnv => ({
  identity: args.identity,
  session: args.session,
  hopChain: [],
  gameTime: () => asGameTime(0),
  now: () => asEpochMs(Date.now()),
  fs: createFsView(args.root, { userType: args.session.userType, cwd: args.cwd }),
  network: networkStub(args.session),
  output: outputStub(),
  patches: patchStub(),
  remote: remoteStub(),
  log: logStub(),
  signal: new AbortController().signal,
});
