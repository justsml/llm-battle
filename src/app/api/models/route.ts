import { randomUUID } from "node:crypto";

import { parse } from "llm-strings";

import { getServerSession } from "@/lib/auth";
import {
  deleteCustomModelConfig,
  ensureSchema,
  insertCustomModelConfig,
  isDatabaseConfigured,
  listCustomModelConfigs,
} from "@/lib/db";
import { fetchAvailableModels } from "@/lib/gateway-models";
import { getModelLabel, parseModelConfig } from "@/lib/models";
import type { CreateCustomModelRequest, CustomModelConfig, GatewayModel } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 3600;

function toCustomGatewayModel(model: CustomModelConfig): GatewayModel {
  const parsed = parse(model.llmString);
  const normalized = parseModelConfig({
    id: `${parsed.host}/${parsed.model}`,
    config: model.llmString,
  });
  const ownedBy = normalized.host.split("/")[0]?.split(":")[0] || "custom";

  return {
    id: `custom/${model.id}`,
    name: model.name,
    config: model.llmString,
    ownedBy,
    type: "language",
    tags: model.supportsImageInput ? ["vision", "custom"] : ["custom"],
    supportsImageInput: model.supportsImageInput,
    pricing: {
      inputTiers: [],
      outputTiers: [],
      inputCacheReadTiers: [],
      inputCacheWriteTiers: [],
    },
    description: `Custom endpoint for ${getModelLabel({
      id: `${normalized.host}/${normalized.model}`,
      config: model.llmString,
    })}`,
  };
}

export async function GET(request: Request) {
  try {
    const models = await fetchAvailableModels();
    const customModels: GatewayModel[] = [];

    if (isDatabaseConfigured()) {
      const session = await getServerSession(request);
      if (session?.user) {
        await ensureSchema();
        const storedConfigs = await listCustomModelConfigs(session.user.id);
        customModels.push(...storedConfigs.map(toCustomGatewayModel));
      }
    }

    const seenConfigs = new Set<string>();
    const mergedModels = [...customModels, ...models].filter((model) => {
      if (seenConfigs.has(model.config)) return false;
      seenConfigs.add(model.config);
      return true;
    });

    return Response.json({ models: mergedModels });
  } catch {
    return Response.json({ error: "Unable to load model catalogs." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(request);
  if (!session?.user) {
    return Response.json({ error: "Sign in to save custom models." }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return Response.json({ error: "DATABASE_URL is required to save custom models." }, { status: 500 });
  }

  try {
    const body = (await request.json()) as Partial<CreateCustomModelRequest>;
    const name = body.name?.trim();
    const llmString = body.llmString?.trim();
    const supportsImageInput = body.supportsImageInput ?? true;

    if (!name || !llmString) {
      return Response.json({ error: "Both name and llmString are required." }, { status: 400 });
    }

    parse(llmString);
    await ensureSchema();

    const customModel = await insertCustomModelConfig({
      id: randomUUID(),
      userId: session.user.id,
      name,
      llmString,
      supportsImageInput,
    });

    return Response.json({
      model: toCustomGatewayModel(customModel),
      customModel,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save custom model.";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await getServerSession(request);
  if (!session?.user) {
    return Response.json({ error: "Sign in to remove custom models." }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return Response.json({ error: "DATABASE_URL is required to remove custom models." }, { status: 500 });
  }

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim();

    if (!id) {
      return Response.json({ error: "Model id is required." }, { status: 400 });
    }

    await ensureSchema();
    const deleted = await deleteCustomModelConfig({
      id,
      userId: session.user.id,
    });

    if (!deleted) {
      return Response.json({ error: "Custom model not found." }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove custom model.";
    return Response.json({ error: message }, { status: 400 });
  }
}
