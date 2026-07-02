import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared/constants'

export async function fileUpload(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  let response: Response
  try {
    response = await fetch(DAEMON_FILE_UPLOAD_URL, {
      method: 'POST',
      body: formData,
    })
  } catch (error: any) {
    throw new Error(error)
  }
  // On failure the daemon returns a non-2xx status with the error in the body.
  // Guard the status before returning it: otherwise the error text is used as
  // the CID and ends up baked into a document as `ipfs://<error message>`.
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`File upload failed (${response.status}): ${body}`)
  }
  return body
}
