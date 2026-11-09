import { getDbInstance } from "@/lib/db/core";
import { getAllCircuitBreakerStatuses } from "@/shared/utils/circuitBreaker";
import { renderPrometheusMetrics, type UsageAggregateRow, type CostRow } from "@/lib/prometheus";

/**
 * GET /api/metrics — Prometheus scrape endpoint.
 * Protected by the management auth middleware: scrape with a dashboard session
 * or `Authorization: Bearer <api key>` (Prometheus `authorization.credentials`).
 */
export async function GET() {
  try {
    const db = getDbInstance();
    const usage = db
      .prepare(
        `SELECT provider, model, success,
                COUNT(*) AS requests,
                COALESCE(SUM(tokens_input), 0) AS tokensInput,
                COALESCE(SUM(tokens_output), 0) AS tokensOutput,
                COALESCE(SUM(latency_ms), 0) AS latencySumMs
           FROM usage_history
          GROUP BY provider, model, success`
      )
      .all() as UsageAggregateRow[];

    const since = Date.now() - 24 * 60 * 60 * 1000;
    const costs = db
      .prepare(
        `SELECT api_key_id AS apiKeyId,
                COALESCE(SUM(CASE WHEN timestamp >= ? THEN cost ELSE 0 END), 0) AS costUsd24h,
                COALESCE(SUM(cost), 0) AS costUsdTotal
           FROM domain_cost_history
          GROUP BY api_key_id`
      )
      .all(since) as CostRow[];

    const body = renderPrometheusMetrics({
      usage,
      breakers: getAllCircuitBreakerStatuses(),
      costs,
    });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Error rendering metrics:", error);
    return new Response("# metrics unavailable\n", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
