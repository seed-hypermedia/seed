import {BlockSchema, TypesMatch} from './blocknote'
import {
  defaultBlockSchema,
  defaultProps,
} from './blocknote/core/extensions/Blocks/api/defaultBlocks'
import {HMHeadingBlockContent} from './heading-component-plugin'

export const hmBlockSchema: BlockSchema = {
  paragraph: defaultBlockSchema.paragraph,
  heading: {
    propSchema: {
      ...defaultProps,
      level: {default: '1'},
    },
    node: HMHeadingBlockContent,
  },
}

export type HMBlockSchema = TypesMatch<typeof hmBlockSchema>
