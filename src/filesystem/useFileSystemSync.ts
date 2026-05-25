import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { flushSync } from 'react-dom';
import type { FileNode, FileSystemPatch } from './types';
import type { UserType } from '../session/types';
import { getCachedFilesystemPatches, getDatabase } from '../utils/storageCache';
import { saveFilesystemPatches } from '../utils/storage';
import { createSyncChannel, type SyncMessage } from '../utils/crossTabSync';
import { getIdentity } from '../identity';
import {
  getBaseFs as getBaseFsFromServer,
  listPatchesForMachines as listPatchesForMachinesFromServer,
} from '../patchRegistry/client';
import { getRealtimeClient, subscribeToMachine, type PatchHint } from '../patchRegistry/realtime';
import { applyPatchToList, applyPatches, type FileSystemsState } from './fileSystemUtils';
import { parseWorkstationId } from '../homeNetworks/homeNetworkHelpers';
import { useStableCallback } from '../hooks/useStableCallback';

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

type SessionInput = {
  readonly machine: string;
  readonly userType: UserType;
};

type Inputs = {
  readonly workstationId: string;
  readonly localhostFileSystem: FileNode;
  readonly homeFileSystems?: Readonly<Record<string, FileNode>>;
  readonly missionFileSystems?: Readonly<Record<string, FileNode>>;
  readonly lanOccupantHostnames?: readonly string[];
  // Merged base FS across every cached foreign home network, keyed by
  // machine_id. Layered into `fileSystems` alongside home/mission so
  // cross-LAN reads resolve against the regenerated topology.
  readonly foreignFileSystems?: Readonly<Record<string, FileNode>>;
  // Workstation_ids of OTHER players on cached foreign LANs. Folded
  // into `machineIdsKey` so the rehydration + Realtime subscription
  // effects cover cross-LAN workstations.
  readonly foreignLanOccupantHostnames?: readonly string[];
  readonly session: SessionInput;
  // Canonical machine_ids of currently-active protocol/transient
  // sessions (FTP / nc / MySQL / Redis). Distinct from session.machine
  // because transient sessions don't change the foreground shell
  // session — but they DO need their target's base FS for `ls`, `get`,
  // SELECT, KEYS, etc. to find anything cross-player.
  //
  // Default-empty for tests and for FileSystemProvider call sites that
  // don't yet wire SessionContext's transient state through.
  readonly protocolSessionMachineIds?: readonly string[];
};

export type FileSystemSync = {
  readonly fileSystems: FileSystemsState;
  readonly setFileSystems: Dispatch<SetStateAction<FileSystemsState>>;
  readonly patches: readonly FileSystemPatch[];
  readonly setPatches: Dispatch<SetStateAction<readonly FileSystemPatch[]>>;
  readonly isRehydrating: boolean;
  readonly syncChannelRef: { current: ReturnType<typeof createSyncChannel> | null };
  readonly patchesRef: { current: readonly FileSystemPatch[] };
  readonly localWritesSinceMount: { current: boolean };
  readonly pendingPatchesRef: { current: Set<Promise<unknown>> };
  readonly pendingWritesRef: { current: Map<string, FileSystemPatch> };
  // Imperative fetch + apply for an explicit set of machine_ids.
  // Mirrors the keyset-driven rehydration effect without the
  // REHYDRATION_DEBOUNCE_MS debounce — used by NetworkContext's
  // findMachineByIpAsync to load a newly-materialized foreign network's
  // patches BEFORE the resolver returns, so the first cross-LAN command
  // already sees the merged view instead of base-FS-only state.
  // Replace semantics: setPatches(serverPatches) wipes any patches for
  // ids NOT in machineIds. Callers should pass the union of (current
  // keyset + new ids) to avoid losing state from other machines.
  readonly prefetchPatchesForMachines: (machineIds: readonly string[]) => Promise<void>;
  // Live read of the rehydration keyset (workstation + home + mission +
  // world + occupants + foreign filesystems + foreign occupants).
  // Exposed as a ref so prefetchPatchesForMachines callers can compose
  // the union of (current keyset + new ids) without re-running the
  // machineIdsKey computation.
  readonly machineIdsKeyRef: { current: string };
  // Awaitable cross-player base-FS fetch. Same shape as
  // fetchCrossPlayerBaseFsIfNeeded (no-op when target is own-workstation
  // or already cached at the given tier) but returns a Promise so
  // transient-session callers (notably scp) can BLOCK on it before
  // running writes that would otherwise fail with "Not a directory"
  // because A's view of B has no base FS.
  readonly awaitCrossPlayerBaseFs: (target: string, tier: UserType) => Promise<void>;
};

