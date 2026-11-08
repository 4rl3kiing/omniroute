import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getHeaderValueCaseInsensitive,
  getSkillsProviderForFormat,
  toPositiveNumber,
  extractMemoryTextFromResponse,
  shouldUseNativeCodexPassthrough,
  buildCodexQuotaProviderData,
} from "../../open-sse/handlers/chatCoreHelpers.ts";
import * as chatCore from "../../open-sse/handlers/chatCore.ts";

describe("chatCore helpers", () => {
  it("finds headers case-insensitively and ignores blanks", () => {
    assert.equal(
      getHeaderValueCaseInsensitive({ "User-Agent": " curl/8 " }, "user-agent"),
      "curl/8"
    );
    assert.equal(getHeaderValueCaseInsensitive({ "x-a": "   " }, "x-a"), null);
    assert.equal(getHeaderValueCaseInsensitive(null, "x"), null);
  });

  it("normalizes positive numbers", () => {
    assert.equal(toPositiveNumber(5), 5);
    assert.equal(toPositiveNumber(0), 0);
    assert.equal(toPositiveNumber(-1), 0);
    assert.equal(toPositiveNumber(Number.NaN), 0);
    assert.equal(toPositiveNumber("5"), 0);
  });

  it("maps formats to a skills provider", () => {
    assert.equal(getSkillsProviderForFormat("claude"), "anthropic");
    assert.equal(getSkillsProviderForFormat("gemini"), "google");
    assert.equal(getSkillsProviderForFormat("openai"), "openai");
  });

  it("extracts memory text from OpenAI-shaped responses", () => {
    assert.equal(extractMemoryTextFromResponse(null), "");
    assert.equal(
      extractMemoryTextFromResponse({ choices: [{ message: { content: "hello" } }] }),
      "hello"
    );
  });

  it("keeps shouldUseNativeCodexPassthrough exported from chatCore", () => {
    assert.equal(chatCore.shouldUseNativeCodexPassthrough, shouldUseNativeCodexPassthrough);
    assert.equal(
      shouldUseNativeCodexPassthrough({
        provider: "codex",
        sourceFormat: "openai-responses",
        endpointPath: "/v1/responses/",
      }),
      true
    );
    assert.equal(shouldUseNativeCodexPassthrough({ provider: "openai" }), false);
  });

  describe("buildCodexQuotaProviderData", () => {
    // getCodexDualWindowCooldownMs reads the real clock, so reset times are relative to now.
    const now = Date.now();
    const reset5h = new Date(now + 3 * 3600_000).toISOString();
    const reset7d = new Date(now + 4 * 24 * 3600_000).toISOString();
    const quota = (over = {}) => ({
      usage5h: 10,
      limit5h: 100,
      resetAt5h: reset5h,
      usage7d: 10,
      limit7d: 100,
      resetAt7d: reset7d,
      ...over,
    });

    it("stores the quota snapshot and keeps existing provider data (non-429)", () => {
      const { nextProviderData, exhaustion } = buildCodexQuotaProviderData({
        existingProviderData: { keep: "me" },
        quota: quota(),
        scope: "codex",
        status: 200,
        nowMs: now,
      });
      assert.equal(exhaustion, null);
      assert.equal(nextProviderData.keep, "me");
      assert.equal(nextProviderData.codexQuotaState.usage5h, 10);
      assert.equal(nextProviderData.codexQuotaState.scope, "codex");
      assert.equal(nextProviderData.codexQuotaState.updatedAt, new Date(now).toISOString());
      assert.equal(nextProviderData.codexScopeRateLimitedUntil, undefined);
    });

    it("on 429 with an exhausted 5h window records the per-scope reset time", () => {
      const { nextProviderData, exhaustion } = buildCodexQuotaProviderData({
        existingProviderData: { codexScopeRateLimitedUntil: { spark: "2030-01-01T00:00:00.000Z" } },
        quota: quota({ usage5h: 100 }),
        scope: "codex",
        status: 429,
        nowMs: now,
      });
      assert.equal(exhaustion.window, "5h");
      // scopeUntil is "now + remaining time to reset", i.e. the reset time (within clock skew).
      assert.ok(Math.abs(Date.parse(exhaustion.scopeUntil) - Date.parse(reset5h)) < 2000);
      assert.equal(nextProviderData.codexExhaustedWindow, "5h");
      assert.equal(nextProviderData.codexScopeRateLimitedUntil.spark, "2030-01-01T00:00:00.000Z");
      assert.equal(nextProviderData.codexScopeRateLimitedUntil.codex, exhaustion.scopeUntil);
    });

    it("prefers the 7d window when both are exhausted", () => {
      const { exhaustion } = buildCodexQuotaProviderData({
        existingProviderData: {},
        quota: quota({ usage5h: 100, usage7d: 100 }),
        scope: "codex",
        status: 429,
        nowMs: now,
      });
      assert.equal(exhaustion.window, "7d");
    });

    it("on 429 without an exhausted window leaves scope limits untouched", () => {
      const { nextProviderData, exhaustion } = buildCodexQuotaProviderData({
        existingProviderData: {},
        quota: quota(),
        scope: "codex",
        status: 429,
        nowMs: now,
      });
      assert.equal(exhaustion, null);
      assert.equal(nextProviderData.codexScopeRateLimitedUntil, undefined);
    });
  });
});
