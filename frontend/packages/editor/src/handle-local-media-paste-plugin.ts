import {DAEMON_FILE_UPLOAD_URL, IS_PROD_DESKTOP} from '@shm/shared/constants'
import {Extension} from '@tiptap/core'
import {Plugin, PluginKey} from 'prosemirror-state'

type LocalMediaType = 'image' | 'video' | 'file'

type FileAttachmentResult = {
  displaySrc?: string
  url?: string
  fileBinary?: Uint8Array | ArrayBuffer
  mediaRef?:
    | string
    | {
        draftId: string
        mediaId: string
        name: string
        mime: string
        size: number
      }
}

export const LocalMediaPastePlugin = Extension.create({
  name: 'local-media-paste',
  priority: 100,
  addProseMirrorPlugins() {
    const editor = this.options.editor
    return [handleLocalMediaPastePlugin(editor)]
  },
})

const handleLocalMediaPastePlugin = (blockNoteEditor: any) =>
  new Plugin({
    key: new PluginKey('pm-local-media-paste'),
    props: {
      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items || [])
        const files = Array.from(event.clipboardData?.files || [])

        if (items.length === 0 && files.length === 0) {
          return false
        }

        const insertPos =
          view.state.selection.$anchor.parent.type.name !== 'image' && view.state.selection.$anchor.parent.nodeSize <= 2
            ? view.state.selection.$anchor.start() - 2
            : view.state.selection.$anchor.end() + 1

        // Handle direct image file pastes
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const img = item.getAsFile()
            if (img) {
              processMedia(img, view, insertPos, blockNoteEditor, 'image')
              return true
            }
          }
        }

        for (const file of files) {
          if (file.type.startsWith('image/')) {
            processMedia(file, view, insertPos, blockNoteEditor, 'image')
            return true
          }
        }

        const html = event.clipboardData?.getData('text/html') || ''
        const htmlImageSources = extractPastedImageSources(html)
        const firstConvertibleHtmlImageSource = htmlImageSources.find(shouldConvertPastedImageSourceToFile)
        if (firstConvertibleHtmlImageSource) {
          processImageSource(firstConvertibleHtmlImageSource, view, insertPos, blockNoteEditor)
          return true
        }

        // Check for video and other file types
        for (const item of items) {
          if (item.type.startsWith('video/')) {
            const vid = item.getAsFile()
            if (vid) {
              processMedia(vid, view, insertPos, blockNoteEditor, 'video')
              return true
            }
          } else {
            // Other types of files (not image or video)
            const file = item.getAsFile()
            if (file) {
              processMedia(file, view, insertPos, blockNoteEditor, 'file')
              return true
            }
          }
        }

        for (const file of files) {
          if (file.type.startsWith('video/')) {
            processMedia(file, view, insertPos, blockNoteEditor, 'video')
            return true
          }

          processMedia(file, view, insertPos, blockNoteEditor, 'file')
          return true
        }

        return false
      },
    },
  })

/** Extract image URLs from pasted HTML, skipping Seed image blocks that the schema parser handles. */
export function extractPastedImageSources(html: string): string[] {
  if (!html) return []

  const tempEl = document.createElement('div')
  tempEl.innerHTML = html

  return Array.from(tempEl.querySelectorAll('img[src]'))
    .filter((imgEl) => !imgEl.closest('[data-content-type="image"]'))
    .map((imgEl) => imgEl.getAttribute('src') || '')
    .filter(Boolean)
}

/** Whether a pasted HTML image src should be fetched in-renderer and converted into a File. */
export function shouldConvertPastedImageSourceToFile(src: string): boolean {
  return src.startsWith('data:') || src.startsWith('blob:')
}

/** Convert an image URL from pasted HTML into a File that can use the normal media insertion path. */
export async function imageSourceToFile(src: string, now: () => number = Date.now): Promise<File> {
  const response = await fetch(src)
  if (!response.ok) {
    throw new Error(`Image fetch failed with status ${response.status}`)
  }
  const blob = await response.blob()
  const type = blob.type || 'image/png'
  return new File([blob], `pasted-image-${now()}.${extensionForImageType(type)}`, {
    type,
  })
}

function extensionForImageType(type: string): string {
  switch (type) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/svg+xml':
      return 'svg'
    case 'image/bmp':
      return 'bmp'
    case 'image/avif':
      return 'avif'
    default:
      return 'png'
  }
}

