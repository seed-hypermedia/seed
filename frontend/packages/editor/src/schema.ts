import {BlockSchema, TypesMatch} from '@/blocknote'
import {
  defaultBlockSchema,
  defaultProps,
} from '@/blocknote/core/extensions/Blocks/api/defaultBlocks'
import {ButtonBlock} from '@/button'
import {EmbedBlock} from '@/embed-block'
import {FileBlock} from '@/file'
import {HMHeadingBlockContent} from '@/heading-component-plugin'
import {ImageBlock} from '@/image'
import {MathBlock} from '@/math'
import CodeBlockLowlight from '@/tiptap-extension-code-block'
import {VideoBlock} from '@/video'
import {WebEmbed} from '@/web-embed'
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
  // nostr: NostrBlock,
}

export type HMBlockSchema = TypesMatch<typeof hmBlockSchema>
