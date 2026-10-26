import {useEffect, type RefObject} from 'react'

const FOCUS_EXPLORE_SEARCH = 'explore-focus-search'

/** Focus the search input of an Explore page that is already open. A page that is opening focuses itself. */
export function focusExploreSearch() {
  window.dispatchEvent(new Event(FOCUS_EXPLORE_SEARCH))
}

export function useFocusExploreSearchListener(inputRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const focus = () => inputRef.current?.focus()
    window.addEventListener(FOCUS_EXPLORE_SEARCH, focus)
    return () => window.removeEventListener(FOCUS_EXPLORE_SEARCH, focus)
  }, [inputRef])
}
