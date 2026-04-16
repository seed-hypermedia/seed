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
import {createSupernumbersPlugin} from './extensions/Supernumbers/SupernumbersPlugin'
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
  const isEmbed = opts.editor.renderType === 'embed'

  const ret: Extensions = [
    createInlineEmbedNode(),
    extensions.ClipboardTextSerializer,
    extensions.Commands,
    extensions.Editable,
    extensions.FocusEvents,
    extensions.Tabindex,

    UniqueID.configure({
      types: ['blockNode'],
    }),

    // basics:
    Text,

    // marks:
    Bold,
    Code,
    Italic,
    Strike,
    Underline,
    Link.configure(opts.linkExtensionOptions),

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

    HardBreak,
    BlockNode.configure({
      domAttributes: opts.domAttributes,
    }),
  ]

  const isViewer = opts.editor.renderType === 'viewer'

  // Viewer + Document: read-only UI plugins (BlockHighlight, ImageGallery, Supernumbers)
  if (!isEmbed) {
    ret.push(
      Extension.create({
        name: 'BlockHighlightExtension',
        addProseMirrorPlugins: () => [createBlockHighlightPlugin()],
      }),
      Extension.create({
        name: 'ImageGalleryExtension',
        addProseMirrorPlugins: () => [ImageGalleryPlugin],
      }),
      Extension.create({
        name: 'SupernumbersExtension',
        addProseMirrorPlugins: () => [createSupernumbersPlugin()],
      }),
    )
  }

  // Document/Comment only: editing extensions (skip for viewer + embed)
  if (!isEmbed && !isViewer) {
    ret.push(
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

      // copy paste:
      // @ts-ignore
      createMarkdownExtension(opts.editor),

      // block manipulations:
      BlockManipulationExtension,
      KeyboardShortcutsExtension.configure({editor: opts.editor}),

      LocalMediaPastePlugin.configure({
        editor: opts.editor,
      }),

      HMDropCursor.configure({width: 5, color: '#ddeeff'}),

      // This needs to be at the bottom of this list, because Key events (such as enter, when selecting a /command),
      // should be handled before Enter handlers in other components like splitListItem
      TrailingNode,
      debugPlugin,
      History,
    )
  }

  return ret
}
