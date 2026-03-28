import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";

const ESTIMATED_CHARS_PER_TOKEN = 4;

const browserTokenizer = new Tiktoken(o200kBase);

export function estimateTokens(text: string) {
  if (!text) return 0;

  try {
    return browserTokenizer.encode(text).length;
  } catch {
    return Math.max(1, Math.round(text.length / ESTIMATED_CHARS_PER_TOKEN));
  }
}
