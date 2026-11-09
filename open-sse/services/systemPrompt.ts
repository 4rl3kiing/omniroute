/**
 * System Prompt Injection — Phase 10
 *
 * Injects a global system prompt into all requests at proxy level.
 */

// In-memory config
let _config = {
  enabled: false,
  prompt: "",
};

/**
 * Set system prompt config
 */
export function setSystemPromptConfig(config) {
  _config = { ..._config, ...config };
}

/**
 * Get system prompt config
 */
export function getSystemPromptConfig() {
  return { ..._config };
}

/**
 * Inject system prompt into request body.
 *
 * @param {object} body - Request body
 * @param {string} [promptText] - Override prompt text
 * @returns {object} Modified body
 */
export function injectSystemPrompt(body, promptText = null) {
  const text = promptText || _config.prompt;
  if (!text || !_config.enabled) return body;
  if (!body || typeof body !== "object") return body;
  if (body._skipSystemPrompt) return body;

  const result = { ...body };

  // Claude format keeps the system prompt in a top-level `system` field; adding a
  // role:"system" message there would be rejected upstream, so skip the messages branch.
  const hasClaudeSystemField = result.system !== undefined;

  // OpenAI format (messages[])
  if (!hasClaudeSystemField && result.messages && Array.isArray(result.messages)) {
    const sysIdx = result.messages.findIndex((m) => m.role === "system" || m.role === "developer");
    result.messages = [...result.messages];
    if (sysIdx >= 0) {
      // Prepend to existing system message
      const msg = { ...result.messages[sysIdx] };
      msg.content = text + "\n\n" + (msg.content || "");
      result.messages[sysIdx] = msg;
    } else {
      result.messages = [{ role: "system", content: text }, ...result.messages];
    }
  }

  // Claude format (system field)
  if (result.system !== undefined) {
    if (typeof result.system === "string") {
      result.system = text + "\n\n" + result.system;
    } else if (Array.isArray(result.system)) {
      result.system = [{ type: "text", text }, ...result.system];
    }
  }

  return result;
}

/**
 * Sync the in-memory config from persisted settings (settings.systemPrompt, written by
 * PUT /api/settings/system-prompt). Cheap: callers pass already-cached settings.
 */
export function applySystemPromptFromSettings(settings) {
  const saved = settings?.systemPrompt;
  if (!saved || typeof saved !== "object") return;
  const enabled = saved.enabled === true;
  const prompt = typeof saved.prompt === "string" ? saved.prompt : "";
  if (_config.enabled !== enabled || _config.prompt !== prompt) {
    _config = { ..._config, enabled, prompt };
  }
}
