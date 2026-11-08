/**
 * Pure helpers extracted from chatCore.ts.
 * Kept side-effect free so they can be unit-tested and reused independently.
 */

import { FORMATS } from "../translator/formats.ts";
import { CLAUDE_OAUTH_TOOL_PREFIX } from "../translator/request/openai-to-claude.ts";

export function extractMemoryTextFromResponse(
  response: Record<string, unknown> | null | undefined
): string {
  if (!response || typeof response !== "object") return "";

  const openAIText = response?.choices?.[0]?.message?.content;
  if (typeof openAIText === "string") {
    return openAIText.trim();
  }

  if (Array.isArray(response?.content)) {
    const contentText = response.content
      .filter(
        (part: Record<string, unknown>) => part?.type === "text" && typeof part?.text === "string"
      )
      .map((part: Record<string, unknown>) => String(part.text).trim())
      .filter(Boolean)
      .join("\n");
    if (contentText) return contentText;
  }

  if (typeof response?.output_text === "string") {
    return response.output_text.trim();
  }

  return "";
}

export function shouldUseNativeCodexPassthrough({
  provider,
  sourceFormat,
  endpointPath,
}: {
  provider?: string | null;
  sourceFormat?: string | null;
  endpointPath?: string | null;
}): boolean {
  if (provider !== "codex") return false;
  if (sourceFormat !== FORMATS.OPENAI_RESPONSES) return false;
  let normalizedEndpoint = String(endpointPath || "");
  while (normalizedEndpoint.endsWith("/")) normalizedEndpoint = normalizedEndpoint.slice(0, -1);
  const segments = normalizedEndpoint.split("/");
  return segments.includes("responses");
}

export function buildClaudePassthroughToolNameMap(
  body: Record<string, unknown> | null | undefined
) {
  if (!body || !Array.isArray(body.tools)) return null;

  const toolNameMap = new Map<string, string>();
  for (const tool of body.tools) {
    const toolRecord = tool as Record<string, unknown>;
    const toolData =
      toolRecord?.type === "function" &&
      toolRecord.function &&
      typeof toolRecord.function === "object"
        ? (toolRecord.function as Record<string, unknown>)
        : toolRecord;
    const originalName = typeof toolData?.name === "string" ? toolData.name.trim() : "";
    if (!originalName) continue;
    toolNameMap.set(`${CLAUDE_OAUTH_TOOL_PREFIX}${originalName}`, originalName);
  }

  return toolNameMap.size > 0 ? toolNameMap : null;
}

export function restoreClaudePassthroughToolNames(
  responseBody: Record<string, unknown>,
  toolNameMap: Map<string, string> | null
) {
  if (!toolNameMap || !Array.isArray(responseBody?.content)) return responseBody;

  let changed = false;
  const content = responseBody.content.map((block: Record<string, unknown>) => {
    if (block?.type !== "tool_use" || typeof block?.name !== "string") return block;
    const restoredName = toolNameMap.get(block.name) ?? block.name;
    if (restoredName === block.name) return block;
    changed = true;
    return {
      ...block,
      name: restoredName,
    };
  });

  if (!changed) return responseBody;
  return {
    ...responseBody,
    content,
  };
}

export function materializeDeduplicatedExecutionResult<T extends Record<string, unknown>>(
  result: T
): T {
  const snapshot =
    result && typeof result === "object"
      ? ((result as Record<string, unknown>)._dedupSnapshot as
          | {
              status: number;
              statusText: string;
              headers: [string, string][];
              payload: string;
            }
          | undefined)
      : undefined;

  if (!snapshot) return result;

  return {
    ...result,
    response: new Response(snapshot.payload, {
      status: snapshot.status,
      statusText: snapshot.statusText,
      headers: snapshot.headers,
    }),
  } as T;
}

export function getSkillsProviderForFormat(
  format: string
): "openai" | "anthropic" | "google" | "other" {
  switch (format) {
    case FORMATS.CLAUDE:
      return "anthropic";
    case FORMATS.GEMINI:
      return "google";
    default:
      return "openai";
  }
}

export function getSkillsModelIdForFormat(format: string): string {
  switch (format) {
    case FORMATS.CLAUDE:
      return "claude";
    case FORMATS.GEMINI:
      return "gemini";
    default:
      return "openai";
  }
}

