import {Extension, Extensions, extensions} from '@tiptap/core'
import {HMBlockSchema} from '../../schema'

import {BlockNoteEditor} from './BlockNoteEditor'

import {Bold} from '@tiptap/extension-bold'
import {Code} from '@tiptap/extension-code'

import {Gapcursor} from '@tiptap/extension-gapcursor'
import {HardBreak} from '@tiptap/extension-hard-break'
import {History} from '@tiptap/extension-history'
import {Italic} from '@tiptap/extension-italic'
import {Strike} from '@tiptap/extension-strike'
import {Text} from '@tiptap/extension-text'
import {Underline} from '@tiptap/extension-underline'
import * as Y from 'yjs'
import {LocalMediaPastePlugin} from '../../handle-local-media-paste-plugin'
import {createInlineEmbedNode} from '../../mentions-plugin'
import {debugPlugin} from '../../prosemirror-debugger'
import Link from '../../tiptap-extension-link'
import {createBlockHighlightPlugin} from './extensions/BlockHighlight/BlockHighlightPlugin'
import {BlockManipulationExtension} from './extensions/BlockManipulation/BlockManipulationExtension'
import {BlockChildren, BlockNode, Doc} from './extensions/Blocks'
import {BlockNoteDOMAttributes} from './extensions/Blocks/api/blockTypes'
import {CustomBlockSerializerExtension} from './extensions/Blocks/api/serialization'
import blockStyles from './extensions/Blocks/nodes/Block.module.css'
import {HMDropCursor} from './extensions/GridDropCursor/GridDropCursorExtension'
import {ImageGalleryPlugin} from './extensions/ImageGallery/ImageGalleryPlugin'
import {KeyboardShortcutsExtension} from './extensions/KeyboardShortcuts/KeyboardShortcutsExtension'
import {createMarkdownExtension} from './extensions/Markdown/MarkdownExtension'
import {Placeholder} from './extensions/Placeholder/PlaceholderExtension'
import {TrailingNode} from './extensions/TrailingNode/TrailingNodeExtension'
import {UniqueID} from './extensions/UniqueID/UniqueID'

/**
 * Get all the Tiptap extensions BlockNote is configured with by default
 */
export const getBlockNoteExtensions = <BSchema extends HMBlockSchema>(opts: {
  editable?: boolean
  editor: BlockNoteEditor<BSchema>
  domAttributes: Partial<BlockNoteDOMAttributes>
  blockSchema: BSchema
  // These types are complex due to tiptap extension options - using any for compatibility
  linkExtensionOptions?: any
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
    createInlineEmbedNode(),
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
      types: ['blockNode'],
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
    LocalMediaPastePlugin.configure({
      editor: opts.editor,
    }),
    // nodes
    Doc,
    BlockChildren.configure({
      domAttributes: opts.domAttributes,
    }),
    ...Object.values(opts.blockSchema).map((blockSpec) => {
      return blockSpec.node.configure({
        editor: opts.editor,
        domAttributes: opts.domAttributes,
      })
    }),
    CustomBlockSerializerExtension,

    HMDropCursor.configure({width: 5, color: '#ddeeff'}),
    // Dropcursor.configure({width: 5, color: '#ddeeff'}),
    HardBreak,
    // This needs to be at the bottom of this list, because Key events (such as enter, when selecting a /command),
    // should be handled before Enter handlers in other components like splitListItem
    TrailingNode,
    BlockNode.configure({
      domAttributes: opts.domAttributes,
    }),
    debugPlugin,
    History,
    Extension.create({
      name: 'BlockHighlightExtension',
      addProseMirrorPlugins: () => [createBlockHighlightPlugin()],
    }),
    Extension.create({
      name: 'ImageGalleryExtension',
      addProseMirrorPlugins: () => [ImageGalleryPlugin],
    }),
  ]

  return ret
}
