import type {BlockSchema} from '@shm/editor/blocknote'
import type {Block as BNBlock} from '@shm/editor/blocknote/core/extensions/Blocks/api/blockTypes'
import {HMBlockChildrenTypeSchema} from '@shm/shared'
import {editorBlockToHMBlock} from '@shm/shared/client/editorblock-to-hmblock'
import {Block, BlockNode} from '@shm/shared/client/grpc-types'
import {EditorBlock} from '@shm/shared/editor-types'
import {toast} from '@shm/ui/toast'
import {Editor} from '@tiptap/core'
import {Node as TipTapNode} from '@tiptap/pm/model'
import {EditorView} from '@tiptap/pm/view'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import type {BlockIdentifier} from './blocknote/core/extensions/Blocks/api/blockTypes'

export function youtubeParser(url: string) {
  var regExp =
    /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/
  var match = url.match(regExp)
  // @ts-ignore
  return match && match[7].length == 11 ? match[7] : false
}

export function isValidUrl(urlString: string) {
  try {
    return Boolean(new URL(urlString))
  } catch (e) {
    console.log(e)
    return false
  }
}

export function camelToFlat(camel: string) {
  const camelCase = camel.replace(/([a-z])([A-Z])/g, '$1 $2')

  return camelCase
}

// @ts-expect-error
export const timeoutPromise = (promise, delay, reason) =>
  Promise.race([
    promise,
    new Promise((resolve, reject) =>
      setTimeout(
        () => (reason === undefined ? resolve(null) : reject(reason)),
        delay,
      ),
    ),
  ])

export function setGroupTypes(
  tiptap: Editor,
  blocks: Array<Partial<BNBlock<BlockSchema>>>,
) {
  blocks.forEach((block: Partial<BNBlock<BlockSchema>>) => {
    tiptap.state.doc.descendants((node: TipTapNode, pos: number) => {
      if (
        node.attrs.id === block.id &&
        block.props &&
        block.props.childrenType
      ) {
        // @ts-ignore
        node.descendants((child: TipTapNode, childPos: number) => {
          if (child.type.name === 'blockGroup') {
            setTimeout(() => {
              let tr = tiptap.state.tr
              tr = block.props?.start
                ? tr.setNodeMarkup(pos + childPos + 1, null, {
                    listType: block.props?.childrenType,
                    listLevel: block.props?.listLevel,
                    start: parseInt(block.props?.start),
                  })
                : tr.setNodeMarkup(pos + childPos + 1, null, {
                    listType: block.props?.childrenType,
                    listLevel: block.props?.listLevel,
                  })
              tiptap.view.dispatch(tr)
            })
            return false
          }
        })
      }
    })
    if (block.children) {
      setGroupTypes(tiptap, block.children)
    }
  })
}

export function getNodesInSelection(view: EditorView) {
  const {state} = view
  const {from, to} = state.selection
  const nodes: TipTapNode[] = []

  state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'blockContainer') {
      nodes.push(node)
    }
  })

  return nodes
}

export function getBlockGroup(
  editor: BlockNoteEditor,
  blockId: BlockIdentifier,
): undefined | {type: string; listLevel: string; start?: number} {
  const tiptap = editor?._tiptapEditor
  if (tiptap) {
    const id = typeof blockId === 'string' ? blockId : blockId.id
    let group: {type: string; listLevel: string; start?: number} | undefined
    tiptap.state.doc.firstChild!.descendants((node: TipTapNode) => {
      if (typeof group !== 'undefined') {
        return false
      }

      if (node.attrs.id !== id) {
        return true
      }

      node.descendants((child: TipTapNode) => {
        if (child.attrs.listType && child.type.name === 'blockGroup') {
          group = {
            type: child.attrs.listType,
            start: child.attrs.start,
            listLevel: child.attrs.listLevel,
          } as const
          return false
        }
        return true
      })

      return true
    })
    return group
  }

  return undefined
}

export function serverBlockNodesFromEditorBlocks(
  editor: BlockNoteEditor,
  editorBlocks: EditorBlock[],
): BlockNode[] {
  if (!editorBlocks) return []
  return editorBlocks.map((block: EditorBlock) => {
    const childGroup = getBlockGroup(editor, block.id)
    const serverBlock = editorBlockToHMBlock(block)
    if (childGroup) {
      // @ts-expect-error
      if (!serverBlock.attributes) {
        // @ts-expect-error
        serverBlock.attributes = {}
      }
      const childrenType = HMBlockChildrenTypeSchema.safeParse(childGroup.type)
      if (childrenType.success) {
        // @ts-expect-error
        serverBlock.attributes.childrenType = childrenType.data
      } else {
        // @ts-expect-error
        serverBlock.attributes.childrenType = 'Group'
      }
      if (childGroup.start)
        // @ts-expect-error
        serverBlock.attributes.start = childGroup.start.toString()
    }
    return new BlockNode({
      block: Block.fromJson(serverBlock),
      children: serverBlockNodesFromEditorBlocks(editor, block.children),
    })
  })
}

type FileType = {
  id: string
  props: {
    displaySrc: string
    name: string
    size: string
    fileBinary?: Uint8Array
    mediaRef?: {
      draftId: string
      mediaId: string
      name: string
      mime: string
      size: number
    }
  }
  children: []
  content: []
  type: string
}

export async function handleDragMedia(
  file: File,
  handleFileAttachment?: (file: File) => Promise<{
    displaySrc: string
    fileBinary?: Uint8Array
    mediaRef?: {
      draftId: string
      mediaId: string
      name: string
      mime: string
      size: number
    }
  }>,
) {
  if (file.size > 62914560) {
    toast.error(`The size of ${file.name} exceeds 60 MB.`)
    return null
  }

  if (handleFileAttachment) {
    const result = await handleFileAttachment(file)

    // Use metadata from mediaRef if available, otherwise fall back to file object
    const name = result.mediaRef?.name || file.name
    const size = result.mediaRef?.size || file.size

    return {
      displaySrc: result.displaySrc,
      fileBinary: result.fileBinary,
      mediaRef: result.mediaRef,
      name: name,
      size: size.toString(),
    } as FileType['props']
  }
  return
}

export function generateBlockId(length: number = 8): string {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return result
}

export const chromiumSupportedImageMimeTypes = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/apng',
  'image/avif',
])

export const chromiumSupportedVideoMimeTypes = new Set([
  'video/mp4',
  'video/webm',
])

export function removeTrailingBlocks(blocks: Array<EditorBlock>) {
  let trailedBlocks = [...blocks]
  while (true) {
    let lastBlock = trailedBlocks[trailedBlocks.length - 1]
    if (!lastBlock) break
    if (
      lastBlock.type == 'paragraph' &&
      lastBlock.content.length == 0 &&
      lastBlock.children.length == 0
    ) {
      trailedBlocks.pop()
    } else {
      break
    }
  }
  return trailedBlocks
}
