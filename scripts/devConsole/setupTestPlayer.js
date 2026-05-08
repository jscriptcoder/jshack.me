// ───────────────────────────────────────────────────────────────────
// Bypass IntroScreen and set up a player with a known seed.
// PASTE THIS INTO THE BROWSER DEV CONSOLE — NOT a Node CLI script.
// ───────────────────────────────────────────────────────────────────
//
// Two-player testing on the same WiFi: open the game in two browsers
// (one regular profile, one incognito so localStorage / IndexedDB don't
// share), edit the constants below to be DIFFERENT per browser
// (workstationName / username / rootPassword), keep the same SEED, and
// paste this in each browser's console. Each one will reload directly
// into the game with both players landing on the same WiFi network.
//
// What it does:
//   1. Writes gameState into IndexedDB so SessionInit skips IntroScreen.
//   2. Clears stale wifi / mission / filesystem state from any prior seed.
//   3. Calls /api/register-workstation so the server has the player's
//      machine_id, real /etc/passwd content (with md5(rootPassword) for
//      cross-player auth), and the seed needed for cross-player base FS
//      regen later in the chunk.
//   4. Reloads.
//
// Re-running with the same workstationName + username on the same browser
// is idempotent — the server keeps the original seed/rootPassword. Drop
// the workstations row in Supabase Studio (or `npm run db:reset`) to
// change those values for an existing identity.
//
// Identity is per-browser (Ed25519 keypair in localStorage). Each browser
// is a distinct player to the server — exactly what two-player testing needs.

(async () => {
  // ─── CONFIGURE ────────────────────────────────────────────────────
  const SEED = 'dc11201face181e5'; // → AIRPORT-LOUNGE-VIP (crowded)
  const WORKSTATION_NAME = 'rocket';
  const USERNAME = 'bob';
  const ROOT_PASSWORD = 'bob1234';
  // ──────────────────────────────────────────────────────────────────

  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('jshack-db');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  // Write gameState — minimum fields for GameSession to consider the
  // player as having a started game and skip IntroScreen.
  await new Promise((res, rej) => {
    const tx = db.transaction('session', 'readwrite');
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.objectStore('session').put(
      {
        seed: SEED,
        workstationName: WORKSTATION_NAME,
        username: USERNAME,
        rootPassword: ROOT_PASSWORD,
      },
      'gameState',
    );
  });

  // Clear stale wifi / mission state — those were generated from a
  // previous seed and would be inconsistent with the new one.
  await new Promise((res, rej) => {
    const tx = db.transaction('session', 'readwrite');
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    const store = tx.objectStore('session');
    store.delete('wifiConnected');
    store.delete('activeMissionSeed');
  });

  // Clear filesystem patches — otherwise localhost looks like the old player's box.
  await new Promise((res, rej) => {
    const tx = db.transaction('filesystem', 'readwrite');
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.objectStore('filesystem').clear();
  });

  // Register the workstation server-side. PR 1 of cross-player base FS
  // replication persists `seed` in the workstations row and embeds
  // md5(rootPassword) in projected /etc/passwd content — required for
  // PR 2's cross-player password validation to succeed.
  const { registerWorkstation } = await import('/src/workstationRegistry/client.ts');
  const { getIdentity } = await import('/src/identity/index.ts');
  try {
    const result = await registerWorkstation(getIdentity(), {
      workstation_name: WORKSTATION_NAME,
      username: USERNAME,
      seed: SEED,
      rootPassword: ROOT_PASSWORD,
    });
    console.log(
      `%c✓ Workstation registered (inserted=${result.inserted})`,
      'color: lime; font-weight: bold',
    );
    if (!result.inserted) {
      console.warn(
        '⚠  Server already had a workstations row for this identity — server-side seed/rootPassword unchanged. Drop the row in Supabase Studio if you need different values persisted.',
      );
    }
  } catch (err) {
    console.error('✗ register-workstation failed:', err);
    return; // don't reload — let you inspect
  }

  console.log(
    `%c✓ gameState set (seed=${SEED}, ws=${WORKSTATION_NAME}, user=${USERNAME}). Reloading…`,
    'color: lime; font-weight: bold',
  );
  setTimeout(() => location.reload(), 500);
})();
