import { getServerSession } from "@/lib/auth";
import { ensureSchema, isDatabaseConfigured, listRuns } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getServerSession(request);
  if (!session?.user) {
    return Response.json(
      { runs: [], error: "Sign in to access your saved runs." },
      { status: 401 },
    );
  }

  if (!isDatabaseConfigured()) {
    return Response.json(
      { runs: [], error: "DATABASE_URL is required to load saved runs." },
      { status: 500 },
    );
  }

  try {
    await ensureSchema();
    const rows = await listRuns(session.user.id);

    const runs = rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      prompt: row.prompt,
      imageDataUrl: row.image_data_url || undefined,
      imageUrl: row.image_url,
      imageObjectKey: row.image_object_key || undefined,
      imageName: row.image_name,
      models: row.models,
      results: row.results,
    }));

    return Response.json({ runs });
  } catch (error) {
    console.error("Failed to fetch runs:", error);
    return Response.json({ runs: [], error: "Failed to load run history." }, { status: 500 });
  }
}
