import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { jsonSchema, stepCountIs, streamText, tool, type ModelMessage } from "ai";
import { z } from "zod/v4";

import { createToolResponsePromise } from "@/lib/agentic-bridge";
import { getServerSession } from "@/lib/auth";
import {
  ensureSchema,
  finalizeRun,
  insertRun,
  isDatabaseConfigured,
  upsertRunModelResult,
} from "@/lib/db";
import { estimateModelCost, fetchAvailableModels } from "@/lib/gateway-models";
import {
  DEFAULT_MODELS,
  getModelApiKey,
  getModelRequestOptions,
  parseModelConfig,
  resolveModelBaseUrl,
} from "@/lib/models";
import { isStorageConfigured, uploadImage, uploadText } from "@/lib/storage";
import type {
  AgenticOptions,
  CompareModel,
  CompareRequest,
  GatewayModel,
  ModelCostSnapshot,
  ModelResult,
  ModelUsageSnapshot,
} from "@/lib/types";
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

const DEFAULT_AGENTIC_OPTIONS: AgenticOptions = {
  enabled: false,
  maxTurns: 4,
  todoListTool: false,
};

const TODO_LIST_SCHEMA = z.object({
  items: z.array(
    z.object({
      text: z.string(),
      done: z.boolean(),
    }),
  ),
});

const EMPTY_PRICING = {
  inputTiers: [],
  outputTiers: [],
  inputCacheReadTiers: [],
  inputCacheWriteTiers: [],
};

const openAiCompatibleProviders = new Map<string, ReturnType<typeof createOpenAICompatible>>();

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

  if (parsed.host === "ai-gateway.vercel.sh") {
    if (!process.env.AI_GATEWAY_API_KEY) {
      throw new Error("Missing AI_GATEWAY_API_KEY. Add it to your environment first.");
    }

    return {
      client: gateway,
      modelId: parsed.model,
    };
  }

  const apiKey = getModelApiKey(model);
  const baseURL = resolveModelBaseUrl(model);
  const cacheKey = `${baseURL}::${apiKey ?? ""}`;
  let client = openAiCompatibleProviders.get(cacheKey);

  if (!client) {
    client = createOpenAICompatible({
      name: parsed.label?.trim() || parsed.host.replace(/[^a-zA-Z0-9-]+/g, "-"),
      apiKey,
      baseURL,
    });
    openAiCompatibleProviders.set(cacheKey, client);
  }

  return {
    client,
    modelId: parsed.model,
  };
}

function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: Record<string, unknown>,
) {
  controller.enqueue(new TextEncoder().encode(`${JSON.stringify(payload)}\n`));
}

function buildUsageSnapshot(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    reasoningTokens?: number;
  };
}): ModelUsageSnapshot {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens:
      usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens,
    cacheReadTokens:
      usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
  };
}

function sumMaybeNumber(a?: number, b?: number) {
  if (a == null) return b;
  if (b == null) return a;
  return a + b;
}

function mergeUsage(
  current: ModelUsageSnapshot | undefined,
  next: ModelUsageSnapshot,
): ModelUsageSnapshot {
  return {
    inputTokens: sumMaybeNumber(current?.inputTokens, next.inputTokens),
    outputTokens: sumMaybeNumber(current?.outputTokens, next.outputTokens),
    totalTokens: sumMaybeNumber(current?.totalTokens, next.totalTokens),
    reasoningTokens: sumMaybeNumber(
      current?.reasoningTokens,
      next.reasoningTokens,
    ),
    cacheReadTokens: sumMaybeNumber(
      current?.cacheReadTokens,
      next.cacheReadTokens,
    ),
    cacheWriteTokens: sumMaybeNumber(
      current?.cacheWriteTokens,
      next.cacheWriteTokens,
    ),
  };
}

