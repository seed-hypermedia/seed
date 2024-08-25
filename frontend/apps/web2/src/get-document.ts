import {toPlainMessage} from "@bufbuild/protobuf";
import {queryClient} from "./client";

export async function getDocument(slug?: string) {
  const path = slug?.split("/");
  const [accountUid, ...restPath] = path || [];
  const validPathTerms = restPath.filter((term) => !!term);
  const rawDoc = await queryClient.documents.getDocument({
    account: accountUid,
    path: validPathTerms.length ? `/${validPathTerms.join("/")}` : "",
    // version
  });

  return toPlainMessage(rawDoc);
}
