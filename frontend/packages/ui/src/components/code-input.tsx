import {type InputHTMLAttributes, useEffect, useRef, useState} from 'react'

interface CodeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
  /** Called with the full code as soon as every cell is filled (typed or pasted). */
  onComplete?: (value: string) => void
  length?: number
}

/**
 * Multi-cell numeric verification-code input (e.g. a 4-digit email code).
 * Shared between the desktop app and the web vault so the email-change UX is
 * identical. Handles per-cell entry, backspace/arrow navigation, and full-code
 * paste.
 */
export function CodeInput({value, onChange, onComplete, length = 4, className, ...props}: CodeInputProps) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  // Empty cells must retain their position while the public value stays numeric.
  // Otherwise deleting the third digit of 123456 shifts 456 into the wrong cells.
  const [cells, setCells] = useState(() => Array.from({length}, (_, index) => value[index] || ''))
  const lastEmittedValue = useRef(value)

  useEffect(() => {
    if (value !== lastEmittedValue.current || cells.length !== length) {
      lastEmittedValue.current = value
      setCells(Array.from({length}, (_, index) => value[index] || ''))
    }
  }, [value, length, cells.length])

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  const update = (next: string[], complete = false) => {
    const nextValue = next.join('')
    lastEmittedValue.current = nextValue
    setCells(next)
    onChange(nextValue)
    if (complete && next.every((digit) => /^\d$/.test(digit))) onComplete?.(nextValue)
  }

  const fillCode = (code: string) => {
    update(
      Array.from({length}, (_, index) => code[index] || ''),
      true,
    )
    inputRefs.current[Math.min(code.length, length - 1)]?.focus()
  }

  const handleChange = (index: number, raw: string) => {
    if (props.disabled || props.readOnly) return
    const digits = raw.replace(/\D/g, '')
    // Browser one-time-code autofill can deliver the whole code to one input.
    if (digits.length >= length) {
      fillCode(digits.slice(0, length))
      return
    }
    const next = [...cells]
    next[index] = digits.slice(-1)
    update(next, true)
    if (next[index] && index < length - 1) inputRefs.current[index + 1]?.focus()
  }

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (props.disabled || props.readOnly) return
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      const target = event.key === 'Backspace' && !cells[index] ? Math.max(0, index - 1) : index
      const next = [...cells]
      next[target] = ''
      update(next)
      inputRefs.current[target]?.focus()
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      inputRefs.current[index - 1]?.focus()
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault()
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    event.preventDefault()
    if (props.disabled || props.readOnly) return
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    if (pasted) fillCode(pasted)
  }

  const handleFocus = (index: number) => {
    setFocusedIndex(index)
    // Pre-select content. User can replace the digit with a single keystroke.
    inputRefs.current[index]?.select()
  }

  return (
    <div className="flex justify-center gap-2" onPaste={handlePaste}>
      {Array.from({length}, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el
          }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={length}
          value={cells[i] || ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={() => handleFocus(i)}
          onBlur={() => setFocusedIndex(null)}
          className={`bg-background h-14 w-12 min-w-0 rounded-md border text-center text-2xl font-semibold transition-colors ${
            focusedIndex === i ? 'border-primary ring-primary/20 ring-2' : 'border-border hover:border-primary/50'
          } ${cells[i] ? 'border-primary/50' : ''} ${className || ''}`}
          aria-label={`Digit ${i + 1} of ${length}`}
          {...props}
        />
      ))}
    </div>
  )
}