type StreamPassOptions = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  model: CompareModel;
  providerModelId: string;
  startedAtMs: number;
  firstTokenAtRef: { value?: string };
  messages: ModelMessage[];
  gatewayModel?: GatewayModel;
  replaceOnTextStart?: boolean;
  agentic?: {
    maxTurns: number;
    todoListTool: boolean;
  };
};

async function streamPass({
  controller,
  model,
  providerModelId,
  startedAtMs,
  firstTokenAtRef,
  messages,
  gatewayModel,
  replaceOnTextStart = false,
  agentic,
}: StreamPassOptions) {
  let passText = "";
  let stepUsage: ModelUsageSnapshot | undefined;
  let finishReason: string | undefined;
  let responseId: string | undefined;
  let textBlockOpen = false;
  const modelRequestOptions = getModelRequestOptions(model);

  const browserTools = {
    get_screenshot: tool({
      description:
        "Capture the currently rendered iframe screenshot for the active HTML draft.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async (_input, { toolCallId }) => {
        return createToolResponsePromise(toolCallId);
      },
    }),
    get_html: tool({
      description:
        "Read the current effective HTML draft exactly as it is being previewed in the browser.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async (_input, { toolCallId }) => {
        return createToolResponsePromise(toolCallId);
      },
    }),
    set_html: tool({
      description:
        "Replace the current browser preview with a full HTML draft so you can inspect an edited override before your final answer.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          html: {
            type: "string",
            description:
              "The full replacement HTML document or fragment to preview.",
          },
        },
        required: ["html"],
        additionalProperties: false,
      }),
      execute: async (_input, { toolCallId }) => {
        return createToolResponsePromise(toolCallId);
      },
    }),
    get_console_logs: tool({
      description:
        "Read recent console, runtime error, and unhandled rejection logs from the active iframe.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async (_input, { toolCallId }) => {
        return createToolResponsePromise(toolCallId);
      },
    }),
  };

  const tools = agentic
    ? {
        ...browserTools,
        ...(agentic.todoListTool
          ? {
              todo_list: tool({
                description:
                  "Track a compact working checklist for the current draft and mark items done as you complete them.",
                inputSchema: TODO_LIST_SCHEMA,
                execute: async (input: {
                  items: Array<{ text: string; done: boolean }>;
                }) => ({
                  items: input.items,
                }),
              }),
            }
          : {}),
      }
    : undefined;

  const result = streamText({
    model: getProviderClient(model).client.chatModel(providerModelId),
    temperature: modelRequestOptions.temperature ?? 0.3,
    topP: modelRequestOptions.topP,
    topK: modelRequestOptions.topK,
    maxOutputTokens: modelRequestOptions.maxOutputTokens,
    frequencyPenalty: modelRequestOptions.frequencyPenalty,
    presencePenalty: modelRequestOptions.presencePenalty,
    stopSequences: modelRequestOptions.stopSequences,
    seed: modelRequestOptions.seed,
    messages,
    tools,
    stopWhen: agentic ? stepCountIs(Math.max(1, agentic.maxTurns)) : undefined,
    prepareStep: agentic
      ? async ({ stepNumber }) => {
          if (stepNumber === 0) {
            return {
              toolChoice: "required" as const,
            };
          }

          return {};
        }
      : undefined,
    onStepFinish(event) {
      sendEvent(controller, {
        type: "agent-step",
        modelId: model.id,
        stepNumber: event.stepNumber,
        finishReason: event.finishReason,
      });
    },
    onFinish(event) {
      stepUsage = buildUsageSnapshot(event.totalUsage);
      finishReason = event.finishReason;
      responseId = event.response.id;
    },
  });

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-start": {
        passText = "";
        textBlockOpen = true;
        if (replaceOnTextStart) {
          sendEvent(controller, {
            type: "replace-output",
            modelId: model.id,
          });
        }
        break;
      }
      case "text-delta": {
        if (!firstTokenAtRef.value) {
          firstTokenAtRef.value = new Date().toISOString();
        }

        passText += part.text;
        sendEvent(controller, {
          type: "delta",
          modelId: model.id,
          delta: part.text,
          firstTokenAt: firstTokenAtRef.value,
          latencyMs: firstTokenAtRef.value
            ? Date.parse(firstTokenAtRef.value) - startedAtMs
            : undefined,
        });
        break;
      }
      case "tool-call": {
        sendEvent(controller, {
          type: "tool-call",
          modelId: model.id,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
        break;
      }
      case "tool-result": {
        sendEvent(controller, {
          type: "tool-result",
          modelId: model.id,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: part.output,
        });
        break;
      }
      case "tool-error": {
        sendEvent(controller, {
          type: "tool-error",
          modelId: model.id,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          error:
            "errorText" in part && typeof part.errorText === "string"
              ? part.errorText
              : "error" in part
                ? String(part.error)
                : "Tool execution failed.",
        });
        break;
      }
      case "error": {
        throw part.error;
      }
      default:
        break;
    }
  }

  if (!textBlockOpen && replaceOnTextStart) {
    sendEvent(controller, {
      type: "replace-output",
      modelId: model.id,
    });
  }

  return {
    text: passText,
    usage: stepUsage,
    finishReason,
    responseId,
  };
}

