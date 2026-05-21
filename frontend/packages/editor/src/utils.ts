import type {BlockSchema} from '@shm/editor/blocknote'
import type {Block as BNBlock} from '@shm/editor/blocknote/core/extensions/Blocks/api/blockTypes'
import {HMBlockChildrenTypeSchema} from '@seed-hypermedia/client/hm-types'
import {editorBlockToHMBlock} from '@seed-hypermedia/client/editorblock-to-hmblock'
import {DAEMON_FILE_UPLOAD_URL, MAX_FILE_SIZE_B, MAX_FILE_SIZE_MB} from '@shm/shared/constants'
import {Block, BlockNode} from '@shm/shared/client/grpc-types'
import {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {toast} from '@shm/ui/toast'
import {Editor} from '@tiptap/core'
import {Node as TipTapNode} from '@tiptap/pm/model'
import {AllSelection} from '@tiptap/pm/state'
import {EditorView} from '@tiptap/pm/view'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import type {BlockIdentifier} from './blocknote/core/extensions/Blocks/api/blockTypes'

export function youtubeParser(url: string) {
  var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/
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

/** Selects the full ProseMirror document, including trailing non-editable blocks. */
export function selectAllEditorContent(editor: Pick<Editor, 'view'>): boolean {
  const {view} = editor
  if (!view) return false

  view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)).scrollIntoView())
  view.focus()
  return true
}

// @ts-expect-error
export const timeoutPromise = (promise, delay, reason) =>
  Promise.race([
    promise,
    new Promise((resolve, reject) => setTimeout(() => (reason === undefined ? resolve(null) : reject(reason)), delay)),
  ])

export function setGroupTypes(tiptap: Editor, blocks: Array<Partial<BNBlock<BlockSchema>>>) {
  blocks.forEach((block: Partial<BNBlock<BlockSchema>>) => {
    tiptap.state.doc.descendants((node: TipTapNode, pos: number) => {
      if (node.attrs.id === block.id && block.props && block.props.childrenType) {
        // @ts-ignore
        node.descendants((child: TipTapNode, childPos: number) => {
          if (child.type.name === 'blockChildren') {
            setTimeout(() => {
              let tr = tiptap.state.tr
              const attrs: Record<string, any> = {
                listType: block.props?.childrenType,
                listLevel: block.props?.listLevel,
              }
              if (block.props?.start) {
                attrs.start = parseInt(block.props.start)
              }
              if (block.props?.childrenType === 'Grid' && (block.props as any)?.columnCount) {
                attrs.columnCount = (block.props as any).columnCount
              }
              tr = tr.setNodeMarkup(pos + childPos + 1, null, attrs)
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
    if (node.type.name === 'blockNode') {
      nodes.push(node)
    }
  })

  return nodes
}

export function getBlockGroup(
  editor: BlockNoteEditor,
  blockId: BlockIdentifier,
): undefined | {type: string; listLevel: string; start?: number; columnCount?: string} {
  const tiptap = editor?._tiptapEditor
  if (tiptap) {
    const id = typeof blockId === 'string' ? blockId : blockId.id
    let group: {type: string; listLevel: string; start?: number; columnCount?: string} | undefined
    tiptap.state.doc.firstChild!.descendants((node: TipTapNode) => {
      if (typeof group !== 'undefined') {
        return false
      }

      if (node.attrs.id !== id) {
        return true
      }

      node.descendants((child: TipTapNode) => {
        if (child.attrs.listType && child.type.name === 'blockChildren') {
          group = {
            type: child.attrs.listType,
            start: child.attrs.start,
            listLevel: child.attrs.listLevel,
            columnCount: child.attrs.columnCount,
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

export function serverBlockNodesFromEditorBlocks(editor: BlockNoteEditor, editorBlocks: EditorBlock[]): BlockNode[] {
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
      if (childGroup.columnCount)
        // @ts-expect-error
        serverBlock.attributes.columnCount = parseInt(childGroup.columnCount)
    }
    const blockNode = new BlockNode({
      block: Block.fromJson(serverBlock),
      children: serverBlockNodesFromEditorBlocks(editor, block.children),
    })
    return blockNode
  })
}

type FileType = {
  id: string
  props: {
    displaySrc: string
    url?: string
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
    url?: string
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
  if (file.size > MAX_FILE_SIZE_B) {
    toast.error(`The size of ${file.name} exceeds ${MAX_FILE_SIZE_MB} MB.`)
    return null
  }

  if (handleFileAttachment) {
    const result = await handleFileAttachment(file)

    // Use metadata from mediaRef if available, otherwise fall back to file object
    const name = result.mediaRef?.name || file.name
    const size = result.mediaRef?.size || file.size

    return {
      displaySrc: result.displaySrc,
      url: result.url,
      fileBinary: result.fileBinary,
      mediaRef: result.mediaRef,
      name: name,
      size: size.toString(),
    } as FileType['props']
  }

  const formData = new FormData()
  formData.append('file', file)

  try {
    const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
      method: 'POST',
      body: formData,
    })
    const data = await response.text()
    return {
      url: data ? `ipfs://${data}` : '',
      name: file.name,
      size: file.size.toString(),
    } as FileType['props']
  } catch (error) {
    // @ts-expect-error
    console.log(error.message)
    toast.error('Failed to upload file.')
    return null
  }
}

/** Builds a media block payload from prepared file attachment data. */
export function createMediaBlock(file: File, props: Awaited<ReturnType<typeof handleDragMedia>>) {
  if (!props) return null

  const newId = generateBlockId()
  const serializedMediaRef = props.mediaRef ? JSON.stringify(props.mediaRef) : ''

  if (props.url && !props.fileBinary && !props.mediaRef) {
    if (chromiumSupportedImageMimeTypes.has(file.type)) {
      return {
        id: newId,
        type: 'image',
        props: {
          url: props.url,
          name: props.name,
        },
      }
    }

    if (chromiumSupportedVideoMimeTypes.has(file.type)) {
      return {
        id: newId,
        type: 'video',
        props: {
          url: props.url,
          name: props.name,
        },
      }
    }

    return {
      id: newId,
      type: 'file',
      props: {
        url: props.url,
        name: props.name,
        size: props.size,
      },
    }
  }

  if (chromiumSupportedImageMimeTypes.has(file.type)) {
    return {
      id: newId,
      type: 'image',
      props: {
        displaySrc: props.displaySrc,
        fileBinary: props.fileBinary,
        mediaRef: serializedMediaRef,
        name: props.name,
      },
    }
  }

  if (chromiumSupportedVideoMimeTypes.has(file.type)) {
    return {
      id: newId,
      type: 'video',
      props: {
        displaySrc: props.displaySrc,
        fileBinary: props.fileBinary,
        mediaRef: serializedMediaRef,
        name: props.name,
      },
    }
  }

  return {
    id: newId,
    type: 'file',
    props: {
      fileBinary: props.fileBinary,
      mediaRef: serializedMediaRef,
      name: props.name,
      size: props.size,
      ...(props.url ? {url: props.url} : {}),
    },
  }
}

export function generateBlockId(length: number = 8): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
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

export const chromiumSupportedVideoMimeTypes = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'])

export function removeTrailingBlocks(blocks: Array<EditorBlock>) {
  let trailedBlocks = [...blocks]
  while (true) {
    let lastBlock = trailedBlocks[trailedBlocks.length - 1]
    if (!lastBlock) break
    if (lastBlock.type == 'paragraph' && lastBlock.content.length == 0 && lastBlock.children.length == 0) {
      trailedBlocks.pop()
    } else {
      break
    }
  }
  return trailedBlocks
}
