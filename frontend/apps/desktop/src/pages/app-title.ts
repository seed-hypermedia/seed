import {eventStream} from '@shm/shared'
import {useEffect, useRef} from 'react'

export const [dispatchShowTitleEvent, showTitleEvent] = eventStream<
  'page' | 'titlebar'
>()

export function useShowTitle(ref: HTMLElement | null) {
  const triggered = useRef(false)
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        dispatchShowTitleEvent('page')
      } else {
        dispatchShowTitleEvent('titlebar')
      }
    })
  })

  useEffect(() => {
    if (!ref) return
    if (!triggered.current) {
      observer.observe(ref)
      triggered.current = true
    }
  }, [ref])
}
