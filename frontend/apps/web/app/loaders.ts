import {toPlainMessage} from "@bufbuild/protobuf";
import {hmId} from "@shm/shared";
import {serialize} from "superjson";
import {queryClient} from "./client";
import {getConfig} from "./config";

export type hmDocumentLoader = typeof loadHMDocument;

export type hmDocumentPayload = Awaited<ReturnType<typeof loadHMDocument>>;

async function getMetadata(uid: string, path?: string[]) {
  const rawDoc = await queryClient.documents.getDocument({
    account: uid,
  });
  const document = toPlainMessage(rawDoc);
  return {id: hmId("d", uid, {path}), metadata: document.metadata};
}

export async function loadHMDocument(accountUid: string, path: string[]) {
  const config = getConfig();
  const validPathTerms = path.filter((term) => !!term);
  const rawDoc = await queryClient.documents.getDocument({
    account: accountUid,
    path: validPathTerms.length ? `/${validPathTerms.join("/")}` : "",
    // version
  });
  const document = toPlainMessage(rawDoc);
  let homeMetadata = null;
  let homeId = null;
  if (config.registeredAccountUid) {
    try {
      const {id, metadata} = await getMetadata(config.registeredAccountUid);
      homeMetadata = metadata;
      homeId = id;
    } catch (e) {}
  }
  const authors = await Promise.all(
    document.authors.map(async (authorUid) => {
      return getMetadata(authorUid);
    })
  );
  return {
    document: serialize(document),
    authors,
    id: hmId("d", accountUid, {
      path: path,
      // version: v,
    }),
    homeMetadata,
    homeId,
  };
}
