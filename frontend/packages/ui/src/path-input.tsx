import {normalizePathInput, type PathInputKind} from '@shm/shared/utils/path'
import React, {useLayoutEffect, useRef, useState} from 'react'
import {Input, type InputProps} from './components/input'

/** A controlled address input that reports completed values separately from the editing text. */
export const PathInput = React.forwardRef<
  HTMLInputElement,
  Omit<InputProps, 'value' | 'defaultValue' | 'onChange' | 'onChangeText' | 'type'> & {
    value: string
    onValueChange: (value: string) => void
    kind?: PathInputKind
  }
>(({value, onValueChange, kind = 'path', onBlur, onKeyDown, onCompositionStart, onCompositionEnd, ...props}, ref) => {
  // The parent always receives a completed address. Only this input keeps the
  // unfinished separator, so Enter and buttons cannot save a trailing dash.
  const [draft, setDraft] = useState<{text: string; value: string} | null>(null)
  const composing = useRef(false)
  const selection = useRef<{
    input: HTMLInputElement
    start: number
    end: number
    direction: HTMLInputElement['selectionDirection']
  } | null>(null)
  useLayoutEffect(() => {
    if (!selection.current) return
    const {input, start, end, direction} = selection.current
    input.setSelectionRange(start, end, direction ?? undefined)
    selection.current = null
  })
  const text = draft?.value === value ? draft.text : value

  function updateInput(input: HTMLInputElement) {
    const raw = input.value
    if (composing.current) {
      setDraft({text: raw, value})
      return
    }
    const next = normalizePathInput(raw, {kind, editing: true})
    const completed = normalizePathInput(raw, {kind})
    const start = normalizePathInput(raw.slice(0, input.selectionStart ?? raw.length), {kind, editing: true}).length
    const end = normalizePathInput(raw.slice(0, input.selectionEnd ?? raw.length), {kind, editing: true}).length
    const direction = input.selectionDirection
    // React applies the controlled value after the change handler. Restore the
    // selection after that update so middle-of-text edits do not jump to the end.
    selection.current = {input, start, end, direction}
    setDraft({text: next, value: completed})
    onValueChange(completed)
  }

  return (
    <Input
      {...props}
      ref={ref}
      type="text"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      value={text}
      onChange={(event) => updateInput(event.currentTarget)}
      onBlur={(event) => {
        setDraft(null)
        onBlur?.(event)
      }}
      onKeyDown={(event) => {
        if (composing.current || event.nativeEvent.isComposing) return
        if (event.key === 'Enter') setDraft(null)
        onKeyDown?.(event)
      }}
      onCompositionStart={(event) => {
        composing.current = true
        onCompositionStart?.(event)
      }}
      onCompositionEnd={(event) => {
        composing.current = false
        updateInput(event.currentTarget)
        onCompositionEnd?.(event)
      }}
    />
  )
})
