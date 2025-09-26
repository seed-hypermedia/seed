import {useEffect} from 'react'

/**
 * Sets up CSS custom property for visual viewport height as a fallback for older devices
 * that don't fully support dvh units. This hook should be called once near the app root.
 *
 * Creates --vvh CSS variable that can be used like: max-h-[calc(var(--vvh)*100)]
 */
export function useVisualViewportHeight() {
  useEffect(() => {
    const setVh = () => {
      const h = window.visualViewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--vvh', `${h * 0.01}px`)
    }

    // Set initial value
    setVh()

    // Listen for changes
    window.visualViewport?.addEventListener('resize', setVh)
    window.addEventListener('orientationchange', setVh)
    window.addEventListener('resize', setVh)

    return () => {
      window.visualViewport?.removeEventListener('resize', setVh)
      window.removeEventListener('orientationchange', setVh)
      window.removeEventListener('resize', setVh)
    }
  }, [])
}