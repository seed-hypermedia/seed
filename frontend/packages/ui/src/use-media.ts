import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {useMemo, useState} from 'react'

// Define a type for media queries configuration
export type MediaQueries = Record<string, {[key: string]: string | number}>

// Type for the result of useMedia hook
export type MediaQueryState = Record<string, boolean>

// Default media queries configuration (can be customized)
const defaultMediaQueries: MediaQueries = {
  xs: {maxWidth: 660},
  gtXs: {minWidth: 661},
  sm: {maxWidth: 860},
  gtSm: {minWidth: 861},
  md: {maxWidth: 980},
  gtMd: {minWidth: 981},
  lg: {maxWidth: 1120},
  gtLg: {minWidth: 1121},
  short: {maxHeight: 820},
  tall: {minHeight: 821},
  hoverNone: {hover: 'none'},
  pointerCoarse: {pointer: 'coarse'},
}

// Helper function to convert media query object to CSS media query string
function createMediaQuery(query: {[key: string]: string | number}): string {
  const conditions = Object.entries(query).map(([key, value]) => {
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase()

    if (typeof value === 'number') {
      return `(${cssKey}: ${value}px)`
    }

    return `(${cssKey}: ${value})`
  })

  return conditions.join(' and ')
}

// Create a proxy object that tracks which keys are accessed
function createMediaProxy(mediaState: MediaQueryState): MediaQueryState {
  const accessedKeys = new Set<string>()

  return new Proxy(mediaState, {
    get(target, prop) {
      if (typeof prop === 'string') {
        accessedKeys.add(prop)
      }
      return target[prop as string]
    },
    has(target, prop) {
      return prop in target
    },
    ownKeys(target) {
      return Object.keys(target)
    },
    getOwnPropertyDescriptor(target, prop) {
      return Object.getOwnPropertyDescriptor(target, prop)
    },
  })
}

// Main useMedia hook with configurable media queries
export function useMedia(customMediaQueries?: MediaQueries): MediaQueryState {
  const mediaQueries = customMediaQueries || defaultMediaQueries

  // Create media query strings
  const mediaQueryStrings = useMemo(() => {
    const strings: Record<string, string> = {}
    Object.entries(mediaQueries).forEach(([key, queryObj]) => {
      strings[key] = createMediaQuery(queryObj)
    })
    return strings
  }, [mediaQueries])

  // Initialize state with current matches
  const [mediaStates, setMediaStates] = useState<MediaQueryState>(() => {
    if (typeof window === 'undefined') {
      // Return false for all queries during SSR
      const initialState: MediaQueryState = {}
      Object.keys(mediaQueryStrings).forEach((key) => {
        initialState[key] = false
      })
      return initialState
    }

    // Initialize with current media query matches
    const initialState: MediaQueryState = {}
    Object.entries(mediaQueryStrings).forEach(([key, queryString]) => {
      initialState[key] = window.matchMedia(queryString).matches
    })
    return initialState
  })

  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQueryLists: Array<{key: string; mql: MediaQueryList}> = []
    const listeners: Array<() => void> = []

    // Create media query lists and listeners for each query
    Object.entries(mediaQueryStrings).forEach(([key, queryString]) => {
      const mql = window.matchMedia(queryString)
      mediaQueryLists.push({key, mql})

      // Create listener for this specific media query
      const listener = (event: MediaQueryListEvent) => {
        setMediaStates((prev) => ({
          ...prev,
          [key]: event.matches,
        }))
      }

      // Add listener
      if (mql.addEventListener) {
        mql.addEventListener('change', listener)
        listeners.push(() => mql.removeEventListener('change', listener))
      } else {
        // Fallback for older browsers
        mql.addListener(listener)
        listeners.push(() => mql.removeListener(listener))
      }

      // Set initial state
      setMediaStates((prev) => ({
        ...prev,
        [key]: mql.matches,
      }))
    })

    // Cleanup function
    return () => {
      listeners.forEach((cleanup) => cleanup())
    }
  }, [mediaQueryStrings])

  // Return proxied object for performance tracking
  return useMemo(() => createMediaProxy(mediaStates), [mediaStates])
}

export default useMedia
