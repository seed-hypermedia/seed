import {useEffect, useState} from 'react'
import {Toaster as Sonner, ToasterProps} from 'sonner'
import 'sonner/dist/styles.css'

export {toast} from 'sonner'

// Universal theme hook that works in both Next.js and non-Next.js environments
const useUniversalTheme = () => {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')

  useEffect(() => {
    // Check if we're in a Next.js environment with next-themes
    if (typeof window !== 'undefined' && (window as any).__NEXT_DATA__) {
      // Next.js environment (desktop app)
      try {
        const {useTheme} = require('next-themes')
        const nextTheme = useTheme()
        setTheme(nextTheme.theme || 'system')
      } catch (e) {
        // Fallback if next-themes is not available
        setTheme('system')
      }
    } else {
      // Non-Next.js environment (web app)
      // Check for dark class on document element
      const isDark = document.documentElement.classList.contains('dark')
      setTheme(isDark ? 'dark' : 'light')

      // Watch for theme changes
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (
            mutation.type === 'attributes' &&
            mutation.attributeName === 'class'
          ) {
            const isDark = document.documentElement.classList.contains('dark')
            setTheme(isDark ? 'dark' : 'light')
          }
        })
      })

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      })

      return () => observer.disconnect()
    }
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
