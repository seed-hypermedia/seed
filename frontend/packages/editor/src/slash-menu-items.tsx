import {
  RiArticleFill,
  RiCodeBoxFill,
  RiFile2Fill,
  RiFlowChart,
  RiFunctions,
  RiHeading,
  RiImage2Fill,
  RiPagesFill,
  RiRadioButtonFill,
  RiText,
  RiVideoAddFill,
} from 'react-icons/ri'
import {
  BlockNoteEditor,
  BlockSpec,
  insertOrUpdateBlock,
  PartialBlock,
  PropSchema,
} from './blocknote/core'
import {HMBlockSchema} from './schema'

export function getSlashMenuItems() {
  const slashMenuItems = [
    {
      name: 'Heading',
      aliases: ['h', 'heading1', 'subheading'],
      group: 'Text blocks ',

      icon: <RiHeading size={18} />,
      execute: (
        editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
      ) => {
        insertOrUpdateBlock(editor, {
          type: 'heading',
          props: {level: '2'},
        } as PartialBlock<HMBlockSchema>)
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    },
    {
      name: 'Paragraph',
      aliases: ['p'],
      group: 'Text blocks',
      icon: <RiText size={18} />,
      execute: (
        editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
      ) => {
        insertOrUpdateBlock(editor, {
          type: 'paragraph',
        } as PartialBlock<HMBlockSchema>)
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    },
    {
      name: 'Code Block',
      aliases: ['code', 'pre', 'code-block'],
      group: 'Text blocks',
      icon: <RiCodeBoxFill size={18} />,
      hint: 'Insert a Code Block',
      execute: (editor: BlockNoteEditor) => {
        insertOrUpdateBlock(editor, {
          type: 'code-block',
          props: {
            language: '',
          },
        } as PartialBlock<HMBlockSchema>)
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    },
    {
      name: 'Image',
      aliases: ['image', 'img', 'picture'],
      group: 'Media blocks',
      icon: <RiImage2Fill size={18} />,
      hint: 'Insert an Image',
      execute: (
        editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
      ) => {
        insertOrUpdateBlock(
          editor,
          {
            type: 'image',
            props: {
              url: '',
              defaultOpen: 'true',
            },
          } as PartialBlock<HMBlockSchema>,
          true,
        )
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    },
    {
      name: 'Video',
      aliases: ['video', 'vid', 'media'],
      group: 'Media blocks',
      icon: <RiVideoAddFill size={18} />,
      hint: 'Insert a Video',
      execute: (
        editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
      ) => {
        insertOrUpdateBlock(
          editor,
          {
            type: 'video',
            props: {
              url: '',
              defaultOpen: 'true',
            },
          } as PartialBlock<HMBlockSchema>,
          true,
        )
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    },
    {
      name: 'File',
      aliases: ['file', 'folder'],
      group: 'Media blocks',
      icon: <RiFile2Fill size={18} />,
      hint: 'Insert a File',
      execute: (
        editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
      ) => {
        insertOrUpdateBlock(
          editor,
          {
            type: 'file',
            props: {
              url: '',
              defaultOpen: 'true',
            },
          } as PartialBlock<HMBlockSchema>,
          true,
        )
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    },
    {
      name: 'Embed',
      aliases: ['embed', 'card'],
      group: 'Media blocks',
      icon: <RiArticleFill size={18} />,
      hint: 'Insert a Hypermedia Embed',
      execute: (
        editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
      ) => {
        insertOrUpdateBlock(
          editor,
          {
            type: 'embed',
            props: {
              link: '',
            },
          } as PartialBlock<HMBlockSchema>,
          true,
        )
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    },
    {
      name: 'Math',
      aliases: ['math', 'mathematics', 'equation', 'katex', 'tex'],
      group: 'Media blocks',
      icon: <RiFunctions size={18} />,
      hint: 'Insert an Math Block',
      execute: (
        editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
      ) => {
        insertOrUpdateBlock(
          editor,
          {
            type: 'math',
          } as PartialBlock<HMBlockSchema>,
          true,
        )
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    },
    {
      name: 'Mermaid',
      aliases: ['mermaid', 'diagram', 'flowchart', 'chart', 'graph', 'sequence'],
      group: 'Media blocks',
      icon: <RiFlowChart size={18} />,
      hint: 'Insert a Mermaid Diagram',
      execute: (
        editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
      ) => {
        insertOrUpdateBlock(
          editor,
          {
            type: 'mermaid',
          } as PartialBlock<HMBlockSchema>,
          true,
        )
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    },
    {
      name: 'Button',
      aliases: ['button', 'click', 'press'],
      group: '',
      icon: <RiRadioButtonFill size={18} />,
      hint: 'Insert a button block',
      execute: (
        editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
      ) => {
        insertOrUpdateBlock(
          editor,
          {
            type: 'button',
            props: {
              url: '',
              name: 'Button',
            },
          } as PartialBlock<HMBlockSchema>,
          true,
        )
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    },
    // {
    //   name: 'Nostr',
    //   aliases: ['nostr', 'note', 'event'],
    //   group: 'Web embeds',
    //   icon: <RiMessage2Fill size={18} />,
    //   hint: 'Insert a nostr note',
    //   execute: (
    //     editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
    //   ) => {
    //     insertOrUpdateBlock(
    //       editor,
    //       {
    //         type: 'nostr',
    //         props: {
    //           url: '',
    //         },
    //       } as PartialBlock<HMBlockSchema>,
    //       true,
    //     )
    //     const {state, view} = editor._tiptapEditor
    //     view.dispatch(state.tr.scrollIntoView())
    //   },
    // },
    //   {
    //     name: "Query",
    //     aliases: ["query"],
    //     group: "Web embeds",
    //     icon: <RiGridFill size={18} />,
    //     hint: "Insert a Query Block",
    //     execute: (
    //       editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>
    //     ) => {
    //       insertOrUpdateBlock(
    //         editor,
    //         {
    //           type: "query",
    //           props: {
    //             style: "Card",
    //             columnCount: "3",
    //             queryLimit: "",
    //             queryIncludes: '[{"space": "", "path": "", "mode": "Children"}]',
    //             querySort: '[{"term": "UpdateTime", "reverse": false}]',
    //           },
    //         } as PartialBlock<HMBlockSchema>,
    //         true
    //       );
    //       const {state, view} = editor._tiptapEditor;
    //       view.dispatch(state.tr.scrollIntoView());
    //     },
    //   },
    // DISABLE TWITTER/X EMBEDS BECAUSE IT DOES NOT WORK ON WEB
    {
      name: 'Web Embed',
      aliases: ['tweet', 'twitter', 'web embed', 'x.com', 'instagram'],
      group: 'Web embeds',
      icon: <RiPagesFill size={18} />,
      hint: 'Insert an Instagram or X post embed',
      // @ts-expect-error
      execute: (editor) => {
        insertOrUpdateBlock(
          editor,
          {
            type: 'web-embed',
            props: {
              url: '',
            },
          } as PartialBlock<HMBlockSchema>,
          true,
        )
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    },
  ]
  return slashMenuItems
}
