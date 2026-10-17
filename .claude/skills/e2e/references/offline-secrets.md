# Offline secrets and the database

The game does not surface another player's secrets, and gateway credentials seed from the ESSID.
Every seeder returns a **hash** (`seed*Hash`, `workstationGuestHash`): the game never holds an
uncrackable word. Turn one into its word with `plaintextFor` from `src/test/passwords.ts`, which
reads the gitignored `__plaintext.ts` that `npm run encode` writes. Compute them with a **temp file
inside the repo** — `./src/...` imports only resolve from there, and a `/tmp` path will not work:

```bash
cat > ./g.tmp.ts << 'EOF'
import { seedApGatewayAdminHash } from './src/core/generation/routerFs.js';
import { plaintextFor } from './src/test/passwords.js';
console.log('adminpw=' + plaintextFor(seedApGatewayAdminHash('SHINRA-5G')));
EOF
npx tsx ./g.tmp.ts; rm -f ./g.tmp.ts
```

**`npx tsx -e "..."` produces no output here** — always use a file. Same for DB queries, which
additionally need the env:

```bash
npx dotenv -e .env.development.local -- npx tsx ./q.tmp.ts
```

For a plain table read, skip the temp file — query the container directly. **`supabase db psql
-c` does not exist** (CLI 2.95: `unknown shorthand flag: 'c'`); go through docker:

```bash
docker exec supabase_db_jshack-me psql -U postgres -tAc "select * from home_network_occupants"
```

Useful lookups: `plaintextFor(workstationGuestHash(ownerKey))`, `assignHomeNetwork(ownerKey, essid)` →
`{ localIp, hostname }` (no `publicIp`), and `publicAddressOf(essid)` from
`scripts/publicAddressOf.ts` for an ESSID's public IP, which the world derives from the
network's place in it. Cross-check any derived `localIp`
against the live `ifconfig`. Delete the temp file when done.
