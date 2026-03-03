import {DAEMON_FILE_UPLOAD_URL, IS_PROD_DESKTOP} from '@shm/shared/constants'
import {Extension} from '@tiptap/core'
import {Plugin, PluginKey} from 'prosemirror-state'

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

        return false
      },
    },
  })

function processMedia(
  file: File,
  view: any,
  insertPos: number,
  blockNoteEditor: any,
  mediaType: 'image' | 'video' | 'file',
) {
  // Check if we're in a comment editor in the web app
  // Desktop uploads immediately, web stores for later upload
  const isCommentEditor = view.dom.closest('.comment-editor') !== null
  const isDesktop =
    IS_PROD_DESKTOP ||
    (typeof window !== 'undefined' && window.location.protocol === 'file:') ||
    typeof (window as any).appInfo !== 'undefined'
  const shouldStoreMedia = isCommentEditor && !isDesktop

  if (shouldStoreMedia) {
    // Comment editor: Store media blobs in IndexedDB for later upload
    const editor = blockNoteEditor

    if (editor?.handleFileAttachment) {
      // Use the editor's handleFileAttachment which handles IndexedDB storage
      editor
        .handleFileAttachment(file)
        .then((result: any) => {
          const {name, size} = file
          const {schema} = view.state

          const nodeProps: Record<string, any> = {
            name: name,
            // Serialize mediaRef object to JSON string for block attribute
            mediaRef: result.mediaRef ? JSON.stringify(result.mediaRef) : '',
          }

          if (mediaType === 'file') {
            // File blocks don't need displaySrc
            nodeProps.fileBinary = result.fileBinary
            nodeProps.size = size
          } else {
            nodeProps.displaySrc = result.displaySrc
            nodeProps.fileBinary = result.fileBinary
          }

          // @ts-ignore
          const node = schema.nodes[mediaType].create(nodeProps)
          view.dispatch(view.state.tr.insert(insertPos, node))
        })
        .catch((error: any) => {
          console.error(`Error processing pasted ${mediaType}:`, error)
        })
    } else {
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
    }
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
