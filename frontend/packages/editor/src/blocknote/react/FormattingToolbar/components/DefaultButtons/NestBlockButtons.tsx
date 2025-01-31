import {BlockNoteEditor, BlockSchema} from "@/blocknote/core";
import {
  canNestBlock as checkNestBlock,
  canUnnestBlock as checkUnnestBlock,
} from "@/blocknote/core/api/blockManipulation/commands/nestBlock";
import {useCallback, useState} from "react";
import {RiIndentDecrease, RiIndentIncrease} from "react-icons/ri";
import {ToolbarButton} from "../../../SharedComponents/Toolbar/components/ToolbarButton";
import {useEditorContentChange} from "../../../hooks/useEditorContentChange";
import {useEditorSelectionChange} from "../../../hooks/useEditorSelectionChange";
import {formatKeyboardShortcut} from "../../../utils";

export const NestBlockButton = <BSchema extends BlockSchema>(props: {
  editor: BlockNoteEditor<BSchema>;
}) => {
  const [canNestBlock, setCanNestBlock] = useState<boolean>();

  useEditorContentChange(props.editor, () => {
    setCanNestBlock(checkNestBlock(props.editor));
  });

  useEditorSelectionChange(props.editor, () => {
    setCanNestBlock(checkNestBlock(props.editor));
  });

  const nestBlock = useCallback(() => {
    props.editor.focus();
    props.editor.nestBlock();
  }, [props.editor]);

  return (
    <ToolbarButton
      onClick={nestBlock}
      isDisabled={!canNestBlock}
      mainTooltip="Nest Block"
      secondaryTooltip={formatKeyboardShortcut("Tab")}
      icon={RiIndentIncrease}
    />
  );
};

export const UnnestBlockButton = <BSchema extends BlockSchema>(props: {
  editor: BlockNoteEditor<BSchema>;
}) => {
  const [canUnnestBlock, setCanUnnestBlock] = useState<boolean>();

  useEditorContentChange(props.editor, () => {
    setCanUnnestBlock(checkUnnestBlock(props.editor));
  });

  useEditorSelectionChange(props.editor, () => {
    setCanUnnestBlock(checkUnnestBlock(props.editor));
  });

  const unnestBlock = useCallback(() => {
    props.editor.focus();
    props.editor.unnestBlock();
  }, [props]);

  return (
    <ToolbarButton
      onClick={unnestBlock}
      isDisabled={!canUnnestBlock}
      mainTooltip="Unnest Block"
      secondaryTooltip={formatKeyboardShortcut("Shift+Tab")}
      icon={RiIndentDecrease}
    />
  );
};
