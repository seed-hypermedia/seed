import {cn} from '@/frontend/utils'
import * as React from 'react'

/** Numbered recovery-word grid shared by vault sign-in and account import. */
export function RecoveryWordInputs({
  words,
  onChange,
  onError,
  disabled = false,
  wordCounts,
  describedBy,
}: {
  words: string[]
  onChange: (words: string[]) => void
  onError: (message: string) => void
  disabled?: boolean
  /** Supported full-phrase lengths; omit to keep the current word count fixed. */
  wordCounts?: readonly number[]
  describedBy?: string
}) {
  const wordInputRefs = React.useRef<(HTMLInputElement | null)[]>([])
  const pendingFocus = React.useRef<number | null>(null)

  function focusWord(index: number) {
    const input = wordInputRefs.current[index]
    if (!input) return false
    input.focus()
    input.select()
    return true
  }

  React.useLayoutEffect(() => {
    if (pendingFocus.current !== null) {
      focusWord(pendingFocus.current)
      pendingFocus.current = null
    }
  }, [words])

  function handleWordChange(index: number, value: string) {
    const typed = value
      .trim()
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean)
    if (!typed.length) typed.push('')
    // A full phrase replaces the grid even when pasted into a later field.
    const fullPhrase = (wordCounts ?? [words.length]).includes(typed.length)
    if (!fullPhrase && index + typed.length > words.length) {
      onError('Too many words for this recovery phrase. Check the word count and paste again.')
      return
    }
    const next = fullPhrase ? typed : [...words]
    if (!fullPhrase)
      typed.forEach((word, offset) => {
        next[index + offset] = word
      })
    if (typed[0] && (typed.length > 1 || /[\s,]$/.test(value))) {
      pendingFocus.current = fullPhrase ? next.length - 1 : Math.min(index + typed.length, next.length - 1)
    }
    onChange(next)
  }

  function handleWordKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const wholeSelected = input.selectionStart === 0 && input.selectionEnd === input.value.length
    const atStart = wholeSelected || input.selectionEnd === 0
    const atEnd = wholeSelected || input.selectionStart === input.value.length
    const targets: Record<string, number | null> = {
      ArrowLeft: atStart ? index - 1 : null,
      ArrowRight: atEnd ? index + 1 : null,
      ArrowUp: index - 3,
      ArrowDown: index + 3,
      Backspace: input.value ? null : index - 1,
    }
    const target = targets[event.key]
    if (target != null && focusWord(target)) event.preventDefault()
  }

  return (
    <div className="bg-brand/10 grid grid-cols-3 gap-2 rounded-lg p-3">
      {words.map((word, index) => (
        <label
          key={index}
          className={cn(
            'bg-background/70 focus-within:ring-brand/40 flex items-center gap-1 rounded-md border px-3 py-2 text-sm focus-within:ring-2',
            word ? 'border-brand' : 'border-black/10 dark:border-white/10',
          )}
        >
          <span className="text-muted-foreground">{index + 1}.</span>
          <input
            ref={(input) => {
              wordInputRefs.current[index] = input
            }}
            aria-label={`Recovery word ${index + 1}`}
            aria-describedby={describedBy}
            className="w-full min-w-0 bg-transparent font-medium outline-none"
            value={word}
            onChange={(event) => handleWordChange(index, event.target.value)}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData('text/plain')
              if (
                pasted
                  .trim()
                  .split(/[\s,]+/)
                  .filter(Boolean).length > 1
              ) {
                event.preventDefault()
                handleWordChange(index, pasted)
              }
            }}
            onKeyDown={(event) => handleWordKeyDown(index, event)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={disabled}
          />
        </label>
      ))}
    </div>
  )
}
