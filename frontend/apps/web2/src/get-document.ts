import {toPlainMessage} from "@bufbuild/protobuf";
import {queryClient} from "./client";

export async function getDocument(slug?: string) {
  console.log("slug", slug);
  const path = slug?.split("/");
  const [accountUid, ...restPath] = path || [];
  const validPathTerms = restPath.filter((term) => !!term);

  console.log(`== ~ getDocument ~ validPathTerms:`, validPathTerms);
  const rawDoc = await queryClient.documents.getDocument({
    account: accountUid,
    path: validPathTerms.length ? `/${validPathTerms.join("/")}` : "/about",
    // version
  });

  return toPlainMessage(rawDoc);
}
