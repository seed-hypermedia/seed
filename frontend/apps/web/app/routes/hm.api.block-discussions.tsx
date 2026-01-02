import { grpcClient } from "@/client.server";
import { wrapJSON, WrappedResponse } from "@/wrapping.server";
import { Params } from "@remix-run/react";
import {
  createCommentsByReferenceResolver,
  HMListCommentsOutput,
  unpackHmId,
} from "@shm/shared";

const loadCommentsByReference = createCommentsByReferenceResolver(grpcClient);

export const loader = async ({
  request,
  params,
}: {
  request: Request;
  params: Params;
}): Promise<WrappedResponse<HMListCommentsOutput>> => {
  const url = new URL(request.url);
  const targetId = unpackHmId(url.searchParams.get("targetId") || undefined);
  const blockId = url.searchParams.get("blockId");
  if (!targetId) throw new Error("targetId is required");
  if (!blockId) throw new Error("blockId is required");

  const result = await loadCommentsByReference(targetId, blockId);

  return wrapJSON(result);
};
