# Feature: standup-journal

## Overview

Greenfield CRUD journaling web app deployed as a single Cloudflare Worker with a D1 database, developed and built with Deno. Stack: Deno 2 + TypeScript, Cloudflare Worker (plain `fetch` handler, no framework) serving a REST API backed by D1, and Workers Static Assets serving a Vite + React + Tailwind + lucide-react SPA.

Data model: one journal entry per calendar date (date TEXT primary key, browser-local timezone). Entry fields: seven integer ratings 0–5 (spirit, energy, sleep, intake, symptoms, awareness, discipline) plus `goal` (morning) and `memory` (evening) free-text fields.

Auth: hardcoded password `pipoman`. The frontend asks for it once, stores it in `localStorage`, and sends it as `Authorization: Bearer <password>` on every API call; the worker compares it to the hardcoded value. Minimum security, no sessions, no hashing.

Decisions taken: plain router in the worker (tiny surface, no dep churn); Tailwind v4 via `@tailwindcss/vite` plugin (no config file); wrangler.jsonc with `assets` pointing at `dist/` and `not_found_handling: single-page`; rating input implemented as a 0–5 clickable star row (lucide `Star` icons). Deployment itself is documented in a DEPLOY.md the client follows manually (client is familiar with Cloudflare).

Open questions resolved: one entry per day (upsert), local browser date as key, list-only UI (no calendar), worker name in wrangler.jsonc is a placeholder the client can change at deploy time.

## Tasks

### standup-jo-1
- **Difficulty:** easy
- **Model:** qwen3:4b-instruct
- **Depends on:** none
- **Summary:** Scaffold project config: deno.json, wrangler.jsonc, D1 schema, .gitignore, README stub.
- **Details:** Repo root is `/home/standup/Projects/standup-journal` (currently only README.md). Create:
  1. `deno.json` with:
     - `"tasks"`: `"dev:web": "deno run -A npm:vite"`, `"build:web": "deno run -A npm:vite build"`, `"dev:worker": "wrangler dev"`, `"deploy": "wrangler deploy"`, `"db:migrate:local": "wrangler d1 execute DB --local --file=./migrations/0001_init.sql"`, `"db:migrate:remote": "wrangler d1 execute DB --remote --file=./migrations/0001_init.sql"`, `"check": "deno check worker/ web/src/"`, `"test": "deno test -A worker/"`.
     - `"compilerOptions"`: `{ "lib": ["es2023", "dom", "dom.iterable"], "strict": true }`.
  2. `wrangler.jsonc`: `name: "standup-journal"`, `main: "worker/index.ts"`, `compatibility_date: "2025-01-01"` (or newer), `assets: { "directory": "./dist", "not_found_handling": "single-page", "binding": "ASSETS" }`, `d1_databases: [{ binding: "DB", database_name: "standup-journal-db", database_id: "REPLACE_ME", migrations_dir: "migrations" }]`.
  3. `migrations/0001_init.sql`: `CREATE TABLE IF NOT EXISTS entries (date TEXT PRIMARY KEY, goal TEXT NOT NULL DEFAULT '', memory TEXT NOT NULL DEFAULT '', spirit INTEGER NOT NULL DEFAULT 0, energy INTEGER NOT NULL DEFAULT 0, sleep INTEGER NOT NULL DEFAULT 0, intake INTEGER NOT NULL DEFAULT 0, symptoms INTEGER NOT NULL DEFAULT 0, awareness INTEGER NOT NULL DEFAULT 0, discipline INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`
  4. `.gitignore`: `node_modules/`, `dist/`, `.wrangler/`, `.env`.
  5. Update `README.md` to a short project description + pointer to DEPLOY.md (created later) and deno tasks.
  Verify: `deno check` on nothing to check yet is fine; JSON/JSONC parse correctly (`deno eval` import or `jq` for deno.json), SQL file exists and contains the table.

