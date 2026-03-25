import { build, parse } from "llm-strings";

import type { CompareModel, GatewayModel } from "@/lib/types";

export const MODEL_PROVIDER_ALIASES = {
  vercel: "ai-gateway.vercel.sh",
  openai: "api.openai.com",
  anthropic: "api.anthropic.com",
  google: "generativelanguage.googleapis.com",
  openrouter: "openrouter.ai",
} as const;

type ModelProviderAlias = keyof typeof MODEL_PROVIDER_ALIASES;

function resolveModelProviderHost(hostOrAlias: string) {
  return MODEL_PROVIDER_ALIASES[hostOrAlias as ModelProviderAlias] ?? hostOrAlias;
}

export function buildModelConfig(modelId: string, provider: ModelProviderAlias = "vercel") {
  return build({
    host: provider,
    model: modelId,
    params: {},
  });
}

export function getModelConfig(model: Pick<CompareModel, "id" | "config"> | string) {
  return typeof model === "string" ? buildModelConfig(model) : model.config ?? buildModelConfig(model.id);
}

export function getModelLabel(model: Pick<CompareModel, "id" | "config"> | string) {
  return parseModelConfig(model).model;
}

export function parseModelConfig(model: Pick<CompareModel, "id" | "config"> | string) {
  const parsed = parse(getModelConfig(model));

  return {
    ...parsed,
    host: resolveModelProviderHost(parsed.host),
  };
}

export const DEFAULT_PROMPT =
  "You are given a UI screenshot and must recreate it as a single self-contained HTML artifact for realtime preview. Return only runnable HTML starting with <!DOCTYPE html> and ending with </html> with no markdown fences or commentary. Use semantic HTML, inline <style>, and optional inline <script>. Do not rely on external assets, frameworks, CDNs, or network requests. Match the screenshot's layout, spacing, hierarchy, typography, colors, borders, and interactions as closely as possible. Prefer stable, progressively renderable markup so partial streaming still paints useful UI early. If some details are unclear, make tasteful product-quality decisions and keep the result polished and responsive.";

export const DEFAULT_MODELS: CompareModel[] = [
  "openai/gpt-5.4",
  "anthropic/claude-4.6-sonnet",
  "google/gemini-3-flash-preview",
  "alibaba/qwen3-vl-instruct",
].map((id) => ({
  id,
  label: getModelLabel(id),
  config: buildModelConfig(id),
}));

export function isVisionCapableModel(model: Pick<GatewayModel, "type" | "tags"> & { supportsImageInput?: boolean }) {
  if (model.type !== "language") return false;

  return model.supportsImageInput || model.tags.includes("vision") || model.tags.includes("file-input");
}

export function toCompareModel(model: Pick<GatewayModel, "id" | "name">): CompareModel {
  return {
    id: model.id,
    label: getModelLabel(model.id),
    config: getModelConfig(model),
  };
}
