import {ipc} from '@/ipc'
import type {AppWindowEvent} from '@/utils/window-events'
import {ChevronDown, ChevronUp, Close} from '@shm/ui/icons'
import {useEffect, useRef, useState} from 'react'
import {NativeSyntheticEvent, TextInputKeyPressEventData} from 'react-native'
import {Button, Input, XGroup} from 'tamagui'

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

    // @ts-expect-error
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

  function handleKeyPress(
    event: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) {
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
      <XGroup
        elevation="$4"
        borderWidth={1}
        borderColor="$color8"
        animation="fast"
        bg="$backgroundStrong"
        p="$1.5"
        borderRadius="$2"
        overflow="hidden"
      >
        <XGroup.Item>
          <Input
            ref={queryInput}
            unstyled
            bg="$backgroundStrong"
            size={size}
            placeholder="Find in page..."
            borderWidth={0}
            value={query}
            onChangeText={setQuery}
            onKeyPress={handleKeyPress}
          />
        </XGroup.Item>

        <XGroup.Item>
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
        </XGroup.Item>
        <XGroup.Item>
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
        </XGroup.Item>
        <XGroup.Item>
          <Button
            chromeless
            bg="$backgroundStrong"
            size={size}
            icon={Close}
            onPress={clearFind}
          />
        </XGroup.Item>
      </XGroup>
    </div>
  )
}
