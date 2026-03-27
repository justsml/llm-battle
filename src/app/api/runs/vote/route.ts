import { getServerSession } from "@/lib/auth";
import {
  ensureSchema,
  isDatabaseConfigured,
  setRunModelVote,
} from "@/lib/db";
import type { OutputVoteValue } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getServerSession(request);
  if (!session?.user) {
    return Response.json(
      { error: "Sign in to vote on outputs." },
      { status: 401 },
    );
  }

  if (!isDatabaseConfigured()) {
    return Response.json(
      { error: "DATABASE_URL is required to save votes." },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    runId?: unknown;
    modelIndex?: unknown;
    vote?: unknown;
  } | null;

  const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
  const modelIndex =
    typeof body?.modelIndex === "number"
      ? Math.trunc(body.modelIndex)
      : Number.NaN;
  const vote = body?.vote === 1 || body?.vote === -1
    ? (body.vote as OutputVoteValue)
    : null;

  if (!runId || !Number.isInteger(modelIndex) || modelIndex < 0 || vote == null) {
    return Response.json(
      { error: "runId, modelIndex, and vote are required." },
      { status: 400 },
    );
  }

  try {
    await ensureSchema();
    const summary = await setRunModelVote({
      runId,
      modelIndex,
      userId: session.user.id,
      vote,
    });

    return Response.json({ summary });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save vote.";
    const status =
      message === "That output could not be found." ? 404 : 500;

    if (status === 500) {
      console.error("Failed to save vote:", error);
    }

    return Response.json({ error: message }, { status });
  }
}
