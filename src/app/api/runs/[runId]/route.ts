import { getServerSession } from "@/lib/auth";
import { ensureSchema, getRun, isDatabaseConfigured } from "@/lib/db";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = await getServerSession(request);
  if (!session?.user) {
    return Response.json(
      { error: "Sign in to access your saved runs." },
      { status: 401 },
    );
  }

  if (!isDatabaseConfigured()) {
    return Response.json(
      { error: "DATABASE_URL is required to load saved runs." },
      { status: 500 },
    );
  }

  try {
    await ensureSchema();
    const { runId } = await context.params;
    const row = await getRun(session.user.id, runId);

    if (!row) {
      return Response.json({ error: "Run not found." }, { status: 404 });
    }

    return Response.json({
      run: {
        id: row.id,
        createdAt: row.created_at,
        prompt: row.prompt,
        imageDataUrl: row.image_data_url || undefined,
        imageUrl: row.image_url,
        imageObjectKey: row.image_object_key || undefined,
        imageName: row.image_name,
        agentic: row.agentic || undefined,
        models: row.models,
        results: row.results,
      },
    });
  } catch (error) {
    console.error("Failed to fetch run:", error);
    return Response.json({ error: "Failed to load run." }, { status: 500 });
  }
}
