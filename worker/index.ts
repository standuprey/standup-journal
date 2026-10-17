import { Env, Rating } from './types.ts';

const PASSWORD = 'pipoman';
const RATINGS: Rating[] = [
  'spirit',
  'energy',
  'sleep',
  'intake',
  'symptoms',
  'awareness',
  'discipline',
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clampRating(n: unknown): number | null {
  if (typeof n !== 'number' || Number.isNaN(n)) return null;
  return Math.min(5, Math.max(0, Math.round(n)));
}

function authorized(request: Request): boolean {
  return request.headers.get('Authorization') === `Bearer ${PASSWORD}`;
}

function validateDate(date: string): boolean {
  return DATE_RE.test(date);
}

async function listEntries(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM entries ORDER BY date DESC',
  ).all();
  return json(results);
}

async function getEntry(env: Env, date: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT * FROM entries WHERE date = ?')
    .bind(date)
    .first();
  if (!row) return json({ error: 'not found' }, 404);
  return json(row);
}

async function upsertEntry(
  env: Env,
  date: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const goal = typeof body.goal === 'string' ? body.goal : '';
  const memory = typeof body.memory === 'string' ? body.memory : '';
  const values: Record<string, number> = {};
  for (const key of RATINGS) {
    if (body[key] === undefined) continue;
    const clamped = clampRating(body[key]);
    if (clamped === null) {
      return json({ error: `invalid rating: ${key}` }, 400);
    }
    values[key] = clamped;
  }
  const now = new Date().toISOString();
  const colList = ['date', 'goal', 'memory', ...Object.keys(values), 'created_at', 'updated_at'];
  const placeholders = colList.map(() => '?').join(', ');
  const updates = ['goal', 'memory', ...Object.keys(values)]
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  const args = [
    date,
    goal,
    memory,
    ...Object.values(values),
    now,
    now,
  ];
  await env.DB.prepare(
    `INSERT INTO entries (${colList.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(date) DO UPDATE SET ${updates}, updated_at = excluded.updated_at`,
  ).bind(...args).run();
  const row = await env.DB.prepare('SELECT * FROM entries WHERE date = ?')
    .bind(date)
    .first();
  return json(row);
}

async function deleteEntry(env: Env, date: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM entries WHERE date = ?').bind(date).run();
  return json({ ok: true });
}

async function handleApi(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  if (!authorized(request)) return json({ error: 'unauthorized' }, 401);
  const { method } = request;
  const route = path.replace(/^\/api\/entries\/?/, '');

  if (route === '' && method === 'GET') return listEntries(env);

  if (route !== '') {
    if (!validateDate(route)) return json({ error: 'invalid date' }, 400);
    if (method === 'GET') return getEntry(env, route);
    if (method === 'PUT') {
      let body: Record<string, unknown>;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid JSON body' }, 400);
      }
      return upsertEntry(env, route, body);
    }
    if (method === 'DELETE') return deleteEntry(env, route);
  }

  return json({ error: 'not found' }, 404);
}

async function handle(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(request, env, url.pathname);
    }
    return await env.ASSETS.fetch(request);
  } catch (error) {
    console.error('unhandled error:', error);
    return json({ error: 'internal server error' }, 500);
  }
}

export default { fetch: handle };