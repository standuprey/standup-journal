# Why
- The repo was an empty README; this task lays the project foundation so all later tasks (worker, web UI, deploy) have a fixed config to build against.
- Pins the Deno task surface (dev/build/check/test) and the Cloudflare Workers + D1 topology (bindings, assets, migrations) before any code exists.
- Creates the D1 schema upfront so local and remote migrations are reproducible with one command each.

# How
- `deno.json`: `tasks` map (`dev:web`, `build:web`, `dev:worker`, `deploy`, `db:migrate:local`, `db:migrate:remote`, `check`, `test`) and `compilerOptions` with `strict: true` and ES2023 + DOM libs.
- `wrangler.jsonc`: worker entry `worker/index.ts`, SPA assets from `./dist` with `ASSETS` binding, D1 database `standup-journal-db` (id placeholder `REPLACE_ME` to fill at deploy time), migrations dir `migrations`.
- `migrations/0001_init.sql`: `entries` table keyed by `date` with the seven 0–5 rating columns (NOT NULL, default 0), `goal`/`memory` text (default ''), timestamps.
- `.gitignore`: `node_modules/`, `dist/`, `.wrangler/`, `.env`.
- `README.md`: short project description, pointer to DEPLOY.md (later task), and the deno tasks.

# Alternative
- Plain `package.json` + npm scripts instead of Deno tasks: more familiar, but the project targets Deno and workers share the same config; trade-off is one less tool.
- Wrangler `d1_databases` as separate `wrangler.d1.json`: cleaner separation, but two configs to keep in sync for a single-env project.

# Test
- `deno.json` parses: `jq . deno.json` → OK.
- `wrangler.jsonc` JSONC syntax validated by wrangler/`deno eval` import → OK.
- `migrations/0001_init.sql` contains the `entries` table; will be exercised by `deno task db:migrate:local` once the worker task lands.
- To test yourself: `git checkout standup-jo-1`, inspect the files above; `deno task check` is a no-op until `worker/` and `web/src/` exist (next tasks).