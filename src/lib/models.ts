import { build, normalize, parse } from "llm-strings";

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

function isLocalHost(host: string) {
  return (
    host === "localhost"
    || host.startsWith("localhost:")
    || host === "127.0.0.1"
    || host.startsWith("127.0.0.1:")
    || host === "0.0.0.0"
    || host.startsWith("0.0.0.0:")
  );
}

function normalizeApiPath(value: string | undefined) {
  if (!value) return "/v1";
  return value.startsWith("/") ? value : `/${value}`;
}

function toOptionalNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toOptionalStringArray(value: string | undefined) {
  if (!value) return undefined;
  return value
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function resolveModelBaseUrl(model: Pick<CompareModel, "id" | "config"> | string) {
  const parsed = parseModelConfig(model);

  if (parsed.host === "ai-gateway.vercel.sh") {
    return "https://ai-gateway.vercel.sh/v1";
  }

  if (parsed.host === "openrouter.ai") {
    return "https://openrouter.ai/api/v1";
  }

  const protocol = parsed.params.protocol?.trim() || (isLocalHost(parsed.host) ? "http" : "https");
  const apiPath = normalizeApiPath(parsed.params.path?.trim() || parsed.params.base_path?.trim());

  return `${protocol}://${parsed.host}${apiPath}`;
}

export function getModelApiKey(model: Pick<CompareModel, "id" | "config"> | string) {
  const parsed = parseModelConfig(model);
  return parsed.apiKey?.trim() || undefined;
}

export function getModelRequestOptions(model: Pick<CompareModel, "id" | "config"> | string) {
  const parsed = parseModelConfig(model);
  const { config } = normalize(parsed);

  return {
    temperature: toOptionalNumber(config.params.temperature),
    topP: toOptionalNumber(config.params.top_p ?? config.params.topP),
    topK: toOptionalNumber(config.params.top_k ?? config.params.topK),
    maxOutputTokens: toOptionalNumber(config.params.max_tokens ?? config.params.maxOutputTokens),
    frequencyPenalty: toOptionalNumber(config.params.frequency_penalty ?? config.params.frequencyPenalty),
    presencePenalty: toOptionalNumber(config.params.presence_penalty ?? config.params.presencePenalty),
    stopSequences: toOptionalStringArray(config.params.stop ?? config.params.stopSequences),
    seed: toOptionalNumber(config.params.seed),
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
    label: model.name?.trim() || getModelLabel(model.id),
    config: getModelConfig(model),
  };
}
