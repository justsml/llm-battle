import {
  rejectToolResponse,
  resolveToolResponse,
} from "@/lib/agentic-bridge";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    toolCallId?: string;
    output?: unknown;
    error?: string;
  } | null;

  const toolCallId = body?.toolCallId?.trim();
  if (!toolCallId) {
    return Response.json(
      { error: "toolCallId is required." },
      { status: 400 },
    );
  }

  if (typeof body?.error === "string" && body.error.trim()) {
    const matched = rejectToolResponse(toolCallId, body.error.trim());
    return Response.json(
      matched
        ? { ok: true }
        : { error: "No pending tool call matched that id." },
      { status: matched ? 200 : 404 },
    );
  }

  const matched = resolveToolResponse(toolCallId, body?.output ?? null);
  return Response.json(
    matched ? { ok: true } : { error: "No pending tool call matched that id." },
    { status: matched ? 200 : 404 },
  );
}
