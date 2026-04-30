import { Pool, type QueryResultRow } from "pg";

import type {
  AgenticOptions,
  CompareModel,
  CustomModelConfig,
  ModelResult,
  OutputVoteValue,
} from "@/lib/types";

type GlobalDbState = typeof globalThis & {
  __appDbPool?: Pool;
};

const globalDbState = globalThis as GlobalDbState;

type SqlQueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly SqlQueryValue[];

type SqlTag = <TRow extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: SqlQueryValue[]
) => Promise<TRow[]>;

function getPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured.");

  if (globalDbState.__appDbPool) {
    return globalDbState.__appDbPool;
  }

  const pool = new Pool({
    connectionString: url,
  });

  globalDbState.__appDbPool = pool;
  return pool;
}

function getClient(): SqlTag {
  const pool = getPool();

  return async <TRow extends QueryResultRow = QueryResultRow>(
    strings: TemplateStringsArray,
    ...values: SqlQueryValue[]
  ) => {
    let text = "";

    for (const [index, chunk] of strings.entries()) {
      text += chunk;
      if (index < values.length) {
        text += `$${index + 1}`;
      }
    }

    const result = await pool.query<TRow>(text, values);
    return result.rows;
  };
}

export async function ensureSchema() {
  const sql = getClient();
  await sql`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'running',
      prompt TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      image_object_key TEXT NOT NULL DEFAULT '',
      image_data_url TEXT,
      image_name TEXT NOT NULL DEFAULT '',
      agentic JSONB,
      models JSONB NOT NULL DEFAULT '[]'::jsonb,
      results JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `;
  await sql`
    ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE
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
    ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS agentic JSONB
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
      execution_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
      score INTEGER NOT NULL DEFAULT 0,
      upvotes INTEGER NOT NULL DEFAULT 0,
      downvotes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (run_id, model_index)
    )
  `;
  await sql`
    ALTER TABLE run_model_results
    ADD COLUMN IF NOT EXISTS execution_stats JSONB NOT NULL DEFAULT '{}'::jsonb
  `;
  await sql`
    ALTER TABLE run_model_results
    ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0
  `;
  await sql`
    ALTER TABLE run_model_results
    ADD COLUMN IF NOT EXISTS upvotes INTEGER NOT NULL DEFAULT 0
  `;
  await sql`
    ALTER TABLE run_model_results
    ADD COLUMN IF NOT EXISTS downvotes INTEGER NOT NULL DEFAULT 0
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS run_model_votes (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      model_index INTEGER NOT NULL,
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      vote SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
      score INTEGER NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (run_id, model_index, user_id),
      FOREIGN KEY (run_id, model_index)
        REFERENCES run_model_results(run_id, model_index)
        ON DELETE CASCADE
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS custom_model_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      name TEXT NOT NULL,
      llm_string TEXT NOT NULL,
      supports_image_input BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE (user_id, name),
      UNIQUE (user_id, llm_string)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS runs_created_at_idx
    ON runs (created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS runs_user_created_at_idx
    ON runs (user_id, created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS custom_model_configs_user_updated_at_idx
    ON custom_model_configs (user_id, updated_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS run_model_results_run_id_idx
    ON run_model_results (run_id, model_index)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS run_model_votes_run_id_idx
    ON run_model_votes (run_id, model_index)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS run_model_votes_user_id_idx
    ON run_model_votes (user_id, updated_at DESC)
  `;
}

export async function insertRun(run: {
  id: string;
  userId: string;
  createdAt: string;
  status?: string;
  prompt: string;
  imageUrl: string;
  imageObjectKey?: string;
  imageDataUrl?: string;
  imageName: string;
  agentic?: AgenticOptions;
  models: CompareModel[];
  results: ModelResult[];
}) {
  const sql = getClient();
  await sql`
    INSERT INTO runs (
      id,
      user_id,
      created_at,
      status,
      prompt,
      image_url,
      image_object_key,
      image_data_url,
      image_name,
      agentic,
      models,
      results
    )
    VALUES (
      ${run.id},
      ${run.userId},
      ${run.createdAt},
      ${run.status ?? "running"},
      ${run.prompt},
      ${run.imageUrl},
      ${run.imageObjectKey ?? ""},
      ${run.imageDataUrl ?? null},
      ${run.imageName},
      ${run.agentic ? JSON.stringify(run.agentic) : null},
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
      total_cost,
      execution_stats
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
      ${params.result.costs?.total ?? null},
      ${JSON.stringify(params.result.stats ?? {})}::jsonb
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
      total_cost = EXCLUDED.total_cost,
      execution_stats = EXCLUDED.execution_stats
  `;
}

