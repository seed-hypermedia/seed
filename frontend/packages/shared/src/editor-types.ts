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
export type EditorInlineContent = EditorText | EditorInlineEmbed | EditorLink

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
  content: Array<EditorInlineContent>
}

export interface EditorHeadingBlock extends EditorBaseBlock {
  type: 'heading'
  content: Array<EditorInlineContent>
}

export interface EditorCodeBlock extends EditorBaseBlock {
  type: 'code-block'
  content: Array<EditorInlineContent>
  props: EditorBlockProps & {
    language?: string
  }
}

export interface MediaBlockProps extends EditorBlockProps {
  url?: string
  src?: string
  name?: string
  width?: string
  defaultOpen?: string
  size?: string
}

export interface EditorImageBlock extends EditorBaseBlock {
  type: 'image'
  props: MediaBlockProps
  content: Array<EditorInlineContent>
}

export interface EditorVideoBlock extends EditorBaseBlock {
  type: 'video'
  props: MediaBlockProps
  content: Array<EditorInlineContent>
}

export interface EditorFileBlock extends EditorBaseBlock {
  type: 'file'
  props: MediaBlockProps
  content: Array<EditorInlineContent>
}

export interface EditorButtonBlock extends EditorBaseBlock {
  type: 'button'
  props: MediaBlockProps
  content: Array<EditorInlineContent>
}

export interface EditorEmbedBlock extends EditorBaseBlock {
  type: 'embed'
  props: EditorBlockProps & {
    view: 'Content' | 'Card'
    url: string
  }
  content: Array<EditorInlineContent>
}

export interface EditorMathBlock extends EditorBaseBlock {
  type: 'math'
  content: Array<EditorInlineContent>
}

export type EditorWebEmbedBlock = EditorBaseBlock & {
  type: 'web-embed'
  props: EditorBlockProps & {
    url?: string
  }
  content: Array<EditorInlineContent>
}

export type EditorNostrBlock = EditorBaseBlock & {
  type: 'nostr'
  props: EditorBlockProps & {
    name?: string
    url?: string
    text?: string
    size?: string
  }
  content: Array<EditorInlineContent>
}

export type EditorQueryBlock = EditorBaseBlock & {
  type: 'query'
  props: EditorBlockProps & {
    style: 'Card' | 'List'
    columnCount?: '1' | '2' | '3'
    queryLimit?: string
    queryIncludes?: string
    querySort?: string
  }
  content: Array<EditorInlineContent>
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
  content: Array<EditorInlineContent>
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
}

export type EditorAnnotationType =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'link'
  | 'inline-embed'

export type EditorBlockType = EditorBlock['type']

export type SearchResult = {
  key: string
  title: string
  subtitle?: string
  icon?: string
  onSelect: () => void | Promise<void>
  onFocus: () => void
  onMouseEnter: () => void
}
