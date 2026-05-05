import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  FileNode,
  FilePermissions,
  FileSystemPatch,
  MachineCreateOp,
  MachineDeleteOp,
  MachineFileOp,
  MachineMkdirOp,
  MachineWriteOp,
  PermissionResult,
} from './types';
import { useSession } from '../session/SessionContext';
import type { UserType } from '../session/types';
import { getDefaultHomePath, type MachineId } from './machineFileSystems';
import { getCachedFilesystemPatches, getDatabase } from '../utils/storageCache';
import { saveFilesystemPatches } from '../utils/storage';
import { createSyncChannel, type SyncMessage } from '../utils/crossTabSync';
import { getIdentity } from '../identity';
import {
  upsertPatch as upsertPatchOnServer,
  removePatch as removePatchOnServer,
  listPatchesForMachines as listPatchesForMachinesFromServer,
} from '../patchRegistry/client';
import { getRealtimeClient, subscribeToMachine, type PatchHint } from '../patchRegistry/realtime';
import {
  resolvePath as resolvePathUtil,
  getNodeAtPath,
  checkTraversal,
  updateNodeAtPath,
  ensureChildAtPath,
  removeChildAtPath,
  upsertPatch,
  applyPatches,
  planDirectoryCreation,
  type FileSystemsState,
} from './fileSystemUtils';
import { canRead as canReadPerms, canWrite as canWritePerms } from './permissionWalker';

type FileSystemContextValue = {
  readonly fileSystem: FileNode;
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly canRead: (path: string, userType: UserType) => PermissionResult;
  readonly canWrite: (path: string, userType: UserType) => PermissionResult;
  readonly listDirectory: (path: string, userType: UserType) => string[] | null;
  readonly readFile: (path: string, userType: UserType) => string | null;
  readonly writeFile: (path: string, content: string, userType: UserType) => PermissionResult;
  readonly createFile: (
    path: string,
    content: string,
    userType: UserType,
    permissions?: FilePermissions,
  ) => PermissionResult;
  readonly createDirectory: (
    path: string,
    userType: UserType,
    options?: { readonly parents?: boolean; readonly permissions?: FilePermissions },
  ) => PermissionResult;
  readonly deleteNode: (
    path: string,
    userType: UserType,
    options?: { readonly recursive?: boolean },
  ) => PermissionResult;
  readonly getDefaultHomePath: (machineId: string, username: string) => string;
  readonly resolvePathForMachine: (path: string, cwd: string) => string;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly canReadFromMachine: (op: MachineFileOp) => PermissionResult;
  readonly canWriteFromMachine: (op: MachineFileOp) => PermissionResult;
  readonly listDirectoryFromMachine: (op: MachineFileOp) => string[] | null;
  readonly readFileFromMachine: (op: MachineFileOp) => string | null;
  readonly writeFileToMachine: (op: MachineWriteOp) => PermissionResult;
  readonly createFileOnMachine: (op: MachineCreateOp) => PermissionResult;
  // Write-or-create: existing files get the writeFileToMachine path
  // (overwrite content, preserve owner/permissions); missing paths get
  // the createFileOnMachine path (new file owned by `userType`). Used by
  // msfconsole's writeRemoteFile so effects that target new paths
  // (file_write, backdoor_port_open) actually fire upsertPatch.
  readonly upsertFileOnMachine: (op: MachineWriteOp) => PermissionResult;
  readonly createDirectoryOnMachine: (op: MachineMkdirOp) => PermissionResult;
  readonly deleteNodeFromMachine: (op: MachineDeleteOp) => PermissionResult;
  readonly updatePermissions: (
    path: string,
    permissions: FilePermissions,
    userType: UserType,
  ) => PermissionResult;
  readonly canTraverse: (path: string, userType: UserType) => PermissionResult;
  readonly canTraverseOnMachine: (
    machineId: MachineId,
    path: string,
    userType: UserType,
  ) => PermissionResult;
  // True between mount and the first listPatchesForMachines resolve (success OR failure).
  // No UI gates on this today (the IndexedDB cache covers initial paint), but
  // exposed for future loading-indicator wiring.
  readonly isRehydrating: boolean;
  // Resolves when every patch network call that was in flight at the
  // moment of the call has settled. Used by transient-session wrappers
  // (scp/snmpset/msfconsole one-shots) to wait for fire-and-forget
  // upsertPatch / removePatch calls before the wrapping endSession
  // fires — otherwise endSession can land at the server first and the
  // patch hits 403 no_session via the L1 gate.
  readonly flushPendingPatches: () => Promise<void>;
};

const FileSystemContext = createContext<FileSystemContextValue | null>(null);

// Debounce window for Realtime hint refetches. Multiple hints arriving
// within this window coalesce into a single listPatchesForMachines
// call covering all affected machines. Tuned for "feels live" cross-
// player updates (~150ms is below the human eye's continuous-motion
// threshold of ~200ms) while still batching simultaneous edits.
const HINT_REFETCH_DEBOUNCE_MS = 150;

// Debounce window for the rehydration fetch. The machineIdsKey changes
// 2-3 times during initial mount as different providers resolve at
// different times (HomeNetworksContext + WorldNetworks ~immediate from
// cache; MissionProvider ~seconds later from server). Without
// debouncing, each keyset change spawns its own listPatchesForMachines
// round-trip, and the first 1-2 fetches are wasted (the next-arriving
// keyset's fetch supersedes them). 150ms coalesces the home/world
// arrivals; mission state typically arrives well past this window
// and gets its own fetch (which is correct — we couldn't have known
// to wait for it).
//
// Initial paint is unaffected — the IndexedDB cache (read synchronously
// in the FileSystemProvider's useState initializer) covers the gap
// before the server's authoritative response.
const REHYDRATION_DEBOUNCE_MS = 150;

