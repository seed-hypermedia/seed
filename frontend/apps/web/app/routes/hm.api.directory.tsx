import {PlainMessage, toPlainMessage} from "@bufbuild/protobuf";
import {
  hmId,
  HMMetadata,
  HMTimestamp,
  ListDocumentsResponse,
  UnpackedHypermediaId,
  unpackHmId,
} from "@shm/shared";
import {queryClient} from "~/client";
import {wrapJSON, WrappedResponse} from "~/wrapping";

export type HMDirectory = PlainMessage<ListDocumentsResponse>;

export type DirectoryPayload = {
  directory?: {
    path: string;
    metadata: HMMetadata;
    updateTime?: HMTimestamp;
    id: UnpackedHypermediaId;
    authors: string[];
  }[];
  authorsMetadata?: {
    uid: string;
    metadata?: HMMetadata;
  }[];
  error?: string;
};

export const loader = async ({
  request,
}: {
  request: Request;
}): Promise<WrappedResponse<DirectoryPayload>> => {
  const url = new URL(request.url);
  const id = unpackHmId(url.searchParams.get("id") || undefined);
  if (!id) throw new Error("id is required");
  let result: DirectoryPayload;
  try {
    const res = await queryClient.documents.listDocuments({
      account: id.uid,
    });
    const directory = toPlainMessage(res)
      .documents.filter((doc) => doc.path !== "/")
      .map((doc) => {
        return {
          path: doc.path,
          updateTime: doc.updateTime,
          metadata: doc.metadata,
          id: hmId("d", id.uid, {path: doc.path.split("/").slice(1)}),
          authors: doc.authors,
        };
      });
    const allAuthors = new Set<string>();
    directory.forEach((doc) => {
      doc.authors.forEach((author) => allAuthors.add(author));
    });
    const authorsMetadata = await Promise.all(
      Array.from(allAuthors).map(async (authorUid) => {
        const res = await queryClient.documents.getDocument({
          account: authorUid,
        });
        const authorAccount = toPlainMessage(res);
        return {uid: authorUid, metadata: authorAccount.metadata};
      })
    );
    result = {directory, authorsMetadata};
  } catch (e: any) {
    result = {error: e.message};
  }
  return wrapJSON(result);
};
