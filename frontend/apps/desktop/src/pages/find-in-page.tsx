import {ipc} from '@/ipc'
import type {AppWindowEvent} from '@/utils/window-events'
import {useEffect, useRef, useState} from 'react'

// Inline SVG icons to avoid importing from @shm/ui which causes React duplication
function ChevronUpIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

export function FindInPage() {
  const [query, setQuery] = useState('')
  const queryInput = useRef<HTMLInputElement>(null)

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

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const key = event.key
    if (key === 'Escape') {
      event.preventDefault()
      clearFind()
    } else if (key === 'Enter') {
      event.preventDefault()
      if (query.length > 0) {
        ipc.send('find_in_page_query', {
          query,
          findNext: false,
          forward: true,
        })
      }
    }
  }

  // Start search when typing
  useEffect(() => {
    if (query.length === 0) {
      ipc.send('find_in_page_cancel')
      return
    }
    ipc.send('find_in_page_query', {query, findNext: true})
  }, [query])

  return (
    <div className="fixed inset-0 flex items-center justify-center gap-2 p-4">
      <div className="flex flex-1 items-center">
        <input
          ref={queryInput}
          type="text"
          placeholder="Find in page..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="bg-panel border-border focus:ring-ring h-8 flex-1 rounded-sm border px-2 text-sm outline-none focus:ring-1"
        />
      </div>
      <div className="border-border bg-panel flex items-center overflow-hidden rounded-sm border">
        <button
          type="button"
          className="hover:bg-muted flex size-8 items-center justify-center"
          onClick={() => {
            ipc.send('find_in_page_query', {
              query,
              findNext: false,
              forward: false,
            })
          }}
        >
          <ChevronUpIcon />
        </button>

        <button
          type="button"
          className="hover:bg-muted flex size-8 items-center justify-center"
          onClick={() => {
            ipc.send('find_in_page_query', {
              query,
              findNext: false,
              forward: true,
            })
          }}
        >
          <ChevronDownIcon />
        </button>

        <button
          type="button"
          onClick={clearFind}
          className="hover:bg-muted flex size-8 items-center justify-center"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
