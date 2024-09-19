import {toPlainMessage, type PlainMessage} from "@bufbuild/protobuf";
import {Document} from "@shm/shared";
import {queryClient} from "./client";

export async function getDocument(slug?: string): Promise<
  Omit<PlainMessage<Document>, "authors"> & {
    authors: Array<PlainMessage<Document>>;
  }
> {
  const path = slug?.split("/");
  const [accountUid, ...restPath] = path || [];
  const validPathTerms = restPath.filter((term) => !!term);
  const rawDoc = await queryClient.documents.getDocument({
    account: accountUid,
    path: validPathTerms.length ? `/${validPathTerms.join("/")}` : "",
    // version
  });
  const authors = await Promise.all(
    rawDoc.authors.map(async (authorUid) => {
      return await queryClient.documents.getDocument({
        account: authorUid,
        path: "",
        // version
      });
    })
  );
  let res = {...toPlainMessage(rawDoc), authors: authors.map(toPlainMessage)};

  return res;
}
