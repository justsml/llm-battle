import type {
  GatewayModel,
  GatewayModelPricing,
  ModelCostSnapshot,
  ModelUsageSnapshot,
  TokenPricingTier,
} from "@/lib/types";
import { buildModelConfig, isVisionCapableModel } from "@/lib/models";

type GatewayPricingPayload = {
  input?: string;
  output?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  input_tiers?: Array<{ min?: number; max?: number; cost?: string }>;
  output_tiers?: Array<{ min?: number; max?: number; cost?: string }>;
  input_cache_read_tiers?: Array<{ min?: number; max?: number; cost?: string }>;
  input_cache_write_tiers?: Array<{ min?: number; max?: number; cost?: string }>;
};

type GatewayModelPayload = {
  id?: string;
  name?: string;
  description?: string;
  owned_by?: string;
  created?: number;
  released?: number;
  context_window?: number;
  max_tokens?: number;
  type?: string;
  tags?: string[];
  pricing?: GatewayPricingPayload;
};

type GatewayModelsResponse = {
  data?: GatewayModelPayload[];
};

type OpenRouterPricingPayload = {
  prompt?: string;
  completion?: string;
  image?: string;
  request?: string;
  input_cache_read?: string;
  input_cache_write?: string;
};

type OpenRouterArchitecturePayload = {
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
};

type OpenRouterModelPayload = {
  id?: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number;
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
  architecture?: OpenRouterArchitecturePayload;
  pricing?: OpenRouterPricingPayload;
  supported_parameters?: string[];
};

type OpenRouterModelsResponse = {
  data?: OpenRouterModelPayload[];
};

