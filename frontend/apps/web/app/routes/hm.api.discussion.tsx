import {PlainMessage, toPlainMessage} from "@bufbuild/protobuf";
import {
  getCommentGroups,
  HMAccountsMetadata,
  HMComment,
  HMCommentGroup,
  hmId,
  hmIdPathToEntityQueryPath,
  ListDocumentsResponse,
  unpackHmId,
} from "@shm/shared";
import {queryClient} from "~/client";
import {getMetadata} from "~/loaders";
import {wrapJSON, WrappedResponse} from "~/wrapping";

export type HMDiscussion = PlainMessage<ListDocumentsResponse>;

export type DiscussionPayload = {
  commentGroups?: HMCommentGroup[];
  commentAuthors?: HMAccountsMetadata;
  error?: string;
};

export const loader = async ({
  request,
}: {
  request: Request;
}): Promise<WrappedResponse<DiscussionPayload>> => {
  const url = new URL(request.url);
  const id = unpackHmId(url.searchParams.get("id") || undefined);
  const targetCommentId = url.searchParams.get("targetCommentId");
  if (!id) throw new Error("id is required");
  let result: DiscussionPayload;
  try {
    const targetAccount = id.uid;
    const targetPath = hmIdPathToEntityQueryPath(id.path);
    const res = await queryClient.comments.listComments({
      targetAccount,
      targetPath,
    });
    const allComments = res.comments.map((rawComment) => {
      return toPlainMessage(rawComment) as HMComment;
    });
    const commentGroups = getCommentGroups(
      allComments,
      targetCommentId || null
    );
    const commentGroupAuthors = new Set<string>();
    commentGroups.forEach((commentGroup) => {
      commentGroup.comments.forEach((comment) => {
        commentGroupAuthors.add(comment.author);
      });
    });
    const commentAuthors = await Promise.all(
      Array.from(commentGroupAuthors).map(async (authorUid) => {
        return await getMetadata(hmId("d", authorUid));
      })
    );
    result = {
      commentGroups,
      commentAuthors: Object.fromEntries(
        commentAuthors.map((author) => [
          author.id.uid,
          {id: author.id, metadata: author.metadata},
        ])
      ) as HMAccountsMetadata,
    };
  } catch (e: any) {
    result = {error: e.message};
  }
  return wrapJSON(result);
};
