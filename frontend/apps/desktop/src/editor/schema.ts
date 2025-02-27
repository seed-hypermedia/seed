import {
  BlockSchema,
  TypesMatch,
  defaultBlockSchema,
  defaultProps,
} from '@shm/editor/blocknote'
import {ButtonBlock} from '@shm/editor/button'
import {EmbedBlock} from '@shm/editor/embed-block'
import {FileBlock} from '@shm/editor/file'
import {HMHeadingBlockContent} from '@shm/editor/heading-component-plugin'
import CodeBlockLowlight from '@shm/editor/tiptap-extension-code-block'
import {common, createLowlight} from 'lowlight'
import {ImageBlock} from './image'
import {MathBlock} from './math'
import {NostrBlock} from './nostr'
import {QueryBlock} from './query-block'
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
