import {ipc} from '@/ipc'
import type {AppWindowEvent} from '@/utils/window-events'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {ChevronDown, ChevronUp, Close} from '@shm/ui/icons'
import {useEffect, useRef, useState} from 'react'

export function FindInPage() {
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
        if (event.type === 'find_in_page') {
          setTimeout(() => {
            queryInput.current?.focus()
            queryInput.current?.select()
          }, 10)
        }
      },
    )

    return () => unsubscribe?.()
  }, [])

  function handleKeyPress(event: React.KeyboardEvent<HTMLInputElement>) {
    const key = event.key
    if (key === 'Escape') {
      event.preventDefault()
      clearFind()
    } else if (key === 'Enter') {
      event.preventDefault()
      console.log('Enter pressed - find next occurrence')

      if (query.length > 0) {
        ipc.send('find_in_page_query', {
          query,
          findNext: false,
          forward: true,
        })
      }
    }
  }

  // Start search when typing (but not on Enter key)
  useEffect(() => {
    console.log('useEffect triggered, query:', query)

    if (query.length === 0) {
      console.log('Cancelling search - empty query')
      ipc.send('find_in_page_cancel')
      return
    }

    console.log('Starting initial search')
    ipc.send('find_in_page_query', {query, findNext: true})
  }, [query])

  return (
    <div className="fixed inset-0 flex items-center justify-center gap-2 p-4">
      <div className="flex flex-1 items-center">
        <Input
          ref={queryInput}
          placeholder="Find in page..."
          value={query}
          onChangeText={setQuery}
          onKeyDown={handleKeyPress}
          className="bg-panel border-border flex-1"
        />
      </div>
      <div className="border-border bg-panel flex items-center overflow-hidden rounded-sm border">
        <Button
          variant="ghost"
          className="size-8 rounded-none"
          size="icon"
          onClick={() => {
            console.log('Up button clicked - sending IPC from button')
            ipc.send('find_in_page_query', {
              query,
              findNext: false,
              forward: false,
            })
          }}
        >
          <ChevronUp className="size-4" />
        </Button>

        <Button
          variant="ghost"
          className="size-8 rounded-none"
          size="icon"
          onClick={() => {
            console.log('Down button clicked - sending IPC from button')
            ipc.send('find_in_page_query', {
              query,
              findNext: false,
              forward: true,
            })
          }}
        >
          <ChevronDown className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={clearFind}
          className="size-8 rounded-none"
        >
          <Close className="size-4" />
        </Button>
      </div>
    </div>
  )
}
