import {eventStream} from '@shm/shared/utils/stream'
import {useEffect, useRef, useState} from 'react'

type TitlebatKeys = 'page' | 'titlebar'

export const [dispatchShowTitleEvent, showTitleEvent] =
  eventStream<TitlebatKeys>()

export function useShowTitleObserver(ref: HTMLElement | null) {
  const triggered = useRef(false)
  const observer = new IntersectionObserver((entries) => {
    dispatchShowTitleEvent('titlebar')
    entries.forEach((entry) => {
      // if (entry.isIntersecting) {
      //   dispatchShowTitleEvent('page')
      // } else {
      //   dispatchShowTitleEvent('titlebar')
      // }
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

export function useShowTitle(key: TitlebatKeys) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    showTitleEvent.subscribe((value) => {
      setShow(value == key)
    })
  }, [])

  return {
    show,
    setShow,
  }
}
