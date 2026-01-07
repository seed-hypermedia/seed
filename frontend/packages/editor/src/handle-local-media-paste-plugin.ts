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

        if (items.length === 0 && files.length === 0) return false

        const insertPos =
          view.state.selection.$anchor.parent.type.name !== 'image' &&
          view.state.selection.$anchor.parent.nodeSize <= 2
            ? view.state.selection.$anchor.start() - 2
            : view.state.selection.$anchor.end() + 1

        // Check if there are any images in the clipboard
        let hasProcessed = false

        // Try to find images from the clipboard items
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const img = item.getAsFile()
            if (img) {
              hasProcessed = true
              processImage(img, view, insertPos, blockNoteEditor)
              return true
            }
          }
        }

        // If no images found, check if any items have representation as images
        if (!hasProcessed) {
          for (const item of items) {
            // Handle pasted images from the web by trying to get an image representation
            if (item.type === 'text/html') {
              // Get HTML representation to extract images
              // @ts-ignore
              item.getAsString((html) => {
                const tempEl = document.createElement('div')
                tempEl.innerHTML = html
                const images = tempEl.querySelectorAll('img')

                if (images.length > 0) {
                  for (const imgEl of Array.from(images)) {
                    // Skip images that are inside an image block container
                    // They are handled by parseHTML rule
                    if (imgEl.closest('[data-content-type="image"]')) {
                      continue
                    }
                    const src = imgEl.getAttribute('src')
                    if (src) {
                      // Check if it's a data URL (base64 image)
                      if (src.startsWith('data:')) {
                        // Convert data URL to blob
                        fetch(src)
                          .then((response) => response.blob())
                          .then((blob) => {
                            const imgFile = new File(
                              [blob],
                              `pasted-image-${Date.now()}.png`,
                              {
                                type: blob.type || 'image/png',
                              },
                            )
                            processImage(
                              imgFile,
                              view,
                              insertPos,
                              blockNoteEditor,
                            )
                          })
                          .catch((error) => {
                            console.error('Error processing data URL:', error)
                          })
                        hasProcessed = true
                      } else {
                        // Fetch the image from the URL
                        fetch(src)
                          .then((response) => response.blob())
                          .then((blob) => {
                            const imgFile = new File(
                              [blob],
                              `pasted-image-${Date.now()}.png`,
                              {
                                type: blob.type || 'image/png',
                              },
                            )
                            processImage(
                              imgFile,
                              view,
                              insertPos,
                              blockNoteEditor,
                            )
                          })
                          .catch((error) => {
                            console.error(
                              'Error fetching image from web paste:',
                              error,
                            )
                          })

                        hasProcessed = true
                      }
                    }
                  }
                  if (hasProcessed) return true
                }
              })
            }
          }
        }

        // Check for video and other file types
        for (const item of items) {
          if (item.type.startsWith('video/')) {
            const vid = item.getAsFile()
            if (vid) {
              uploadMedia(vid)
                .then((data) => {
                  const {name} = vid
                  const {schema} = view.state
                  // @ts-ignore
                  const node = schema.nodes.video.create({
                    url: data,
                    name: name,
                  })
                  view.dispatch(view.state.tr.insert(insertPos, node))
                })
                .catch((error) => {
                  console.error('Error uploading pasted video:', error)
                })
              return true
            }
          } else {
            // Other types of files (not image or video)
            const file = item.getAsFile()
            if (file) {
              uploadMedia(file)
                .then((data) => {
                  const {name, size} = file
                  // @ts-ignore
                  const node = view.state.schema.nodes.file.create({
                    url: data,
                    name: name,
                    size: size,
                  })
                  view.dispatch(view.state.tr.insert(insertPos, node))
                })
                .catch((error) => {
                  console.error('Error uploading pasted file:', error)
                })
              return true
            }
          }
        }

        return false
      },
    },
  })

function processImage(
  img: File,
  view: any,
  insertPos: number,
  blockNoteEditor: any,
) {
  // Check if we're in a comment editor in the web app
  // Desktop uploads immediately, web stores for later upload
  const isCommentEditor = view.dom.closest('.comment-editor') !== null
  const isDesktop =
    IS_PROD_DESKTOP ||
    (typeof window !== 'undefined' && window.location.protocol === 'file:') ||
    typeof (window as any).appInfo !== 'undefined'
  const shouldStoreForLater = isCommentEditor && !isDesktop

  if (shouldStoreForLater) {
    // Comment editor: Store media blobs in IndexedDB for later upload
    const editor = blockNoteEditor

    if (editor?.handleFileAttachment) {
      // Use the editor's handleFileAttachment which handles IndexedDB storage
      editor
        .handleFileAttachment(img)
        .then((result: any) => {
          const {name} = img
          const {schema} = view.state
          const node = schema.nodes.image.create({
            displaySrc: result.displaySrc,
            fileBinary: result.fileBinary,
            // Serialize mediaRef object to JSON string for block attribute
            mediaRef: result.mediaRef ? JSON.stringify(result.mediaRef) : '',
            name: name,
          })
          view.dispatch(view.state.tr.insert(insertPos, node))
        })
        .catch((error: any) => {
          console.error('Error processing pasted image:', error)
        })
    } else {
      // Fallback to legacy binary storage if handleFileAttachment not available
      const displayReader = new FileReader()
      const binaryReader = new FileReader()

      let displaySrc: string
      let fileBinary: Uint8Array

      displayReader.onload = (e) => {
        displaySrc = e.target?.result as string
        binaryReader.readAsArrayBuffer(img)
      }

      binaryReader.onload = (e) => {
        fileBinary = new Uint8Array(e.target?.result as ArrayBuffer)

        const {name} = img
        const {schema} = view.state
        const node = schema.nodes.image.create({
          displaySrc: displaySrc,
          fileBinary: fileBinary,
          name: name,
        })
        view.dispatch(view.state.tr.insert(insertPos, node))
      }

      displayReader.onerror = (error) => {
        console.error('Error reading pasted image as data URL:', error)
      }
      binaryReader.onerror = (error) => {
        console.error('Error reading pasted image as binary:', error)
      }

      displayReader.readAsDataURL(img)
    }
  } else {
    // Desktop editor: upload immediately to IPFS
    uploadMedia(img)
      .then((data) => {
        const {name} = img
        const {schema} = view.state
        const node = schema.nodes.image.create({
          url: data,
          name: name,
        })
        view.dispatch(view.state.tr.insert(insertPos, node))
      })
      .catch((error) => {
        console.error('Error uploading pasted image:', error)
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
