import type { CompareModel, GatewayModel } from "@/lib/types";

export const DEFAULT_PROMPT =
  "You are evaluating a UI screenshot for a frontend build challenge. Describe the layout, typography, spacing, color palette, interaction details, and the implementation strategy a strong engineer should follow to recreate it in React and Tailwind. Be concrete and concise.";

export const DEFAULT_MODELS: CompareModel[] = [
  { id: "openai/gpt-4.1", label: "GPT-4.1" },
  { id: "anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "xai/grok-3", label: "Grok 3 Beta" },
];

export function isVisionCapableModel(model: Pick<GatewayModel, "type" | "tags">) {
  if (model.type !== "language") return false;

  return model.tags.includes("vision") || model.tags.includes("file-input");
}

export function toCompareModel(model: Pick<GatewayModel, "id" | "name">): CompareModel {
  return {
    id: model.id,
    label: model.name,
  };
}
