export type CompareModel = {
  id: string;
  label: string;
};

export type TokenPricingTier = {
  min: number;
  max?: number;
  cost: number;
};

export type GatewayModelPricing = {
  input?: number;
  output?: number;
  inputCacheRead?: number;
  inputCacheWrite?: number;
  inputTiers: TokenPricingTier[];
  outputTiers: TokenPricingTier[];
  inputCacheReadTiers: TokenPricingTier[];
  inputCacheWriteTiers: TokenPricingTier[];
};

export type GatewayModel = {
  id: string;
  name: string;
  ownedBy: string;
  type: string;
  tags: string[];
  supportsImageInput: boolean;
  pricing: GatewayModelPricing;
};

export type ModelUsageSnapshot = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type ModelCostSnapshot = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
};

export type ModelPerformanceSnapshot = {
  startedAt?: string;
  firstTokenAt?: string;
  completedAt?: string;
  latencyMs?: number;
  runtimeMs?: number;
};

export type ModelStatus = "idle" | "streaming" | "done" | "error";

export type ModelResult = {
  modelId: string;
  label: string;
  text: string;
  status: ModelStatus;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  firstTokenAt?: string;
  latencyMs?: number;
  runtimeMs?: number;
  finishReason?: string;
  responseId?: string;
  usage?: ModelUsageSnapshot;
  costs?: ModelCostSnapshot;
};

export type SavedRun = {
  id: string;
  createdAt: string;
  prompt: string;
  imageDataUrl?: string;
  imageUrl?: string;
  imageName: string;
  models: CompareModel[];
  results: ModelResult[];
};

export type CompareRequest = {
  prompt: string;
  imageDataUrl: string;
  imageName?: string;
  models: CompareModel[];
};
