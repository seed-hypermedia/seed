import {Params} from "@remix-run/react";
import {hmId} from "@shm/shared";
import {getDocument, WebDocumentPayload} from "~/loaders";
import {wrapJSON, WrappedResponse} from "~/wrapping";

export const loader = async ({
  request,
  params,
}: {
  request: Request;
  params: Params;
}): Promise<WrappedResponse<WebDocumentPayload>> => {
  const url = new URL(request.url);
  const version = url.searchParams.get("v");
  const entityPath = params["*"]?.split("/");
  const uid = entityPath?.[0];
  const path = entityPath?.slice(1);
  if (!uid) {
    throw new Error("No uid provided");
  }
  const id = hmId("d", uid, {path: path || [], version});
  const loaded = await getDocument(id);
  return wrapJSON(loaded);
};
