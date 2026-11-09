import { authorizeV1, corsPreflight, json, notFound } from "@/lib/batches/auth";
import { getBatch, publicRecord } from "@/lib/batches/store";

export async function OPTIONS() {
  return corsPreflight("GET, OPTIONS");
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authorizeV1(request);
  if (auth.rejection) return auth.rejection;
  const { id } = await props.params;
  const rec = getBatch(id, auth.owner);
  return rec ? json(publicRecord(rec)) : notFound("Batch");
}
