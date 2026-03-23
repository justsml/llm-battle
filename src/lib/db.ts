import { neon } from "@neondatabase/serverless";

import type { CompareModel, ModelResult } from "@/lib/types";

function getClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return neon(url);
}

export async function ensureSchema() {
  const sql = getClient();
  await sql`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      prompt TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      image_name TEXT NOT NULL DEFAULT '',
      models JSONB NOT NULL DEFAULT '[]'::jsonb,
      results JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `;
}

export async function insertRun(run: {
  id: string;
  createdAt: string;
  prompt: string;
  imageUrl: string;
  imageName: string;
  models: CompareModel[];
  results: ModelResult[];
}) {
  const sql = getClient();
  await sql`
    INSERT INTO runs (id, created_at, prompt, image_url, image_name, models, results)
    VALUES (
      ${run.id},
      ${run.createdAt},
      ${run.prompt},
      ${run.imageUrl},
      ${run.imageName},
      ${JSON.stringify(run.models)},
      ${JSON.stringify(run.results)}
    )
  `;
}

export async function updateRunResults(id: string, results: ModelResult[]) {
  const sql = getClient();
  await sql`
    UPDATE runs
    SET results = ${JSON.stringify(results)}::jsonb
    WHERE id = ${id}
  `;
}

export type RunRow = {
  id: string;
  created_at: string;
  prompt: string;
  image_url: string;
  image_name: string;
  models: CompareModel[];
  results: ModelResult[];
};

export async function listRuns(limit = 20) {
  const sql = getClient();
  const rows = await sql`
    SELECT id, created_at, prompt, image_url, image_name, models, results
    FROM runs
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as RunRow[];
}

export function isDatabaseConfigured() {
  return !!process.env.DATABASE_URL;
}