// Pure reducer: apply a single FileSystemPatch onto a patches list.
// Used by every path that mutates the patches list — local writes
// (broadcastAndRecordPatch), cross-tab BroadcastChannel arrivals
// (applyExternalPatch), and hint-refetch pending-write replay
// (refetchMachines). Centralizes the null-content / isNew /
// descendant-cleanup branching so all three paths stay in sync.
//
//   content !== null              → upsert the patch (write/create)
//   content === null && isNew     → drop the patch + descendants
//                                   (created-via-patch file deleted;
//                                    no tombstone needed since the row
//                                    never reflected base FS state)
//   content === null && !isNew    → drop descendants, then upsert the
//                                   null-marker (base file deletion)
const applyPatchToList = (
  prev: readonly FileSystemPatch[],
  patch: FileSystemPatch,
): readonly FileSystemPatch[] => {
  if (patch.content !== null) return upsertPatch(prev, patch);

  const existing = prev.find((p) => p.machineId === patch.machineId && p.path === patch.path);
  const deletedPrefix = patch.path.endsWith('/') ? patch.path : patch.path + '/';
  const withoutChildren = prev.filter(
    (p) => !(p.machineId === patch.machineId && p.path.startsWith(deletedPrefix)),
  );

  if (existing?.isNew) {
    return withoutChildren.filter(
      (p) => !(p.machineId === patch.machineId && p.path === patch.path),
    );
  }
  return upsertPatch(withoutChildren, patch);
};

type FileSystemProviderProps = {
  readonly children: ReactNode;
  readonly localhostFileSystem: FileNode;
  readonly missionFileSystems?: Readonly<Record<string, FileNode>>;
  readonly homeFileSystems?: Readonly<Record<string, FileNode>>;
  readonly lanOccupantHostnames?: readonly string[];
};

