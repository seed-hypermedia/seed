import {BlockSchema, TypesMatch, defaultBlockSchema} from "./blocknote";

export const hmBlockSchema: BlockSchema = {
  paragraph: defaultBlockSchema.paragraph,
  // heading: defaultBlockSchema.heading,
};

export type HMBlockSchema = TypesMatch<typeof hmBlockSchema>;