async function streamModelResult(
  controller: ReadableStreamDefaultController<Uint8Array>,
  model: CompareModel,
  gatewayModel: GatewayModel | undefined,
  prompt: string,
  imageDataUrl: string,
  agentic: AgenticOptions,
): Promise<ModelResult> {
  const { mimeType, base64 } = readDataUrlMeta(imageDataUrl);
  const image = Uint8Array.from(Buffer.from(base64, "base64"));
  const startedAtIso = new Date().toISOString();
  const startedAtMs = Date.now();
  const firstTokenAtRef: { value?: string } = {};
  const provider = getProviderClient(model);
  let fullText = "";
  let usage: ModelUsageSnapshot | undefined;
  let finishReason: string | undefined;
  let responseId: string | undefined;

  sendEvent(controller, {
    type: "start",
    modelId: model.id,
    startedAt: startedAtIso,
    agentic:
      agentic.enabled
        ? {
            maxTurns: agentic.maxTurns,
            todoListTool: agentic.todoListTool,
          }
        : undefined,
  });

  try {
    const initialPass = await streamPass({
      controller,
      model,
      providerModelId: provider.modelId,
      startedAtMs,
      firstTokenAtRef,
      gatewayModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image", image, mediaType: mimeType },
          ],
        },
      ],
    });

    fullText = initialPass.text;
    if (initialPass.usage) {
      usage = mergeUsage(usage, initialPass.usage);
    }
    finishReason = initialPass.finishReason;
    responseId = initialPass.responseId;

    if (agentic.enabled && fullText.trim() && agentic.maxTurns > 1) {
      const revisionPass = await streamPass({
        controller,
        model,
        providerModelId: provider.modelId,
        startedAtMs,
        firstTokenAtRef,
        gatewayModel,
        replaceOnTextStart: true,
        agentic: {
          maxTurns: Math.max(1, agentic.maxTurns - 1),
          todoListTool: agentic.todoListTool,
        },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image", image, mediaType: mimeType },
            ],
          },
          {
            role: "assistant",
            content: fullText,
          },
          {
            role: "user",
            content:
              "Inspect the current rendered draft with the available tools before finalizing. Return only a full replacement HTML document, never a diff.",
          },
        ],
      });

      if (revisionPass.text.trim()) {
        fullText = revisionPass.text;
      }

      if (revisionPass.usage) {
        usage = mergeUsage(usage, revisionPass.usage);
      }
      finishReason = revisionPass.finishReason ?? finishReason;
      responseId = revisionPass.responseId ?? responseId;
    }

    const completedAtIso = new Date().toISOString();
    const costs = estimateModelCost(gatewayModel?.pricing ?? EMPTY_PRICING, usage ?? {});

    sendEvent(controller, {
      type: "done",
      modelId: model.id,
      completedAt: completedAtIso,
      firstTokenAt: firstTokenAtRef.value,
      latencyMs: firstTokenAtRef.value
        ? Date.parse(firstTokenAtRef.value) - startedAtMs
        : undefined,
      runtimeMs: Date.parse(completedAtIso) - startedAtMs,
      finishReason,
      responseId,
      usage,
      costs,
    });

    return {
      modelId: model.id,
      label: model.label,
      text: fullText,
      status: "done",
      startedAt: startedAtIso,
      completedAt: completedAtIso,
      firstTokenAt: firstTokenAtRef.value,
      latencyMs: firstTokenAtRef.value
        ? Date.parse(firstTokenAtRef.value) - startedAtMs
        : undefined,
      runtimeMs: Date.parse(completedAtIso) - startedAtMs,
      finishReason,
      responseId,
      usage,
      costs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected model error.";
    const completedAtIso = new Date().toISOString();

    sendEvent(controller, {
      type: "error",
      modelId: model.id,
      error: message,
      completedAt: completedAtIso,
      firstTokenAt: firstTokenAtRef.value,
      latencyMs: firstTokenAtRef.value
        ? Date.parse(firstTokenAtRef.value) - startedAtMs
        : undefined,
      runtimeMs: Date.parse(completedAtIso) - startedAtMs,
    });

    return {
      modelId: model.id,
      label: model.label,
      text: fullText,
      status: "error",
      error: message,
      startedAt: startedAtIso,
      completedAt: completedAtIso,
      firstTokenAt: firstTokenAtRef.value,
      latencyMs: firstTokenAtRef.value
        ? Date.parse(firstTokenAtRef.value) - startedAtMs
        : undefined,
      runtimeMs: Date.parse(completedAtIso) - startedAtMs,
    };
  }
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function looksLikeHtml(value: string) {
  return /<!doctype html|<html[\s>]|<body[\s>]|<head[\s>]|<\/?[a-z][\w:-]*(?:\s[^>]*)?>/i.test(value);
}

