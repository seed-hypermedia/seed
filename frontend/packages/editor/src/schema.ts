import {BlockSchema, TypesMatch} from '@/blocknote'
import {
  defaultBlockSchema,
  defaultProps,
} from '@/blocknote/core/extensions/Blocks/api/defaultBlocks'
import {EmbedBlock} from '@/embed-block'
import {FileBlock} from '@/file'
import {HMHeadingBlockContent} from '@/heading-component-plugin'
import CodeBlockLowlight from '@/tiptap-extension-code-block'
import {common, createLowlight} from 'lowlight'

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
  embed: EmbedBlock,
}

export type HMBlockSchema = TypesMatch<typeof hmBlockSchema>
