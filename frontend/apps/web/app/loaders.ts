import {toPlainMessage} from "@bufbuild/protobuf";
import {
  HMDocument,
  hmId,
  hmIdPathToEntityQueryPath,
  HMMetadata,
  UnpackedHypermediaId,
} from "@shm/shared";
import {queryClient} from "./client";
import {getConfig} from "./config";
import {wrapJSON, WrappedResponse} from "./wrapping";

export type MetadataPayload = {
  id: UnpackedHypermediaId;
  metadata: HMMetadata;
};

async function getMetadata(id: UnpackedHypermediaId): Promise<MetadataPayload> {
  const rawDoc = await queryClient.documents.getDocument({
    account: id.uid,
    path: hmIdPathToEntityQueryPath(id.path),
    version: id.version || undefined,
  });
  const document = toPlainMessage(rawDoc);
  return {id, metadata: document.metadata};
}

export type WebDocumentPayload = {
  document: HMDocument;
  authors: {id: UnpackedHypermediaId; metadata: HMMetadata}[];
  id: UnpackedHypermediaId;
};

export async function getDocument(
  id: UnpackedHypermediaId
): Promise<WebDocumentPayload> {
  const rawDoc = await queryClient.documents.getDocument({
    account: id.uid,
    path: hmIdPathToEntityQueryPath(id.path),
    version: id.version || undefined,
  });
  const document = toPlainMessage(rawDoc);
  const authors = await Promise.all(
    document.authors.map(async (authorUid) => {
      return await getMetadata(hmId("d", authorUid));
    })
  );
  return {
    document,
    authors,
    id,
  };
}

export async function loadDocument(id: UnpackedHypermediaId) {
  return wrapJSON(await getDocument(id));
}

export type SiteDocumentPayload = WebDocumentPayload & {
  homeMetadata: HMMetadata;
  homeId: UnpackedHypermediaId;
};

export async function loadSiteDocument(
  id: UnpackedHypermediaId
): Promise<WrappedResponse<SiteDocumentPayload>> {
  const config = getConfig();
  let homeMetadata = null;
  let homeId = null;
  if (config.registeredAccountUid) {
    try {
      const {id, metadata} = await getMetadata(
        hmId("d", config.registeredAccountUid)
      );
      homeMetadata = metadata;
      homeId = id;
    } catch (e) {}
  }
  const docContent = await getDocument(id);
  const loadedSiteDocument = {
    ...docContent,
    homeMetadata,
    homeId,
  };
  return wrapJSON(loadedSiteDocument);
}
