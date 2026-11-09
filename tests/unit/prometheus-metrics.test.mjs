import test from "node:test";
import assert from "node:assert/strict";

const { renderPrometheusMetrics, escapeLabelValue } = await import("../../src/lib/prometheus.ts");

test("escapes quotes, backslashes and newlines in label values", () => {
  assert.equal(escapeLabelValue('a"b\\c\nd'), 'a\\"b\\\\c\\nd');
});

test("renders counters, breaker one-hot state and cost gauges", () => {
  const text = renderPrometheusMetrics({
    usage: [
      {
        provider: "openai",
        model: "gpt-4o",
        success: 1,
        requests: 3,
        tokensInput: 10,
        tokensOutput: 5,
        latencySumMs: 900,
      },
      {
        provider: "openai",
        model: "gpt-4o",
        success: 0,
        requests: 1,
        tokensInput: 0,
        tokensOutput: 0,
        latencySumMs: 50,
      },
    ],
    breakers: [{ name: "openai", state: "OPEN", failureCount: 4 }],
    costs: [{ apiKeyId: "k1", costUsd24h: 1.5, costUsdTotal: 9 }],
  });
  assert.match(text, /# TYPE omniroute_requests_total counter/);
  assert.match(
    text,
    /omniroute_requests_total\{provider="openai",model="gpt-4o",outcome="success"\} 3/
  );
  assert.match(
    text,
    /omniroute_requests_total\{provider="openai",model="gpt-4o",outcome="error"\} 1/
  );
  assert.match(
    text,
    /omniroute_tokens_total\{provider="openai",model="gpt-4o",direction="output"\} 5/
  );
  assert.match(text, /omniroute_circuit_breaker_state\{name="openai",state="OPEN"\} 1/);
  assert.match(text, /omniroute_circuit_breaker_state\{name="openai",state="CLOSED"\} 0/);
  assert.match(text, /omniroute_api_key_cost_usd_24h\{api_key_id="k1"\} 1.5/);
  assert.ok(text.endsWith("\n"));
});

test("empty input still yields valid HELP/TYPE headers", () => {
  const text = renderPrometheusMetrics({ usage: [], breakers: [], costs: [] });
  assert.match(text, /# HELP omniroute_requests_total/);
  assert.doesNotMatch(text, /^omniroute_requests_total\{/m);
});