function createOutputArtifactKey(
  runId: string,
  modelIndex: number,
  modelId: string,
  output: string,
) {
  const extension = looksLikeHtml(output) ? "html" : "txt";
  const modelSlug = encodeURIComponent(modelId);
  return {
    key: `runs/${runId}/models/${String(modelIndex).padStart(2, "0")}-${modelSlug}/output.${extension}`,
    contentType:
      extension === "html"
        ? "text/html; charset=utf-8"
        : "text/plain; charset=utf-8",
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
      const outputUrl = await uploadText(
        artifact.key,
        params.result.text,
        artifact.contentType,
      );
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

  const body = (await request.json()) as Partial<CompareRequest>;
  const prompt = body.prompt?.trim();
  const imageDataUrl = body.imageDataUrl?.trim();
  const imageName = body.imageName?.trim() || "screenshot";
  const models = body.models?.length ? body.models : DEFAULT_MODELS;
  const agentic: AgenticOptions = {
    ...DEFAULT_AGENTIC_OPTIONS,
    ...body.agentic,
    maxTurns: Math.max(
      1,
      Math.min(8, Math.round(body.agentic?.maxTurns ?? DEFAULT_AGENTIC_OPTIONS.maxTurns)),
    ),
  };
  const catalogModels = await fetchAvailableModels().catch(() => []);
  const catalogModelMap = new Map(
    catalogModels.map((model) => [model.config, model]),
  );

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
              agentic,
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

        const completedAt = new Date().toISOString();
        if (useDb) {
          const imageArtifact = await imageUploadPromise;

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
        }

        sendEvent(controller, {
          type: "complete",
          runId,
          completedAt,
        });
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
