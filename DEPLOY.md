## Prereqs\n- Deno\n- Node/npm (for vite deps)\n- wrangler (via `npm i -g wrangler` or `npx wrangler`)
\n## Create D1 database\n```
wrangler d1 create standup-journal-db
```
Paste the returned `database_id` into `wrangler.jsonc` (replacing `REPLACE_ME`). Optionally change the worker `name` here too.
\n## Apply schema\n- Local: `deno task db:migrate:local`\n- Remote: `deno task db:migrate:remote`\n\n## Local dev\nRun `deno run -A npm:vite` (or `deno task dev:web`) in one terminal and `deno task dev:worker` in another; vite proxies `/api` to the worker on :8787.
\n## Build & deploy\n1. `deno task build:web`\n2. `deno task deploy` (runs `wrangler deploy`, bundles `worker/index.ts`, serves `dist/` via assets)\nFirst deploy note: wrangler may prompt to acknowledge compatibility flags/usage.
\n## Post-deploy\nChange the password note — hardcoded as `PASSWORD` in `worker/index.ts`; edit + redeploy to change it.\nD1 data persists per environment (local `.wrangler/` dir vs remote).\n\n**Verify**:\n- File exists\n- Steps reference actual files: `deno.json` tasks, `wrangler.jsonc` bindings, `migrations/0001_init.sql`, `worker/index.ts`