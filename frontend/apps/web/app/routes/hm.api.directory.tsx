import {PlainMessage, toPlainMessage} from "@bufbuild/protobuf";
import {json, TypedResponse} from "@remix-run/node";
import {ListDocumentsResponse, unpackHmId} from "@shm/shared";
import {queryClient} from "~/client";
import {wrap, Wrapped} from "~/wrapping";

export type HMDirectory = PlainMessage<ListDocumentsResponse>;

export const loader = async ({
  request,
}: {
  request: Request;
}): Promise<TypedResponse<Wrapped<HMDirectory>>> => {
  const url = new URL(request.url);
  const id = unpackHmId(url.searchParams.get("id") || undefined);
  if (!id) throw new Error("id is required");
  const res = await queryClient.documents.listDocuments({
    account: id.uid,
  });
  const directory = toPlainMessage(res);
  return json(wrap(directory));
};
