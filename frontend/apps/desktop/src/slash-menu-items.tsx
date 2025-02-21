import {
  BlockNoteEditor,
  BlockSpec,
  insertOrUpdateBlock,
  PartialBlock,
  PropSchema,
} from '@shm/editor/blocknote'
import {hmIdPathToEntityQueryPath, UnpackedHypermediaId} from '@shm/shared'
import {TwitterXIcon} from '@shm/ui'
import {
  RiArticleFill,
  RiCodeBoxFill,
  RiFile2Fill,
  RiFunctions,
  RiGridFill,
  RiHeading,
  RiImage2Fill,
  RiMessage2Fill,
  RiRadioButtonFill,
  RiText,
  RiVideoAddFill,
  RiWindow2Fill,
} from 'react-icons/ri'
import {HMBlockSchema} from './editor'

export function getSlashMenuItems({
  showNostr = true,
  showQuery = true,
  docId,
}: {
  showNostr?: boolean
  showQuery?: boolean
  docId: UnpackedHypermediaId
}) {
  const slashMenuItems = []

  slashMenuItems.push({
    name: 'Heading',
    aliases: ['h', 'heading1', 'subheading'],
    group: 'Text blocks',

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
  })
  slashMenuItems.push({
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
  })
  slashMenuItems.push({
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
  })
  slashMenuItems.push({
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
  })
  slashMenuItems.push({
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
  })
  slashMenuItems.push({
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
  })
  slashMenuItems.push({
    name: 'Embed',
    aliases: ['embed'],
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
  })
  slashMenuItems.push({
    name: 'Card',
    aliases: ['card'],
    group: 'Media blocks',
    icon: <RiWindow2Fill size={18} />,
    hint: 'Insert a Hypermedia Card Embed',
    execute: (
      editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
    ) => {
      insertOrUpdateBlock(
        editor,
        {
          type: 'embed',
          props: {
            link: '',
            view: 'Card',
          },
        } as PartialBlock<HMBlockSchema>,
        true,
      )
      const {state, view} = editor._tiptapEditor
      view.dispatch(state.tr.scrollIntoView())
    },
  })
  slashMenuItems.push({
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
  })
  slashMenuItems.push({
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
          },
        } as PartialBlock<HMBlockSchema>,
        true,
      )
      const {state, view} = editor._tiptapEditor
      view.dispatch(state.tr.scrollIntoView())
    },
  })
  if (showNostr) {
    slashMenuItems.push({
      name: 'Nostr',
      aliases: ['nostr', 'note', 'event'],
      group: 'Web embeds',
      icon: <RiMessage2Fill size={18} />,
      hint: 'Insert a nostr note',
      execute: (
        editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
      ) => {
        insertOrUpdateBlock(
          editor,
          {
            type: 'nostr',
            props: {
              url: '',
            },
          } as PartialBlock<HMBlockSchema>,
          true,
        )
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    })
  }
  if (showQuery) {
    slashMenuItems.push({
      name: 'Query',
      aliases: ['query'],
      group: 'Web embeds',
      icon: <RiGridFill size={18} />,
      hint: 'Insert a Query Block',
      execute: (
        editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>,
      ) => {
        insertOrUpdateBlock(
          editor,
          {
            type: 'query',
            props: {
              style: 'Card',
              columnCount: '3',
              queryLimit: '',
              queryIncludes: JSON.stringify([
                {
                  space: docId.uid,
                  path: hmIdPathToEntityQueryPath(docId.path).slice(1),
                  mode: 'Children',
                },
              ]),
              querySort: '[{"term": "UpdateTime", "reverse": false}]',
            },
          } as PartialBlock<HMBlockSchema>,
          true,
        )
        const {state, view} = editor._tiptapEditor
        view.dispatch(state.tr.scrollIntoView())
      },
    })
  }
  slashMenuItems.push({
    name: 'X Post',
    aliases: ['tweet', 'twitter', 'web embed', 'x.com'],
    group: 'Web embeds',
    icon: <TwitterXIcon width={18} height={18} />,
    hint: 'Insert an X Post embed',
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
  })
  return slashMenuItems
}
