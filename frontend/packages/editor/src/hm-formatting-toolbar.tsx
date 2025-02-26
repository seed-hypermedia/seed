import {BlockNoteEditor, BlockSpec, PropSchema} from "@/blocknote/core";
import {
  BlockTypeDropdownItem,
  FormattingToolbarProps,
  useEditorContentChange,
  useEditorSelectionChange,
} from "@/blocknote/react";
import {HMLinkToolbarButton} from "@/hm-toolbar-link-button";
import {EditorToggledStyle} from "@shm/shared/hm-types";
import {Button} from "@shm/ui/button";
import {
  Code,
  Emphasis,
  HeadingIcon,
  OrderedList,
  Strikethrough,
  Strong,
  Type,
  Underline,
  UnorderedList,
} from "@shm/ui/icons";
import {useState} from "react";
import {SizeTokens, Theme, Tooltip, XGroup, XStack} from "tamagui";

const size: SizeTokens = "$3";

const toggleStyles = [
  {
    name: "Bold (Mod+B)",
    icon: Strong,
    style: "bold" as EditorToggledStyle,
  },
  {
    name: "Italic (Mod+I)",
    icon: Emphasis,
    style: "italic" as EditorToggledStyle,
  },
  {
    name: "Underline (Mod+U)",
    icon: Underline,
    style: "underline" as EditorToggledStyle,
  },
  {
    name: "Strikethrough (Mod+Shift+X)",
    icon: Strikethrough,
    style: "strike" as EditorToggledStyle,
  },
  {
    name: "Code (Mod+E)",
    icon: Code,
    style: "code" as EditorToggledStyle,
  },
];

export const blockDropdownItems: BlockTypeDropdownItem[] = [
  {
    name: "Paragraph",
    type: "paragraph",
    icon: Type,
  },
  {
    name: "Heading",
    type: "heading",
    icon: HeadingIcon,
  },
  {
    name: "Bullet List",
    type: "bulletListItem",
    icon: UnorderedList,
  },
  {
    name: "Numbered List",
    type: "numberedListItem",
    icon: OrderedList,
  },
];

export function HMFormattingToolbar<
  Schema extends Record<string, BlockSpec<string, PropSchema>>,
>(
  props: FormattingToolbarProps<Schema> & {
    blockTypeDropdownItems?: BlockTypeDropdownItem[];
  }
) {
  // return <XStack bg="red" ref={currentRef} width={200} height={10} />
  return (
    <XStack>
      <XGroup elevation="$5" bg="red" paddingHorizontal={0} x={-40}>
        {/* <BlockTypeToolbarDropdown
          editor={props.editor}
          items={props.blockTypeDropdownItems}
        /> */}
        {toggleStyles.map((item) => (
          <ToggleStyleButton
            key={item.style}
            editor={props.editor}
            toggleStyle={item.style}
            {...item}
          />
        ))}
        <HMLinkToolbarButton editor={props.editor} size={size} />
      </XGroup>
    </XStack>
  );
}

function ToggleStyleButton<
  Schema extends Record<string, BlockSpec<string, PropSchema>>,
>({
  editor,
  toggleStyle,

  name,
  icon,
}: {
  editor: BlockNoteEditor<Schema>;
  toggleStyle: EditorToggledStyle;
  name: string;
  icon: any;
}) {
  const [active, setActive] = useState<boolean>(
    toggleStyle in editor.getActiveStyles()
  );

  function toggleCurrentStyle() {
    setActive(toggleStyle in editor.getActiveStyles());
  }

  useEditorContentChange(editor, toggleCurrentStyle);
  useEditorSelectionChange(editor, toggleCurrentStyle);

  function handlePress(style: EditorToggledStyle) {
    editor.focus();
    editor.toggleStyles({[toggleStyle]: true});
  }

  return (
    <Theme inverse={active}>
      <XGroup.Item>
        <Tooltip content={name}>
          <Button
            bg={active ? "$background" : "$backgroundFocus"}
            fontWeight={active ? "bold" : "400"}
            size={size}
            borderRadius={0}
            icon={icon}
            onPress={() => handlePress(toggleStyle)}
          />
        </Tooltip>
      </XGroup.Item>
    </Theme>
  );
}
