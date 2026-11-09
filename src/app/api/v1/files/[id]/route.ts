import { authorizeV1, corsPreflight, json, notFound } from "@/lib/batches/auth";
import { getFile, deleteFile, publicRecord } from "@/lib/batches/store";

export async function OPTIONS() {
  return corsPreflight("GET, DELETE, OPTIONS");
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authorizeV1(request);
  if (auth.rejection) return auth.rejection;
  const { id } = await props.params;
  const rec = getFile(id, auth.owner);
  return rec ? json(publicRecord(rec)) : notFound("File");
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authorizeV1(request);
  if (auth.rejection) return auth.rejection;
  const { id } = await props.params;
  return deleteFile(id, auth.owner)
    ? json({ id, object: "file", deleted: true })
    : notFound("File");
}
