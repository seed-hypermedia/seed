import {common, createLowlight} from 'lowlight'
import {
  BlockSchema,
  TypesMatch,
  defaultBlockSchema,
  defaultProps,
} from './blocknote'
import {ButtonBlock} from './button'
import {EmbedBlock} from './embed-block'
import {FileBlock} from './file'
import {HMHeadingBlockContent} from './heading-component-plugin'
import {ImageBlock} from './image'
import {MathBlock} from './math'
import {NostrBlock} from './nostr'
import {QueryBlock} from './query-block'
import CodeBlockLowlight from './tiptap-extension-code-block'
import {VideoBlock} from './video'
import {WebEmbed} from './web-embed'

export const hmBlockSchema: BlockSchema = {
  paragraph: defaultBlockSchema.paragraph,
  // heading: defaultBlockSchema.heading,
  heading: {
    propSchema: {
      ...defaultProps,
      level: {default: '1'},
    },
    node: HMHeadingBlockContent,
  },
  image: ImageBlock,
  ['code-block']: {
    propSchema: {
      ...defaultProps,
      language: {default: ''},
    },
    // @ts-ignore
    node: CodeBlockLowlight.configure({
      defaultLanguage: 'plaintext',
      lowlight: createLowlight(common),
      languageClassPrefix: 'language-',
    }),
  },

  video: VideoBlock,
  embed: EmbedBlock,
  file: FileBlock,
  button: ButtonBlock,
  nostr: NostrBlock,
  ['web-embed']: WebEmbed,
  math: MathBlock('math'),
  query: QueryBlock,
}

export type HMBlockSchema = TypesMatch<typeof hmBlockSchema>
