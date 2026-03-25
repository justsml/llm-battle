import { fetchAvailableModels } from "@/lib/gateway-models";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET() {
  try {
    const models = await fetchAvailableModels();
    return Response.json({ models });
  } catch {
    return Response.json({ error: "Unable to load model catalogs." }, { status: 502 });
  }
}