export const FileSystemProvider = ({
  children,
  localhostFileSystem,
  missionFileSystems,
  homeFileSystems,
}: FileSystemProviderProps) => {
  const { session, hostname } = useSession();
  // The player's workstation filesystem is keyed under their workstation_id
  // (= suffixed hostname). Same value used for storage (patches.machine_id),
  // Realtime channel name, and the home_network_occupants.hostname column
  // others see. The legacy 'localhost' literal is gone from storage; the
  // localhostFileSystem PROP name is kept for now to keep this PR focused
  // — its content is the player's workstation filesystem.
  const workstationId = hostname;
  // Set of machine_ids whose patches survive WiFi/mission transitions.
  // Currently only the player's own workstation; home network and mission
  // machines come and go with WiFi connect / mission accept. Recomputed
  // per render because workstationId is per-player at the prop layer.
  const persistentMachineKeys = useMemo(() => new Set([workstationId]), [workstationId]);
  const [fileSystems, setFileSystems] = useState<FileSystemsState>(() =>
    applyPatches({ [workstationId]: localhostFileSystem }, getCachedFilesystemPatches()),
  );
  const [patches, setPatches] = useState<readonly FileSystemPatch[]>(getCachedFilesystemPatches);
  // True between mount and the first listPatchesForMachines resolve (success or failure).
  const [isRehydrating, setIsRehydrating] = useState(true);
  // Create channel inside effect so StrictMode's cleanup + re-run cycle gets
  // a fresh (open) channel. The ref is updated so broadcastAndRecordPatch always
  // posts on the currently-active channel.
  const syncChannelRef = useRef<ReturnType<typeof createSyncChannel> | null>(null);
  // patchesRef mirrors `patches` so broadcastAndRecordPatch can look up the
  // existing patch (for the isNew vs base-file decision) without re-creating
  // the callback on every patches change. See the useEffect below the state.
  const patchesRef = useRef<readonly FileSystemPatch[]>(patches);
  // propsRef captures the latest base/home/mission filesystems so the
  // rehydration .then() can rebuild fileSystems from the freshest layered
  // base, even if props changed during the in-flight listPatchesForMachines.
  const propsRef = useRef({ localhostFileSystem, homeFileSystems, missionFileSystems });
  // Set to true the first time the user does any local write/delete after
  // mount. The rehydration .then() reads this and SKIPS server-truth
  // replacement when local writes are in flight — those upserts are already
  // heading to the server fire-and-forget, the next mount will see the merged
  // truth. Avoids clobbering a user's just-typed change if listPatchesForMachines lands
  // a few hundred ms after mount.
  const localWritesSinceMount = useRef(false);
  // In-flight patch network calls. Each upsertPatch/removePatch promise
  // gets registered here on dispatch and removed on settle. Used by
  // flushPendingPatches() to let transient-session wrappers wait for
  // fire-and-forget patches to land before they end the session — see
  // the FileSystemContextValue.flushPendingPatches doc-comment.
  const pendingPatchesRef = useRef<Set<Promise<unknown>>>(new Set());

  // In-flight LOCAL writes, keyed by `${machineId}::${path}` →
  // FileSystemPatch. A patch enters when broadcastAndRecordPatch dispatches
  // its server POST; it leaves on POST settle (success or failure). Used by
  // hint-driven refetches to replay pending writes on top of the
  // server-truth result, so a cross-player edit on the same machine
  // doesn't clobber what the user just typed but hasn't yet persisted.
  // Without this, race scenario:
  //   1. I type "abc" optimistically; POST in flight
  //   2. Player B writes elsewhere on same machine; their server hint
  //      arrives with a different originator_key, so I refetch
  //   3. My refetch returns server state without my "abc"
  //   4. Without replay, my local "abc" gets overwritten by truth
  // Replay reapplies the pending patch on top, preserving local state
  // until the POST settles and the next refetch sees server agreement.
  const pendingWritesRef = useRef<Map<string, FileSystemPatch>>(new Map());

  // Pending machine_ids queued for hint-driven refetch. Multiple hints
  // within the debounce window accumulate here and get flushed in one
  // listPatchesForMachines call.
  const pendingHintMachinesRef = useRef<Set<string>>(new Set());
  // Active debounce timer for hint refetch. Cleared on cleanup.
  const hintDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply a patch that originated outside this React tree — currently
  // only from another tab via BroadcastChannel (cross-tab same-identity
  // sync). Realtime cross-player updates flow through the hint-refetch
  // path (handlePatchHint below) instead, which fetches authoritative
  // server state rather than trusting an unsignable broadcast payload.
  // Idempotent: applying the same patch twice produces the same result.
  const applyExternalPatch = useCallback((patch: FileSystemPatch) => {
    setFileSystems((prev) => applyPatches(prev, [patch]));
    setPatches((prev) => applyPatchToList(prev, patch));
  }, []);

  // Subscribe to filesystem patches from other tabs in the same browser.
  // BroadcastChannel does not deliver messages to the posting tab, so no echo guard needed.
  useEffect(() => {
    const channel = createSyncChannel();
    syncChannelRef.current = channel;
    channel.onMessage((message: SyncMessage) => {
      if (message.type !== 'filesystem-patch') return;
      applyExternalPatch(message.patch);
    });
    return () => channel.close();
  }, [applyExternalPatch]);

  // Persist all patches (static + mission) to IndexedDB. Mission patches are replayed
  // on top of regenerated filesystems when the page reloads with an active mission seed.
  useEffect(() => {
    const db = getDatabase();
    if (db) {
      saveFilesystemPatches(db, [...patches]);
    }
  }, [patches]);

  // Keep patchesRef and propsRef in sync with the current state/props so
  // ref-readers always observe the latest committed values.
  useEffect(() => {
    patchesRef.current = patches;
  }, [patches]);
  useEffect(() => {
    propsRef.current = { localhostFileSystem, homeFileSystems, missionFileSystems };
  }, [localhostFileSystem, homeFileSystems, missionFileSystems]);

  // Stable signature of the current machine_ids set: workstation +
  // homeFileSystems keys + missionFileSystems keys, deduped + sorted.
  // Used as the dep for both the rehydration fetch and the Realtime
  // subscription effects so they re-run together when the keyset
  // changes (mid-session WiFi crack, mission accept, world networks
  // resolving after mount).
  const machineIdsKey = useMemo(() => {
    const ids = new Set<string>([workstationId]);
    if (homeFileSystems) for (const id of Object.keys(homeFileSystems)) ids.add(id);
    if (missionFileSystems) for (const id of Object.keys(missionFileSystems)) ids.add(id);
    return [...ids].sort().join(',');
  }, [homeFileSystems, missionFileSystems, workstationId]);

  // Tracks whether the next rehydration fetch is the very first one.
  // The localWritesSinceMount guard (which skips server-truth
  // replacement when the user has already typed something locally) is
  // only honored on the initial fetch — subsequent keyset-change
  // refetches always merge so late-loading machines (worlds, missions
  // accepted mid-session, etc.) surface their cross-player patches.
  const isInitialFetch = useRef(true);

  // Rehydration fetch — fires on initial mount AND whenever the
  // machine_ids keyset changes (worlds resolve after mount, mission
  // accept, mid-session WiFi crack). The IndexedDB cache covers fast
  // initial paint; this useEffect performs the cross-device +
  // cross-player sync once the network responds.
  //
  // Debounced via REHYDRATION_DEBOUNCE_MS so the rapid keyset changes
  // during initial mount (home/world arrive ~immediately, then mission
  // ~seconds later) don't spawn a wasted localhost-only fetch first.
  // isInitialFetch.current is flipped INSIDE the timer callback so a
  // cancelled-before-fire fetch doesn't burn the "initial" marker —
  // the next surviving fetch still runs as the initial one.
  //
  // Race window (initial mount only): a local write before
  // listPatchesForMachines resolves sets localWritesSinceMount and we
  // skip replacement. The local upsert is already on its way to the
  // server fire-and-forget; the next fetch reconciles. We deliberately
  // don't apply this guard to keyset-change refetches — those need to
  // populate state for newly-loaded machines, and "the user typed
  // before any keyset change ever happened" doesn't usefully imply
  // "all subsequent keyset changes should skip the fetch."
  useEffect(() => {
    const machineIds = machineIdsKey.split(',').filter(Boolean);

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const wasInitial = isInitialFetch.current;
      isInitialFetch.current = false;

      void listPatchesForMachinesFromServer(getIdentity(), machineIds)
        .then((serverPatches) => {
          if (cancelled) return;
          if (wasInitial && localWritesSinceMount.current) return;
          // Replace patches state + IndexedDB cache + rebuild fileSystems
          // from the freshest layered base.
          setPatches(serverPatches);
          const db = getDatabase();
          if (db) saveFilesystemPatches(db, [...serverPatches]);
          const props = propsRef.current;
          const base = { [workstationId]: props.localhostFileSystem };
          const withHome = props.homeFileSystems ? { ...base, ...props.homeFileSystems } : base;
          const merged = props.missionFileSystems
            ? { ...withHome, ...props.missionFileSystems }
            : withHome;
          setFileSystems(applyPatches(merged, serverPatches));
        })
        .catch((error) => {
          if (cancelled) return;
          console.error('[fs] patch rehydration failed:', error);
        })
        .finally(() => {
          // isRehydrating is the "first load not yet complete" flag —
          // only flips on the initial fetch. Subsequent refetches don't
          // toggle it (UI shouldn't re-show a rehydration spinner on
          // every late-arriving network).
          if (!cancelled && wasInitial) setIsRehydrating(false);
        });
    }, REHYDRATION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [machineIdsKey, workstationId]);

  // Hint-driven refetch: snapshot the pending machine_ids set, fetch
  // authoritative state for those machines via listPatchesForMachines,
  // splice the result into patches state (leaving unaffected machines
  // untouched), and replay any in-flight local writes on top.
  //
  // Why a hint refetch instead of applying the broadcast payload
  // directly: the prior design shipped the full PatchSummary in the
  // Realtime event, but the broadcast channel is anon-publishable from
  // the browser bundle, so any client could forge a patch_change with
  // fake content. Hints carry only `(machine_id, originator_key)`;
  // forgery is harmless because the actual data fetch goes through the
  // signed /api/patches endpoint which returns server truth. See
  // project_realtime_publish_authorization memory.
  const refetchAffectedMachines = useCallback(
    async (machineIds: ReadonlyArray<string>) => {
      if (machineIds.length === 0) return;
      let serverPatches: ReadonlyArray<FileSystemPatch>;
      try {
        serverPatches = await listPatchesForMachinesFromServer(getIdentity(), machineIds);
      } catch (error) {
        console.error('[fs] hint refetch failed:', error);
        return;
      }
      const affected = new Set(machineIds);
      setPatches((prev) => {
        // Drop existing patches for the affected machines, splice in the
        // server-truth rows for those machines, then replay any pending
        // local writes (so an in-flight POST that hasn't reached the DB
        // yet doesn't get clobbered by the cross-player refetch).
        const others = prev.filter((p) => !affected.has(p.machineId));
        let next: readonly FileSystemPatch[] = [...others, ...serverPatches];
        for (const pending of pendingWritesRef.current.values()) {
          if (affected.has(pending.machineId)) {
            next = applyPatchToList(next, pending);
          }
        }
        const props = propsRef.current;
        const base = { [workstationId]: props.localhostFileSystem };
        const withHome = props.homeFileSystems ? { ...base, ...props.homeFileSystems } : base;
        const merged = props.missionFileSystems
          ? { ...withHome, ...props.missionFileSystems }
          : withHome;
        setFileSystems(applyPatches(merged, next));
        const db = getDatabase();
        if (db) saveFilesystemPatches(db, [...next]);
        return next;
      });
    },
    [workstationId],
  );

  // Identity is stable for the session; capture once and read from a
  // ref so the hint handler's identity check can't race with mid-
  // session re-renders. (Identity itself never changes within a tab.)
  const ownPubkeyRef = useRef<string>(getIdentity().publicKeyHex);

  // Realtime: subscribe to per-machine broadcast channels for every
  // machine in the current view, INCLUDING the player's own
  // workstation. Inbound events are HINTS — receivers refetch
  // authoritative state via listPatchesForMachines instead of
  // trusting an unsignable broadcast payload.
  //
  // The keyset signature (sorted-joined string) is the dep — when home
  // or mission filesystems change keys, we tear down all channels and
  // resubscribe to the new set. Mid-session WiFi crack / mission
  // accept therefore picks up live updates without page reload.
  //
  // The workstation channel is INCLUDED here. Under the eliminated-
  // localhost model, the player's workstation_id is unique per player,
  // so subscribing to patches:<workstation_id> doesn't leak neighbors'
  // changes — each player's workstation has its own channel. This is
  // the load-bearing piece of cross-player workstation visibility:
  // when player A nmaps player B's workstation, A's write lands as
  // patches.machine_id=<B.workstation_id>, fires a hint on
  // patches:<B.workstation_id>, and B (subscribed) refetches and sees
  // it. Same-tab sync still flows through BroadcastChannel; the
  // self-skip check below filters out our own broadcasts so we don't
  // refetch our own keystrokes.
  //
  // Graceful degradation: getRealtimeClient() returns null when
  // VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY are missing. The app
  // keeps working — page-reload-driven rehydration still surfaces
  // cross-player changes.
  useEffect(() => {
    const client = getRealtimeClient();
    if (!client) return;

    // Capture the ref-held Set into a local const so the cleanup
    // closure references the same object the effect body uses (and
    // satisfies react-hooks/exhaustive-deps without disabling). The
    // ref is stable across effect re-runs by construction.
    const pendingMachines = pendingHintMachinesRef.current;

    const handleHint = (hint: PatchHint) => {
      // Self-skip: the local optimistic apply + cross-tab BroadcastChannel
      // already covered our own writes. Without this, every keystroke
      // would echo back through Realtime and trigger a refetch — wasted
      // round-trips and a real risk of clobbering an in-flight POST that
      // hasn't yet reached the DB.
      //
      // A forger can spoof originator_key to make the victim skip ONE
      // refetch per forged hint; authentic hints from real writers will
      // still trigger refetches. No data corruption, just delayed
      // visibility on one specific change. Documented in
      // project_realtime_publish_authorization memory.
      if (hint.originatorKey === ownPubkeyRef.current) return;

      pendingMachines.add(hint.machineId);
      if (hintDebounceTimerRef.current !== null) {
        clearTimeout(hintDebounceTimerRef.current);
      }
      hintDebounceTimerRef.current = setTimeout(() => {
        hintDebounceTimerRef.current = null;
        const machineIds = [...pendingMachines];
        pendingMachines.clear();
        void refetchAffectedMachines(machineIds);
      }, HINT_REFETCH_DEBOUNCE_MS);
    };

    const machineIds = machineIdsKey.split(',').filter(Boolean);
    const unsubscribers = machineIds.map((id) => subscribeToMachine(client, id, handleHint));

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      if (hintDebounceTimerRef.current !== null) {
        clearTimeout(hintDebounceTimerRef.current);
        hintDebounceTimerRef.current = null;
      }
      pendingMachines.clear();
    };
  }, [machineIdsKey, refetchAffectedMachines]);

  // Track whether the missionFileSystems effect is running for the first time.
  // On initial mount with a persisted mission, we replay cached patches so the
  // user's in-progress work (apt installs, nano edits, etc.) survives page reload.
  const isInitialMissionMount = useRef(true);

  // Snapshot of cached patches at mount time — used only once during initial
  // mission replay and never updated, avoiding a stale dependency in the effect.
  const cachedPatchesAtMount = useMemo(() => getCachedFilesystemPatches(), []);

  // When a mission starts/ends, OR when the home network arrives async
  // on initial page load, OR when world networks resolve — re-merge the
  // base + home + mission filesystems. Patches are NEVER wiped here:
  // mission instances are permanent (per project_multiplayer_mission_-
  // instances memory — once accepted, the seed retires but the instance
  // and its patches persist forever for anyone who can route to it),
  // home networks are shared persistent infrastructure, and
  // cross-player writes on shared machines are part of the world.
  // Rehydration naturally scopes local patches state to whatever
  // machines are currently in view.
  useEffect(() => {
    setFileSystems((prev) => {
      const staticOnly = Object.fromEntries(
        Object.entries(prev).filter(([key]) => persistentMachineKeys.has(key)),
      );

      // Layer: static (player's workstation) + home network + mission network
      const withHome = homeFileSystems ? { ...staticOnly, ...homeFileSystems } : staticOnly;
      const merged = missionFileSystems ? { ...withHome, ...missionFileSystems } : withHome;

      if (!missionFileSystems && !homeFileSystems) {
        isInitialMissionMount.current = false;
        return staticOnly;
      }

      // On initial mount, replay persisted non-static patches on top of regenerated
      // filesystems so the user's in-progress changes survive page reload.
      if (isInitialMissionMount.current) {
        isInitialMissionMount.current = false;
        const dynamicPatches = cachedPatchesAtMount.filter(
          (p) => !persistentMachineKeys.has(p.machineId),
        );
        if (dynamicPatches.length > 0) {
          return applyPatches(merged, dynamicPatches);
        }
      }

      return merged;
    });
  }, [missionFileSystems, homeFileSystems, cachedPatchesAtMount, persistentMachineKeys]);

  // session.machine is typed as string but always holds a valid MachineId at runtime
  // (set by SSH/session logic). MachineId is currently a string alias, so no cast
  // is needed; the named type just documents the intent.
  const currentMachine: MachineId = session.machine;
  const currentPath = session.currentPath;
  // Fallback to the player's own workstation as a safety net — in practice
  // currentMachine always matches a key in fileSystems because SSH only
  // connects to known machines.
  const fileSystem = fileSystems[currentMachine] ?? fileSystems[workstationId];

  const resolvePathForMachine = useCallback(
    (path: string, cwd: string): string => resolvePathUtil(path, cwd),
    [],
  );

  const resolvePath = useCallback(
    (path: string): string => resolvePathUtil(path, currentPath),
    [currentPath],
  );

  const getNodeFromMachine = useCallback(
    (machineId: MachineId, path: string, cwd: string): FileNode | null => {
      const fs = fileSystems[machineId];
      if (!fs) return null;
      const resolvedPath = resolvePathUtil(path, cwd);
      return getNodeAtPath(fs, resolvedPath);
    },
    [fileSystems],
  );

  const getNode = useCallback(
    (path: string): FileNode | null => {
      const resolvedPath = path.startsWith('/') ? path : resolvePathUtil(path, currentPath);
      return getNodeAtPath(fileSystem, resolvedPath);
    },
    [fileSystem, currentPath],
  );

  const canReadFromMachine = useCallback(
    ({ machineId, path, cwd, userType }: MachineFileOp): PermissionResult => {
      const fs = fileSystems[machineId];
      if (!fs) return { allowed: false, error: `No such file or directory: ${path}` };
      const resolvedPath = resolvePathUtil(path, cwd);
      const traversal = checkTraversal(fs, resolvedPath, userType);
      if (!traversal.allowed) return { allowed: false, error: `Permission denied: ${path}` };
      const node = getNodeAtPath(fs, resolvedPath);
      if (!node) return { allowed: false, error: `No such file or directory: ${path}` };
      // Leaf check delegated to the shared L2 walker. parentChain is empty
      // here because checkTraversal above already validated the chain;
      // server-side L2 will populate parentChain from machine_filesystems
      // rows since it doesn't have a tree to walk.
      const leaf = canReadPerms({ userType, target: node.permissions, parentChain: [] });
      if (!leaf.allowed) return { allowed: false, error: `Permission denied: ${path}` };
      return { allowed: true };
    },
    [fileSystems],
  );

  const canWriteFromMachine = useCallback(
    ({ machineId, path, cwd, userType }: MachineFileOp): PermissionResult => {
      const fs = fileSystems[machineId];
      if (!fs) return { allowed: false, error: `No such file or directory: ${path}` };
      const resolvedPath = resolvePathUtil(path, cwd);
      const traversal = checkTraversal(fs, resolvedPath, userType);
      if (!traversal.allowed) return { allowed: false, error: `Permission denied: ${path}` };
      const node = getNodeAtPath(fs, resolvedPath);
      if (!node) return { allowed: false, error: `No such file or directory: ${path}` };
      const leaf = canWritePerms({ userType, target: node.permissions, parentChain: [] });
      if (!leaf.allowed) return { allowed: false, error: `Permission denied: ${path}` };
      return { allowed: true };
    },
    [fileSystems],
  );

  const canRead = useCallback(
    (path: string, userType: UserType): PermissionResult => {
      return canReadFromMachine({ machineId: currentMachine, path, cwd: currentPath, userType });
    },
    [canReadFromMachine, currentMachine, currentPath],
  );

  const canWrite = useCallback(
    (path: string, userType: UserType): PermissionResult => {
      return canWriteFromMachine({ machineId: currentMachine, path, cwd: currentPath, userType });
    },
    [canWriteFromMachine, currentMachine, currentPath],
  );

  const listDirectoryFromMachine = useCallback(
    (op: MachineFileOp): string[] | null => {
      const permission = canReadFromMachine(op);
      if (!permission.allowed) return null;

      const node = getNodeFromMachine(op.machineId, op.path, op.cwd);
      if (!node || node.type !== 'directory' || !node.children) return null;

      return Object.keys(node.children).sort();
    },
    [canReadFromMachine, getNodeFromMachine],
  );

  const readFileFromMachine = useCallback(
    (op: MachineFileOp): string | null => {
      const permission = canReadFromMachine(op);
      if (!permission.allowed) return null;

      const node = getNodeFromMachine(op.machineId, op.path, op.cwd);
      if (!node || node.type !== 'file') return null;

      return node.content ?? '';
    },
    [canReadFromMachine, getNodeFromMachine],
  );

  const listDirectory = useCallback(
    (path: string, userType: UserType): string[] | null => {
      return listDirectoryFromMachine({
        machineId: currentMachine,
        path,
        cwd: currentPath,
        userType,
      });
    },
    [listDirectoryFromMachine, currentMachine, currentPath],
  );

  const readFile = useCallback(
    (path: string, userType: UserType): string | null => {
      return readFileFromMachine({ machineId: currentMachine, path, cwd: currentPath, userType });
    },
    [readFileFromMachine, currentMachine, currentPath],
  );

  // Broadcasts a patch to other tabs, fires the right server-side call, and
  // updates local patch state. The server-side dispatch is fire-and-forget —
  // sync callers don't await; failures are logged but never block the UI.
  // See feedback memory: feedback_react_context_server_integration.md.
  //
  // Deletion of a patch-created file (isNew) removes the patch entirely
  // instead of recording a null patch — the file never existed in the base
  // filesystem. Deletion of a base filesystem file records a null patch.
  // Both cases also remove any child patches under the deleted path.
  //
  // Server dispatch table:
  //   write/create (content !== null)        → upsertPatchOnServer
  //   delete isNew (content === null & isNew) → removePatchOnServer (handles
  //                                              descendants via path_prefix)
  //   delete base  (content === null & !isNew)→ removePatchOnServer THEN
  //                                              upsertPatchOnServer (null
  //                                              marker after descendant
  //                                              cleanup)
  //
  // The existing-row lookup for the isNew vs base decision uses patchesRef,
  // not the live setPatches prev. A rare race (rapid create+delete in the
  // same tick) might pick the wrong branch and leave a stale null marker
  // server-side; the local in-memory state is still correct, and the
  // marker is harmless on the next rehydration (applyPatches treats it as
  // a deletion — same outcome).
  // Registers a fire-and-forget patch network promise into the pending
  // set so flushPendingPatches() can await it. The promise is removed
  // on settle (success OR rejection) so the set always reflects only
  // currently-in-flight calls.
  const trackPending = (promise: Promise<unknown>): void => {
    pendingPatchesRef.current.add(promise);
    void promise.finally(() => {
      pendingPatchesRef.current.delete(promise);
    });
  };

  // Register a local write into pendingWritesRef so any cross-player
  // hint refetch in flight can replay it on top of the server-truth
  // result. The entry is only cleared if THIS patch is still the
  // latest at this (machineId, path) — a subsequent write on the
  // same path will have replaced it, and that newer entry's own
  // settle handler is responsible for cleanup.
  const trackPendingWrite = (patch: FileSystemPatch, settled: Promise<unknown>): void => {
    const key = `${patch.machineId}::${patch.path}`;
    pendingWritesRef.current.set(key, patch);
    void settled.finally(() => {
      if (pendingWritesRef.current.get(key) === patch) {
        pendingWritesRef.current.delete(key);
      }
    });
  };

  const broadcastAndRecordPatch = useCallback((patch: FileSystemPatch) => {
    syncChannelRef.current?.broadcast({ type: 'filesystem-patch', patch });
    localWritesSinceMount.current = true;

    const existing = patchesRef.current.find(
      (p) => p.machineId === patch.machineId && p.path === patch.path,
    );
    let serverPromise: Promise<unknown>;
    if (patch.content !== null) {
      serverPromise = upsertPatchOnServer(getIdentity(), patch).catch((error) => {
        console.error('[fs] upsertPatch failed:', error);
      });
    } else if (existing?.isNew) {
      serverPromise = removePatchOnServer(getIdentity(), {
        machineId: patch.machineId,
        path: patch.path,
      }).catch((error) => {
        console.error('[fs] removePatch (isNew) failed:', error);
      });
    } else {
      // Base-file deletion: drop descendants first (they don't make sense
      // once the parent is marked deleted), then record the null marker.
      serverPromise = removePatchOnServer(getIdentity(), {
        machineId: patch.machineId,
        path: patch.path,
      })
        .then(() => upsertPatchOnServer(getIdentity(), patch))
        .catch((error) => {
          console.error('[fs] removePatch+upsertPatch failed:', error);
        });
    }
    trackPending(serverPromise);
    trackPendingWrite(patch, serverPromise);

    setPatches((prev) => applyPatchToList(prev, patch));
  }, []);

  const writeFileToMachine = useCallback(
    ({ machineId, path, cwd, content, userType }: MachineWriteOp): PermissionResult => {
      const permission = canWriteFromMachine({ machineId, path, cwd, userType });
      if (!permission.allowed) return permission;

      const node = getNodeFromMachine(machineId, path, cwd);
      if (!node || node.type !== 'file') return { allowed: false, error: `Not a file: ${path}` };

      const resolvedPath = resolvePathForMachine(path, cwd);
      const parts = resolvedPath.split('/').filter(Boolean);
      setFileSystems((prev) => ({
        ...prev,
        [machineId]: updateNodeAtPath(prev[machineId], parts, (fileNode) => ({
          ...fileNode,
          content,
        })),
      }));

      broadcastAndRecordPatch({
        machineId,
        path: resolvedPath,
        content,
        owner: node.owner,
        permissions: node.permissions,
      });

      return { allowed: true };
    },
    [canWriteFromMachine, getNodeFromMachine, resolvePathForMachine, broadcastAndRecordPatch],
  );

  const createFileOnMachine = useCallback(
    ({
      machineId,
      path,
      cwd,
      content,
      userType,
      permissions,
    }: MachineCreateOp): PermissionResult => {
      const resolvedPath = resolvePathForMachine(path, cwd);
      const parts = resolvedPath.split('/').filter(Boolean);
      const fileName = parts[parts.length - 1];
      const dirParts = parts.slice(0, -1);
      const dirPath = '/' + dirParts.join('/') || '/';

      const parentNode = getNodeFromMachine(machineId, dirPath, '/');
      const parentExists = parentNode?.type === 'directory';

      // If parent exists, check write permission and file collision
      if (parentExists) {
        const parentPermission = canWriteFromMachine({
          machineId,
          path: dirPath,
          cwd: '/',
          userType,
        });
        if (!parentPermission.allowed) return parentPermission;
        if (parentNode.children?.[fileName])
          return { allowed: false, error: `File exists: ${path}` };
      } else if (userType !== 'root') {
        // Only root can auto-create intermediate directories
        return { allowed: false, error: `Not a directory: ${dirPath}` };
      }

      const defaultPermissions: FilePermissions = {
        read: ['root', userType],
        write: ['root', userType],
        execute: ['root'],
      };

      const newFile: FileNode = {
        name: fileName,
        type: 'file',
        owner: userType,
        permissions: permissions ?? defaultPermissions,
        content,
      };

      // ensureChildAtPath auto-creates missing intermediate directories
      setFileSystems((prev) => ({
        ...prev,
        [machineId]: ensureChildAtPath(prev[machineId], dirParts, fileName, newFile),
      }));

      broadcastAndRecordPatch({
        machineId,
        path: resolvedPath,
        content,
        owner: userType,
        isNew: true,
        ...(permissions ? { permissions } : {}),
      });

      return { allowed: true };
    },
    [resolvePathForMachine, canWriteFromMachine, getNodeFromMachine, broadcastAndRecordPatch],
  );

  // Either-or: writes if the file exists, creates if it doesn't.
  // msfconsole's writeRemoteFile uses this so file_write / password_reset /
  // backdoor_port_open all work whether the destination path exists or not
  // (file_write and backdoor_port_open typically write brand-new paths).
  // Existing-file branch preserves the file's owner; new-file branch sets
  // owner to `userType`.
  const upsertFileOnMachine = useCallback(
    (op: MachineWriteOp): PermissionResult => {
      const node = getNodeFromMachine(op.machineId, op.path, op.cwd);
      if (node && node.type === 'file') {
        return writeFileToMachine(op);
      }
      return createFileOnMachine({
        machineId: op.machineId,
        path: op.path,
        cwd: op.cwd,
        content: op.content,
        userType: op.userType,
      });
    },
    [getNodeFromMachine, writeFileToMachine, createFileOnMachine],
  );

  const createDirectoryOnMachine = useCallback(
    ({
      machineId,
      path,
      cwd,
      userType,
      parents,
      permissions,
    }: MachineMkdirOp): PermissionResult => {
      const resolvedPath = resolvePathForMachine(path, cwd);

      if (resolvedPath === '/') {
        return { allowed: false, error: `mkdir: cannot create directory '${path}': File exists` };
      }

      const existing = getNodeFromMachine(machineId, resolvedPath, '/');

      if (existing) {
        if (parents) return { allowed: true };
        return { allowed: false, error: `mkdir: cannot create directory '${path}': File exists` };
      }

      const plan = planDirectoryCreation({
        parts: resolvedPath.split('/').filter(Boolean),
        targetPath: path,
        parents: parents ?? false,
        getNode: (p) => getNodeFromMachine(machineId, p, '/'),
        canWriteParent: (p) => canWriteFromMachine({ machineId, path: p, cwd: '/', userType }),
      });

      if (!plan.ok) return { allowed: false, error: plan.error };
      if (plan.toCreate.length === 0) return { allowed: true };

      const defaultPermissions: FilePermissions = {
        read: ['root', 'user', 'guest'],
        write: ['root', userType],
        execute: ['root', 'user', 'guest'],
      };

      plan.toCreate.forEach((dirPath) => {
        const dirParts = dirPath.split('/').filter(Boolean);
        const dirName = dirParts[dirParts.length - 1] ?? '';
        const parentParts = dirParts.slice(0, -1);

        const newDir: FileNode = {
          name: dirName,
          type: 'directory',
          owner: userType,
          permissions: permissions ?? defaultPermissions,
          children: {},
        };

        setFileSystems((prev) => ({
          ...prev,
          [machineId]: ensureChildAtPath(prev[machineId], parentParts, dirName, newDir),
        }));

        broadcastAndRecordPatch({
          machineId,
          path: dirPath,
          content: null,
          owner: userType,
          isNew: true,
          nodeType: 'directory',
          ...(permissions ? { permissions } : { permissions: defaultPermissions }),
        });
      });

      return { allowed: true };
    },
    [resolvePathForMachine, canWriteFromMachine, getNodeFromMachine, broadcastAndRecordPatch],
  );

  const deleteNodeFromMachine = useCallback(
    ({ machineId, path, cwd, userType, recursive }: MachineDeleteOp): PermissionResult => {
      const resolvedPath = resolvePathForMachine(path, cwd);
      if (resolvedPath === '/')
        return { allowed: false, error: 'rm: cannot remove root directory' };

      const parts = resolvedPath.split('/').filter(Boolean);
      const childName = parts[parts.length - 1];
      const dirParts = parts.slice(0, -1);
      const dirPath = '/' + dirParts.join('/') || '/';

      const parentPermission = canWriteFromMachine({
        machineId,
        path: dirPath,
        cwd: '/',
        userType,
      });
      if (!parentPermission.allowed)
        return { allowed: false, error: `rm: cannot remove '${path}': Permission denied` };

      const node = getNodeFromMachine(machineId, resolvedPath, '/');
      if (!node)
        return { allowed: false, error: `rm: cannot remove '${path}': No such file or directory` };

      if (node.type === 'directory' && !recursive)
        return { allowed: false, error: `rm: cannot remove '${path}': Is a directory` };

      setFileSystems((prev) => ({
        ...prev,
        [machineId]: removeChildAtPath(prev[machineId], dirParts, childName),
      }));

      broadcastAndRecordPatch({ machineId, path: resolvedPath, content: null, owner: userType });

      return { allowed: true };
    },
    [resolvePathForMachine, canWriteFromMachine, getNodeFromMachine, broadcastAndRecordPatch],
  );

  const deleteNode = useCallback(
    (
      path: string,
      userType: UserType,
      options?: { readonly recursive?: boolean },
    ): PermissionResult => {
      return deleteNodeFromMachine({
        machineId: currentMachine,
        path,
        cwd: currentPath,
        userType,
        recursive: options?.recursive,
      });
    },
    [deleteNodeFromMachine, currentMachine, currentPath],
  );

  const writeFile = useCallback(
    (path: string, content: string, userType: UserType): PermissionResult => {
      return writeFileToMachine({
        machineId: currentMachine,
        path,
        cwd: currentPath,
        content,
        userType,
      });
    },
    [writeFileToMachine, currentMachine, currentPath],
  );

  const createFile = useCallback(
    (
      path: string,
      content: string,
      userType: UserType,
      permissions?: FilePermissions,
    ): PermissionResult => {
      return createFileOnMachine({
        machineId: currentMachine,
        path,
        cwd: currentPath,
        content,
        userType,
        permissions,
      });
    },
    [createFileOnMachine, currentMachine, currentPath],
  );

  const createDirectory = useCallback(
    (
      path: string,
      userType: UserType,
      options?: { readonly parents?: boolean; readonly permissions?: FilePermissions },
    ): PermissionResult => {
      return createDirectoryOnMachine({
        machineId: currentMachine,
        path,
        cwd: currentPath,
        userType,
        parents: options?.parents,
        permissions: options?.permissions,
      });
    },
    [createDirectoryOnMachine, currentMachine, currentPath],
  );

  const updatePermissions = useCallback(
    (path: string, permissions: FilePermissions, userType: UserType): PermissionResult => {
      const resolvedPath = resolvePathUtil(path, currentPath);
      const node = getNodeAtPath(fileSystem, resolvedPath);
      if (!node) return { allowed: false, error: `No such file or directory: ${path}` };

      // Only owner or root can change permissions
      if (userType !== 'root' && userType !== node.owner) {
        return { allowed: false, error: `Operation not permitted: ${path}` };
      }

      const parts = resolvedPath.split('/').filter(Boolean);
      setFileSystems((prev) => ({
        ...prev,
        [currentMachine]: updateNodeAtPath(prev[currentMachine], parts, (fileNode) => ({
          ...fileNode,
          permissions,
        })),
      }));

      broadcastAndRecordPatch({
        machineId: currentMachine,
        path: resolvedPath,
        content: node.content ?? null,
        owner: node.owner,
        permissions,
      });

      return { allowed: true };
    },
    [fileSystem, currentPath, currentMachine, broadcastAndRecordPatch],
  );

  const canTraverseOnMachine = useCallback(
    (machineId: MachineId, path: string, userType: UserType): PermissionResult => {
      const fs = fileSystems[machineId];
      if (!fs) return { allowed: false, error: `Permission denied: ${path}` };
      const result = checkTraversal(fs, path, userType);
      if (!result.allowed) return { allowed: false, error: `Permission denied: ${path}` };
      return { allowed: true };
    },
    [fileSystems],
  );

  const canTraverseFn = useCallback(
    (path: string, userType: UserType): PermissionResult => {
      const resolvedPath = resolvePathUtil(path, currentPath);
      return canTraverseOnMachine(currentMachine, resolvedPath, userType);
    },
    [canTraverseOnMachine, currentMachine, currentPath],
  );

  const getDefaultHomePathFn = useCallback((machineId: string, username: string): string => {
    return getDefaultHomePath(machineId, username);
  }, []);

  // Snapshots the in-flight set at call time, then awaits all of them.
  // Patches dispatched AFTER the snapshot are not awaited (they belong to
  // a later body, not this transient-session body). allSettled — we don't
  // care if individual patches reject; the inner .catch already swallows
  // network errors, this is a safety net so flush never throws.
  const flushPendingPatches = useCallback(async (): Promise<void> => {
    const inflight = [...pendingPatchesRef.current];
    if (inflight.length === 0) return;
    await Promise.allSettled(inflight);
  }, []);

  return (
    <FileSystemContext.Provider
      value={{
        fileSystem,
        resolvePath,
        getNode,
        canRead,
        canWrite,
        listDirectory,
        readFile,
        writeFile,
        createFile,
        createDirectory,
        deleteNode,
        getDefaultHomePath: getDefaultHomePathFn,
        resolvePathForMachine,
        getNodeFromMachine,
        canReadFromMachine,
        canWriteFromMachine,
        listDirectoryFromMachine,
        readFileFromMachine,
        writeFileToMachine,
        createFileOnMachine,
        upsertFileOnMachine,
        createDirectoryOnMachine,
        deleteNodeFromMachine,
        updatePermissions,
        canTraverse: canTraverseFn,
        canTraverseOnMachine,
        isRehydrating,
        flushPendingPatches,
      }}
    >
      {children}
    </FileSystemContext.Provider>
  );
};

export const useFileSystem = (): FileSystemContextValue => {
  const context = useContext(FileSystemContext);
  if (!context) {
    throw new Error('useFileSystem must be used within a FileSystemProvider');
  }
  return context;
};
