/// <reference path="./d1.d.ts" />

export type Rating =
  | 'spirit'
  | 'energy'
  | 'sleep'
  | 'intake'
  | 'symptoms'
  | 'awareness'
  | 'discipline';

export type Entry = {
  date: string;
  goal: string;
  memory: string;
  spirit: number;
  energy: number;
  sleep: number;
  intake: number;
  symptoms: number;
  awareness: number;
  discipline: number;
  created_at: string;
  updated_at: string;
};

export type Env = {
  DB: D1Database;
  ASSETS: { fetch(req: Request): Promise<Response> };
};