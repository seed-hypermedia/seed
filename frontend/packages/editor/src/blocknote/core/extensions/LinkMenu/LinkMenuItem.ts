import {HMBlockSchema} from "@/schema";
import {BlockNoteEditor} from "../../BlockNoteEditor";
import {BlockSchema} from "../Blocks/api/blockTypes";

export type LinkMenuItem<BSchema extends BlockSchema = HMBlockSchema> = {
  name: string;
  key: string;
  icon?: JSX.Element;
  hint?: string;
  disabled: boolean;
  execute: (editor: BlockNoteEditor<BSchema>, ref: string) => void;
};
