import {BlockSchema, TypesMatch} from '@/blocknote'
import {
  defaultBlockSchema,
  defaultProps,
} from '@/blocknote/core/extensions/Blocks/api/defaultBlocks'
import {FileBlock} from '@/file'
import {HMHeadingBlockContent} from '@/heading-component-plugin'
import {ImageBlock} from '@/image'
import CodeBlockLowlight from '@/tiptap-extension-code-block'
import {common, createLowlight} from 'lowlight'
import {ButtonBlock} from './button'
import {MathBlock} from './math'
import {VideoBlock} from './video'

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
}

export type HMBlockSchema = TypesMatch<typeof hmBlockSchema>
