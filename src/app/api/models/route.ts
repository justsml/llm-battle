import type { GatewayModel } from "@/lib/types";
import { isVisionCapableModel } from "@/lib/models";

export const runtime = "nodejs";
export const revalidate = 3600;

type GatewayModelsResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    owned_by?: string;
    type?: string;
    tags?: string[];
  }>;
};

export async function GET() {
  const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
    headers: { Accept: "application/json" },
    next: { revalidate },
  });

  if (!response.ok) {
    return Response.json({ error: "Unable to load Vercel AI Gateway models." }, { status: 502 });
  }

  const payload = (await response.json()) as GatewayModelsResponse;
  const models: GatewayModel[] = (payload.data ?? [])
    .filter((model): model is NonNullable<GatewayModelsResponse["data"]>[number] & { id: string } =>
      Boolean(model.id),
    )
    .map((model) => {
      const tags = model.tags ?? [];

      return {
        id: model.id,
        name: model.name?.trim() || model.id,
        ownedBy: model.owned_by?.trim() || "unknown",
        type: model.type?.trim() || "unknown",
        tags,
        supportsImageInput: isVisionCapableModel({
          type: model.type?.trim() || "unknown",
          tags,
        }),
      };
    })
    .sort((left, right) => {
      if (left.supportsImageInput !== right.supportsImageInput) {
        return left.supportsImageInput ? -1 : 1;
      }

      const providerOrder = left.ownedBy.localeCompare(right.ownedBy);
      if (providerOrder !== 0) return providerOrder;

      return left.name.localeCompare(right.name);
    });

  return Response.json({ models });
}