function processImageSource(src: string, view: any, insertPos: number, blockNoteEditor: any) {
  imageSourceToFile(src)
    .then((file) => {
      processMedia(file, view, insertPos, blockNoteEditor, 'image')
    })
    .catch((error) => {
      console.error('Error processing pasted HTML image:', error)
    })
}

function processMedia(file: File, view: any, insertPos: number, blockNoteEditor: any, mediaType: LocalMediaType) {
  // Check if we're in a comment editor in the web app
  // Desktop uploads immediately, web stores for later upload
  const isCommentEditor = view.dom.closest('.comment-editor') !== null
  const isDesktop =
    IS_PROD_DESKTOP ||
    (typeof window !== 'undefined' && window.location.protocol === 'file:') ||
    typeof (window as any).appInfo !== 'undefined'
  const shouldStoreMedia = isCommentEditor && !isDesktop

  if (blockNoteEditor?.handleFileAttachment) {
    processMediaWithAttachmentHandler(file, view, insertPos, blockNoteEditor, mediaType)
  } else if (shouldStoreMedia) {
    console.warn('Using legacy binary storage')
    // Fallback to legacy binary storage if handleFileAttachment not available
    const binaryReader = new FileReader()

    binaryReader.onload = (e) => {
      const fileBinary = new Uint8Array(e.target?.result as ArrayBuffer)
      const {name, size} = file
      const {schema} = view.state

      const nodeProps: Record<string, any> = {
        name: name,
        fileBinary: fileBinary,
      }

      if (mediaType === 'file') {
        nodeProps.size = size
      } else {
        // For images and videos, create an object URL for display
        nodeProps.displaySrc = URL.createObjectURL(file)
      }

      // @ts-ignore
      const node = schema.nodes[mediaType].create(nodeProps)
      view.dispatch(view.state.tr.insert(insertPos, node))
    }

    binaryReader.onerror = (error) => {
      console.error(`Error reading pasted ${mediaType} as binary:`, error)
    }

    binaryReader.readAsArrayBuffer(file)
  } else {
    // Desktop editor: upload immediately to IPFS
    uploadMedia(file)
      .then((data) => {
        const {name, size} = file
        const {schema} = view.state

        const nodeProps: Record<string, any> = {
          url: data,
          name: name,
        }
        if (mediaType === 'file') {
          nodeProps.size = size
        }

        // @ts-ignore
        const node = schema.nodes[mediaType].create(nodeProps)
        view.dispatch(view.state.tr.insert(insertPos, node))
      })
      .catch((error) => {
        console.error(`Error uploading pasted ${mediaType}:`, error)
      })
  }
}

function processMediaWithAttachmentHandler(
  file: File,
  view: any,
  insertPos: number,
  blockNoteEditor: any,
  mediaType: LocalMediaType,
) {
  blockNoteEditor
    .handleFileAttachment(file)
    .then((result: FileAttachmentResult) => {
      const nodeProps = createNodePropsFromAttachmentResult(file, result, mediaType)
      const node = view.state.schema.nodes[mediaType].create(nodeProps)
      view.dispatch(view.state.tr.insert(insertPos, node))
    })
    .catch((error: any) => {
      console.error(`Error processing pasted ${mediaType}:`, error)
    })
}

/** Build media node props from a platform-specific file attachment result. */
export function createNodePropsFromAttachmentResult(
  file: File,
  result: FileAttachmentResult,
  mediaType: LocalMediaType,
): Record<string, any> {
  const nodeProps: Record<string, any> = {
    name: file.name,
  }

  if (mediaType === 'file') {
    nodeProps.size = file.size
  }

  if (result.url) {
    nodeProps.url = result.url
    if (mediaType !== 'file') {
      nodeProps.displaySrc = result.displaySrc || ''
    }
    return nodeProps
  }

  if (result.mediaRef) {
    nodeProps.mediaRef = typeof result.mediaRef === 'string' ? result.mediaRef : JSON.stringify(result.mediaRef)
    if (result.fileBinary) {
      nodeProps.fileBinary = result.fileBinary
    }
    if (mediaType !== 'file') {
      nodeProps.displaySrc = result.displaySrc || ''
    }
    return nodeProps
  }

  if (result.fileBinary) {
    nodeProps.fileBinary = result.fileBinary
  }
  if (mediaType !== 'file') {
    nodeProps.displaySrc = result.displaySrc || URL.createObjectURL(file)
  }

  return nodeProps
}

async function uploadMedia(file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`)
  }

  const data = await response.text()
  return `ipfs://${data}`
}
