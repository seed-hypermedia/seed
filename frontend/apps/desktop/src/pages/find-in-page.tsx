import {ipc} from '@/ipc'
import type {AppWindowEvent} from '@/utils/window-events'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {ChevronDown, ChevronUp, Close} from '@shm/ui/icons'
import {useEffect, useRef, useState} from 'react'

export function FindInPage() {
  const size = '$2'
  const [query, setQuery] = useState('')
  const queryInput = useRef<any>(null)

  function clearFind() {
    setQuery('')
    ipc.send('find_in_page_cancel')
  }

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        clearFind()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    if (queryInput.current) {
      queryInput.current?.focus()
      queryInput.current?.select()
    }

    const unsubscribe = window.appWindowEvents?.subscribe(
      (event: AppWindowEvent) => {
        if (event === 'find_in_page') {
          setTimeout(() => {
            queryInput.current?.focus()
            queryInput.current?.select()
          }, 10)
        }
      },
    )

    return () => unsubscribe?.()
  }, [])

  function handleKeyPress(event) {
    const key = event.nativeEvent.key
    if (key === 'Escape') {
      event.preventDefault()
      clearFind()
    } else if (key === 'Enter') {
      event.preventDefault()
      ipc.send('find_in_page_query', {
        query,
        findNext: false,
        forward: true,
      })
    }
  }

  useEffect(() => {
    if (query.length > 0) {
      ipc.send('find_in_page_query', {query, findNext: true})
    }
  }, [query])

  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <Input
        ref={queryInput}
        placeholder="Find in page..."
        value={query}
        onChangeText={setQuery}
        onKeyDown={handleKeyPress}
      />

      <Button
        chromeless
        bg="$backgroundStrong"
        size={size}
        icon={ChevronUp}
        onPress={() =>
          ipc.send('find_in_page_query', {
            query,
            findNext: false,
            forward: false,
          })
        }
      />

      <Button
        chromeless
        bg="$backgroundStrong"
        size={size}
        icon={ChevronDown}
        onPress={() =>
          ipc.send('find_in_page_query', {
            query,
            findNext: false,
            forward: true,
          })
        }
      />

      <Button onClick={clearFind}>
        <Close className="size-4" />
      </Button>
    </div>
  )
}
