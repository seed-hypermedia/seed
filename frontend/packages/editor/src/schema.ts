import {common, createLowlight} from 'lowlight'
import {BlockSchema, TypesMatch} from './blocknote'
import {defaultBlockSchema, defaultProps} from './blocknote/core/extensions/Blocks/api/defaultBlocks'
import {ButtonBlock} from './button'
import {EmbedBlock} from './embed-block'
import {FileBlock} from './file'
import {HMHeadingBlockContent} from './heading-component-plugin'
import {ImageBlock} from './image'
import {MathBlock} from './math'
import {QueryBlock} from './query-block'
import CodeBlockLowlight from './tiptap-extension-code-block'
import {Table} from './tiptap-extension-table'
import {UnknownBlock} from './unknown-block'
import {VideoBlock} from './video'
import {WebEmbed} from './web-embed'

export const hmBlockSchema: BlockSchema = {
  paragraph: defaultBlockSchema.paragraph,
  heading: {
    propSchema: {
      ...defaultProps,
      level: {default: '1'},
    },
    node: HMHeadingBlockContent,
  },
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
  file: FileBlock,
  image: ImageBlock,
  video: VideoBlock,
  button: ButtonBlock,
  math: MathBlock('math'),
  ['web-embed']: WebEmbed,
  embed: EmbedBlock,
  query: QueryBlock,
  table: {
    propSchema: {
      ...defaultProps,
    },
    // @ts-ignore
    node: Table,
  },
  unknown: UnknownBlock,
}

export type HMBlockSchema = TypesMatch<typeof hmBlockSchema>
