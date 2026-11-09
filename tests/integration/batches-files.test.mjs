import test from "node:test";
import assert from "node:assert/strict";

import { createChatPipelineHarness } from "./_chatPipelineHarness.mjs";

const harness = await createChatPipelineHarness("batches");
const { BaseExecutor, buildOpenAIResponse, resetStorage, seedApiKey, seedConnection, waitFor } =
  harness;

const filesRoute = await import("../../src/app/api/v1/files/route.ts");
const fileByIdRoute = await import("../../src/app/api/v1/files/[id]/route.ts");
const fileContentRoute = await import("../../src/app/api/v1/files/[id]/content/route.ts");
const batchesRoute = await import("../../src/app/api/v1/batches/route.ts");
const batchByIdRoute = await import("../../src/app/api/v1/batches/[id]/route.ts");
const batchCancelRoute = await import("../../src/app/api/v1/batches/[id]/cancel/route.ts");

test.beforeEach(async () => {
  BaseExecutor.RETRY_CONFIG.delayMs = 0;
  await resetStorage();
});
test.afterEach(async () => {
  await resetStorage();
});
test.after(async () => {
  await harness.cleanup();
});

const authHeaders = (key) => (key ? { Authorization: `Bearer ${key}` } : {});

async function upload(text, key = null, purpose = "batch") {
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", new File([text], "in.jsonl", { type: "application/jsonl" }));
  const res = await filesRoute.POST(
    new Request("http://localhost/v1/files", {
      method: "POST",
      headers: authHeaders(key),
      body: form,
    })
  );
  return { res, json: await res.json() };
}

function createBatch(inputFileId, key = null) {
  return batchesRoute.POST(
    new Request("http://localhost/v1/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(key) },
      body: JSON.stringify({
        input_file_id: inputFileId,
        endpoint: "/v1/chat/completions",
        completion_window: "24h",
      }),
    })
  );
}

const line = (id, content, model = "openai/gpt-4o-mini") =>
  JSON.stringify({
    custom_id: id,
    method: "POST",
    url: "/v1/chat/completions",
    body: { model, messages: [{ role: "user", content }] },
  });

test("upload → batch → output file with one result per request", async () => {
  await seedConnection("openai", { apiKey: "sk-openai-batch" });
  let n = 0;
  globalThis.fetch = async () => buildOpenAIResponse(`reply-${++n}`);

  const { res, json: file } = await upload([line("a", "one"), line("b", "two")].join("\n"));
  assert.equal(res.status, 200);
  assert.equal(file.object, "file");
  assert.equal(file.owner, undefined);

  const created = await (await createBatch(file.id)).json();
  assert.equal(created.object, "batch");
  assert.equal(created.request_counts.total, 2);

  const done = await waitFor(async () => {
    const r = await batchByIdRoute.GET(new Request("http://localhost/v1/batches/x"), {
      params: Promise.resolve({ id: created.id }),
    });
    const j = await r.json();
    return j.status === "completed" ? j : null;
  }, 5000);
  assert.ok(done, "batch should complete");
  assert.equal(done.request_counts.completed, 2);
  assert.ok(done.output_file_id);

  const content = await fileContentRoute.GET(new Request("http://localhost/v1/files/x/content"), {
    params: Promise.resolve({ id: done.output_file_id }),
  });
  const rows = (await content.text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.deepEqual(
    rows.map((r) => r.custom_id),
    ["a", "b"]
  );
  assert.equal(rows[0].response.status_code, 200);
  assert.equal(rows[0].response.body.choices[0].message.content, "reply-1");
});

test("invalid input files are rejected with 400", async () => {
  const bad = await upload('{"custom_id":"a","method":"POST","url":"/v1/embeddings","body":{}}');
  const res = await createBatch(bad.json.id);
  assert.equal(res.status, 400);

  const dup = await upload([line("a", "x"), line("a", "y")].join("\n"));
  assert.equal((await createBatch(dup.json.id)).status, 400);

  const missing = await createBatch("file-" + "0".repeat(32));
  assert.equal(missing.status, 400);
});

test("files are private to the API key that uploaded them", async () => {
  const keyA = await seedApiKey({ name: "a" });
  const keyB = await seedApiKey({ name: "b" });
  const { json: file } = await upload(line("a", "x"), keyA.key);
  const asB = await fileByIdRoute.GET(
    new Request("http://localhost/v1/files/x", { headers: authHeaders(keyB.key) }),
    { params: Promise.resolve({ id: file.id }) }
  );
  assert.equal(asB.status, 404);
  const asA = await fileByIdRoute.GET(
    new Request("http://localhost/v1/files/x", { headers: authHeaders(keyA.key) }),
    { params: Promise.resolve({ id: file.id }) }
  );
  assert.equal(asA.status, 200);
  const del = await fileByIdRoute.DELETE(
    new Request("http://localhost/v1/files/x", {
      method: "DELETE",
      headers: authHeaders(keyA.key),
    }),
    { params: Promise.resolve({ id: file.id }) }
  );
  assert.equal((await del.json()).deleted, true);
});

test("path-traversal style ids are never read from disk", async () => {
  const res = await fileContentRoute.GET(new Request("http://localhost/v1/files/x/content"), {
    params: Promise.resolve({ id: "../../etc/passwd" }),
  });
  assert.equal(res.status, 404);
  const res2 = await batchCancelRoute.POST(
    new Request("http://localhost/v1/batches/x/cancel", { method: "POST" }),
    {
      params: Promise.resolve({ id: "batch-../../x" }),
    }
  );
  assert.equal(res2.status, 404);
});

test("upstream failures land in the error file and the batch still completes", async () => {
  await seedConnection("openai", { apiKey: "sk-openai-batch-err" });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "bad request" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  const { json: file } = await upload(line("only", "x"));
  const created = await (await createBatch(file.id)).json();
  const done = await waitFor(async () => {
    const r = await batchByIdRoute.GET(new Request("http://localhost/v1/batches/x"), {
      params: Promise.resolve({ id: created.id }),
    });
    const j = await r.json();
    return j.status === "completed" ? j : null;
  }, 5000);
  assert.ok(done);
  assert.equal(done.request_counts.failed, 1);
  assert.equal(done.output_file_id, null);
  assert.ok(done.error_file_id);
});
