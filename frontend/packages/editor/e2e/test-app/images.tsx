import './tailwind.css'
import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {FileDropGuard} from '@shm/ui/file-drop-guard'
import {ImageCropDialog} from '@shm/ui/image-crop-dialog'
import * as processing from '@shm/ui/image-processing'
import * as cropping from '@shm/ui/image-crop'

Object.assign(window, {TEST_IMAGE_PROCESSING: processing, TEST_IMAGE_CROPPING: cropping})

function ImageUploadHarness() {
  const [source, setSource] = useState<File | null>(null)
  const [result, setResult] = useState('No image uploaded')
  return (
    <>
      <FileDropGuard />
      <label>
        Select image
        <input type="file" onChange={(event) => setSource(event.target.files?.[0] ?? null)} />
      </label>
      <output>{result}</output>
      <ImageCropDialog
        input={
          source
            ? {
                file: source,
                aspect: 1,
                maxDimension: 1024,
                onCropped: async ({file}) => {
                  const uploaded = await processing.processImage(file, processing.AVATAR_IMAGE_POLICY)
                  const bitmap = await createImageBitmap(uploaded)
                  setResult(`${bitmap.width}×${bitmap.height}; unchanged=${uploaded === file}`)
                  bitmap.close()
                },
              }
            : null
        }
        onClose={() => setSource(null)}
      />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<ImageUploadHarness />)
