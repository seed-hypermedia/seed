import {toPlainMessage} from "@bufbuild/protobuf";
import {hmId} from "@shm/shared";
import {serialize} from "superjson";
import {queryClient} from "./client";

export async function loadHMDocument(accountUid: string, path: string[]) {
  const validPathTerms = path.filter((term) => !!term);
  const rawDoc = await queryClient.documents.getDocument({
    account: accountUid,
    path: validPathTerms.length ? `/${validPathTerms.join("/")}` : "",
    // version
  });
  const document = toPlainMessage(rawDoc);
  return {
    document: serialize(document),
    id: hmId("d", accountUid, {
      path: path,
      // version: v,
    }),
  };
}
