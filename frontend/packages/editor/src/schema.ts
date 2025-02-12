import {BlockSchema, TypesMatch} from "./blocknote";
import {defaultBlockSchema} from "./blocknote/core/extensions/Blocks/api/defaultBlocks";

export const hmBlockSchema: BlockSchema = {
  paragraph: defaultBlockSchema.paragraph,
  // heading: defaultBlockSchema.heading,
};

export type HMBlockSchema = TypesMatch<typeof hmBlockSchema>;
