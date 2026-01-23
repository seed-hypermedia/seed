import {HMBlockChildrenType} from './hm-types'

export type EditorBlock =
  | EditorParagraphBlock
  | EditorHeadingBlock
  | EditorCodeBlock
  | EditorImageBlock
  | EditorVideoBlock
  | EditorFileBlock
  | EditorButtonBlock
  | EditorEmbedBlock
  | EditorWebEmbedBlock
  | EditorMathBlock
  | EditorNostrBlock
  | EditorQueryBlock
  | EditorUnknownBlock
export type HMInlineContent = EditorText | EditorInlineEmbed | EditorLink

// ===============

export interface EditorBaseBlock {
  id: string
  props: EditorBlockProps
  children: Array<EditorBlock>
}

export interface EditorBlockProps {
  // textAlignment?: 'left' | 'center' | 'right'
  childrenType?: HMBlockChildrenType
  listLevel?: string
  level?: number | string
  ref?: string
  revision?: string
}

export interface EditorParagraphBlock extends EditorBaseBlock {
  type: 'paragraph'
  content: Array<HMInlineContent>
}

export interface EditorHeadingBlock extends EditorBaseBlock {
  type: 'heading'
  content: Array<HMInlineContent>
}

export interface EditorCodeBlock extends EditorBaseBlock {
  type: 'code-block'
  content: Array<HMInlineContent>
  props: EditorBlockProps & {
    language?: string
  }
}

export interface DraftMediaRef {
  draftId: string
  mediaId: string
  name: string
  mime: string
  size: number
}

export interface MediaBlockProps extends EditorBlockProps {
  url?: string
  src?: string
  displaySrc?: string
  fileBinary?: Uint8Array | number[]
  mediaRef?: DraftMediaRef
  name?: string
  width?: string
  defaultOpen?: string
  size?: string
  alignment?: string
}

export interface EditorImageBlock extends EditorBaseBlock {
  type: 'image'
  props: MediaBlockProps
  content: Array<HMInlineContent>
}

export interface EditorVideoBlock extends EditorBaseBlock {
  type: 'video'
  props: MediaBlockProps
  content: Array<HMInlineContent>
}

export interface EditorFileBlock extends EditorBaseBlock {
  type: 'file'
  props: MediaBlockProps
  content: Array<HMInlineContent>
}

export interface EditorButtonBlock extends EditorBaseBlock {
  type: 'button'
  props: MediaBlockProps
  content: Array<HMInlineContent>
}

export interface EditorEmbedBlock extends EditorBaseBlock {
  type: 'embed'
  props: EditorBlockProps & {
    view: 'Content' | 'Card'
    url: string
  }
  content: Array<HMInlineContent>
}

export interface EditorMathBlock extends EditorBaseBlock {
  type: 'math'
  content: Array<HMInlineContent>
}

export type EditorWebEmbedBlock = EditorBaseBlock & {
  type: 'web-embed'
  props: EditorBlockProps & {
    url?: string
  }
  content: Array<HMInlineContent>
}

export type EditorNostrBlock = EditorBaseBlock & {
  type: 'nostr'
  props: EditorBlockProps & {
    name?: string
    url?: string
    text?: string
    size?: string
  }
  content: Array<HMInlineContent>
}

export type EditorQueryBlock = EditorBaseBlock & {
  type: 'query'
  props: EditorBlockProps & {
    style: 'Card' | 'List'
    columnCount?: '1' | '2' | '3'
    queryLimit?: string
    queryIncludes?: string
    querySort?: string
    banner?: 'true' | 'false'
  }
  content: Array<HMInlineContent>
}

export type EditorUnknownBlock = EditorBaseBlock & {
  type: 'unknown'
  props: EditorBlockProps & {
    originalType: string
    originalData: string
  }
  content: Array<HMInlineContent>
}

export interface EditorText {
  type: 'text'
  text: string
  styles: EditorInlineStyles
}

export interface EditorLink {
  type: 'link'
  // TODO: change to link
  href: string
  content: Array<HMInlineContent>
}

export interface EditorInlineEmbed {
  type: 'inline-embed'
  link: string
  styles: EditorInlineStyles | {}
}

export interface EditorInlineStyles {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  math?: boolean
  range?: boolean
}

export type EditorAnnotationType =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'link'
  | 'inline-embed'
  | 'range'
export type EditorBlockType = EditorBlock['type']

export type SearchResult = {
  key: string
  title: string
  subtitle?: string
  icon?: string
  path?: string[] | null
  versionTime?: string
  searchQuery?: string
  onSelect?: () => void | Promise<void>
  onFocus: () => void
  onMouseEnter: () => void
}