function toNumber(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTiers(tiers?: Array<{ min?: number; max?: number; cost?: string }>): TokenPricingTier[] {
  return (tiers ?? [])
    .flatMap<TokenPricingTier>((tier) => {
      const cost = toNumber(tier.cost);
      if (cost == null) return [];

      return [{
        min: tier.min ?? 0,
        max: tier.max,
        cost,
      }];
    })
    .sort((left, right) => left.min - right.min);
}

function normalizePricing(pricing?: GatewayPricingPayload): GatewayModelPricing {
  return {
    input: toNumber(pricing?.input),
    output: toNumber(pricing?.output),
    inputCacheRead: toNumber(pricing?.input_cache_read),
    inputCacheWrite: toNumber(pricing?.input_cache_write),
    inputTiers: normalizeTiers(pricing?.input_tiers),
    outputTiers: normalizeTiers(pricing?.output_tiers),
    inputCacheReadTiers: normalizeTiers(pricing?.input_cache_read_tiers),
    inputCacheWriteTiers: normalizeTiers(pricing?.input_cache_write_tiers),
  };
}

function normalizeModel(model: GatewayModelPayload): GatewayModel | null {
  if (!model.id) return null;

  const tags = model.tags ?? [];
  const type = model.type?.trim() || "unknown";

  return {
    id: model.id,
    name: model.name?.trim() || model.id,
    config: buildModelConfig(model.id, "vercel"),
    ownedBy: model.owned_by?.trim() || "unknown",
    createdAt: model.created ? new Date(model.created * 1000).toISOString() : undefined,
    releasedAt: model.released ? new Date(model.released * 1000).toISOString() : undefined,
    description: model.description?.trim() || undefined,
    contextWindow: model.context_window,
    maxTokens: model.max_tokens,
    type,
    tags,
    supportsImageInput: isVisionCapableModel({ type, tags }),
    supportsToolCalling: tags.includes("tool-use"),
    supportsReasoning: tags.includes("reasoning"),
    pricing: normalizePricing(model.pricing),
  };
}

function isOpenRouterVisionCapable(model: OpenRouterModelPayload) {
  const architecture = model.architecture;
  const modalities = [
    architecture?.modality,
    ...(architecture?.input_modalities ?? []),
    ...(architecture?.output_modalities ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return modalities.includes("image");
}

function normalizeOpenRouterPricing(pricing?: OpenRouterPricingPayload): GatewayModelPricing {
  return {
    input: toNumber(pricing?.prompt) ?? toNumber(pricing?.image),
    output: toNumber(pricing?.completion),
    inputCacheRead: toNumber(pricing?.input_cache_read),
    inputCacheWrite: toNumber(pricing?.input_cache_write),
    inputTiers: [],
    outputTiers: [],
    inputCacheReadTiers: [],
    inputCacheWriteTiers: [],
  };
}

function normalizeOpenRouterModel(model: OpenRouterModelPayload): GatewayModel | null {
  if (!model.id) return null;

  const provider = model.id.split("/")[0]?.trim() || "openrouter";
  const supportsImageInput = isOpenRouterVisionCapable(model);
  const supportedParameters = new Set(
    (model.supported_parameters ?? []).map((parameter) => parameter.toLowerCase()),
  );

  return {
    id: model.id,
    name: model.name?.trim() || model.id,
    config: buildModelConfig(model.id, "openrouter"),
    ownedBy: provider,
    type: "language",
    tags: supportsImageInput ? ["vision"] : [],
    createdAt: model.created ? new Date(model.created * 1000).toISOString() : undefined,
    releasedAt: model.created ? new Date(model.created * 1000).toISOString() : undefined,
    description: model.description?.trim() || undefined,
    contextWindow: model.top_provider?.context_length ?? model.context_length,
    maxTokens: model.top_provider?.max_completion_tokens,
    supportsImageInput,
    supportsToolCalling:
      supportedParameters.has("tools") || supportedParameters.has("tool_choice"),
    supportsReasoning:
      supportedParameters.has("reasoning")
      || supportedParameters.has("include_reasoning")
      || supportedParameters.has("reasoning_effort"),
    pricing: normalizeOpenRouterPricing(model.pricing),
  };
}

export async function fetchGatewayModels() {
  const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error("Unable to load Vercel AI Gateway models.");
  }

  const payload = (await response.json()) as GatewayModelsResponse;

  return (payload.data ?? [])
    .map(normalizeModel)
    .filter((model): model is GatewayModel => model !== null)
    .sort((left, right) => {
      if (left.supportsImageInput !== right.supportsImageInput) {
        return left.supportsImageInput ? -1 : 1;
      }

      const providerOrder = left.ownedBy.localeCompare(right.ownedBy);
      if (providerOrder !== 0) return providerOrder;

      return left.name.localeCompare(right.name);
    });
}

export async function fetchOpenRouterModels() {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error("Unable to load OpenRouter models.");
  }

  const payload = (await response.json()) as OpenRouterModelsResponse;

  return (payload.data ?? [])
    .map(normalizeOpenRouterModel)
    .filter((model): model is GatewayModel => model !== null)
    .sort((left, right) => {
      if (left.supportsImageInput !== right.supportsImageInput) {
        return left.supportsImageInput ? -1 : 1;
      }

      const providerOrder = left.ownedBy.localeCompare(right.ownedBy);
      if (providerOrder !== 0) return providerOrder;

      return left.name.localeCompare(right.name);
    });
}

export async function fetchAvailableModels() {
  const [gatewayModels, openRouterModels] = await Promise.all([
    fetchGatewayModels(),
    fetchOpenRouterModels().catch(() => []),
  ]);

  const seenConfigs = new Set<string>();

  return [...gatewayModels, ...openRouterModels].filter((model) => {
    if (seenConfigs.has(model.config)) return false;
    seenConfigs.add(model.config);
    return true;
  });
}

function calculateTieredCost(tokens: number, baseRate: number | undefined, tiers: TokenPricingTier[]) {
  if (tokens <= 0) return 0;

  if (!tiers.length) {
    return (baseRate ?? 0) * tokens;
  }

  let remaining = tokens;
  let cost = 0;

  for (let index = 0; index < tiers.length && remaining > 0; index += 1) {
    const tier = tiers[index];
    const nextTierMin = tiers[index + 1]?.min;
    const tierLimit = (tier.max ?? nextTierMin ?? Number.POSITIVE_INFINITY) - tier.min;
    const billable = Math.min(remaining, tierLimit);

    if (billable > 0) {
      cost += billable * tier.cost;
      remaining -= billable;
    }
  }

  if (remaining > 0) {
    const fallbackRate = tiers.at(-1)?.cost ?? baseRate ?? 0;
    cost += remaining * fallbackRate;
  }

  return cost;
}

function roundCurrency(value: number | undefined) {
  if (value == null || Number.isNaN(value)) return undefined;
  return Number(value.toFixed(6));
}

export function estimateModelCost(
  pricing: GatewayModelPricing,
  usage: ModelUsageSnapshot | undefined,
): ModelCostSnapshot | undefined {
  if (!usage) return undefined;

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
  const noCacheTokens = Math.max(inputTokens - cacheReadTokens - cacheWriteTokens, 0);

  const input = calculateTieredCost(noCacheTokens, pricing.input, pricing.inputTiers);
  const output = calculateTieredCost(outputTokens, pricing.output, pricing.outputTiers);
  const cacheRead = calculateTieredCost(
    cacheReadTokens,
    pricing.inputCacheRead,
    pricing.inputCacheReadTiers,
  );
  const cacheWrite = calculateTieredCost(
    cacheWriteTokens,
    pricing.inputCacheWrite,
    pricing.inputCacheWriteTiers,
  );

  const total = input + output + cacheRead + cacheWrite;

  if (total === 0 && !pricing.input && !pricing.output && !pricing.inputCacheRead && !pricing.inputCacheWrite) {
    return undefined;
  }

  return {
    input: roundCurrency(input),
    output: roundCurrency(output),
    cacheRead: roundCurrency(cacheRead),
    cacheWrite: roundCurrency(cacheWrite),
    total: roundCurrency(total),
  };
}
