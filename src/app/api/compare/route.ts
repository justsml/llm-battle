import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";

import { getServerSession } from "@/lib/auth";
import {
  ensureSchema,
  finalizeRun,
  insertRun,
  isDatabaseConfigured,
  upsertRunModelResult,
} from "@/lib/db";
import { estimateModelCost, fetchAvailableModels } from "@/lib/gateway-models";
import { DEFAULT_MODELS, parseModelConfig } from "@/lib/models";
import { isStorageConfigured, uploadImage, uploadText } from "@/lib/storage";
import type { CompareRequest, CompareModel, GatewayModel, ModelResult, ModelUsageSnapshot } from "@/lib/types";
import { readDataUrlMeta } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

const gateway = createOpenAICompatible({
  name: "vercel-ai-gateway",
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: "https://ai-gateway.vercel.sh/v1",
});

const openrouter = createOpenAICompatible({
  name: "openrouter",
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  headers: {
    "HTTP-Referer": "https://github.com/justsml/llm-battle",
    "X-Title": "LLM Build-Off",
  },
});

function getProviderClient(model: CompareModel) {
  const parsed = parseModelConfig(model);

  if (parsed.host === "openrouter.ai") {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("Missing OPENROUTER_API_KEY. Add it to your environment first.");
    }

    return {
      client: openrouter,
      modelId: parsed.model,
    };
  }

  return {
    client: gateway,
    modelId: parsed.model,
  };
}

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
    const provider = getProviderClient(model);
    const result = streamText({
      model: provider.client.chatModel(provider.modelId),
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

function looksLikeHtml(value: string) {
  return /<!doctype html|<html[\s>]|<body[\s>]|<head[\s>]|<\/?[a-z][\w:-]*(?:\s[^>]*)?>/i.test(value);
}

function createOutputArtifactKey(runId: string, modelIndex: number, modelId: string, output: string) {
  const extension = looksLikeHtml(output) ? "html" : "txt";
  const modelSlug = encodeURIComponent(modelId);
  return {
    key: `runs/${runId}/models/${String(modelIndex).padStart(2, "0")}-${modelSlug}/output.${extension}`,
    contentType: extension === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
  };
}

async function persistModelResult(params: {
  runId: string;
  modelIndex: number;
  result: ModelResult;
  useDb: boolean;
  useStorage: boolean;
}) {
  let persistedResult = params.result;

  if (params.useStorage) {
    const artifact = createOutputArtifactKey(
      params.runId,
      params.modelIndex,
      params.result.modelId,
      params.result.text,
    );

    try {
      const outputUrl = await uploadText(artifact.key, params.result.text, artifact.contentType);
      persistedResult = {
        ...persistedResult,
        outputUrl,
        outputObjectKey: artifact.key,
        outputContentType: artifact.contentType,
      };
    } catch (error) {
      console.error(`Output upload failed for ${params.result.modelId}:`, error);
    }
  }

  if (params.useDb) {
    try {
      await upsertRunModelResult({
        runId: params.runId,
        modelIndex: params.modelIndex,
        result: persistedResult,
      });
    } catch (error) {
      console.error(`Failed to persist model result for ${params.result.modelId}:`, error);
    }
  }

  return persistedResult;
}

export async function POST(request: Request) {
  const session = await getServerSession(request);
  if (!session?.user) {
    return Response.json(
      { error: "Sign in to run a build-off." },
      { status: 401 },
    );
  }

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
  const catalogModels = await fetchAvailableModels().catch(() => []);
  const catalogModelMap = new Map(catalogModels.map((model) => [model.config, model]));

  if (!prompt || !imageDataUrl) {
    return Response.json(
      { error: "Both a prompt and a screenshot are required." },
      { status: 400 },
    );
  }

  const runId = uid();
  const createdAt = new Date().toISOString();
  let useDb = isDatabaseConfigured();
  const useStorage = isStorageConfigured();
  const baseResults = models.map((model) => ({
    modelId: model.id,
    label: model.label,
    text: "",
    status: "idle" as const,
  }));
  const screenshotObjectKey = `runs/${runId}/input/screenshot`;

  // Upload image to Tigris in parallel with streaming
  const imageUploadPromise = useStorage
    ? uploadImage(screenshotObjectKey, imageDataUrl)
        .then((imageUrl) => ({
          imageUrl,
          imageObjectKey: screenshotObjectKey,
        }))
        .catch((error) => {
          console.error("Image upload failed:", error);
          return {
            imageUrl: "",
            imageObjectKey: "",
          };
        })
    : Promise.resolve({
        imageUrl: "",
        imageObjectKey: "",
      });

  // Ensure schema exists if DB is configured
  if (useDb) {
    try {
      await ensureSchema();
      await insertRun({
        id: runId,
        userId: session.user.id,
        createdAt,
        status: "running",
        prompt,
        imageUrl: "",
        imageObjectKey: "",
        imageDataUrl: useStorage ? undefined : imageDataUrl,
        imageName,
        models,
        results: baseResults,
      });
    } catch (error) {
      useDb = false;
      console.error("Initial run persistence failed:", error);
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        sendEvent(controller, {
          type: "ready",
          runId,
          modelIds: models.map((model) => model.id),
        });

        const finalResults = await Promise.all(
          models.map(async (model, modelIndex) => {
            const result = await streamModelResult(
              controller,
              model,
              catalogModelMap.get(parseModelConfig(model).raw),
              prompt,
              imageDataUrl,
            );
            return persistModelResult({
              runId,
              modelIndex,
              result,
              useDb,
              useStorage,
            });
          }),
        );

        if (useDb) {
          const imageArtifact = await imageUploadPromise;
          const completedAt = new Date().toISOString();

          try {
            await finalizeRun({
              id: runId,
              completedAt,
              status: "completed",
              results: finalResults,
              imageUrl: imageArtifact.imageUrl,
              imageObjectKey: imageArtifact.imageObjectKey,
              imageDataUrl: imageArtifact.imageUrl ? undefined : imageDataUrl,
            });
          } catch (error) {
            console.error("Failed to finalize run persistence:", error);
          }

          sendEvent(controller, {
            type: "complete",
            runId,
            completedAt,
          });
        } else {
          const completedAt = new Date().toISOString();
          sendEvent(controller, {
            type: "complete",
            runId,
            completedAt,
          });
        }
      } catch (error) {
        console.error("Compare stream failed:", error);
        if (useDb) {
          const imageArtifact = await imageUploadPromise;
          const completedAt = new Date().toISOString();

          try {
            await finalizeRun({
              id: runId,
              completedAt,
              status: "error",
              results: baseResults,
              imageUrl: imageArtifact.imageUrl,
              imageObjectKey: imageArtifact.imageObjectKey,
              imageDataUrl: imageArtifact.imageUrl ? undefined : imageDataUrl,
            });
          } catch (finalizeError) {
            console.error("Failed to finalize errored run persistence:", finalizeError);
          }
        }

        sendEvent(controller, {
          type: "fatal",
          runId,
          error: error instanceof Error ? error.message : "Unexpected compare error.",
        });
      } finally {
        controller.close();
      }
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
