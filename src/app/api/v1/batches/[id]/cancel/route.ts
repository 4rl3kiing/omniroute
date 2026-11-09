import { authorizeV1, corsPreflight, json, notFound } from "@/lib/batches/auth";
import { publicRecord } from "@/lib/batches/store";
import { requestCancel } from "@/lib/batches/processor";

export async function OPTIONS() {
  return corsPreflight("POST, OPTIONS");
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authorizeV1(request);
  if (auth.rejection) return auth.rejection;
  const { id } = await props.params;
  const rec = requestCancel(id, auth.owner);
  return rec ? json(publicRecord(rec)) : notFound("Batch");
}
