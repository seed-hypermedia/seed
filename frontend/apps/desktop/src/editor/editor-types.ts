export type EditorBlock =
  | EditorParagraphBlock
  | EditorHeadingBlock
  | EditorCodeBlock
  | EditorImageBlock
  | EditorVideoBlock
  | EditorFileBlock
  | EditorEmbedBlock
  | EditorWebEmbedBlock
  | EditorMathBlock
  | EditorNostrBlock

export type EditorInlineContent = EditorText | EditorInlineEmbed | EditorLink

// ===============

export interface EditorBaseBlock {
  id: string
  props: EditorBlockProps
  children: Array<EditorBlock>
}

export interface EditorBlockProps {
  // textAlignment?: 'left' | 'center' | 'right'
  childrenType?: 'div' | 'ul' | 'ol'
  listLevel?: string
  start?: string
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
  width?: number
  defaultOpen?: string
  size?: number
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
    size: number
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
