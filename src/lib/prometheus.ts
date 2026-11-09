/**
 * Prometheus text exposition (format 0.0.4) renderer.
 * Pure functions: callers pass already-aggregated rows so this stays easy to test.
 */

export interface UsageAggregateRow {
  provider: string | null;
  model: string | null;
  success: number | null;
  requests: number;
  tokensInput: number;
  tokensOutput: number;
  latencySumMs: number;
}

export interface BreakerStatus {
  name: string;
  state: string;
  failureCount: number;
}

export interface CostRow {
  apiKeyId: string;
  costUsd24h: number;
  costUsdTotal: number;
}

export function escapeLabelValue(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function labels(obj: Record<string, unknown>): string {
  const parts = Object.entries(obj).map(([k, v]) => `${k}="${escapeLabelValue(v)}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const BREAKER_STATES = ["CLOSED", "OPEN", "HALF_OPEN"] as const;

export function renderPrometheusMetrics(input: {
  usage: UsageAggregateRow[];
  breakers: BreakerStatus[];
  costs: CostRow[];
  nowMs?: number;
}): string {
  const out: string[] = [];
  const header = (name: string, help: string, type: "counter" | "gauge") => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
  };

  header("omniroute_requests_total", "Requests handled, by provider/model/outcome.", "counter");
  for (const r of input.usage) {
    out.push(
      `omniroute_requests_total${labels({
        provider: r.provider ?? "unknown",
        model: r.model ?? "unknown",
        outcome: num(r.success) === 1 ? "success" : "error",
      })} ${num(r.requests)}`
    );
  }

  header("omniroute_tokens_total", "Tokens processed, by provider/model/direction.", "counter");
  for (const r of input.usage) {
    const base = { provider: r.provider ?? "unknown", model: r.model ?? "unknown" };
    out.push(
      `omniroute_tokens_total${labels({ ...base, direction: "input" })} ${num(r.tokensInput)}`,
      `omniroute_tokens_total${labels({ ...base, direction: "output" })} ${num(r.tokensOutput)}`
    );
  }

  header(
    "omniroute_request_latency_ms_sum",
    "Sum of request latency in ms (divide by requests_total for the mean).",
    "counter"
  );
  for (const r of input.usage) {
    out.push(
      `omniroute_request_latency_ms_sum${labels({
        provider: r.provider ?? "unknown",
        model: r.model ?? "unknown",
        outcome: num(r.success) === 1 ? "success" : "error",
      })} ${num(r.latencySumMs)}`
    );
  }

  header("omniroute_circuit_breaker_state", "1 for the breaker's current state, else 0.", "gauge");
  for (const b of input.breakers) {
    for (const s of BREAKER_STATES) {
      out.push(
        `omniroute_circuit_breaker_state${labels({ name: b.name, state: s })} ${
          String(b.state).toUpperCase() === s ? 1 : 0
        }`
      );
    }
  }
  header("omniroute_circuit_breaker_failures", "Current failure count per breaker.", "gauge");
  for (const b of input.breakers) {
    out.push(
      `omniroute_circuit_breaker_failures${labels({ name: b.name })} ${num(b.failureCount)}`
    );
  }

  header("omniroute_api_key_cost_usd_24h", "Estimated spend in the last 24h per API key.", "gauge");
  for (const c of input.costs) {
    out.push(
      `omniroute_api_key_cost_usd_24h${labels({ api_key_id: c.apiKeyId })} ${num(c.costUsd24h)}`
    );
  }
  header("omniroute_api_key_cost_usd_total", "Recorded spend per API key.", "counter");
  for (const c of input.costs) {
    out.push(
      `omniroute_api_key_cost_usd_total${labels({ api_key_id: c.apiKeyId })} ${num(c.costUsdTotal)}`
    );
  }

  return out.join("\n") + "\n";
}
