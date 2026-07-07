import {useEffect} from 'react'

export function useBlockBorderDebug() {
  useEffect(() => {
    const handleDebugToggle = (e: KeyboardEvent) => {
      if (e.key !== 'D' && e.key !== 'd') return
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return
      e.preventDefault()
      const html = document.documentElement
      html.dataset.debugBlocks = html.dataset.debugBlocks === '1' ? '' : '1'
    }
    document.addEventListener('keydown', handleDebugToggle)
    return () => document.removeEventListener('keydown', handleDebugToggle)
  }, [])
}
