import {
  extractQueryBlocks,
  extractRefs,
  getParentPaths,
  HMDocument,
  HMDocumentMetadataSchema,
  HMDocumentSchema,
  hmId,
  hmIdPathToEntityQueryPath,
  HMMetadata,
  HMMetadataPayload,
  HMQueryResult,
  SITE_BASE_URL,
  UnpackedHypermediaId,
} from "@shm/shared";
import {
  getDiretoryWithClient,
  getQueryResultsWithClient,
} from "@shm/shared/models/directory";
import {AccountsMetadata} from "@shm/ui/src/face-pile";
import {queryClient} from "./client";
import {logDebug} from "./logger";
import {getConfig} from "./site-config";
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
    return {
      id,
      metadata: HMDocumentMetadataSchema.parse(
        rawDoc.metadata?.toJson({emitDefaultValues: true})
      ),
    };
  } catch (e) {
    return {id, metadata: {}};
  }
}

export type WebBaseDocumentPayload = {
  document: HMDocument;
  accountsMetadata: AccountsMetadata;
  id: UnpackedHypermediaId;
  siteHost: string | undefined;
  supportDocuments?: {id: UnpackedHypermediaId; document: HMDocument}[];
  supportQueries?: HMQueryResult[];
  enableWebSigning?: boolean;
};

export type WebDocumentPayload = WebBaseDocumentPayload & {
  breadcrumbs: Array<{id: UnpackedHypermediaId; metadata: HMMetadata}>;
};

async function getHMDocument(entityId: UnpackedHypermediaId) {
  const {version, uid, latest} = entityId;
  const path = hmIdPathToEntityQueryPath(entityId.path);
  const apiDoc = await queryClient.documents.getDocument({
    account: uid,
    path,
    version: !latest && version ? version : "",
  });

  const document = HMDocumentSchema.parse(apiDoc.toJson());
  return document;
}

const getDirectory = getDiretoryWithClient(queryClient);
const getQueryResults = getQueryResultsWithClient(queryClient);

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
      recursive: true,
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
  const refs = extractRefs(document.content);
  let supportDocuments: {id: UnpackedHypermediaId; document: HMDocument}[] = (
    await Promise.all(
      refs.map(async (ref) => {
        try {
          const doc = await getHMDocument(ref.refId);
          if (!doc) return null;
          return {document: doc, id: ref.refId};
        } catch (e) {
          console.error("error fetching supportDocument", ref, e);
        }
      })
    )
  ).filter((doc) => !!doc);
  let supportQueries: HMQueryResult[] = [];

  const queryBlocks = extractQueryBlocks(document.content);
  const homeId = hmId("d", uid);
  const homeDirectoryResults = await getDirectory(homeId);
  const directoryResults = await getDirectory(entityId);
  const queryBlockQueries = (
    await Promise.all(
      queryBlocks.map(async (block) => {
        return await getQueryResults(block.attributes.query);
      })
    )
  ).filter((result) => !!result);
  supportQueries = [
    // home directory
    {in: homeId, results: homeDirectoryResults},
    {in: entityId, results: directoryResults},
    ...queryBlockQueries,
  ];
  const alreadySupportDocIds = new Set<string>();
  supportDocuments.forEach((doc) => {
    if (doc.id.latest || doc.id.version == null) {
      alreadySupportDocIds.add(doc.id.id);
    }
  });
  const supportAuthorsUidsToFetch = new Set<string>();
  if (document.metadata.layout === "Seed/Experimental/Newspaper") {
    supportDocuments = await Promise.all(
      directoryResults.map(async (item) => {
        const id = hmId("d", entityId.uid, {path: item.path});
        return {
          id,
          document: await getHMDocument(id),
        };
      })
    );
    const itemsAuthors = (
      directoryResults.flatMap((entity) => entity.authors || []) || []
    ).map((authorId) => {
      return hmId("d", authorId);
    });
    authors = [
      ...authors,
      ...(await Promise.all(
        itemsAuthors.map((authorId) => getMetadata(authorId))
      )),
    ];
  } else {
    supportDocuments.push(
      ...(await Promise.all(
        queryBlockQueries
          .flatMap((item) => item.results)
          .map(async (item) => {
            const id = hmId("d", item.account, {path: item.path});
            const document = await getHMDocument(id);
            document.authors.forEach((author) => {
              if (!alreadySupportDocIds.has(hmId("d", author).id)) {
                supportAuthorsUidsToFetch.add(author);
              }
            });
            return {
              id,
              document,
            };
          })
      ))
    );
  }

  // now we need to get the author content for queried docs
  supportDocuments.push(
    ...(await Promise.all(
      Array.from(supportAuthorsUidsToFetch).map(async (uid) => {
        const document = await getHMDocument(hmId("d", uid));
        return {
          id: hmId("d", uid),
          document,
        };
      })
    ))
  );

  return {
    document,
    supportDocuments,
    supportQueries,
    accountsMetadata: Object.fromEntries(
      authors.map((author) => [author.id.uid, author])
    ),
    siteHost: SITE_BASE_URL,
    id: {...entityId, version: document.version},
    enableWebSigning: process.env.WEB_SIGNING_ENABLED === "true",
  };
}

export async function getDocument(
  entityId: UnpackedHypermediaId,
  waitForSync?: boolean
): Promise<WebDocumentPayload> {
  logDebug("getDocument", entityId.id);
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
        metadata: HMDocumentMetadataSchema.parse(
          document.metadata?.toJson({emitDefaultValues: true})
        ),
      };
    })
  );
  return {
    ...document,
    breadcrumbs,
  };
}

export type SiteDocumentPayload = WebDocumentPayload & {
  homeMetadata: HMMetadata;
  homeId: UnpackedHypermediaId;
};

export async function loadSiteDocument<T>(
  hostname: string,
  id: UnpackedHypermediaId,
  waitForSync?: boolean,
  extraData?: T
): Promise<WrappedResponse<SiteDocumentPayload & T>> {
  logDebug("loadSiteDocument", id.id);
  const config = await getConfig(hostname);
  if (!config) {
    throw new Error("No config found for hostname " + hostname);
  }
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
      ...(extraData || {}),
      ...docContent,
      homeMetadata,
      supportQueries,
      homeId,
    };
    return wrapJSON(loadedSiteDocument);
  } catch (e) {
    console.error("Error Loading Site Document", e);
    // probably document not found. todo, handle other errors
  }
  return wrapJSON(
    {homeMetadata, homeId, ...(extraData || {})},
    {status: id ? 200 : 404}
  );
}
