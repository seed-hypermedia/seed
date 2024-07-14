import {API_FILE_UPLOAD_URL} from '@shm/shared'

export async function fileUpload(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  let response: Response
  try {
    response = await fetch(API_FILE_UPLOAD_URL, {
      method: 'POST',
      body: formData,
    })
    return await response.text()
  } catch (error: any) {
    throw new Error(error)
  }
}
