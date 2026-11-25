import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared/constants'
import {CONTENT_IMAGE_POLICY, processImageIfSupported, type ImageProcessingPolicy} from '@shm/ui/image-processing'

export async function fileUpload(file: File, imagePolicy: ImageProcessingPolicy = CONTENT_IMAGE_POLICY) {
  const uploadFile = await processImageIfSupported(file, imagePolicy)
  const formData = new FormData()
  formData.append('file', uploadFile)
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