export function getHeaderValueCaseInsensitive(
  headers: Record<string, unknown> | null | undefined,
  targetName: string
) {
  if (!headers || typeof headers !== "object") return null;
  const lowered = targetName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowered && typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function buildClaudePromptCacheLogMeta(
  targetFormat: string,
  finalBody: Record<string, unknown> | null | undefined,
  providerHeaders: Record<string, unknown> | null | undefined
) {
  if (targetFormat !== FORMATS.CLAUDE || !finalBody || typeof finalBody !== "object") return null;

  const describeCacheControl = (cacheControl: Record<string, unknown> | undefined, extra = {}) => ({
    type:
      cacheControl && typeof cacheControl.type === "string" && cacheControl.type.trim()
        ? cacheControl.type.trim()
        : "ephemeral",
    ttl:
      cacheControl && typeof cacheControl.ttl === "string" && cacheControl.ttl.trim()
        ? cacheControl.ttl.trim()
        : null,
    ...extra,
  });

  const systemBreakpoints = Array.isArray(finalBody.system)
    ? finalBody.system.flatMap((block, index) => {
        if (!block || typeof block !== "object") return [];
        const cacheControl =
          block.cache_control && typeof block.cache_control === "object"
            ? block.cache_control
            : null;
        return cacheControl ? [describeCacheControl(cacheControl, { index })] : [];
      })
    : [];

  const toolBreakpoints = Array.isArray(finalBody.tools)
    ? finalBody.tools.flatMap((tool, index) => {
        if (!tool || typeof tool !== "object") return [];
        const cacheControl =
          tool.cache_control && typeof tool.cache_control === "object" ? tool.cache_control : null;
        const name = typeof tool.name === "string" && tool.name.trim() ? tool.name.trim() : null;
        return cacheControl ? [describeCacheControl(cacheControl, { index, name })] : [];
      })
    : [];

  const messageBreakpoints = Array.isArray(finalBody.messages)
    ? finalBody.messages.flatMap((message, messageIndex) => {
        if (!message || typeof message !== "object" || !Array.isArray(message.content)) return [];
        const role =
          typeof message.role === "string" && message.role.trim() ? message.role.trim() : "unknown";
        return message.content.flatMap((block, contentIndex) => {
          if (!block || typeof block !== "object") return [];
          const cacheControl =
            block.cache_control && typeof block.cache_control === "object"
              ? block.cache_control
              : null;
          if (!cacheControl) return [];
          return [
            describeCacheControl(cacheControl, {
              messageIndex,
              contentIndex,
              role,
              blockType:
                typeof block.type === "string" && block.type.trim() ? block.type.trim() : "unknown",
            }),
          ];
        });
      })
    : [];

  const totalBreakpoints =
    systemBreakpoints.length + toolBreakpoints.length + messageBreakpoints.length;
  const anthropicBeta = getHeaderValueCaseInsensitive(providerHeaders, "Anthropic-Beta");

  if (totalBreakpoints === 0 && !anthropicBeta) return null;

  return {
    applied: totalBreakpoints > 0,
    totalBreakpoints,
    anthropicBeta,
    systemBreakpoints,
    toolBreakpoints,
    messageBreakpoints,
  };
}

export function toPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function buildCacheUsageLogMeta(usage: Record<string, unknown> | null | undefined) {
  if (!usage || typeof usage !== "object") return null;
  const promptTokenDetails =
    usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
      ? (usage.prompt_tokens_details as Record<string, unknown>)
      : undefined;
  const hasCacheFields =
    "cache_read_input_tokens" in usage ||
    "cached_tokens" in usage ||
    "cache_creation_input_tokens" in usage ||
    (!!promptTokenDetails &&
      ("cached_tokens" in promptTokenDetails || "cache_creation_tokens" in promptTokenDetails));
  const cacheReadTokens = toPositiveNumber(
    usage.cache_read_input_tokens ?? usage.cached_tokens ?? promptTokenDetails?.cached_tokens
  );
  const cacheCreationTokens = toPositiveNumber(
    usage.cache_creation_input_tokens ?? promptTokenDetails?.cache_creation_tokens
  );
  if (!hasCacheFields) return null;
  return {
    cacheReadTokens,
    cacheCreationTokens,
  };
}

export function attachLogMeta(
  payload: Record<string, unknown> | null | undefined,
  meta: Record<string, unknown> | null | undefined
) {
  if (!meta || typeof meta !== "object") return payload;
  const compactMeta = Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== null && value !== undefined)
  );
  if (Object.keys(compactMeta).length === 0) return payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { _omniroute: compactMeta, _payload: payload ?? null };
  }
  const existing =
    payload._omniroute &&
    typeof payload._omniroute === "object" &&
    !Array.isArray(payload._omniroute)
      ? payload._omniroute
      : {};
  return {
    ...payload,
    _omniroute: {
      ...existing,
      ...compactMeta,
    },
  };
}

/**
 * Core chat handler - shared between SSE and Worker
 * Returns { success, response, status, error } for caller to handle fallback
 * @param {object} options
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {object} options.log - Logger instance (optional)
 * @param {function} options.onCredentialsRefreshed - Callback when credentials are refreshed
 * @param {function} options.onRequestSuccess - Callback when request succeeds (to clear error status)
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {string} options.connectionId - Connection ID for usage tracking
 * @param {object} options.apiKeyInfo - API key metadata for usage attribution
 * @param {string} options.userAgent - Client user agent for caching decisions
 * @param {string} options.comboName - Combo name if this is a combo request
 * @param {string} options.comboStrategy - Combo routing strategy (e.g., 'priority', 'cost-optimized')
 * @param {boolean} options.isCombo - Whether this request is from a combo
 * @param {string} options.connectionId - Connection ID for settings lookup
 */
