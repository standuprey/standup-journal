## Prereqs

- Deno
- Node/npm (for vite deps)
- wrangler (via `npm i -g wrangler` or `npx wrangler`)

## Create D1 database
```
wrangler d1 create standup-journal-db
```
Paste the returned `database_id` into `wrangler.jsonc` (replacing `REPLACE_ME`). Optionally change the worker `name` here too.
## Apply schema
- Local: `deno task db:migrate:local`
- Remote: `deno task db:migrate:remote`

## Local dev

Run `deno run -A npm:vite` (or `deno task dev:web`) in one terminal and `deno task dev:worker` in another; vite proxies `/api` to the worker on :8787.

## Build & deploy

1. `deno task build:web`
2. `deno task deploy` (runs `wrangler deploy`, bundles `worker/index.ts`, serves `dist/` via assets)
3. First deploy note: wrangler may prompt to acknowledge compatibility flags/usage.

## Post-deploy

Change the password note — hardcoded as `PASSWORD` in `worker/index.ts`; edit + redeploy to change it.
D1 data persists per environment (local `.wrangler/` dir vs remote).

**Verify**:

- File exists
- Steps reference actual files: `deno.json` tasks, `wrangler.jsonc` bindings, `migrations/0001_init.sql`, `worker/index.ts`
