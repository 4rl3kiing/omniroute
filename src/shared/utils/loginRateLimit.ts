/**
 * In-memory brute-force protection for the dashboard login.
 *
 * Tracks failed attempts per client key (IP) inside a sliding window and blocks
 * further attempts once the limit is reached. A successful login clears the key.
 * State is process-local by design (single-instance SQLite deployment).
 */

export interface LoginRateLimitOptions {
  maxAttempts?: number;
  windowMs?: number;
  maxTrackedKeys?: number;
  now?: () => number;
}

export interface LoginRateLimitStatus {
  blocked: boolean;
  retryAfterSeconds: number;
}

export function createLoginRateLimiter(options: LoginRateLimitOptions = {}) {
  const maxAttempts = options.maxAttempts ?? 5;
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const maxTrackedKeys = options.maxTrackedKeys ?? 5000;
  const now = options.now ?? Date.now;
  const failures = new Map<string, number[]>();

  function prune(key: string, current: number): number[] {
    const recent = (failures.get(key) || []).filter((ts) => current - ts < windowMs);
    if (recent.length > 0) failures.set(key, recent);
    else failures.delete(key);
    return recent;
  }

  return {
    check(key: string): LoginRateLimitStatus {
      const current = now();
      const recent = prune(key, current);
      if (recent.length < maxAttempts) return { blocked: false, retryAfterSeconds: 0 };
      const retryAfterMs = windowMs - (current - recent[0]);
      return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    },

    recordFailure(key: string): void {
      const current = now();
      if (!failures.has(key) && failures.size >= maxTrackedKeys) {
        // Bound memory: drop the oldest tracked key.
        const oldest = failures.keys().next().value;
        if (oldest !== undefined) failures.delete(oldest);
      }
      const recent = prune(key, current);
      recent.push(current);
      failures.set(key, recent);
    },

    recordSuccess(key: string): void {
      failures.delete(key);
    },

    reset(): void {
      failures.clear();
    },
  };
}

export const loginRateLimiter = createLoginRateLimiter();

/** Best-effort client key from proxy headers; falls back to a shared bucket. */
export function getLoginClientKey(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded ? forwarded.split(",")[0].trim() : "";
  return first || headers.get("x-real-ip")?.trim() || "unknown";
}
