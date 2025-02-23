import {getBaseDocument, WebBaseDocumentPayload} from "@/loaders";
import {wrapJSON, WrappedResponse} from "@/wrapping";
import {Params} from "@remix-run/react";
import {hmId} from "@shm/shared";

export const loader = async ({
  request,
  params,
}: {
  request: Request;
  params: Params;
}): Promise<WrappedResponse<WebBaseDocumentPayload>> => {
  const url = new URL(request.url);
  const version = url.searchParams.get("v");
  const latest = url.searchParams.get("l") === "true";
  const entityPath = params["*"]?.split("/");
  const uid = entityPath?.[0];
  const path = entityPath?.slice(1);
  if (!uid) {
    throw new Error("No uid provided");
  }
  const id = hmId("d", uid, {path: path || [], version, latest});
  const loaded = await getBaseDocument(id);
  return wrapJSON(loaded);
};
