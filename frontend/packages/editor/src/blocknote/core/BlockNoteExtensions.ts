import {Extensions, extensions} from '@tiptap/core'
import {HMBlockSchema} from '../../schema'

import {BlockNoteEditor} from './BlockNoteEditor'

import {BlockManipulationExtension} from '@/blocknote/core/extensions/BlockManipulation/BlockManipulationExtension'
import {
  BlockContainer,
  BlockGroup,
  Doc,
} from '@/blocknote/core/extensions/Blocks'
import {BlockNoteDOMAttributes} from '@/blocknote/core/extensions/Blocks/api/blockTypes'
import {CustomBlockSerializerExtension} from '@/blocknote/core/extensions/Blocks/api/serialization'
import blockStyles from '@/blocknote/core/extensions/Blocks/nodes/Block.module.css'
import {KeyboardShortcutsExtension} from '@/blocknote/core/extensions/KeyboardShortcuts/KeyboardShortcutsExtension'
import {createMarkdownExtension} from '@/blocknote/core/extensions/Markdown/MarkdownExtension'
import {Placeholder} from '@/blocknote/core/extensions/Placeholder/PlaceholderExtension'
import {TrailingNode} from '@/blocknote/core/extensions/TrailingNode/TrailingNodeExtension'
import {UniqueID} from '@/blocknote/core/extensions/UniqueID/UniqueID'
import {LocalMediaPastePlugin} from '@/handle-local-media-paste-plugin'
import {createInlineEmbedNode} from '@/mentions-plugin'
import {debugPlugin} from '@/prosemirror-debugger'
import Link from '@/tiptap-extension-link'
import {Bold} from '@tiptap/extension-bold'
import {Code} from '@tiptap/extension-code'
import {Dropcursor} from '@tiptap/extension-dropcursor'
import {Gapcursor} from '@tiptap/extension-gapcursor'
import {HardBreak} from '@tiptap/extension-hard-break'
import {History} from '@tiptap/extension-history'
import {Italic} from '@tiptap/extension-italic'
import {Strike} from '@tiptap/extension-strike'
import {Text} from '@tiptap/extension-text'
import {Underline} from '@tiptap/extension-underline'
import * as Y from 'yjs'

/**
 * Get all the Tiptap extensions BlockNote is configured with by default
 */
export const getBlockNoteExtensions = <BSchema extends HMBlockSchema>(opts: {
  editable?: boolean
  editor: BlockNoteEditor<BSchema>
  domAttributes: Partial<BlockNoteDOMAttributes>
  blockSchema: BSchema
  // TODO: properly type this.
  linkExtensionOptions: any
  inlineEmbedOptions: any
  collaboration?: {
    fragment: Y.XmlFragment
    user: {
      name: string
      color: string
    }
    provider: any
    renderCursor?: (user: any) => HTMLElement
  }
}) => {
  const ret: Extensions = [
    createInlineEmbedNode(opts.editor),
    extensions.ClipboardTextSerializer,
    extensions.Commands,
    extensions.Editable,
    extensions.FocusEvents,
    extensions.Tabindex,

    // DevTools,
    Gapcursor,

    // DropCursor,
    Placeholder.configure({
      emptyNodeClass: blockStyles.isEmpty,
      hasAnchorClass: blockStyles.hasAnchor,
      isFilterClass: blockStyles.isFilter,
      includeChildren: true,
      showOnlyCurrent: false,
    }),
    UniqueID.configure({
      types: ['blockContainer'],
    }),
    // Comments,

    // basics:
    Text,

    // copy paste:
    // @ts-ignore
    createMarkdownExtension(opts.editor),

    // block manupulations:
    BlockManipulationExtension,
    KeyboardShortcutsExtension.configure({editor: opts.editor}),

    // marks:
    Bold,
    Code,
    Italic,
    Strike,
    Underline,
    Link.configure(opts.linkExtensionOptions),
    // TextColorMark,
    // TextColorExtension,
    // BackgroundColorMark,
    // BackgroundColorExtension,
    // TextAlignmentExtension,
    LocalMediaPastePlugin,
    // nodes
    Doc,
    BlockGroup.configure({
      domAttributes: opts.domAttributes,
    }),
    ...Object.values(opts.blockSchema).map((blockSpec) => {
      return blockSpec.node.configure({
        editor: opts.editor,
        domAttributes: opts.domAttributes,
      })
    }),
    CustomBlockSerializerExtension,

    Dropcursor.configure({width: 5, color: '#ddeeff'}),
    HardBreak,
    // This needs to be at the bottom of this list, because Key events (such as enter, when selecting a /command),
    // should be handled before Enter handlers in other components like splitListItem
    TrailingNode,
    BlockContainer.configure({
      domAttributes: opts.domAttributes,
    }),
    debugPlugin,
    History,
  ]

  return ret
}
