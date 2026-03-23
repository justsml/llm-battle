import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";

import { DEFAULT_MODELS } from "@/lib/models";
import type { CompareRequest, CompareModel } from "@/lib/types";
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
  prompt: string,
  imageDataUrl: string,
) {
  const { mimeType, base64 } = readDataUrlMeta(imageDataUrl);
  const image = Uint8Array.from(Buffer.from(base64, "base64"));

  sendEvent(controller, {
    type: "start",
    modelId: model.id,
    startedAt: new Date().toISOString(),
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
    });

    for await (const delta of result.textStream) {
      sendEvent(controller, {
        type: "delta",
        modelId: model.id,
        delta,
      });
    }

    sendEvent(controller, {
      type: "done",
      modelId: model.id,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected model error.";

    sendEvent(controller, {
      type: "error",
      modelId: model.id,
      error: message,
      completedAt: new Date().toISOString(),
    });
  }
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
  const models = body.models?.length ? body.models : DEFAULT_MODELS;

  if (!prompt || !imageDataUrl) {
    return Response.json(
      { error: "Both a prompt and a screenshot are required." },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      sendEvent(controller, {
        type: "ready",
        modelIds: models.map((model) => model.id),
      });

      await Promise.all(
        models.map((model) => streamModelResult(controller, model, prompt, imageDataUrl)),
      );

      sendEvent(controller, {
        type: "complete",
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
