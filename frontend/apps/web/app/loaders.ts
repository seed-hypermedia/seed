import {toPlainMessage} from "@bufbuild/protobuf";
import {hmId} from "@shm/shared";
import {serialize} from "superjson";
import {queryClient} from "./client";
import {getConfig} from "./config";

export type hmDocumentLoader = typeof loadHMDocument;

export type hmDocumentPayload = Awaited<ReturnType<typeof loadHMDocument>>;

export async function loadHMDocument(accountUid: string, path: string[]) {
  const config = getConfig();
  const validPathTerms = path.filter((term) => !!term);
  const rawDoc = await queryClient.documents.getDocument({
    account: accountUid,
    path: validPathTerms.length ? `/${validPathTerms.join("/")}` : "",
    // version
  });
  const document = toPlainMessage(rawDoc);
  let homeDocumentMetadata = null;
  try {
    const rawHomeDoc = await queryClient.documents.getDocument({
      account: config.registeredAccountUid,
      path: "",
      // version
    });
    const homeDocument = toPlainMessage(rawHomeDoc);
    homeDocumentMetadata = homeDocument.metadata;
  } catch (e) {}
  return {
    document: serialize(document),
    id: hmId("d", accountUid, {
      path: path,
      // version: v,
    }),
    homeDocumentMetadata,
  };
}
