import { DAEMON_FILE_UPLOAD_URL } from '@shm/shared/constants'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'

export const LocalMediaPastePlugin = Extension.create({
  name: 'local-media-paste',
  priority: 100,
  addProseMirrorPlugins() {
    return [handleLocalMediaPastePlugin]
  },
})

const handleLocalMediaPastePlugin = new Plugin({
  key: new PluginKey('pm-local-media-paste'),
  props: {
    handlePaste(view, event) {
      // First check for files from the filesystem
      const items = Array.from(event.clipboardData?.items || [])
      if (items.length === 0) return false

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
          // This is an image type
          const img = item.getAsFile()
          if (img) {
            hasProcessed = true
            processImage(img, view, insertPos)
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
                        processImage(imgFile, view, insertPos)
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
                console.log(error)
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
                console.log(error)
              })
            return true
          }
        }
      }

      return false
    },
  },
})

function processImage(img: File, view: any, insertPos: number) {
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

async function uploadMedia(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
    method: 'POST',
    body: formData,
  })
  const data = await response.text()
  return `ipfs://${data}`
}
