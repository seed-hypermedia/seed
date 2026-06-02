import type {DomainResolverFn} from '@seed-hypermedia/client'
import type {BlockRange, HMBlockNode, HMRawMention, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {UniversalClient} from './universal-client'
import type {StateStream} from './utils/stream'

/** Options for block range selection with optional clipboard copy. */
export type BlockRangeSelectOptions = BlockRange & {
  copyToClipboard?: boolean
}

/** A normalized ranged citation target rendered as a document text decoration. */
export type CitationFragmentHighlight = {
  id: string
  targetBlockId: string
  targetRange: {
    start: number
    end: number
  }
  sourceType: 'document' | 'comment' | 'unknown'
  sourceId: UnpackedHypermediaId | null
  sourceDocumentId: UnpackedHypermediaId | null
  sourceBlockId: string | null
  sourceCommentId: string | null
  sourceAuthorUid: string | null
  raw: HMRawMention
}

/** Click payload emitted by the citation fragment highlight editor plugin. */
export type CitationFragmentClick = {
  citations: CitationFragmentHighlight[]
  clientX: number
  clientY: number
}

/**
 * Options forwarded to the editor's link extension and to plugins that resolve
 * pasted/typed URLs. Each consumer (web, desktop, comment editor, read-only
 * viewer, importer) supplies the subset relevant to its surface — every field
 * is therefore optional.
 */
export type LinkExtensionOptions = {
  /** Platform-agnostic Seed client used to fetch resources when resolving pasted hm:// URLs. */
  universalClient?: UniversalClient
  /** Maps a hostname (e.g. a custom domain) to a Seed account UID so URLs at that
   * domain can be resolved to hm:// references instead of erroring as "not a hypermedia link". */
  domainResolver?: DomainResolverFn
  /** Stream of the current gateway URL, used to detect gateway-prefixed hm links. */
  gwUrl?: StateStream<string>
  /** Opens a URL via the platform's native handler (desktop shell, web router). */
  openUrl?: (url: string, newWindow?: boolean) => void
  /** Asks the daemon whether a web URL points to a resource Seed can import/embed. */
  checkWebUrl?: (url: string) => Promise<unknown>
  /** Whether Cmd/Ctrl-modified link clicks should be handled by `openUrl` (new window). */
  handleModifiedClicks?: boolean
  /** Converts the stored hm:// href into the rendered DOM `href` for display. */
  renderHref?: (url: string) => string
  /** Whether the link mark should be rendered as `<a>` (clickable) or `<span>`. */
  openOnClick?: boolean
  /**
   * Called when a Hypermedia URL whose fragment targets a specific block
   * (`#blockId[start:end]`) is pasted into an empty selection. Implementations
   * typically replace the cursor block with an Embed block referencing the URL.
   * Return `false` to fall back to the default link-mark behavior.
   */
  onPasteHypermediaBlockFragment?: (resolvedHmUrl: string) => void | boolean
}

export type DocumentContentProps = {
  blocks: HMBlockNode[]
  resourceId: UnpackedHypermediaId
  focusBlockId?: string
  /** Optional codepoint range within `focusBlockId` to highlight instead of the whole block. */
  focusBlockRange?: BlockRange | null
  /** Ranged inbound citations rendered as text fragment highlights. */
  citationFragmentHighlights?: CitationFragmentHighlight[]
  /** Called when a citation fragment highlight is clicked. */
  onCitationFragmentClick?: (event: CitationFragmentClick) => void
  blockCitations?: Record<string, {citations: number; comments: number}> | null
  onBlockCitationClick?: (blockId?: string | null) => void
  onBlockCommentClick?: (
    blockId?: string | null,
    blockRange?: BlockRange | undefined,
    startCommentingNow?: boolean,
  ) => void
  onBlockSelect?: (blockId: string, opts?: BlockRange & {copyToClipboard?: boolean}) => void
  /** Called when the user creates a non-empty text selection inside the document editor. */
  onTextSelection?: () => void
  /** Called when the set of fully-selected blocks changes. Receives the IDs of blocks whose entire content is covered by the current selection. */
  onBlocksFullSelected?: (blockIds: string[]) => void
  /** Called when the editor instance is created. Used by the desktop app to capture the editor ref for draft saving. */
  onEditorReady?: (editor: any) => void
  /** Cursor position saved in the draft file; used to restore cursor on reload. */
  draftCursorPosition?: number | null
  /** Account uid used in inline mention suggestions. */
  perspectiveAccountUid?: string | null
  /** Options passed to the link extension and to URL-resolution plugins. */
  linkExtensionOptions?: LinkExtensionOptions
  /** Whether the document has no published version yet. */
  isUnpublishedDraft?: boolean
  /** Check if the given block id exist in the currently published
   * version of this document. */
  isBlockInPublishedVersion?: (blockId: string) => boolean
  /** Imports a web URL, fetches the resource and uploads to IPFS, returning
   * either an IPFS cid (desktop) or displaySrc + fileBinary (web/draft). */
  importWebFile?: (
    url: string,
  ) => Promise<{cid: string; type: string} | {displaySrc: string; fileBinary: Uint8Array | ArrayBuffer; type: string}>
  /** Handles pasted/dropped local files. Desktop returns IPFS URLs, while web can
   * return locally-stored draft media or web-published IPFS URLs. */
  handleFileAttachment?: (file: File) => Promise<{
    displaySrc?: string
    url?: string
    fileBinary?: Uint8Array | ArrayBuffer
    mediaRef?:
      | string
      | {
          draftId: string
          mediaId: string
          name: string
          mime: string
          size: number
        }
  }>
}
