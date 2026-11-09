/**
 * Similarity layer for the semantic cache (opt-in).
 *
 * Exact-signature matching stays the primary path. When SEMANTIC_CACHE_SIMILARITY is set to a
 * threshold in (0, 1], a near-duplicate of the LAST user message can reuse a cached response,
 * but only inside the same "scope" (model, sampling params, tools, response_format and every
 * earlier message must be identical). Vectors are local feature-hashed word + char-trigram
 * counts, so no external embedding call and no extra latency beyond a small dot-product scan.
 *
 * Safety rails: prompts containing different numbers never match (so "2+2" never reuses "2+3"),
 * and the index is bounded.
 */

import crypto from "crypto";

const DIM = 512;
const MAX_ENTRIES = 500;

export function getSimilarityThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SEMANTIC_CACHE_SIMILARITY);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 1) return 0;
  return raw;
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function embedText(text: string): Float32Array {
  const vec = new Float32Array(DIM);
  const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
  const words = norm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const w of words) vec[fnv1a("w:" + w) % DIM] += 2;
  const padded = ` ${norm} `;
  for (let i = 0; i + 3 <= padded.length; i++) vec[fnv1a("c:" + padded.slice(i, i + 3)) % DIM] += 1;
  let sum = 0;
  for (let i = 0; i < DIM; i++) sum += vec[i] * vec[i];
  const len = Math.sqrt(sum) || 1;
  for (let i = 0; i < DIM; i++) vec[i] /= len;
  return vec;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += a[i] * b[i];
  return s;
}

function numberSignature(text: string): string {
  return (text.match(/\d+(?:[.,]\d+)?/g) || []).join("|");
}

export function lastUserText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown> | null;
    if (m?.role === "user") {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        const parts = m.content
          .filter((p: any) => p?.type === "text" && typeof p.text === "string")
          .map((p: any) => p.text);
        return parts.length ? parts.join("\n") : null;
      }
      return null;
    }
  }
  return null;
}

/** Scope = everything that must match exactly except the last user message text. */
export function buildSimilarityScope(
  model: string,
  body: Record<string, any>,
  temperature: unknown,
  topP: unknown
): string | null {
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0) return null;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return null;
  // Only text-only last turns participate; multimodal prompts fall back to exact matching.
  if (typeof messages[lastUserIdx].content !== "string") return null;
  const rest = messages.filter((_: unknown, i: number) => i !== lastUserIdx);
  const payload = JSON.stringify({
    model,
    temperature,
    topP,
    pos: lastUserIdx,
    rest,
    tools: body.tools ?? null,
    tool_choice: body.tool_choice ?? null,
    response_format: body.response_format ?? null,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

interface Entry {
  scope: string;
  signature: string;
  vec: Float32Array;
  numbers: string;
}

export class SimilarityIndex {
  private entries: Entry[] = [];

  constructor(private readonly maxEntries = MAX_ENTRIES) {}

  get size() {
    return this.entries.length;
  }

  add(scope: string, signature: string, text: string) {
    this.entries = this.entries.filter((e) => e.signature !== signature);
    this.entries.push({ scope, signature, vec: embedText(text), numbers: numberSignature(text) });
    if (this.entries.length > this.maxEntries) this.entries.shift();
  }

  remove(signature: string) {
    this.entries = this.entries.filter((e) => e.signature !== signature);
  }

  /** Best matching signature in the same scope at or above `threshold`, else null. */
  find(
    scope: string,
    text: string,
    threshold: number
  ): { signature: string; score: number } | null {
    if (threshold <= 0) return null;
    const vec = embedText(text);
    const numbers = numberSignature(text);
    let best: { signature: string; score: number } | null = null;
    for (const e of this.entries) {
      if (e.scope !== scope || e.numbers !== numbers) continue;
      const score = cosine(vec, e.vec);
      if (score >= threshold && (!best || score > best.score)) {
        best = { signature: e.signature, score };
      }
    }
    return best;
  }
}

export const similarityIndex = new SimilarityIndex();
