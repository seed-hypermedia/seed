import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmIdPathToEntityQueryPath} from '@shm/shared'
import {
  RiArticleFill,
  RiCodeBoxFill,
  RiFile2Fill,
  RiFunctions,
  RiGridFill,
  RiHeading,
  RiImage2Fill,
  RiLayoutGridFill,
  RiPagesFill,
  RiRadioButtonFill,
  RiText,
  RiVideoAddFill,
  RiWindow2Fill,
} from 'react-icons/ri'
import {BlockNoteEditor, BlockSpec, insertOrUpdateBlock, PartialBlock, PropSchema} from './blocknote/core'
import {getBlockInfoFromPos} from './blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import {HMBlockSchema} from './schema'

export function getSlashMenuItems({
  showQuery = true,
  docId,
}: {
  showQuery?: boolean
  docId?: UnpackedHypermediaId
} = {}) {
  const slashMenuItems = []

  slashMenuItems.push({
    name: 'Heading',
    aliases: ['h', 'heading1', 'subheading'],
    group: 'Text blocks',

    icon: <RiHeading size={18} />,
    execute: (editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>) => {
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
    execute: (editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>) => {
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
      // Move cursor to the code-block after converting from paragraph
      const codeBlock = editor.getTextCursorPosition().prevBlock
      if (codeBlock && codeBlock.type === 'code-block') {
        editor.setTextCursorPosition(codeBlock, 'start')
      }
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
    execute: (editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>) => {
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
    execute: (editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>) => {
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
    execute: (editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>) => {
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
    execute: (editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>) => {
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
    execute: (editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>) => {
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
    execute: (editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>) => {
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
    execute: (editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>) => {
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
  slashMenuItems.push({
    name: 'Grid',
    aliases: ['grid', 'gallery', 'cards', 'columns'],
    group: 'Layout',
    icon: <RiLayoutGridFill size={18} />,
    hint: 'Insert a Grid layout',
    execute: (editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>) => {
      const currentBlock = editor.getTextCursorPosition().block
      const prevBlock = editor.getTextCursorPosition().prevBlock

      // Clear the "/" text from current block
      editor.updateBlock(currentBlock, {
        type: 'paragraph',
        content: '',
      } as PartialBlock<HMBlockSchema>)

      const tiptap = editor._tiptapEditor

      if (prevBlock && prevBlock.children.length === 0) {
        // Previous block has no children: nest current block under it with Grid layout
        setTimeout(() => {
          tiptap
            .chain()
            .sinkListItem('blockNode')
            .command(({state, dispatch}: {state: any; dispatch: any}) => {
              if (!dispatch) return true
              const $pos = state.doc.resolve(state.selection.from)
              for (let d = $pos.depth; d >= 0; d--) {
                const node = $pos.node(d)
                if (node.type.name === 'blockChildren') {
                  state.tr.setNodeMarkup($pos.before(d), null, {
                    ...node.attrs,
                    listType: 'Grid',
                    columnCount: '3',
                  })
                  break
                }
              }
              return true
            })
            .run()
        })
      } else {
        // Previous block has children (or no previous block): add Grid children to current block
        setTimeout(() => {
          tiptap.commands.command(({state, dispatch}: {state: any; dispatch: any}) => {
            if (!dispatch) return true
            const blockInfo = getBlockInfoFromPos(state, state.selection.from)
            const schema = state.schema

            // Create 3 empty child blockNodes
            const emptyChildren = []
            for (let i = 0; i < 3; i++) {
              const para = schema.nodes['paragraph'].create()
              emptyChildren.push(schema.nodes['blockNode'].create({}, para))
            }

            // Create blockChildren with Grid type
            const gridGroup = schema.nodes['blockChildren'].create(
              {listType: 'Grid', columnCount: '3'},
              emptyChildren,
            )

            // Insert after the block content node
            state.tr.insert(blockInfo.blockContent.afterPos, gridGroup)
            dispatch(state.tr)
            return true
          })
        })
      }

      const {state, view} = editor._tiptapEditor
      view.dispatch(state.tr.scrollIntoView())
    },
  })
  if (showQuery) {
    slashMenuItems.push({
      name: 'Query',
      aliases: ['query'],
      group: 'Web embeds',
      icon: <RiGridFill size={18} />,
      hint: 'Insert a Query Block',
      execute: (editor: BlockNoteEditor<Record<string, BlockSpec<string, PropSchema>>>) => {
        insertOrUpdateBlock(
          editor,
          {
            type: 'query',
            props: {
              style: 'Card',
              columnCount: '3',
              queryLimit: '',
              queryIncludes: JSON.stringify(
                docId
                  ? [
                      {
                        space: docId.uid,
                        path: hmIdPathToEntityQueryPath(docId.path).slice(1),
                        mode: 'Children',
                      },
                    ]
                  : [],
              ),
              querySort: '[{"term": "UpdateTime", "reverse": false}]',
              defaultOpen: 'true',
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
  })

  return slashMenuItems
}
