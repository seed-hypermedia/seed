export {createCapability, resolveCapability} from './capability'
export type {CapabilityRole, CreateCapabilityInput} from './capability'
export {
  createChange,
  createChangeOps,
  createDocumentChange,
  createDocumentChangeFromOps,
  createGenesisChange,
  signDocumentChange,
  signPreparedChange,
} from './change'
export type {
  CreateChangeOpsInput,
  CreateDocumentChangeFromOpsInput,
  CreateDocumentChangeInput,
  DocumentOperation,
  SignDocumentChangeInput,
} from './change'
export {createSeedClient} from './client'
export type {PublishDocumentInput, SeedClient, SeedClientOptions} from './client'
export {commentRecordIdFromBlob, createComment, deleteComment, updateComment} from './comment'
export type {CommentAttachmentBlob, CreateCommentInput, DeleteCommentInput, UpdateCommentInput} from './comment'
export {contactRecordIdFromBlob, createContact, deleteContact, updateContact} from './contact'
export type {CreateContactInput, CreateContactResult, DeleteContactInput, UpdateContactInput} from './contact'
export {SeedClientError, SeedNetworkError, SeedValidationError} from './errors'
export {createRedirectRef, createTombstoneRef, createVersionRef} from './ref'
export type {CreateRedirectRefInput, CreateTombstoneRefInput, CreateVersionRefInput} from './ref'
export {teiToBlocks} from './tei-to-blocks'
export type {TeiToBlocksOptions, TeiToBlocksResult, TeiFigure, FigureCoords} from './tei-to-blocks'
export {pdfToBlocks} from './pdf-to-blocks'
export type {PdfToBlocksOptions, PdfToBlocksResult} from './pdf-to-blocks'
export {isGrobidAvailable, processFulltextDocument, DEFAULT_GROBID_URL} from './grobid'
export type {GrobidOptions} from './grobid'
export {embeddedPdfToBlocks} from './pdf-to-blocks-embedded'
export type {EmbeddedPdfResult} from './pdf-to-blocks-embedded'

export {trimTrailingEmptyBlocks} from './comment'
export {
  codePointLength,
  entityQueryPathToHmIdPath,
  getHMQueryString,
  hmIdPathToEntityQueryPath,
  HYPERMEDIA_SCHEME,
  isSurrogate,
  packBaseId,
  packHmId,
  parseCustomURL,
  parseFragment,
  resolveHypermediaUrl,
  resolveId,
  serializeBlockRange,
  unpackHmId,
} from './hm-types'
export type {HMRequest, HMSigner, UnpackedHypermediaId} from './hm-types'

export {fileToIpfsBlobs, filesToIpfsBlobs, resolveFileLinksInBlocks, hasFileLinks} from './file-to-ipfs'
export type {CollectedBlob} from './file-to-ipfs'

export {
  parseMarkdown,
  flattenToOperations,
  parseInlineFormatting,
  parseFrontmatter,
  markdownBlockNodesToHMBlockNodes,
} from './markdown-to-blocks'
export type {BlockNode, SeedBlock, Annotation} from './markdown-to-blocks'
export {blocksToMarkdown, emitFrontmatter, slugify, draftFilename, parseDraftFilename} from './blocks-to-markdown'
export type {BlocksToMarkdownOptions} from './blocks-to-markdown'

export {createBlocksMap, matchBlockIds, computeReplaceOps, hmBlockNodeToBlockNode} from './block-diff'
export type {APIBlockNode, APIBlock} from './block-diff'

export {
  autoLinkChildToParent,
  createAutoLinkOps,
  documentContainsLinkToChild,
  documentHasSelfQuery,
  shouldAutoLinkParent,
} from './auto-link'
export type {AutoLinkChildToParentOptions} from './auto-link'
export {resolveDocumentState} from './document-state'
export type {DocumentState} from './document-state'

export {editorBlockToHMBlock, editorBlocksToHMBlockNodes} from './editorblock-to-hmblock'
export {hmBlocksToEditorContent, hmBlockToEditorBlock, annotationContains} from './hmblock-to-editorblock'
export {AnnotationSet, addSpanToAnnotation, pushSpanToAnnotation} from './unicode'
export type {MutableAnnotation, SpanAnnotation} from './unicode'
export type {
  EditorBlock,
  EditorBaseBlock,
  EditorBlockProps,
  EditorBlockType,
  EditorParagraphBlock,
  EditorHeadingBlock,
  EditorCodeBlock,
  EditorImageBlock,
  EditorVideoBlock,
  EditorFileBlock,
  EditorButtonBlock,
  EditorEmbedBlock,
  EditorWebEmbedBlock,
  EditorMathBlock,
  EditorNostrBlock,
  EditorQueryBlock,
  EditorUnknownBlock,
  EditorText,
  EditorLink,
  EditorInlineEmbed,
  EditorInlineStyles,
  EditorAnnotationType,
  HMInlineContent,
  MediaBlockProps,
  DraftMediaRef,
  SearchResult,
} from './editor-types'
