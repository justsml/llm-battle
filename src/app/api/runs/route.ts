import { ensureSchema, isDatabaseConfigured, listRuns } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  if (!isDatabaseConfigured()) {
    return Response.json({ runs: [] });
  }

  try {
    await ensureSchema();
    const rows = await listRuns();

    const runs = rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      prompt: row.prompt,
      imageUrl: row.image_url,
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