export type RunRow = {
  id: string;
  user_id?: string | null;
  created_at: string;
  completed_at?: string | null;
  status: string;
  prompt: string;
  image_url: string;
  image_object_key: string;
  image_data_url?: string | null;
  image_name: string;
  agentic?: AgenticOptions | null;
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
  execution_stats?: Record<string, unknown> | null;
  score?: number | null;
  upvotes?: number | null;
  downvotes?: number | null;
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
    stats:
      row.execution_stats &&
      typeof row.execution_stats === "object" &&
      Object.keys(row.execution_stats).length
        ? row.execution_stats
        : undefined,
    outputUrl: row.output_url || undefined,
    outputObjectKey: row.output_object_key || undefined,
    outputContentType: row.output_content_type || undefined,
    vote: {
      score: toOptionalNumber(row.score) ?? 0,
      upvotes: toOptionalNumber(row.upvotes) ?? 0,
      downvotes: toOptionalNumber(row.downvotes) ?? 0,
    },
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
      total_cost,
      execution_stats,
      score,
      upvotes,
      downvotes
    FROM run_model_results
    WHERE run_id = ${runId}
    ORDER BY model_index ASC
  `;
  return rows as unknown as RunModelResultRow[];
}

type RunModelUserVoteRow = {
  run_id: string;
  model_index: number;
  vote: OutputVoteValue;
};

async function listRunModelUserVotes(userId: string, runIds: string[]) {
  if (!runIds.length) return [];

  const sql = getClient();
  const rows = await sql`
    SELECT
      run_id,
      model_index,
      vote
    FROM run_model_votes
    WHERE user_id = ${userId}
      AND run_id = ANY(${runIds})
  `;

  return rows as unknown as RunModelUserVoteRow[];
}

export async function listRuns(userId: string, limit = 20) {
  const sql = getClient();
  const rows = await sql`
    SELECT
      id,
      user_id,
      created_at,
      completed_at,
      status,
      prompt,
      image_url,
      image_object_key,
      image_data_url,
      image_name,
      agentic,
      models,
      results
    FROM runs
    WHERE user_id = ${userId}
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
  const votes = await listRunModelUserVotes(
    userId,
    typedRows.map((row) => row.id),
  );
  const userVotesByKey = new Map(
    votes.map((vote) => [`${vote.run_id}:${vote.model_index}`, vote.vote]),
  );

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
          const next = toModelResult(normalizedResult);
          const userVote = userVotesByKey.get(`${row.id}:${index}`);
          return userVote == null
            ? next
            : {
                ...next,
                vote: {
                  ...(next.vote ?? { score: 0, upvotes: 0, downvotes: 0 }),
                  userVote,
                },
              };
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

export async function getRun(userId: string, runId: string) {
  const sql = getClient();
  const rows = await sql`
    SELECT
      id,
      user_id,
      created_at,
      completed_at,
      status,
      prompt,
      image_url,
      image_object_key,
      image_data_url,
      image_name,
      agentic,
      models,
      results
    FROM runs
    WHERE user_id = ${userId}
      AND id = ${runId}
    LIMIT 1
  `;

  const row = ((rows as unknown as RunRow[])[0] ?? null);
  if (!row) return null;

  const normalizedRows = await listRunModelResults(row.id);
  const rowsByIndex = new Map(
    normalizedRows.map((result) => [result.model_index, result]),
  );
  const votes = await listRunModelUserVotes(userId, [row.id]);
  const userVotesByKey = new Map(
    votes.map((vote) => [`${vote.run_id}:${vote.model_index}`, vote.vote]),
  );

  return {
    ...row,
    results: row.models.map((model, index) => {
      const normalizedResult = rowsByIndex.get(index);
      if (normalizedResult) {
        const next = toModelResult(normalizedResult);
        const userVote = userVotesByKey.get(`${row.id}:${index}`);
        return userVote == null
          ? next
          : {
              ...next,
              vote: {
                ...(next.vote ?? { score: 0, upvotes: 0, downvotes: 0 }),
                userVote,
              },
            };
      }

      return (
        row.results[index] ?? {
          modelId: model.id,
          label: model.label,
          text: "",
          status: "idle" as const,
        }
      );
    }),
  };
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

type VoteReferenceRow = {
  run_user_id: string;
  run_created_at: string;
  run_prompt: string;
  image_url: string;
  image_object_key: string;
  image_data_url?: string | null;
  image_name: string;
  model_id: string;
  model_label: string;
  status: ModelResult["status"];
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
  execution_stats?: Record<string, unknown> | null;
};

async function getVoteReference(params: {
  runId: string;
  modelIndex: number;
  userId: string;
}) {
  const sql = getClient();
  const rows = await sql`
    SELECT
      runs.user_id AS run_user_id,
      runs.created_at AS run_created_at,
      runs.prompt AS run_prompt,
      runs.image_url,
      runs.image_object_key,
      runs.image_data_url,
      runs.image_name,
      run_model_results.model_id,
      run_model_results.model_label,
      run_model_results.status,
      run_model_results.output_text,
      run_model_results.output_url,
      run_model_results.output_object_key,
      run_model_results.output_content_type,
      run_model_results.started_at,
      run_model_results.first_token_at,
      run_model_results.completed_at,
      run_model_results.latency_ms,
      run_model_results.runtime_ms,
      run_model_results.finish_reason,
      run_model_results.response_id,
      run_model_results.input_tokens,
      run_model_results.output_tokens,
      run_model_results.total_tokens,
      run_model_results.reasoning_tokens,
      run_model_results.cache_read_tokens,
      run_model_results.cache_write_tokens,
      run_model_results.input_cost,
      run_model_results.output_cost,
      run_model_results.cache_read_cost,
      run_model_results.cache_write_cost,
      run_model_results.total_cost,
      run_model_results.execution_stats
    FROM runs
    INNER JOIN run_model_results
      ON run_model_results.run_id = runs.id
    WHERE runs.id = ${params.runId}
      AND runs.user_id = ${params.userId}
      AND run_model_results.model_index = ${params.modelIndex}
    LIMIT 1
  `;

  return ((rows as unknown as VoteReferenceRow[])[0] ?? null);
}

async function recomputeVoteSummary(runId: string, modelIndex: number) {
  const sql = getClient();
  const rows = await sql`
    SELECT
      COALESCE(SUM(score), 0) AS score,
      COUNT(*) FILTER (WHERE vote = 1) AS upvotes,
      COUNT(*) FILTER (WHERE vote = -1) AS downvotes
    FROM run_model_votes
    WHERE run_id = ${runId}
      AND model_index = ${modelIndex}
  `;

  const row = (rows as Array<{
    score: number | string | null;
    upvotes: number | string | null;
    downvotes: number | string | null;
  }>)[0];

  const score = toOptionalNumber(row?.score) ?? 0;
  const upvotes = toOptionalNumber(row?.upvotes) ?? 0;
  const downvotes = toOptionalNumber(row?.downvotes) ?? 0;

  await sql`
    UPDATE run_model_results
    SET
      score = ${score},
      upvotes = ${upvotes},
      downvotes = ${downvotes}
    WHERE run_id = ${runId}
      AND model_index = ${modelIndex}
  `;

  return {
    score,
    upvotes,
    downvotes,
  };
}

export async function setRunModelVote(params: {
  runId: string;
  modelIndex: number;
  userId: string;
  vote: OutputVoteValue;
}) {
  const sql = getClient();
  const reference = await getVoteReference(params);
  if (!reference) {
    throw new Error("That output could not be found.");
  }

  const existingRows = await sql`
    SELECT vote
    FROM run_model_votes
    WHERE run_id = ${params.runId}
      AND model_index = ${params.modelIndex}
      AND user_id = ${params.userId}
    LIMIT 1
  `;
  const existingVote = toOptionalNumber(
    (existingRows as Array<{ vote?: number | string | null }>)[0]?.vote,
  ) as OutputVoteValue | undefined;

  let userVote: OutputVoteValue | undefined = params.vote;

  if (existingVote === params.vote) {
    await sql`
      DELETE FROM run_model_votes
      WHERE run_id = ${params.runId}
        AND model_index = ${params.modelIndex}
        AND user_id = ${params.userId}
    `;
    userVote = undefined;
  } else {
    const metadata = {
      run: {
        id: params.runId,
        userId: reference.run_user_id,
        createdAt: reference.run_created_at,
        prompt: reference.run_prompt,
      },
      inputImage: {
        url: reference.image_url || undefined,
        objectKey: reference.image_object_key || undefined,
        dataUrl: reference.image_data_url || undefined,
        name: reference.image_name,
      },
      output: {
        modelIndex: params.modelIndex,
        modelId: reference.model_id,
        label: reference.model_label,
        status: reference.status,
        text: reference.output_text,
        outputUrl: reference.output_url || undefined,
        outputObjectKey: reference.output_object_key || undefined,
        outputContentType: reference.output_content_type || undefined,
        finishReason: reference.finish_reason || undefined,
        responseId: reference.response_id || undefined,
      },
      stats: {
        startedAt: reference.started_at || undefined,
        firstTokenAt: reference.first_token_at || undefined,
        completedAt: reference.completed_at || undefined,
        latencyMs: toOptionalNumber(reference.latency_ms),
        runtimeMs: toOptionalNumber(reference.runtime_ms),
        execution: reference.execution_stats || undefined,
        usage: {
          inputTokens: toOptionalNumber(reference.input_tokens),
          outputTokens: toOptionalNumber(reference.output_tokens),
          totalTokens: toOptionalNumber(reference.total_tokens),
          reasoningTokens: toOptionalNumber(reference.reasoning_tokens),
          cacheReadTokens: toOptionalNumber(reference.cache_read_tokens),
          cacheWriteTokens: toOptionalNumber(reference.cache_write_tokens),
        },
        costs: {
          input: toOptionalNumber(reference.input_cost),
          output: toOptionalNumber(reference.output_cost),
          cacheRead: toOptionalNumber(reference.cache_read_cost),
          cacheWrite: toOptionalNumber(reference.cache_write_cost),
          total: toOptionalNumber(reference.total_cost),
        },
      },
    };

    await sql`
      INSERT INTO run_model_votes (
        run_id,
        model_index,
        user_id,
        vote,
        score,
        metadata
      )
      VALUES (
        ${params.runId},
        ${params.modelIndex},
        ${params.userId},
        ${params.vote},
        ${params.vote},
        ${JSON.stringify(metadata)}::jsonb
      )
      ON CONFLICT (run_id, model_index, user_id) DO UPDATE
      SET
        vote = EXCLUDED.vote,
        score = EXCLUDED.score,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `;
  }

  const summary = await recomputeVoteSummary(params.runId, params.modelIndex);

  return {
    ...summary,
    userVote,
  };
}

type CustomModelConfigRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  name: string;
  llm_string: string;
  supports_image_input: boolean;
};

function toCustomModelConfig(row: CustomModelConfigRow): CustomModelConfig {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    llmString: row.llm_string,
    supportsImageInput: row.supports_image_input,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCustomModelConfigs(userId: string) {
  const sql = getClient();
  const rows = await sql`
    SELECT
      id,
      user_id,
      created_at,
      updated_at,
      name,
      llm_string,
      supports_image_input
    FROM custom_model_configs
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC, created_at DESC
  `;

  return (rows as unknown as CustomModelConfigRow[]).map(toCustomModelConfig);
}

export async function insertCustomModelConfig(params: {
  id: string;
  userId: string;
  name: string;
  llmString: string;
  supportsImageInput: boolean;
}) {
  const sql = getClient();
  const rows = await sql`
    INSERT INTO custom_model_configs (
      id,
      user_id,
      name,
      llm_string,
      supports_image_input
    )
    VALUES (
      ${params.id},
      ${params.userId},
      ${params.name},
      ${params.llmString},
      ${params.supportsImageInput}
    )
    RETURNING
      id,
      user_id,
      created_at,
      updated_at,
      name,
      llm_string,
      supports_image_input
  `;

  return toCustomModelConfig((rows as unknown as CustomModelConfigRow[])[0]);
}

export async function deleteCustomModelConfig(params: {
  id: string;
  userId: string;
}) {
  const sql = getClient();
  const rows = await sql`
    DELETE FROM custom_model_configs
    WHERE id = ${params.id}
      AND user_id = ${params.userId}
    RETURNING id
  `;

  return (rows as Array<{ id: string }>).length > 0;
}

export function isDatabaseConfigured() {
  return !!process.env.DATABASE_URL;
}
