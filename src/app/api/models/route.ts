import { fetchGatewayModels } from "@/lib/gateway-models";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET() {
  try {
    const models = await fetchGatewayModels();
    return Response.json({ models });
  } catch {
    return Response.json({ error: "Unable to load Vercel AI Gateway models." }, { status: 502 });
  }
}
