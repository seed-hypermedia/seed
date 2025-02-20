import {
  EditorText,
  extractQueryBlocks,
  extractRefs,
  getParentPaths,
  HMAccountsMetadata,
  HMBlock,
  HMBlockChildrenType,
  HMBlockNode,
  hmBlockToEditorBlock,
  HMDocument,
  HMDocumentMetadataSchema,
  HMDocumentSchema,
  hmId,
  hmIdPathToEntityQueryPath,
  HMInlineContent,
  HMLoadedBlock,
  HMLoadedBlockNode,
  HMLoadedDocument,
  HMLoadedInlineEmbedNode,
  HMLoadedLinkNode,
  HMLoadedText,
  HMLoadedTextContentNode,
  HMMetadata,
  HMMetadataPayload,
  HMQueryResult,
  UnpackedHypermediaId,
  unpackHmId,
} from "@shm/shared";
import {
  getDiretoryWithClient,
  getQueryResultsWithClient,
} from "@shm/shared/models/directory";
import {getBlockNodeById} from "@shm/ui/src";
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

export async function getHMDocument(entityId: UnpackedHypermediaId) {
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
  hostname: string
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
  const homeDocument = await getHMDocument(homeId);
  supportDocuments.push({
    id: homeId,
    document: homeDocument,
  });
  const homeDirectoryResults = await getDirectory(homeId, "Children");
  const homeDirectoryQuery = {in: homeId, results: homeDirectoryResults};
  const directoryResults = await getDirectory(entityId);
  const queryBlockQueries = (
    await Promise.all(
      queryBlocks.map(async (block) => {
        return await getQueryResults(block.attributes.query);
      })
    )
  ).filter((result) => !!result);
  supportQueries = [
    homeDirectoryQuery,
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
    siteHost: hostname,
    id: {...entityId, version: document.version},
    enableWebSigning: process.env.WEB_SIGNING_ENABLED === "true",
  };
}

