import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

const resetResilienceSchema = z.object({ name: z.string().min(1).max(200).optional() }).strict();

/**
 * POST /api/resilience/reset — Reset circuit breakers and clear cooldowns.
 * Body (optional): { "name": "<breaker name>" } resets only that breaker; no body resets all.
 */
export async function POST(request: Request) {
  try {
    let rawBody: unknown = {};
    const text = await request.text();
    if (text.trim().length > 0) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
    }
    const validation = validateBody(resetResilienceSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { name } = validation.data;

    const { getAllCircuitBreakerStatuses, getCircuitBreaker } =
      await import("@/shared/utils/circuitBreaker");

    const statuses = getAllCircuitBreakerStatuses();
    const targets = name ? statuses.filter((s) => s.name === name) : statuses;
    if (name && targets.length === 0) {
      return NextResponse.json({ error: `Circuit breaker not found: ${name}` }, { status: 404 });
    }

    let resetCount = 0;
    for (const { name: breakerName } of targets) {
      getCircuitBreaker(breakerName).reset();
      resetCount++;
    }

    return NextResponse.json({
      ok: true,
      resetCount,
      message: `Reset ${resetCount} circuit breaker(s)`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reset resilience state";
    console.error("[API] POST /api/resilience/reset error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
