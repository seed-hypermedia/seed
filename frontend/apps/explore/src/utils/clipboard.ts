import {showToast} from './toast'

export async function copyToClipboardWithToast(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(`Copied: ${text}`)
  } catch (err) {
    console.error('Failed to copy text:', err)
  }
}
