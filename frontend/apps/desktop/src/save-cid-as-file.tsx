import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {toast} from '@shm/ui/toast'
import {app, dialog, net} from 'electron'
import fs from 'fs'
import mime from 'mime'
import path from 'path'

const {debug, error} = console

// @ts-expect-error
export async function saveCidAsFile(event, args) {
  const {cid, name} = args
  const request = net.request(`${DAEMON_HTTP_URL}/ipfs/${cid}`)
  debug('Saving cid to ' + app.getPath('downloads'))
  request.on('response', (response) => {
    if (response.statusCode === 200) {
      const chunks: Buffer[] = []

      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      response.on('end', async () => {
        const data = Buffer.concat(chunks)

        let finalName = name || 'File'

        // Add file extension if the filename doesn't have one
        if (!path.extname(finalName)) {
          debug('No extension found in filename:', finalName)

          // Try to get extension from content-type header
          const contentType =
            (response.headers['content-type'] as string) ||
            (response.headers['Content-Type'] as string) ||
            ''

          debug('Content-Type from IPFS:', contentType)

          let ext: string | null = null

          // Try to get extension from MIME type
          if (
            contentType &&
            contentType !== 'application/octet-stream' &&
            !contentType.startsWith('application/octet-stream')
          ) {
            ext = mime.getExtension(contentType)
            debug('Extension from MIME type:', ext)
          }

          if (ext) {
            finalName += `.${ext}`
            debug('Final filename with extension:', finalName)
          } else {
            debug('Could not determine file extension, using filename as-is')
          }
        } else {
          debug('Filename already has extension:', finalName)
        }

        const {filePath, canceled} = await dialog.showSaveDialog({
          defaultPath: path.join(app.getPath('downloads'), finalName),
        })

        if (!canceled && filePath) {
          try {
            fs.writeFileSync(filePath, data)
            toast.success(`Successfully downloaded file ${finalName}`)
          } catch (e) {
            toast.error(`Failed to download file ${finalName}`)
            console.error(e)
          }
        }
      })
    } else {
      error('Error: Invalid status code', response.statusCode)
    }
  })

  request.on('error', (err) => {
    error('Error:', err.message)
  })

  request.end()
}