### standup-jo-2
- **Difficulty:** medium
- **Model:** qwen3:4b-instruct
- **Depends on:** standup-jo-1
- **Summary:** Worker API: auth check + CRUD endpoints over D1 + types, with deno unit tests using an in-memory stub.
- **Details:** Create two files.
  1. `worker/types.ts`: export `type Rating = 'spirit' | 'energy' | 'sleep' | 'intake' | 'symptoms' | 'awareness' | 'discipline';` `type Entry = { date: string; goal: string; memory: string; spirit: number; energy: number; sleep: number; intake: number; symptoms: number; awareness: number; discipline: number; created_at: string; updated_at: string; };` `type Env = { DB: D1Database; ASSETS: { fetch(req: Request): Promise<Response> } }`. Include a minimal `D1Database` type declaration (methods `prepare`, `batch`, `exec`) so the file type-checks without `@cloudflare/workers-types` — or add `// @ts-ignore`-free ambient declaration in a `worker/d1.d.ts` ambient file if cleaner.
  2. `worker/index.ts`: default export `fetch(request, env)`. Behavior:
     - Path `/api/*`: first check `request.headers.get('Authorization') === 'Bearer pipoman'`; otherwise return 401 JSON `{ error: 'unauthorized' }`. (Hardcode the password as a const `PASSWORD = 'pipoman'` at top of file.)
     - `GET /api/entries` → list all entries ordered by date DESC, JSON array.
     - `GET /api/entries/:date` → single entry or 404.
     - `PUT /api/entries/:date` → upsert. Body: partial entry `{ goal?, memory?, ...ratings? }`. Clamp ratings to integer 0–5 (out-of-range → clamp, non-numeric → 400). Upsert via `INSERT ... ON CONFLICT(date) DO UPDATE`. Return the full row as JSON.
     - `DELETE /api/entries/:date` → 200 `{ ok: true }` even if absent.
     - Non-`/api` requests → `env.ASSETS.fetch(request)`.
     - Date validation: must match `/^\d{4}-\d{2}-\d{2}$/`, else 400.
     - Always `Content-Type: application/json` for API responses; wrap handler errors in try/catch → 500 JSON.
  3. `worker/index.test.ts` (Deno test): stub `env.DB` with a fake in-memory object implementing `prepare(sql).bind(...args)` returning `{ all, first, run }` backed by a Map keyed by date for the entries table — enough to exercise routes. Tests: 401 without auth header; PUT with invalid date → 400; PUT with rating 7 → clamped to 5; GET list after PUT returns the entry; DELETE returns ok. Keep stub ≤ 80 lines.
  Verify: `deno check worker/` passes; `deno test -A worker/` passes.

