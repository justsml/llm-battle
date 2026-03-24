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
      completed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'running',
      prompt TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      image_object_key TEXT NOT NULL DEFAULT '',
      image_data_url TEXT,
      image_name TEXT NOT NULL DEFAULT '',
      models JSONB NOT NULL DEFAULT '[]'::jsonb,
      results JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `;
  await sql`
    ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ
  `;
  await sql`
    ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'running'
  `;
  await sql`
    ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS image_object_key TEXT NOT NULL DEFAULT ''
  `;
  await sql`
    ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS image_data_url TEXT
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS run_model_results (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      model_index INTEGER NOT NULL,
      model_id TEXT NOT NULL,
      model_label TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle',
      error TEXT,
      output_text TEXT NOT NULL DEFAULT '',
      output_url TEXT NOT NULL DEFAULT '',
      output_object_key TEXT NOT NULL DEFAULT '',
      output_content_type TEXT NOT NULL DEFAULT '',
      started_at TIMESTAMPTZ,
      first_token_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      latency_ms INTEGER,
      runtime_ms INTEGER,
      finish_reason TEXT,
      response_id TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      reasoning_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_write_tokens INTEGER,
      input_cost DOUBLE PRECISION,
      output_cost DOUBLE PRECISION,
      cache_read_cost DOUBLE PRECISION,
      cache_write_cost DOUBLE PRECISION,
      total_cost DOUBLE PRECISION,
      PRIMARY KEY (run_id, model_index)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS runs_created_at_idx
    ON runs (created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS run_model_results_run_id_idx
    ON run_model_results (run_id, model_index)
  `;
}

export async function insertRun(run: {
  id: string;
  createdAt: string;
  status?: string;
  prompt: string;
  imageUrl: string;
  imageObjectKey?: string;
  imageDataUrl?: string;
  imageName: string;
  models: CompareModel[];
  results: ModelResult[];
}) {
  const sql = getClient();
  await sql`
    INSERT INTO runs (
      id,
      created_at,
      status,
      prompt,
      image_url,
      image_object_key,
      image_data_url,
      image_name,
      models,
      results
    )
    VALUES (
      ${run.id},
      ${run.createdAt},
      ${run.status ?? "running"},
      ${run.prompt},
      ${run.imageUrl},
      ${run.imageObjectKey ?? ""},
      ${run.imageDataUrl ?? null},
      ${run.imageName},
      ${JSON.stringify(run.models)},
      ${JSON.stringify(run.results)}
    )
  `;
}

export async function upsertRunModelResult(params: {
  runId: string;
  modelIndex: number;
  result: ModelResult;
}) {
  const sql = getClient();
  await sql`
    INSERT INTO run_model_results (
      run_id,
      model_index,
      model_id,
      model_label,
      status,
      error,
      output_text,
      output_url,
      output_object_key,
      output_content_type,
      started_at,
      first_token_at,
      completed_at,
      latency_ms,
      runtime_ms,
      finish_reason,
      response_id,
      input_tokens,
      output_tokens,
      total_tokens,
      reasoning_tokens,
      cache_read_tokens,
      cache_write_tokens,
      input_cost,
      output_cost,
      cache_read_cost,
      cache_write_cost,
      total_cost
    )
    VALUES (
      ${params.runId},
      ${params.modelIndex},
      ${params.result.modelId},
      ${params.result.label},
      ${params.result.status},
      ${params.result.error ?? null},
      ${params.result.text},
      ${params.result.outputUrl ?? ""},
      ${params.result.outputObjectKey ?? ""},
      ${params.result.outputContentType ?? ""},
      ${params.result.startedAt ?? null},
      ${params.result.firstTokenAt ?? null},
      ${params.result.completedAt ?? null},
      ${params.result.latencyMs ?? null},
      ${params.result.runtimeMs ?? null},
      ${params.result.finishReason ?? null},
      ${params.result.responseId ?? null},
      ${params.result.usage?.inputTokens ?? null},
      ${params.result.usage?.outputTokens ?? null},
      ${params.result.usage?.totalTokens ?? null},
      ${params.result.usage?.reasoningTokens ?? null},
      ${params.result.usage?.cacheReadTokens ?? null},
      ${params.result.usage?.cacheWriteTokens ?? null},
      ${params.result.costs?.input ?? null},
      ${params.result.costs?.output ?? null},
      ${params.result.costs?.cacheRead ?? null},
      ${params.result.costs?.cacheWrite ?? null},
      ${params.result.costs?.total ?? null}
    )
    ON CONFLICT (run_id, model_index) DO UPDATE
    SET
      model_id = EXCLUDED.model_id,
      model_label = EXCLUDED.model_label,
      status = EXCLUDED.status,
      error = EXCLUDED.error,
      output_text = EXCLUDED.output_text,
      output_url = EXCLUDED.output_url,
      output_object_key = EXCLUDED.output_object_key,
      output_content_type = EXCLUDED.output_content_type,
      started_at = EXCLUDED.started_at,
      first_token_at = EXCLUDED.first_token_at,
      completed_at = EXCLUDED.completed_at,
      latency_ms = EXCLUDED.latency_ms,
      runtime_ms = EXCLUDED.runtime_ms,
      finish_reason = EXCLUDED.finish_reason,
      response_id = EXCLUDED.response_id,
      input_tokens = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      total_tokens = EXCLUDED.total_tokens,
      reasoning_tokens = EXCLUDED.reasoning_tokens,
      cache_read_tokens = EXCLUDED.cache_read_tokens,
      cache_write_tokens = EXCLUDED.cache_write_tokens,
      input_cost = EXCLUDED.input_cost,
      output_cost = EXCLUDED.output_cost,
      cache_read_cost = EXCLUDED.cache_read_cost,
      cache_write_cost = EXCLUDED.cache_write_cost,
      total_cost = EXCLUDED.total_cost
  `;
}

export type RunRow = {
  id: string;
  created_at: string;
  completed_at?: string | null;
  status: string;
  prompt: string;
  image_url: string;
  image_object_key: string;
  image_data_url?: string | null;
  image_name: string;
  models: CompareModel[];
  results: ModelResult[];
};

type RunModelResultRow = {
  run_id: string;
  model_index: number;
  model_id: string;
  model_label: string;
  status: ModelResult["status"];
  error?: string | null;
  output_text: string;
  output_url: string;
  output_object_key: string;
  output_content_type: string;
  started_at?: string | null;
  first_token_at?: string | null;
  completed_at?: string | null;
  latency_ms?: number | null;
  runtime_ms?: number | null;
  finish_reason?: string | null;
  response_id?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  reasoning_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  input_cost?: number | null;
  output_cost?: number | null;
  cache_read_cost?: number | null;
  cache_write_cost?: number | null;
  total_cost?: number | null;
};

function toOptionalNumber(value: number | string | null | undefined) {
  if (value == null) return undefined;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toModelResult(row: RunModelResultRow): ModelResult {
  const usage = {
    inputTokens: toOptionalNumber(row.input_tokens),
    outputTokens: toOptionalNumber(row.output_tokens),
    totalTokens: toOptionalNumber(row.total_tokens),
    reasoningTokens: toOptionalNumber(row.reasoning_tokens),
    cacheReadTokens: toOptionalNumber(row.cache_read_tokens),
    cacheWriteTokens: toOptionalNumber(row.cache_write_tokens),
  };
  const costs = {
    input: toOptionalNumber(row.input_cost),
    output: toOptionalNumber(row.output_cost),
    cacheRead: toOptionalNumber(row.cache_read_cost),
    cacheWrite: toOptionalNumber(row.cache_write_cost),
    total: toOptionalNumber(row.total_cost),
  };

  return {
    modelId: row.model_id,
    label: row.model_label,
    text: row.output_text,
    status: row.status,
    error: row.error ?? undefined,
    startedAt: row.started_at ?? undefined,
    firstTokenAt: row.first_token_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    latencyMs: toOptionalNumber(row.latency_ms),
    runtimeMs: toOptionalNumber(row.runtime_ms),
    finishReason: row.finish_reason ?? undefined,
    responseId: row.response_id ?? undefined,
    usage: Object.values(usage).some((value) => value != null) ? usage : undefined,
    costs: Object.values(costs).some((value) => value != null) ? costs : undefined,
    outputUrl: row.output_url || undefined,
    outputObjectKey: row.output_object_key || undefined,
    outputContentType: row.output_content_type || undefined,
  };
}

async function listRunModelResults(runId: string) {
  const sql = getClient();
  const rows = await sql`
    SELECT
      run_id,
      model_index,
      model_id,
      model_label,
      status,
      error,
      output_text,
      output_url,
      output_object_key,
      output_content_type,
      started_at,
      first_token_at,
      completed_at,
      latency_ms,
      runtime_ms,
      finish_reason,
      response_id,
      input_tokens,
      output_tokens,
      total_tokens,
      reasoning_tokens,
      cache_read_tokens,
      cache_write_tokens,
      input_cost,
      output_cost,
      cache_read_cost,
      cache_write_cost,
      total_cost
    FROM run_model_results
    WHERE run_id = ${runId}
    ORDER BY model_index ASC
  `;
  return rows as unknown as RunModelResultRow[];
}

export async function listRuns(limit = 20) {
  const sql = getClient();
  const rows = await sql`
    SELECT
      id,
      created_at,
      completed_at,
      status,
      prompt,
      image_url,
      image_object_key,
      image_data_url,
      image_name,
      models,
      results
    FROM runs
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  const typedRows = rows as unknown as RunRow[];

  const runResults = await Promise.all(
    typedRows.map(async (row) => ({
      runId: row.id,
      results: await listRunModelResults(row.id),
    })),
  );
  const resultsByRunId = new Map(runResults.map(({ runId, results }) => [runId, results]));

  return typedRows.map((row) => ({
    ...row,
    results: (() => {
      const normalizedRows = resultsByRunId.get(row.id) ?? [];
      if (!normalizedRows.length) {
        return row.results;
      }

      const rowsByIndex = new Map(normalizedRows.map((result) => [result.model_index, result]));
      return row.models.map((model, index) => {
        const normalizedResult = rowsByIndex.get(index);
        if (normalizedResult) {
          return toModelResult(normalizedResult);
        }

        return (
          row.results[index] ?? {
            modelId: model.id,
            label: model.label,
            text: "",
            status: "idle" as const,
          }
        );
      });
    })(),
  }));
}

export async function finalizeRun(params: {
  id: string;
  completedAt: string;
  status: string;
  results: ModelResult[];
  imageUrl: string;
  imageObjectKey?: string;
  imageDataUrl?: string;
}) {
  const sql = getClient();
  await sql`
    UPDATE runs
    SET
      completed_at = ${params.completedAt},
      status = ${params.status},
      results = ${JSON.stringify(params.results)}::jsonb,
      image_url = ${params.imageUrl},
      image_object_key = ${params.imageObjectKey ?? ""},
      image_data_url = ${params.imageDataUrl ?? null}
    WHERE id = ${params.id}
  `;
}

export function isDatabaseConfigured() {
  return !!process.env.DATABASE_URL;
}
