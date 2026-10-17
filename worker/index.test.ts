import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import worker from './index.ts';
import { Env } from './types.ts';

// In-memory D1 stub: enough to exercise the routes (list/get/upsert/delete).
function makeEnv(): Env {
  const rows = new Map<string, Record<string, unknown>>();
  const stub = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const methods = {
        all: async () => ({ results: [...rows.values()] }),
        first: async () => rows.get(args[0] as string) ?? null,
        run: async () => {
          if (sql.startsWith('DELETE')) {
            rows.delete(args[0] as string);
          } else if (sql.startsWith('INSERT')) {
            const cols = sql.match(/INSERT INTO entries \(([^)]*)\)/)![1]
              .split(',')
              .map((s) => s.trim());
            const prev = rows.get(args[0] as string) ?? {};
            const row: Record<string, unknown> = { ...prev };
            cols.forEach((c, i) => {
              row[c] = args[i];
            });
            rows.set(row.date as string, row);
          }
        },
      };
      return {
        bind(...values: unknown[]) {
          args = values;
          return methods;
        },
        ...methods,
      };
    },
  };
  return {
    DB: stub as unknown as Env['DB'],
    ASSETS: { fetch: () => Promise.resolve(new Response('')) },
  };
}

const AUTH = { Authorization: 'Bearer pipoman' };

Deno.test('401 without auth header', async () => {
  const res = await worker.fetch(
    new Request('http://x/api/entries'),
    makeEnv(),
  );
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: 'unauthorized' });
});

Deno.test('PUT with invalid date returns 400', async () => {
  const res = await worker.fetch(
    new Request('http://x/api/entries/bad-date', {
      method: 'PUT',
      headers: AUTH,
      body: JSON.stringify({ goal: 'x' }),
    }),
    makeEnv(),
  );
  assertEquals(res.status, 400);
});

Deno.test('PUT with rating 7 is clamped to 5', async () => {
  const res = await worker.fetch(
    new Request('http://x/api/entries/2026-10-17', {
      method: 'PUT',
      headers: AUTH,
      body: JSON.stringify({ energy: 7 }),
    }),
    makeEnv(),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).energy, 5);
});

Deno.test('GET list after PUT returns the entry', async () => {
  const env = makeEnv();
  await worker.fetch(
    new Request('http://x/api/entries/2026-10-17', {
      method: 'PUT',
      headers: AUTH,
      body: JSON.stringify({ goal: 'ship' }),
    }),
    env,
  );
  const res = await worker.fetch(
    new Request('http://x/api/entries', { headers: AUTH }),
    env,
  );
  const list = await res.json();
  assertEquals(list.length, 1);
  assertEquals(list[0].goal, 'ship');
});

Deno.test('DELETE returns ok even if absent', async () => {
  const res = await worker.fetch(
    new Request('http://x/api/entries/1999-01-01', {
      method: 'DELETE',
      headers: AUTH,
    }),
    makeEnv(),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
});