### standup-jo-3
- **Difficulty:** medium
- **Model:** qwen3:4b-instruct
- **Depends on:** standup-jo-1
- **Summary:** Frontend scaffold: Vite + React + TS + Tailwind v4 + lucide-react under `web/`.
- **Details:** Create a `web/` directory with a minimal Vite React-TS project (do NOT use `npm create` interactive scaffolding; write files directly, no `npm install` needed to author them):
  - `web/package.json`: deps `react`, `react-dom`, `lucide-react`, devDeps `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `tailwindcss`, `@tailwindcss/vite`. Scripts `dev`/`build`/`preview` invoking `vite`/`tsc && vite build` (these run via `deno run -A npm:vite` from root tasks, but keep package.json scripts standard).
  - `web/vite.config.ts`: react plugin + `tailwindcss()` plugin, `build.outDir: 'dist'`, dev proxy: `server: { proxy: { '/api': 'http://127.0.0.1:8787' } }`.
  - `web/tsconfig.json`: standard Vite react-ts config (`strict: true`, `jsx: react-jsx`, `moduleResolution: bundler`, include `src`).
  - `web/index.html`: root div + `<script type="module" src="/src/main.tsx">`, title "Standup Journal".
  - `web/src/main.tsx`: createRoot render of `<App />`.
  - `web/src/index.css`: `@import "tailwindcss";`
  - `web/src/App.tsx`: temporary placeholder component rendering "Standup Journal" with a lucide `BookOpen` icon and Tailwind classes (e.g. centered, dark background) — later tasks replace this file.
  Verify: task is authored without running npm; `tsc` correctness is checked by the wiring task. At minimum ensure imports/types are consistent and `web/tsconfig.json` is valid JSON. If the worker task's branch is present, nothing in `web/` may reference worker code.

### standup-jo-4
- **Difficulty:** easy
- **Model:** qwen3:4b-instruct
- **Depends on:** standup-jo-3
- **Summary:** API client module + auth gate (password prompt once, persisted in localStorage).
- **Details:** In `web/src/`:
  1. `api.ts`: `const PASSWORD_KEY = 'sj-password';` functions: `isAuthed(): boolean` (localStorage has non-empty password), `savePassword(pw: string)`, `clearPassword()`, and `api` object with `list(): Promise<Entry[]>`, `get(date)`, `upsert(date, partial): Promise<Entry>`, `remove(date)` — each does `fetch('/api/...' , { headers: { Authorization: \`Bearer ${localStorage.getItem(PASSWORD_KEY)}\` } })`, and on 401 response calls `clearPassword()` then throws an error. Re-declare the `Entry` type locally (same shape as worker/types.ts: date, goal, memory, seven ratings, created_at, updated_at). Rating clamping on the client: `Math.min(5, Math.max(0, Math.round(n)))`.
  2. `components/AuthGate.tsx`: props `{ children: ReactNode }`. If `isAuthed()` render children; else render a centered card with a lucide `LockKeyhole` icon, a password input (type password), and a submit button labeled "Unlock". On submit: optimistically save, call `api.list()`; on success render children; on failure show "Wrong password" error text (red) and clear saved password. Styled with Tailwind (dark bg `bg-zinc-950 text-zinc-100`, zinc-800 card, indigo button).
  3. Update `web/src/App.tsx` to wrap the placeholder content in `<AuthGate>` (keep placeholder content minimal; the list task replaces it).
  Verify: `cd web && npx --yes tsc --noEmit` (or `deno check`) passes given node_modules are installed; AuthGate logic reviewed for the 401-cleanup path.

### standup-jo-5
- **Difficulty:** medium
- **Model:** qwen3:4b-instruct
- **Depends on:** standup-jo-3
- **Summary:** EntryForm component: 0–5 star ratings per dimension plus goal and memory textareas with morning/evening sections.
- **Details:** Create `web/src/components/EntryForm.tsx` and `web/src/components/RatingStars.tsx`.
  1. `RatingStars.tsx`: props `{ label: string; value: number; onChange(n: number): void; icon: LucideIcon }`. Renders the label, the passed lucide icon, and 5 clickable lucide `Star` buttons (indices 1–5): filled/starred state when `value >= i` (use `fill-current` class + `text-amber-400`, unselected `text-zinc-600`). Clicking star i sets value to i. Also render a small numeric badge showing the value. Include a lucide `X` button to reset to 0. Keyboard accessible: use `<button type="button" aria-label={`${label}: ${i}`}>`.
  2. `EntryForm.tsx`: props `{ date: string; initial?: Entry | null; onSave(partial): Promise<void>; onCancel(): void; }`. Local state for all fields (goal, memory, 7 ratings), initialized from `initial` or defaults (ratings 0, strings ''). Sections: "Morning" card (lucide `Sunrise` icon) with the goal textarea labeled "Goal for the day"; "Evening" card (lucide `Moon` icon) with memory textarea labeled "Memory of the day" and all seven RatingStars (icons: Spirit→`Sparkles`, Energy→`Zap`, Sleep→`MoonStar`, Intake→`Utensils`, Symptoms→`Stethoscope`, Awareness→`Eye`, Discipline→`ShieldCheck`). Save button (lucide `Save`) calls `onSave` with the full partial and shows a saving state; Cancel button (lucide `X`) calls `onCancel`. Textareas styled Tailwind (bg-zinc-900 border-zinc-700 rounded). Date shown as a heading (lucide `Calendar` icon).
  Verify: type-checks with `tsc --noEmit`; all lucide icon names are real exports (verify against lucide-react docs list: Sparkles, Zap, MoonStar, Utensils, Stethoscope, Eye, ShieldCheck, Sunrise, Moon, Save, X, Calendar, Star, BookOpen, LockKeyhole, Plus, Trash2, Pencil are all valid).

### standup-jo-6
- **Difficulty:** medium
- **Model:** qwen3:4b-instruct
- **Depends on:** standup-jo-4, standup-jo-5
- **Summary:** Entry list view + App wiring: create/today, edit, delete, loading and error states.
- **Details:** Rewrite `web/src/App.tsx` and create `web/src/components/EntryList.tsx`.
  1. `EntryList.tsx`: props `{ entries: Entry[]; onEdit(entry: Entry): void; onDelete(date: string): void; }`. Renders cards newest-first; each card shows date heading, the 7 ratings as compact icon+number rows (reuse icon mapping from EntryForm — export a shared `RATING_META: { key: Rating; label: string; icon: LucideIcon }[]` from a new `web/src/ratings.tsx` and import it in both EntryForm and EntryList), goal and memory text (whitespace-pre-wrap, truncated to ~2 lines with `line-clamp-2` if long), and edit (lucide `Pencil`) + delete (lucide `Trash2`) buttons. Delete shows a confirm via `window.confirm` before calling `onDelete`. Empty state: lucide `BookOpen` + "No entries yet".
  2. `App.tsx`: state machine: `entries`, `loading`, `error`, `editing: { date: string; initial: Entry | null } | null`. On mount (and after auth), `api.list()`. Top bar: title with `BookOpen` icon and a "New / Today" button (lucide `Plus`) that opens EntryForm with `date = local today as YYYY-MM-DD` (`new Date()` formatted with local components, NOT `toISOString`) and `initial: null`. When `editing` is set, render `<EntryForm date initial onSave={partial => api.upsert(date, partial) then refetch list and close} onCancel={...}>`. Errors from api calls set `error` state shown as a red banner; if error is 401-derived (api.ts clears localStorage), re-render the AuthGate by resetting an internal authed flag. Layout: max-w-2xl centered, `bg-zinc-950 min-h-screen`.
  Verify: `cd web && npx tsc --noEmit` passes; `deno run -A npm:vite build` (root task `build:web`) produces `dist/` with no errors.

### standup-jo-7
- **Difficulty:** easy
- **Model:** qwen3:4b-instruct
- **Depends on:** standup-jo-1
- **Summary:** DEPLOY.md: step-by-step deployment instructions for the client.
- **Details:** Create `DEPLOY.md` at repo root. Sections:
  1. Prereqs: Deno, Node/npm (for vite deps), wrangler (`npm i -g wrangler` or `npx wrangler`), Cloudflare account login (`wrangler login`).
  2. Create the D1 database: `wrangler d1 create standup-journal-db` and paste the returned `database_id` into `wrangler.jsonc` (replacing `REPLACE_ME`). Optionally change the worker `name` here too.
  3. Apply schema: local (`deno task db:migrate:local`) and remote (`deno task db:migrate:remote`).
  4. Local dev: run `deno run -A npm:vite` (or `deno task dev:web`) in one terminal and `deno task dev:worker` in another; vite proxies `/api` to the worker on :8787.
  5. Build & deploy: `deno task build:web` then `deno task deploy` (runs `wrangler deploy`, which bundles `worker/index.ts` and serves `dist/` via assets). First deploy note: wrangler may prompt to acknowledge compatibility flags/usage.
  6. Post-deploy: change the password note — it is hardcoded as `PASSWORD` const in `worker/index.ts`; edit + redeploy to change it. Remind that D1 data persists per environment (local `.wrangler/` dir vs remote).
  Verify: file exists, steps reference actual file/task names from standup-jo-1 (deno.json tasks, wrangler.jsonc bindings, migrations/0001_init.sql, worker/index.ts).