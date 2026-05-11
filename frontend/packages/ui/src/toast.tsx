import {useEffect, useState} from 'react'
import {Toaster as Sonner, ToasterProps} from 'sonner'
import 'sonner/dist/styles.css'

export {toast} from 'sonner'

// Universal theme hook: observe `dark` class on <html> (works for both next-themes
// in desktop and the manual class toggle in web).
const useUniversalTheme = () => {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')

  useEffect(() => {
    if (typeof document === 'undefined') return
    const readTheme = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    setTheme(readTheme())
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          setTheme(readTheme())
        }
      }
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [])

  return {theme}
}

const Toaster = ({...props}: ToasterProps) => {
  const {theme = 'system'} = useUniversalTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export {Toaster}
