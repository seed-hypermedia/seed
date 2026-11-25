import {useEffect} from 'react'

function isUnhandledFileDrag(event: DragEvent) {
  return !event.defaultPrevented && Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/** Prevents external file drags from navigating away when no child drop zone handles them. */
export function FileDropGuard() {
  useEffect(() => {
    const preventUnhandledFileDrop = (event: DragEvent) => {
      if (!isUnhandledFileDrag(event)) return

      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    }

    window.addEventListener('dragover', preventUnhandledFileDrop)
    window.addEventListener('drop', preventUnhandledFileDrop)
    return () => {
      window.removeEventListener('dragover', preventUnhandledFileDrop)
      window.removeEventListener('drop', preventUnhandledFileDrop)
    }
  }, [])

  return null
}
