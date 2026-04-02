import {Node} from 'prosemirror-model'
import {Plugin, PluginKey} from 'prosemirror-state'

/** ProseMirror plugin key for the image gallery plugin. */
export const imageGalleryPluginKey = new PluginKey<ImageGalleryState>('imageGalleryPlugin')

/** A single image item collected from the document. */
export type ImageGalleryItem = {
  /** The block identifier from the parent blockNode's `id` attribute. */
  blockId: string
  /** The image URL (may be an IPFS URI or an HTTP URL). */
  url: string
  /** Optional display name for the image. */
  name?: string
}

/** Plugin state managed by the image gallery plugin. */
export type ImageGalleryState = {
  /** Whether the gallery overlay is currently open. */
  isOpen: boolean
  /** All image blocks collected from the document in DFS order. */
  images: ImageGalleryItem[]
  /** Index into `images` of the currently viewed image. */
  activeIndex: number
}

/** Union of all actions the plugin accepts via `tr.setMeta`. */
type ImageGalleryAction =
  | {type: 'open'; blockId: string}
  | {type: 'next'}
  | {type: 'prev'}
  | {type: 'close'}
  | {type: 'setImages'; images: ImageGalleryItem[]}

const defaultState: ImageGalleryState = {
  isOpen: false,
  images: [],
  activeIndex: 0,
}

/**
 * Traverses a ProseMirror document in DFS order and collects all image blocks.
 *
 * The expected node structure is:
 *   blockNode (attrs: {id}) > image (attrs: {url, name})
 *
 * Only image nodes with a non-empty `url` attribute are included.
 */
export function collectImageBlocks(doc: Node): ImageGalleryItem[] {
  const result: ImageGalleryItem[] = []

  doc.descendants((node, _pos, parent) => {
    if (node.type.name === 'image') {
      const url: string = node.attrs.url ?? ''
      if (!url) return false

      const blockId: string = parent?.attrs?.id ?? ''
      const name: string | undefined = node.attrs.name || undefined

      result.push({blockId, url, name})
      // Do not descend into image nodes.
      return false
    }
    return true
  })

  return result
}

/**
 * ProseMirror plugin that maintains an image gallery state and handles
 * double-click events on image nodes when the editor is in read-only mode.
 *
 * Actions are dispatched via `tr.setMeta(imageGalleryPluginKey, action)`.
 * The React overlay component reads state with
 * `imageGalleryPluginKey.getState(view.state)`.
 */
export const ImageGalleryPlugin = new Plugin<ImageGalleryState>({
  key: imageGalleryPluginKey,

  state: {
    init(_config, state): ImageGalleryState {
      return {
        ...defaultState,
        images: collectImageBlocks(state.doc),
      }
    },

    apply(tr, pluginState): ImageGalleryState {
      const action = tr.getMeta(imageGalleryPluginKey) as ImageGalleryAction | undefined

      // Keep images in sync when the document changes.
      const nextImages = tr.docChanged ? collectImageBlocks(tr.doc) : pluginState.images

      if (!action) {
        if (!tr.docChanged) return pluginState
        return {...pluginState, images: nextImages}
      }

      switch (action.type) {
        case 'open': {
          const idx = nextImages.findIndex((img) => img.blockId === action.blockId)
          if (idx === -1) return {...pluginState, images: nextImages}
          return {isOpen: true, images: nextImages, activeIndex: idx}
        }

        case 'next': {
          const next = Math.min(pluginState.activeIndex + 1, nextImages.length - 1)
          return {...pluginState, images: nextImages, activeIndex: next}
        }

        case 'prev': {
          const prev = Math.max(pluginState.activeIndex - 1, 0)
          return {...pluginState, images: nextImages, activeIndex: prev}
        }

        case 'close': {
          return {...pluginState, images: nextImages, isOpen: false}
        }

        case 'setImages': {
          return {...pluginState, images: action.images}
        }
      }
    },
  },

  props: {
    handleDoubleClickOn(view, _pos, node, _nodePos, _event) {
      if (node.type.name !== 'image') return false

      const url: string = node.attrs.url ?? ''
      if (!url) return false

      // Find the blockId from the parent blockNode. We resolve position of
      // the image node and walk up to find the blockNode.
      const $pos = view.state.doc.resolve(_nodePos)
      let blockId = ''
      for (let d = $pos.depth; d >= 0; d--) {
        const ancestor = $pos.node(d)
        if (ancestor.type.name === 'blockNode') {
          blockId = ancestor.attrs.id ?? ''
          break
        }
      }

      if (!blockId) return false

      view.dispatch(view.state.tr.setMeta(imageGalleryPluginKey, {type: 'open', blockId} satisfies ImageGalleryAction))
      return true
    },
  },
})