export async function getDocument(
  entityId: UnpackedHypermediaId,
  hostname: string
): Promise<WebDocumentPayload> {
  logDebug("getDocument", entityId.id);
  const document = await getBaseDocument(entityId, hostname);
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

function textNodeAttributes(
  node: EditorText
): Partial<HMLoadedTextContentNode> {
  const attributes: Partial<HMLoadedTextContentNode> = {};
  if (node.styles.bold) attributes.bold = true;
  if (node.styles.italic) attributes.italic = true;
  if (node.styles.underline) attributes.underline = true;
  if (node.styles.strike) attributes.strike = true;
  if (node.styles.code) attributes.code = true;
  return attributes;
}

async function loadEditorNodes(
  nodes: HMInlineContent[]
): Promise<HMLoadedText> {
  const content = await Promise.all(
    nodes.map(async (editorNode) => {
      if (editorNode.type === "inline-embed") {
        const id = unpackHmId(editorNode.link);
        if (!id)
          return {
            type: "InlineEmbed",
            ref: editorNode.link,
            text: null,
            id: null,
          } satisfies HMLoadedInlineEmbedNode;
        try {
          const document = await getHMDocument(id);
          return {
            type: "InlineEmbed",
            ref: editorNode.link,
            id,
            text: document.metadata.name || "(?)",
          } satisfies HMLoadedInlineEmbedNode;
        } catch (e) {
          console.error("Error loading inline embed", editorNode, e);
          return {
            type: "InlineEmbed",
            ref: editorNode.link,
            text: null,
            id,
          } satisfies HMLoadedInlineEmbedNode;
        }
      }
      if (editorNode.type === "text") {
        return {
          type: "Text",
          text: editorNode.text,
          ...textNodeAttributes(editorNode),
        } satisfies HMLoadedTextContentNode;
      }
      if (editorNode.type === "link") {
        return {
          type: "Link",
          link: editorNode.href,
          content: editorNode.content
            .map((node) => {
              if (node.type === "inline-embed") return null;
              if (node.type === "link") return null;
              return {
                type: "Text",
                text: node.text,
                ...textNodeAttributes(node),
              } satisfies HMLoadedTextContentNode;
            })
            .filter((node) => !!node),
        } satisfies HMLoadedLinkNode;
      }
      console.log("Unhandled editor node", editorNode);
      return null;
    })
  );
  return content.filter((node) => !!node);
}

async function loadDocumentBlock(block: HMBlock): Promise<HMLoadedBlock> {
  if (block.type === "Paragraph") {
    const editorBlock = hmBlockToEditorBlock(block);
    if (editorBlock.type !== "paragraph")
      throw new Error("Unexpected situation with paragraph block conversion");
    const content = await loadEditorNodes(editorBlock.content);
    return {
      type: "Paragraph",
      id: block.id,
      content,
    };
  }
  if (block.type === "Heading") {
    const editorBlock = hmBlockToEditorBlock(block);
    if (editorBlock.type !== "heading")
      throw new Error("Unexpected situation with heading block conversion");
    const content = await loadEditorNodes(editorBlock.content);
    return {
      type: "Heading",
      id: block.id,
      content,
    };
  }
  if (block.type === "Embed") {
    const id = unpackHmId(block.link);
    if (!id) {
      return {
        type: "Embed",
        id: block.id,
        link: block.link,
        metadata: null,
        content: null,
      };
    }
    try {
      const document = await getHMDocument(id);
      const selectedBlock = id.blockRef
        ? getBlockNodeById(document.content, id.blockRef)
        : null;
      const selectedContent = selectedBlock
        ? [selectedBlock]
        : document.content;
      if (!selectedContent) {
        return {
          type: "Embed",
          id: block.id,
          link: block.link,
          metadata: document.metadata,
          content: null,
        };
      }
      return {
        type: "Embed",
        id: block.id,
        link: block.link,
        metadata: document.metadata,
        content: await loadDocumentContent(selectedContent),
      };
    } catch (e) {
      console.error("Error loading embed", block, e);
      return {
        type: "Embed",
        id: block.id,
        link: block.link,
        metadata: null,
        content: null,
      };
    }
  }
  if (block.type === "Video") {
    return {
      type: "Video",
      id: block.id,
      link: block.link,
      name: block.attributes.name,
      width: block.attributes.width,
    };
  }
  if (block.type === "File") {
    return {
      type: "File",
      id: block.id,
      link: block.link,
      name: block.attributes.name,
      size: block.attributes.size,
    };
  }
  if (block.type === "Image") {
    return {
      type: "Image",
      id: block.id,
      link: block.link,
      name: block.attributes.name,
      width: block.attributes.width,
    };
  }
  if (block.type === "Query") {
    const q = await getQueryResults(block.attributes.query);
    return {
      type: "Query",
      id: block.id,
      query: block.attributes.query,
      results: q?.results
        ? await Promise.all(
            q.results.map(async (result) => ({
              ...result,
              authors: await loadAuthors(result.authors),
            }))
          )
        : null,
    };
  }
  return {
    type: "Unsupported",
    id: block.id,
  };
}

function getChildrenType(block: HMBlock): HMBlockChildrenType | undefined {
  if (block.type === "Paragraph") return block.attributes.childrenType;
  if (block.type === "Heading") return block.attributes.childrenType;
  if (block.type === "Embed") return block.attributes.childrenType;
  if (block.type === "Video") return block.attributes.childrenType;
  if (block.type === "File") return block.attributes.childrenType;
  if (block.type === "Image") return block.attributes.childrenType;
  if (block.type === "Query") return block.attributes.childrenType;
  if (block.type === "Math") return block.attributes.childrenType;
  if (block.type === "Code") return block.attributes.childrenType;
  if (block.type === "Button") return block.attributes.childrenType;
  return undefined;
}

async function loadDocumentBlockNode(
  blockNode: HMBlockNode
): Promise<HMLoadedBlockNode> {
  const childrenType = getChildrenType(blockNode.block);
  const outputBlockNode: HMLoadedBlockNode = {
    block: await loadDocumentBlock(blockNode.block),
    children: await loadDocumentContent(blockNode.children),
  };
  if (childrenType) {
    outputBlockNode.childrenType = childrenType;
  }
  return outputBlockNode;
}

async function loadDocumentContent(
  blockNodes: undefined | HMBlockNode[]
): Promise<HMLoadedBlockNode[]> {
  if (!blockNodes) return [];
  return await Promise.all(blockNodes.map(loadDocumentBlockNode));
}

export async function loadAuthors(
  authors: string[]
): Promise<HMAccountsMetadata> {
  return Object.fromEntries(
    await Promise.all(
      authors.map(async (author) => {
        const metadata = await getMetadata(hmId("d", author));
        return [author, metadata];
      })
    )
  );
}

export async function loadDocument(
  entityId: UnpackedHypermediaId
): Promise<HMLoadedDocument> {
  const doc = await getHMDocument(entityId);
  return {
    id: entityId,
    version: doc.version,
    content: await loadDocumentContent(doc.content),
    metadata: doc.metadata,
    authors: await loadAuthors(doc.authors),
  };
}

export type SiteDocumentPayload = WebDocumentPayload & {
  homeMetadata: HMMetadata;
  originHomeId: UnpackedHypermediaId;
};

export async function loadSiteDocument<T>(
  hostname: string,
  id: UnpackedHypermediaId,
  extraData?: T
): Promise<WrappedResponse<SiteDocumentPayload & T>> {
  logDebug("loadSiteDocument", id.id);
  const config = await getConfig(hostname);
  if (!config) {
    throw new Error("No config found for hostname " + hostname);
  }
  let homeMetadata = null;
  let originHomeId = null;
  if (config.registeredAccountUid) {
    try {
      const {id, metadata} = await getMetadata(
        hmId("d", config.registeredAccountUid)
      );
      homeMetadata = metadata;
      originHomeId = id;
    } catch (e) {}
  }
  try {
    const docContent = await getDocument(id, hostname);
    let supportQueries = docContent.supportQueries;
    if (
      originHomeId &&
      homeMetadata?.layout === "Seed/Experimental/Newspaper" &&
      !docContent.supportQueries?.find((q) => q.in.uid === originHomeId.uid)
    ) {
      const results = await getDirectory(originHomeId);
      supportQueries = [...(supportQueries || []), {in: originHomeId, results}];
    }
    const loadedSiteDocument = {
      ...(extraData || {}),
      ...docContent,
      homeMetadata,
      supportQueries,
      originHomeId,
    };
    const headers: Record<string, string> = {};
    headers["x-hypermedia-id"] = id.id;
    headers["x-hypermedia-version"] = docContent.document.version;
    return wrapJSON(loadedSiteDocument, {
      headers,
    });
  } catch (e) {
    console.error("Error Loading Site Document", e);
    // probably document not found. todo, handle other errors
  }
  return wrapJSON(
    {homeMetadata, originHomeId, ...(extraData || {})},
    {status: id ? 200 : 404}
  );
}
