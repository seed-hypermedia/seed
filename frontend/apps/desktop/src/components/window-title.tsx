import {useEffect} from 'react'

export function useWindowTitleSetter(
  getTitle: () => Promise<string | null>,
  dependencies: any[],
): void {
  useEffect(() => {
    getTitle().then((title) => {
      // we set the window title so the window manager knows the title in the Window menu
      if (title) {
        // @ts-ignore
        window.document.title = title
      }
    })
  }, dependencies)
}
