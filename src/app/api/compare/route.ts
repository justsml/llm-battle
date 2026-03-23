import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";

import { ensureSchema, insertRun, isDatabaseConfigured, updateRunResults } from "@/lib/db";
import { estimateModelCost, fetchGatewayModels } from "@/lib/gateway-models";
import { DEFAULT_MODELS } from "@/lib/models";
import { isStorageConfigured, uploadImage } from "@/lib/storage";
import type { CompareRequest, CompareModel, GatewayModel, ModelResult, ModelUsageSnapshot } from "@/lib/types";
import { readDataUrlMeta } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

const gateway = createOpenAICompatible({
  name: "vercel-ai-gateway",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: "https://ai-gateway.vercel.sh/v1",
});

function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: Record<string, unknown>,
) {
  controller.enqueue(new TextEncoder().encode(`${JSON.stringify(payload)}\n`));
}

async function streamModelResult(
  controller: ReadableStreamDefaultController<Uint8Array>,
  model: CompareModel,
  gatewayModel: GatewayModel | undefined,
  prompt: string,
  imageDataUrl: string,
): Promise<ModelResult> {
  const { mimeType, base64 } = readDataUrlMeta(imageDataUrl);
  const image = Uint8Array.from(Buffer.from(base64, "base64"));
  const startedAtIso = new Date().toISOString();
  const startedAtMs = Date.now();
  let firstTokenAtIso: string | undefined;
  let fullText = "";
  let finalResult: ModelResult = {
    modelId: model.id,
    label: model.label,
    text: "",
    status: "idle",
  };

  sendEvent(controller, {
    type: "start",
    modelId: model.id,
    startedAt: startedAtIso,
  });

  try {
    const result = streamText({
      model: gateway.chatModel(model.id),
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image", image, mediaType: mimeType },
          ],
        },
      ],
      onFinish(event) {
        const completedAtIso = new Date().toISOString();
        const usage: ModelUsageSnapshot = {
          inputTokens: event.totalUsage.inputTokens,
          outputTokens: event.totalUsage.outputTokens,
          totalTokens: event.totalUsage.totalTokens,
          reasoningTokens:
            event.totalUsage.outputTokenDetails.reasoningTokens ?? event.totalUsage.reasoningTokens,
          cacheReadTokens:
            event.totalUsage.inputTokenDetails.cacheReadTokens ?? event.totalUsage.cachedInputTokens,
          cacheWriteTokens: event.totalUsage.inputTokenDetails.cacheWriteTokens,
        };
        const costs = estimateModelCost(gatewayModel?.pricing ?? {
          inputTiers: [],
          outputTiers: [],
          inputCacheReadTiers: [],
          inputCacheWriteTiers: [],
        }, usage);

        sendEvent(controller, {
          type: "done",
          modelId: model.id,
          completedAt: completedAtIso,
          firstTokenAt: firstTokenAtIso,
          latencyMs: firstTokenAtIso ? Date.parse(firstTokenAtIso) - startedAtMs : undefined,
          runtimeMs: Date.parse(completedAtIso) - startedAtMs,
          finishReason: event.finishReason,
          responseId: event.response.id,
          usage,
          costs,
        });

        finalResult = {
          modelId: model.id,
          label: model.label,
          text: fullText,
          status: "done",
          startedAt: startedAtIso,
          completedAt: completedAtIso,
          firstTokenAt: firstTokenAtIso,
          latencyMs: firstTokenAtIso ? Date.parse(firstTokenAtIso) - startedAtMs : undefined,
          runtimeMs: Date.parse(completedAtIso) - startedAtMs,
          finishReason: event.finishReason,
          responseId: event.response.id,
          usage,
          costs,
        };
      },
    });

    for await (const delta of result.textStream) {
      if (!firstTokenAtIso) {
        firstTokenAtIso = new Date().toISOString();
      }
      fullText += delta;

      sendEvent(controller, {
        type: "delta",
        modelId: model.id,
        delta,
        firstTokenAt: firstTokenAtIso,
        latencyMs: Date.parse(firstTokenAtIso) - startedAtMs,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected model error.";
    const completedAtIso = new Date().toISOString();

    sendEvent(controller, {
      type: "error",
      modelId: model.id,
      error: message,
      completedAt: completedAtIso,
      firstTokenAt: firstTokenAtIso,
      latencyMs: firstTokenAtIso ? Date.parse(firstTokenAtIso) - startedAtMs : undefined,
      runtimeMs: Date.parse(completedAtIso) - startedAtMs,
    });

    finalResult = {
      modelId: model.id,
      label: model.label,
      text: fullText,
      status: "error",
      error: message,
      startedAt: startedAtIso,
      completedAt: completedAtIso,
      firstTokenAt: firstTokenAtIso,
      latencyMs: firstTokenAtIso ? Date.parse(firstTokenAtIso) - startedAtMs : undefined,
      runtimeMs: Date.parse(completedAtIso) - startedAtMs,
    };
  }

  return finalResult;
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: Request) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    return Response.json(
      { error: "Missing AI_GATEWAY_API_KEY. Add it to your environment first." },
      { status: 500 },
    );
  }

  const body = (await request.json()) as Partial<CompareRequest>;
  const prompt = body.prompt?.trim();
  const imageDataUrl = body.imageDataUrl?.trim();
  const imageName = body.imageName?.trim() || "screenshot";
  const models = body.models?.length ? body.models : DEFAULT_MODELS;
  const gatewayModels = await fetchGatewayModels().catch(() => []);
  const gatewayModelMap = new Map(gatewayModels.map((model) => [model.id, model]));

  if (!prompt || !imageDataUrl) {
    return Response.json(
      { error: "Both a prompt and a screenshot are required." },
      { status: 400 },
    );
  }

  const runId = uid();
  const createdAt = new Date().toISOString();
  const useDb = isDatabaseConfigured();
  const useStorage = isStorageConfigured();

  // Upload image to Tigris in parallel with streaming
  const imageUploadPromise = useStorage
    ? uploadImage(`runs/${runId}/screenshot`, imageDataUrl).catch((error) => {
        console.error("Image upload failed:", error);
        return "";
      })
    : Promise.resolve("");

  // Ensure schema exists if DB is configured
  if (useDb) {
    await ensureSchema().catch((error) => console.error("Schema init failed:", error));
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      sendEvent(controller, {
        type: "ready",
        runId,
        modelIds: models.map((model) => model.id),
      });

      const finalResults = await Promise.all(
        models.map((model) =>
          streamModelResult(controller, model, gatewayModelMap.get(model.id), prompt, imageDataUrl),
        ),
      );

      // Persist to Neon after all models finish
      if (useDb) {
        const imageUrl = await imageUploadPromise;
        try {
          await insertRun({
            id: runId,
            createdAt,
            prompt,
            imageUrl,
            imageName,
            models,
            results: finalResults,
          });
        } catch (error) {
          console.error("Failed to persist run:", error);
        }
      }

      sendEvent(controller, {
        type: "complete",
        runId,
        completedAt: new Date().toISOString(),
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
