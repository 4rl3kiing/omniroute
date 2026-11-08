import test from "node:test";
import assert from "node:assert/strict";

const h = await import("../../src/app/(dashboard)/dashboard/providers/[id]/providerPageHelpers.ts");

test("buildCompatMap indexes rows by id and skips rows without id", () => {
  const m = h.buildCompatMap([{ id: "a" }, { id: "" }, { id: "b" }]);
  assert.deepEqual([...m.keys()], ["a", "b"]);
});

test("isModelHidden prefers custom over override and defaults to false", () => {
  const custom = new Map([["m", { id: "m", isHidden: false }]]);
  const override = new Map([
    ["m", { id: "m", isHidden: true }],
    ["n", { id: "n", isHidden: true }],
  ]);
  assert.equal(h.isModelHidden("m", custom, override), false);
  assert.equal(h.isModelHidden("n", custom, override), true);
  assert.equal(h.isModelHidden("x", custom, override), false);
});

test("providerText falls back and interpolates when the key is missing", () => {
  const t = () => "translated";
  t.has = () => false;
  assert.equal(h.providerText(t, "k", "Hi {name}", { name: "Ana" }), "Hi Ana");
  t.has = () => true;
  assert.equal(h.providerText(t, "k", "x"), "translated");
});

test("header rows round-trip through record conversion", () => {
  let n = 0;
  const rows = h.recordToHeaderRows({ "X-A": "1", "X-B": "2" }, () => `id${n++}`);
  assert.equal(rows.length, 2);
  assert.deepEqual(h.headerRowsToRecord(rows), { "X-A": "1", "X-B": "2" });
});
