import { grpcClient } from "@/client.server";
import { wrapJSON, WrappedResponse } from "@/wrapping.server";
import { Params } from "@remix-run/react";
import { createDiscussionThreadResolver, unpackHmId } from "@shm/shared";
import {
  HMAccountsMetadata,
  HMComment,
  HMCommentGroup,
} from "@shm/shared/hm-types";

const loadDiscussionThread = createDiscussionThreadResolver(grpcClient);

export type HMDiscussionPayload = {
  commentGroups: HMCommentGroup[];
  authors: HMAccountsMetadata;
  thread: HMComment[];
};

export const loader = async ({
  request,
  params,
}: {
  request: Request;
  params: Params;
}): Promise<WrappedResponse<HMDiscussionPayload>> => {
  const url = new URL(request.url);
  const targetId = unpackHmId(url.searchParams.get("targetId") || undefined);
  const commentId = url.searchParams.get("commentId");
  if (!targetId) throw new Error("targetId is required");
  if (!commentId) throw new Error("commentId is required");

  let result: HMDiscussionPayload | { error: string };
  try {
    result = await loadDiscussionThread(targetId, commentId);
  } catch (e: any) {
    result = { error: e.message };
  }

  return wrapJSON(result);
};
