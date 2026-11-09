/**
 * Request hedging for combos (opt-in, non-streaming only).
 *
 * If the primary model has not answered after `delayMs`, the same request is also sent to the
 * next healthy model and the first *good* answer wins. This trims tail latency at the price of
 * one extra upstream request when the primary is slow. The losing request cannot be cancelled
 * and is simply ignored.
 */

export function resolveHedgeDelayMs(
  config: { hedgeAfterMs?: unknown } | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): number {
  const fromConfig = Number(config?.hedgeAfterMs);
  if (Number.isFinite(fromConfig) && fromConfig > 0) return Math.floor(fromConfig);
  const fromEnv = Number(env.OMNIROUTE_COMBO_HEDGE_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return 0;
}

export interface HedgeOutcome<T> {
  result: T;
  winner: "primary" | "secondary";
  hedged: boolean;
}

/**
 * Runs `primary`; after `delayMs` also starts `secondary`.
 * The first result for which `isGood` is true wins. If no result is good, the primary's result is
 * returned (so the caller's normal error handling applies unchanged).
 */
export async function runWithHedge<T>(
  primary: () => Promise<T>,
  secondary: () => Promise<T>,
  delayMs: number,
  isGood: (value: T) => boolean | Promise<boolean>
): Promise<HedgeOutcome<T>> {
  return new Promise<HedgeOutcome<T>>((resolve, reject) => {
    let settled = false;
    let hedged = false;
    let pending = 1;
    let primaryResult: { value: T } | null = null;
    let primaryError: unknown = null;
    let primaryDone = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (outcome: HedgeOutcome<T>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(outcome);
    };

    const maybeGiveUp = () => {
      if (settled || pending > 0) return;
      if (primaryResult) finish({ result: primaryResult.value, winner: "primary", hedged });
      else if (primaryDone) {
        settled = true;
        reject(primaryError);
      }
    };

    const startSecondary = () => {
      if (settled || hedged) return;
      hedged = true;
      pending += 1;
      Promise.resolve()
        .then(secondary)
        .then(async (value) => {
          if (await isGood(value)) finish({ result: value, winner: "secondary", hedged: true });
        })
        .catch(() => {})
        .finally(() => {
          pending -= 1;
          maybeGiveUp();
        });
    };

    timer = setTimeout(startSecondary, delayMs);

    Promise.resolve()
      .then(primary)
      .then(async (value) => {
        primaryResult = { value };
        if (await isGood(value)) finish({ result: value, winner: "primary", hedged });
        else if (!hedged) finish({ result: value, winner: "primary", hedged: false });
      })
      .catch((err) => {
        primaryError = err;
        // Primary failed before the hedge delay: start the hedge immediately, if any.
        if (!hedged) startSecondary();
      })
      .finally(() => {
        primaryDone = true;
        pending -= 1;
        if (!settled && !hedged) {
          settled = true;
          if (timer) clearTimeout(timer);
          if (primaryResult) resolve({ result: primaryResult.value, winner: "primary", hedged });
          else reject(primaryError);
          return;
        }
        maybeGiveUp();
      });
  });
}
