import {useMedia} from '@shm/ui/use-media'

/**
 * Shared mobile breakpoint constant
 * Matches useMedia's xs breakpoint (≤ 660px)
 */
export const MOBILE_BREAKPOINT = 660

/**
 * Hook to detect if current viewport is mobile
 */
export function useMobile() {
  const media = useMedia()
  return media.xs
}

/**
 * Utility function to check if mobile (for use in non-React contexts)
 */
export function isMobileDevice() {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= MOBILE_BREAKPOINT
}