export const useFileSystemSync = ({
  workstationId,
  localhostFileSystem,
  homeFileSystems,
  missionFileSystems,
  lanOccupantHostnames,
  foreignFileSystems,
  foreignLanOccupantHostnames,
  session,
  protocolSessionMachineIds,
}: Inputs): FileSystemSync => {
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
  const propsRef = useRef({
    localhostFileSystem,
    homeFileSystems,
    missionFileSystems,
    foreignFileSystems,
  });
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

  // Cross-player workstation base FS, keyed by machine_id. Populated by
  // getBaseFs on
  // session establish (the session-change effect below); merged into
  // the base layer everywhere else that reconstructs `merged` (rehydration,
  // hint-driven refetch, the home/mission re-merge effect). Without
  // this, every rehydration would wipe the merged cross-player tree
  // and reads of B's static content (motd, hostname, /home/...) would
  // come up null until the next session-change rebuild.
  const crossPlayerBaseFsRef = useRef<Record<string, FileNode>>({});
  // Tracks the userType the cached base FS was filtered for. Sister
  // ref to crossPlayerBaseFsRef. Without this, a guest-tier fetch
  // would cache a filtered tree that misses root-only paths
  // (/home/<owner>, etc.), and the IDEMPOTENT skip in
  // fetchCrossPlayerBaseFsIfNeeded would short-circuit a subsequent
  // root-tier session on the same machine — leaving the player with
  // the lower-tier view they'd already had. Surfaced 2026-05-19
  // during PR 5's in-game smoke (guest -> exit -> root on a
  // cross-LAN target).
  const crossPlayerBaseFsTierRef = useRef<Record<string, UserType>>({});

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
    propsRef.current = {
      localhostFileSystem,
      homeFileSystems,
      missionFileSystems,
      foreignFileSystems,
    };
  }, [localhostFileSystem, homeFileSystems, missionFileSystems, foreignFileSystems]);

  // Stable signature of the current machine_ids set: workstation +
  // homeFileSystems keys + missionFileSystems keys + lan-occupant
  // hostnames, deduped + sorted. Used as the dep for both the
  // rehydration fetch and the Realtime subscription effects so they
  // re-run together when the keyset changes (mid-session WiFi crack,
  // mission accept, world networks resolving after mount, occupant
  // join/leave on the active LAN).
  //
  // lanOccupantHostnames carries the hostnames (= workstation_ids) of
  // OTHER players on the active LAN. Folding them in subscribes us to
  // their workstation patch streams so daemon state changes (sshd pid
  // file written, etc.) propagate cross-player and our nmap reflects
  // their open ports in real time.
  const machineIdsKey = useMemo(() => {
    const ids = new Set<string>([workstationId]);
    if (homeFileSystems) for (const id of Object.keys(homeFileSystems)) ids.add(id);
    if (missionFileSystems) for (const id of Object.keys(missionFileSystems)) ids.add(id);
    if (lanOccupantHostnames) for (const id of lanOccupantHostnames) ids.add(id);
    if (foreignFileSystems) for (const id of Object.keys(foreignFileSystems)) ids.add(id);
    if (foreignLanOccupantHostnames) for (const id of foreignLanOccupantHostnames) ids.add(id);
    return [...ids].sort().join(',');
  }, [
    homeFileSystems,
    missionFileSystems,
    workstationId,
    lanOccupantHostnames,
    foreignFileSystems,
    foreignLanOccupantHostnames,
  ]);

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
          const withMission = props.missionFileSystems
            ? { ...withHome, ...props.missionFileSystems }
            : withHome;
          const withForeign = props.foreignFileSystems
            ? { ...withMission, ...props.foreignFileSystems }
            : withMission;
          // Include cross-player base FS so the rehydration doesn't wipe
          // trees we already fetched via getBaseFs.
          const merged = { ...withForeign, ...crossPlayerBaseFsRef.current };
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
        const withMission = props.missionFileSystems
          ? { ...withHome, ...props.missionFileSystems }
          : withHome;
        const withForeign = props.foreignFileSystems
          ? { ...withMission, ...props.foreignFileSystems }
          : withMission;
        // Include cross-player base FS so hint refetches don't wipe
        // trees we already fetched via getBaseFs.
        const merged = { ...withForeign, ...crossPlayerBaseFsRef.current };
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

  // Session-change refetch: when the foreground session's userType
  // changes for a given machine (su, ssh push, exit), the read-path
  // filter on the server returns a different set of rows for that
  // machine. Without this trigger, the local FS state stays at the
  // prior tier's filtered view until something else triggers a refetch
  // (Realtime hint from another player, page reload, scope change).
  //
  // The session-machine pair is the foreground identity from the
  // player's stack. Server-side, multiple stacked sessions can be
  // active simultaneously on the same (player, machine) — the bulk
  // adapter takes the most-recent (newest created_at) so the filter
  // matches the foreground tier. After endServerSession lands the
  // popped row drops out and the next-newest active row becomes
  // foreground naturally.
  //
  // Initial mount returns early — the rehydration useEffect already
  // fetches for every machine in scope at startup.
  const lastSessionRef = useRef<{ readonly machine: string; readonly userType: UserType } | null>(
    null,
  );

  // Reusable helper — same precondition + fetch shape used by both the
  // shell-session change effect (below) and the transient-session
  // change effect (further below). Idempotency is scoped to
  // (target, tier) so a guest -> root upgrade on the same machine
  // triggers a refetch and surfaces root-only paths the previously
  // filtered guest tree didn't carry.
  // Promise-returning core. Used by both the fire-and-forget
  // `fetchCrossPlayerBaseFsIfNeeded` (the session/protocol-change
  // effects) AND by the awaitable `awaitCrossPlayerBaseFs` exposed via
  // context for transient-session callers (scp) that need to BLOCK on
  // the base FS arriving before their write fires.
  const fetchCrossPlayerBaseFsCore = useCallback(
    async (target: string, tier: UserType): Promise<void> => {
      if (parseWorkstationId(target) === undefined || target === workstationId) {
        return;
      }
      if (
        target in crossPlayerBaseFsRef.current &&
        crossPlayerBaseFsTierRef.current[target] === tier
      ) {
        return;
      }
      try {
        const baseFs = await getBaseFsFromServer(getIdentity(), target);
        if (baseFs === null) return;
        crossPlayerBaseFsRef.current = {
          ...crossPlayerBaseFsRef.current,
          [target]: baseFs,
        };
        crossPlayerBaseFsTierRef.current = {
          ...crossPlayerBaseFsTierRef.current,
          [target]: tier,
        };
        // Layer the current patches for this machine on top of baseFs
        // before writing. Without this, the assignment below would
        // REPLACE fileSystems[target] entirely and lose any patches
        // already applied by the prefetch — notably daemon pid files
        // (sshd.pid, vsftpd.pid) that drive applyDynamicOverrides's
        // port computation for occupants. Losing those pid files makes
        // buildMergedRouterView think the occupant has no open service
        // ports, so the NAT-forward merge silently drops (the rule
        // 2222→<lan>:22 can't find an open port 22 on the occupant).
        // Symptom: cross-LAN scp succeeds once, then subsequent scp's
        // see the foreign router as bare (no forwards) and bail with
        // "Connection refused".
        const targetPatches = patchesRef.current.filter((p) => p.machineId === target);
        const patched = applyPatches({ [target]: baseFs }, targetPatches)[target] ?? baseFs;
        // flushSync forces React to commit the setFileSystems update
        // synchronously. By the time it returns, useFileSystemReaders
        // has re-run with the new fileSystems AND useNetworkCommands has
        // updated its refs (createFileOnMachineRef etc.) to the
        // recomputed versions that close over the new state.
        //
        // Without flushSync, awaiting callers — notably scp's
        // transient-session wrapper — run body() within ~1ms of
        // setFileSystems, too fast for React's MessageChannel-based
        // scheduler to commit. createFileOnMachineRef.current would
        // still point at the pre-update version whose closure reads
        // pre-update fileSystems, and the mutation bails with "Not a
        // directory: /tmp" because A's view of B doesn't yet contain
        // B's just-fetched base FS. flushSync collapses that timing
        // gap synchronously.
        flushSync(() => {
          setFileSystems((prev) => ({ ...prev, [target]: patched }));
        });
      } catch (error) {
        console.error('[fs] cross-player base-FS fetch failed:', error);
      }
    },
    [workstationId],
  );

  const fetchCrossPlayerBaseFsIfNeeded = useCallback(
    (target: string, tier: UserType): void => {
      void fetchCrossPlayerBaseFsCore(target, tier);
    },
    [fetchCrossPlayerBaseFsCore],
  );

  // Awaitable variant. Used by scp's transient-session wrapper: after
  // authCreateSession returns the server-validated tier, the wrapper
  // awaits this so B's base FS (e.g. /tmp directory) is in A's local
  // view BEFORE the actual createFileOnMachine call runs — otherwise
  // useFileSystemMutations bails with "Not a directory: /tmp" because
  // A's view of B's machine_id has no /tmp node (cross-player base FS
  // doesn't auto-fetch for transient sessions like the persistent
  // session/protocol-session effects do).
  const awaitCrossPlayerBaseFs = useCallback(
    (target: string, tier: UserType): Promise<void> => fetchCrossPlayerBaseFsCore(target, tier),
    [fetchCrossPlayerBaseFsCore],
  );

  useEffect(() => {
    const curr = { machine: session.machine, userType: session.userType };
    const prev = lastSessionRef.current;
    lastSessionRef.current = curr;
    if (prev === null) return;
    if (prev.machine === curr.machine && prev.userType === curr.userType) return;

    // Refetch BOTH the machine we just left and the one we just landed
    // on. The leaving side matters because the read-path filter is
    // tier-sensitive: when A exits a session on B, A no longer has a
    // session row for B → server's tier 3 (no-session allowlist) applies
    // instead of tier 2 (session walker). Visibility for /var/run/*.pid
    // (and other allowlist paths) flips back to "always returned"; if
    // the prior session-tier walker had dropped one of those rows, A's
    // local patches state is stuck without it until something else
    // refetches B. Surfaced 2026-05-10 during smoke: A SSH'd into B,
    // exited, and B's sshd port appeared closed because the pidfile
    // patch was missing locally.
    pendingHintMachinesRef.current.add(curr.machine);
    if (prev.machine !== curr.machine) {
      pendingHintMachinesRef.current.add(prev.machine);
    }
    if (hintDebounceTimerRef.current !== null) {
      clearTimeout(hintDebounceTimerRef.current);
    }
    hintDebounceTimerRef.current = setTimeout(() => {
      hintDebounceTimerRef.current = null;
      const machineIds = [...pendingHintMachinesRef.current];
      pendingHintMachinesRef.current.clear();
      void refetchAffectedMachines(machineIds);
    }, HINT_REFETCH_DEBOUNCE_MS);

    // Eager bulk-fetch of the base FS when the foreground session moves
    // onto a CROSS-PLAYER workstation we don't already have a tree for.
    //
    // Triggers when ALL hold:
    //   - curr.machine is a workstation_id pattern (parseWorkstationId
    //     returns truthy — non-workstation IDs like IPv4 NPC boxes
    //     don't apply because their FS regens locally from the home/
    //     world seed).
    //   - curr.machine !== workstationId (the player's own — own-box
    //     reads use the localhostFileSystem prop, no fetch needed).
    //   - crossPlayerBaseFsRef doesn't already have a tree for this
    //     machine (a prior session on this same machine already merged
    //     it).
    //
    // The "do I have it?" check is deliberately scoped to
    // crossPlayerBaseFsRef and NOT to fileSystems — applyPatches creates
    // empty-root stubs for any patch whose machine_id isn't in the
    // base (see fileSystemUtils.ts:359). When B writes their own pid
    // file and the patch arrives on A's box BEFORE A's session lands,
    // fileSystems[B.workstation_id] is already populated with that
    // empty stub. A fileSystems-based check would then skip the fetch
    // and A would land in B's shell with no /usr/bin, /lib, or /home —
    // exactly the symptom this PR exists to eliminate.
    //
    // Failure modes (network error, 401, 500) get logged + swallowed —
    // no exception propagates, no merge happens, the user sees their
    // existing (probably empty) view of that machine. The shell still
    // works for in-memory writes; reads of B's static content just
    // come up null until a successful retry later.
    fetchCrossPlayerBaseFsIfNeeded(curr.machine, curr.userType);
  }, [
    session.machine,
    session.userType,
    refetchAffectedMachines,
    workstationId,
    fetchCrossPlayerBaseFsIfNeeded,
  ]);

  // Transient (protocol) sessions — FTP / nc / MySQL / Redis. Each
  // creates a server-side session row that affects how listPatches's
  // tier filter answers for the target machine; each also opens a
  // shell or shell-equivalent on the target whose reads need the base
  // FS in `fileSystems`. Without this effect, an FTP `ls` against a
  // cross-player workstation would return nothing because session.machine
  // never changes (FTP lives in its own state slice) and the existing
  // session-change effect never fires for it.
  //
  // Process additions and removals via a tracking ref. Additions →
  // schedule a tier refetch + fire getBaseFs. Removals → schedule a
  // tier refetch (the leaving side's visibility flipped, same logic
  // as the shell-session leaving-machine refetch).
  const lastProtocolMachineIdsRef = useRef<readonly string[]>([]);
  const protocolMachinesKey = useMemo(
    () => [...(protocolSessionMachineIds ?? [])].sort().join(','),
    [protocolSessionMachineIds],
  );
  useEffect(() => {
    const curr = protocolMachinesKey.split(',').filter(Boolean);
    const prev = lastProtocolMachineIdsRef.current;
    lastProtocolMachineIdsRef.current = curr;

    const added = curr.filter((id) => !prev.includes(id));
    const removed = prev.filter((id) => !curr.includes(id));
    if (added.length === 0 && removed.length === 0) return;

    for (const id of added) {
      pendingHintMachinesRef.current.add(id);
      // Protocol sessions (FTP/MySQL/Redis/nc) carry their own
      // server-side userType derived from the auth credentials. The
      // client view of `protocolSessionMachineIds` doesn't expose
      // it. Use the current shell session's userType as the cache
      // tier — if the actual protocol tier differs, the next shell
      // session change or refresh will catch it.
      fetchCrossPlayerBaseFsIfNeeded(id, session.userType);
    }
    for (const id of removed) {
      pendingHintMachinesRef.current.add(id);
    }

    if (hintDebounceTimerRef.current !== null) {
      clearTimeout(hintDebounceTimerRef.current);
    }
    hintDebounceTimerRef.current = setTimeout(() => {
      hintDebounceTimerRef.current = null;
      const machineIds = [...pendingHintMachinesRef.current];
      pendingHintMachinesRef.current.clear();
      void refetchAffectedMachines(machineIds);
    }, HINT_REFETCH_DEBOUNCE_MS);
  }, [
    protocolMachinesKey,
    refetchAffectedMachines,
    fetchCrossPlayerBaseFsIfNeeded,
    session.userType,
  ]);

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
      // + foreign networks (cross-LAN regen) + cross-player workstations.
      const withHome = homeFileSystems ? { ...staticOnly, ...homeFileSystems } : staticOnly;
      const withMission = missionFileSystems ? { ...withHome, ...missionFileSystems } : withHome;
      const withForeign = foreignFileSystems
        ? { ...withMission, ...foreignFileSystems }
        : withMission;
      const merged = { ...withForeign, ...crossPlayerBaseFsRef.current };

      if (!missionFileSystems && !homeFileSystems && !foreignFileSystems) {
        isInitialMissionMount.current = false;
        // Include cross-player base FS even in the no-home/no-mission
        // case so eager fetches that landed before this effect re-fires
        // aren't wiped.
        return { ...staticOnly, ...crossPlayerBaseFsRef.current };
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
  }, [
    missionFileSystems,
    homeFileSystems,
    foreignFileSystems,
    cachedPatchesAtMount,
    persistentMachineKeys,
  ]);

  // Tracks the current keyset so prefetchPatchesForMachines callers
  // can compose the union of (current keyset + new ids) without
  // duplicating the machineIdsKey computation. Synced during render
  // (not in an effect) so reads inside async callbacks see the
  // latest value after the next React render cycle.
  const machineIdsKeyRef = useRef<string>(machineIdsKey);
  machineIdsKeyRef.current = machineIdsKey;

  const prefetchPatchesForMachines = useCallback(
    async (machineIds: readonly string[]): Promise<void> => {
      if (machineIds.length === 0) return;
      try {
        const serverPatches = await listPatchesForMachinesFromServer(getIdentity(), [
          ...machineIds,
        ]);
        setPatches(serverPatches);
        const db = getDatabase();
        if (db) saveFilesystemPatches(db, [...serverPatches]);
        const props = propsRef.current;
        const base = { [workstationId]: props.localhostFileSystem };
        const withHome = props.homeFileSystems ? { ...base, ...props.homeFileSystems } : base;
        const withMission = props.missionFileSystems
          ? { ...withHome, ...props.missionFileSystems }
          : withHome;
        const withForeign = props.foreignFileSystems
          ? { ...withMission, ...props.foreignFileSystems }
          : withMission;
        const merged = { ...withForeign, ...crossPlayerBaseFsRef.current };
        setFileSystems(applyPatches(merged, serverPatches));
      } catch (error) {
        console.error('[fs] prefetchPatchesForMachines failed:', error);
      }
    },
    [workstationId],
  );

  // Stable-identity wrap on the methods consumed downstream — see
  // plans/use-stable-callback-refactor.md. State values, dispatchers,
  // and useRef handles are already stable; only the useCallback-derived
  // functions need wrapping at the boundary.
  return {
    fileSystems,
    setFileSystems,
    patches,
    setPatches,
    isRehydrating,
    syncChannelRef,
    patchesRef,
    localWritesSinceMount,
    pendingPatchesRef,
    pendingWritesRef,
    prefetchPatchesForMachines: useStableCallback(prefetchPatchesForMachines),
    machineIdsKeyRef,
    awaitCrossPlayerBaseFs: useStableCallback(awaitCrossPlayerBaseFs),
  };
};
