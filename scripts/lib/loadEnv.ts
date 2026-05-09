// Side-effect import: populates process.env from .env.local and
// .env.development.local at script startup so callers don't need the
// `npx dotenv -e .env.local -e .env.development.local --` prefix.
//
// Usage: add as the FIRST import of any script that needs the dev DB
// (Supabase URL / service-role key, etc.).
//
//   import './lib/loadEnv';
//
// dotenv doesn't override existing process.env values, so this is safe
// inside vercel:dev / CI / any context where vars are already set —
// they take precedence over file values.
//
// Order: .env.local loaded first (highest local-override priority);
// .env.development.local fills in anything still missing. Mirrors the
// `npx dotenv -e .env.local -e .env.development.local` argument order.

import * as dotenv from 'dotenv';
import { resolve } from 'node:path';

const cwd = process.cwd();
dotenv.config({ path: resolve(cwd, '.env.local'), quiet: true });
dotenv.config({ path: resolve(cwd, '.env.development.local'), quiet: true });
