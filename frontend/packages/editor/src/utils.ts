import {BlockNoteEditor} from '@/blocknote/core/BlockNoteEditor'
import type {BlockIdentifier} from '@/blocknote/core/extensions/Blocks/api/blockTypes'
import type {BlockSchema} from '@shm/editor/blocknote'
import type {Block as BNBlock} from '@shm/editor/blocknote/core/extensions/Blocks/api/blockTypes'
import {HMBlockChildrenTypeSchema} from '@shm/shared'
import {editorBlockToHMBlock} from '@shm/shared/client/editorblock-to-hmblock'
import {Block, BlockNode} from '@shm/shared/client/grpc-types'
import {EditorBlock} from '@shm/shared/editor-types'
import {Editor} from '@tiptap/core'
import {Node as TipTapNode} from '@tiptap/pm/model'
import {EditorView} from '@tiptap/pm/view'
import {toast} from '../../ui/src/toast'

export function youtubeParser(url: string) {
  var regExp =
    /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/
  var match = url.match(regExp)
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
      if (!serverBlock.attributes) {
        serverBlock.attributes = {}
      }
      const childrenType = HMBlockChildrenTypeSchema.safeParse(childGroup.type)
      if (childrenType.success) {
        serverBlock.attributes.childrenType = childrenType.data
      } else {
        serverBlock.attributes.childrenType = 'Group'
      }
      if (childGroup.start)
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
    fileBinary: Uint8Array
  }
  children: []
  content: []
  type: string
}

export async function handleDragMedia(
  file: File,
  handleFileAttachment?: (
    file: File,
  ) => Promise<{displaySrc: string; fileBinary: Uint8Array}>,
) {
  if (file.size > 62914560) {
    toast.error(`The size of ${file.name} exceeds 60 MB.`)
    return null
  }

  if (handleFileAttachment) {
    const {displaySrc, fileBinary} = await handleFileAttachment(file)
    console.log('displaySrc', displaySrc, fileBinary)

    const {name, size} = file

    console.log({
      fileBinary,
      displaySrc,
      name,
      size: size.toString(),
    })

    return {
      displaySrc: displaySrc,
      fileBinary: fileBinary,
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
