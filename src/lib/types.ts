export type CompareModel = {
  id: string;
  label: string;
  config?: string;
};

export type AgenticOptions = {
  enabled: boolean;
  maxTurns: number;
  todoListTool: boolean;
};

export type CustomModelConfig = {
  id: string;
  userId: string;
  name: string;
  llmString: string;
  supportsImageInput: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateCustomModelRequest = {
  name: string;
  llmString: string;
  supportsImageInput?: boolean;
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
  config: string;
  ownedBy: string;
  type: string;
  tags: string[];
  createdAt?: string;
  releasedAt?: string;
  description?: string;
  contextWindow?: number;
  maxTokens?: number;
  supportsImageInput: boolean;
  supportsToolCalling: boolean;
  supportsReasoning: boolean;
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

export type ModelToolStats = {
  calls: number;
  errors: number;
  totalDurationMs?: number;
  averageDurationMs?: number;
  lastDurationMs?: number;
};

export type ModelExecutionStats = {
  passCount?: number;
  stepCount?: number;
  toolCallCount?: number;
  toolErrorCount?: number;
  textDeltaCount?: number;
  outputChars?: number;
  tokensPerSecond?: number;
  tools?: Record<string, ModelToolStats>;
};

export type ModelStatus = "idle" | "streaming" | "done" | "error";

export type OutputVoteValue = -1 | 1;

export type ModelVoteSummary = {
  score: number;
  upvotes: number;
  downvotes: number;
  userVote?: OutputVoteValue;
};

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
  stats?: ModelExecutionStats;
  outputUrl?: string;
  outputObjectKey?: string;
  outputContentType?: string;
  vote?: ModelVoteSummary;
};

export type SavedRun = {
  id: string;
  createdAt: string;
  prompt: string;
  imageDataUrl?: string;
  imageUrl?: string;
  imageObjectKey?: string;
  imageName: string;
  models: CompareModel[];
  results: ModelResult[];
};

export type CompareRequest = {
  prompt: string;
  imageDataUrl: string;
  imageName?: string;
  models: CompareModel[];
  agentic?: AgenticOptions;
};
