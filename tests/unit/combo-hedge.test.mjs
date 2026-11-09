import test from "node:test";
import assert from "node:assert/strict";

const { runWithHedge, resolveHedgeDelayMs } = await import("../../open-sse/services/comboHedge.ts");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const good = (v) => v.ok;

test("hedging is off unless configured", () => {
  assert.equal(resolveHedgeDelayMs({}, {}), 0);
  assert.equal(resolveHedgeDelayMs({ hedgeAfterMs: 250 }, {}), 250);
  assert.equal(resolveHedgeDelayMs({}, { OMNIROUTE_COMBO_HEDGE_MS: "400" }), 400);
  assert.equal(resolveHedgeDelayMs({ hedgeAfterMs: -1 }, { OMNIROUTE_COMBO_HEDGE_MS: "x" }), 0);
});

test("fast primary wins and the secondary is never started", async () => {
  let secondaryStarted = false;
  const out = await runWithHedge(
    async () => ({ ok: true, who: "p" }),
    async () => {
      secondaryStarted = true;
      return { ok: true, who: "s" };
    },
    50,
    good
  );
  assert.equal(out.winner, "primary");
  assert.equal(out.hedged, false);
  await sleep(80);
  assert.equal(secondaryStarted, false);
});

test("slow primary loses to a faster hedge", async () => {
  const out = await runWithHedge(
    async () => {
      await sleep(200);
      return { ok: true, who: "p" };
    },
    async () => {
      await sleep(10);
      return { ok: true, who: "s" };
    },
    30,
    good
  );
  assert.equal(out.winner, "secondary");
  assert.equal(out.result.who, "s");
});

test("slow primary still wins when the hedge fails", async () => {
  const out = await runWithHedge(
    async () => {
      await sleep(80);
      return { ok: true, who: "p" };
    },
    async () => ({ ok: false, who: "s" }),
    20,
    good
  );
  assert.equal(out.winner, "primary");
  assert.equal(out.result.who, "p");
});

test("primary error before the delay falls through to the hedge", async () => {
  const out = await runWithHedge(
    async () => {
      throw new Error("boom");
    },
    async () => ({ ok: true, who: "s" }),
    500,
    good
  );
  assert.equal(out.winner, "secondary");
});

test("both failing returns the primary result / rejects with the primary error", async () => {
  const bad = await runWithHedge(
    async () => {
      await sleep(40);
      return { ok: false, who: "p" };
    },
    async () => ({ ok: false, who: "s" }),
    10,
    good
  );
  assert.equal(bad.result.who, "p");
  await assert.rejects(
    runWithHedge(
      async () => {
        throw new Error("p-err");
      },
      async () => ({ ok: false }),
      10,
      good
    ),
    /p-err/
  );
});
