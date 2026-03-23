import type { CompareModel, GatewayModel } from "@/lib/types";

export const DEFAULT_PROMPT =
  "You are given a UI screenshot and must recreate it as a single self-contained HTML artifact for realtime preview. Return only runnable HTML starting with <!DOCTYPE html> and ending with </html> with no markdown fences or commentary. Use semantic HTML, inline <style>, and optional inline <script>. Do not rely on external assets, frameworks, CDNs, or network requests. Match the screenshot's layout, spacing, hierarchy, typography, colors, borders, and interactions as closely as possible. Prefer stable, progressively renderable markup so partial streaming still paints useful UI early. If some details are unclear, make tasteful product-quality decisions and keep the result polished and responsive.";

export const DEFAULT_MODELS: CompareModel[] = [
  { id: "openai/gpt-5.4", label: "GPT-5.4" },
  { id: "anthropic/claude-4.6-sonnet", label: "Claude 4.6 Sonnet" },
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { id: "alibaba/qwen3-vl-instruct", label: "Qwen 3 VL Instruct" },
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
