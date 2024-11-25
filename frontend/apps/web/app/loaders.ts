import {toPlainMessage} from "@bufbuild/protobuf";
import {
  extractRefs,
  getParentPaths,
  HMDocument,
  HMDocumentListItem,
  HMDocumentSchema,
  hmId,
  hmIdPathToEntityQueryPath,
  HMMetadata,
  HMMetadataPayload,
  HMQueryResult,
  SITE_BASE_URL,
  UnpackedHypermediaId,
} from "@shm/shared";
import {queryClient} from "./client";
import {getConfig} from "./config";
import {wrapJSON, WrappedResponse} from "./wrapping";

export async function getMetadata(
  id: UnpackedHypermediaId
): Promise<HMMetadataPayload> {
  try {
    const rawDoc = await queryClient.documents.getDocument({
      account: id.uid,
      path: hmIdPathToEntityQueryPath(id.path),
      version: id.version || undefined,
    });
    const document = toPlainMessage(rawDoc);
    return {id, metadata: document.metadata};
  } catch (e) {
    return {id, metadata: {}};
  }
}

export type WebBaseDocumentPayload = {
  document: HMDocument;
  authors: {id: UnpackedHypermediaId; metadata: HMMetadata}[];
  id: UnpackedHypermediaId;
  siteHost: string | undefined;
  supportDocuments?: {id: UnpackedHypermediaId; document: HMDocument}[];
  supportQueries?: HMQueryResult[];
};

export type WebDocumentPayload = WebBaseDocumentPayload & {
  breadcrumbs: {id: UnpackedHypermediaId; metadata: HMMetadata}[];
};

async function getHMDocument(entityId: UnpackedHypermediaId) {
  const {version, uid, latest} = entityId;
  const path = hmIdPathToEntityQueryPath(entityId.path);
  const apiDoc = await queryClient.documents.getDocument({
    account: uid,
    path,
    version: !latest && version ? version : "",
  });

  console.log(`==================== ~ getHMDocument ~ apiDoc:`, apiDoc);
  const document = HMDocumentSchema.parse(toPlainMessage(apiDoc));
  return document;
}

async function getDirectory(id: UnpackedHypermediaId) {
  const res = await queryClient.documents.listDocuments({
    account: id.uid,
  });
  const docs = res.documents
    .map(toPlainMessage)
    .filter((doc) => doc.path !== "")
    .map((doc) => {
      return {...doc, path: doc.path.slice(1).split("/")};
    });
  return docs as HMDocumentListItem[];
}

export async function getBaseDocument(
  entityId: UnpackedHypermediaId,
  waitForSync?: boolean
): Promise<WebBaseDocumentPayload> {
  const {uid} = entityId;
  const path = hmIdPathToEntityQueryPath(entityId.path);
  const discoverPromise = queryClient.entities
    .discoverEntity({
      account: uid,
      path,
      // version ommitted intentionally here. we want to discover the latest version
    })
    .then(() => {
      console.log("discovered entity " + entityId.id);
    })
    .catch((e) => {
      console.error("error discovering entity", entityId.id, e);
    });
  if (waitForSync) {
    await discoverPromise;
  } else {
    discoverPromise.catch((e) => {
      console.error("discovery error " + entityId.id, e);
    });
  }
  const document = await getHMDocument(entityId);
  let authors = await Promise.all(
    document.authors.map(async (authorUid) => {
      return await getMetadata(hmId("d", authorUid));
    })
  );

  let supportDocuments: {id: UnpackedHypermediaId; document: HMDocument}[] = (
    await Promise.all(
      extractRefs(document.content).map(async (ref) => {
        const doc = await getHMDocument(ref.refId);
        if (!doc) return null;
        return {document: doc, id: ref.refId};
      })
    )
  ).filter((doc) => !!doc);
  let supportQueries: {
    in: UnpackedHypermediaId;
    results: HMDocumentListItem[];
  }[] = [];

  const results = await getDirectory(entityId);
  supportQueries = [{in: entityId, results}];
  if (document.metadata.layout === "Seed/Experimental/Newspaper") {
    supportDocuments = await Promise.all(
      results.map(async (item) => {
        const id = hmId("d", entityId.uid, {path: item.path});
        return {
          id,
          document: await getHMDocument(id),
        };
      })
    );
    const itemsAuthors = (
      results.flatMap((entity) => entity.authors || []) || []
    ).map((authorId) => {
      return hmId("d", authorId);
    });
    authors = [
      ...authors,
      ...(await Promise.all(
        itemsAuthors.map((authorId) => getMetadata(authorId))
      )),
    ];
  }

  return {
    document,
    supportDocuments,
    supportQueries,
    authors,
    siteHost: SITE_BASE_URL,
    id: {...entityId, version: document.version},
  };
}

export async function getDocument(
  entityId: UnpackedHypermediaId,
  waitForSync?: boolean
): Promise<WebDocumentPayload> {
  const document = await getBaseDocument(entityId, waitForSync);
  const crumbs = getParentPaths(entityId.path).slice(0, -1);
  const breadcrumbs = await Promise.all(
    crumbs.map(async (crumbPath) => {
      const document = await queryClient.documents.getDocument({
        account: entityId.uid,
        path: hmIdPathToEntityQueryPath(crumbPath),
      });
      return {
        id: hmId(entityId.type, entityId.uid, {path: crumbPath}),
        metadata: toPlainMessage(document).metadata,
      };
    })
  );

  return {
    ...document,
    breadcrumbs,
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
  id: UnpackedHypermediaId,
  waitForSync?: boolean
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
    const docContent = await getDocument(id, waitForSync);
    let supportQueries = docContent.supportQueries;
    if (
      homeId &&
      homeMetadata?.layout === "Seed/Experimental/Newspaper" &&
      !docContent.supportQueries?.find((q) => q.in.uid === homeId.uid)
    ) {
      const results = await getDirectory(homeId);
      supportQueries = [...(supportQueries || []), {in: homeId, results}];
    }
    const loadedSiteDocument = {
      ...docContent,
      homeMetadata,
      supportQueries,
      homeId,
    };
    return wrapJSON(loadedSiteDocument);
  } catch (e) {
    // probably document not found. todo, handle other errors
  }
  return wrapJSON({homeMetadata, homeId});
}
