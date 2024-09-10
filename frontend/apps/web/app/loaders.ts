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

export async function getMetadata(
  id: UnpackedHypermediaId
): Promise<MetadataPayload> {
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
  entityId: UnpackedHypermediaId
): Promise<WebDocumentPayload> {
  const {id, version, uid} = entityId;
  const path = hmIdPathToEntityQueryPath(entityId.path);
  console.log("Will discover entity " + entityId.id);
  queryClient.entities
    .discoverEntity({id: entityId.id})
    .then(() => {
      console.log("discovered entity " + entityId.id);
    })
    .catch((e) => {
      console.error("discovery error " + entityId.id, e);
    });
  console.log("= getDocument", {uid, path, version});
  const rawDoc = await queryClient.documents.getDocument({
    account: uid,
    path,
    version: version || undefined,
  });
  const document = toPlainMessage(rawDoc);
  console.log("loaded doc with version: ", document.version);
  const authors = await Promise.all(
    document.authors.map(async (authorUid) => {
      return await getMetadata(hmId("d", authorUid));
    })
  );
  return {
    document,
    authors,
    id: entityId,
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
  try {
    const docContent = await getDocument(id);
    const loadedSiteDocument = {
      ...docContent,
      homeMetadata,
      homeId,
    };
    return wrapJSON(loadedSiteDocument);
  } catch (e) {
    // probably document not found. todo, handle other errors
  }
  return wrapJSON({homeMetadata, homeId});
}
