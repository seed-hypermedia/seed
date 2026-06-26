import {type InputHTMLAttributes, useEffect, useRef, useState} from 'react'

interface CodeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
  length?: number
}

/**
 * Multi-cell numeric verification-code input (e.g. a 4-digit email code).
 * Shared between the desktop app and the web vault so the email-change UX is
 * identical. Handles per-cell entry, backspace/arrow navigation, and full-code
 * paste.
 */
export function CodeInput({value, onChange, length = 4, className, ...props}: CodeInputProps) {
  // We track focus state to visually highlight the active cell for better UX.
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  // We need refs to programmatically shift focus between cells as the user types.
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Autofocus the first cell when the input appears so the user can type right away.
  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  const handleChange = (index: number, digit: string) => {
    // Restrict input to single digits. Prevents broken pasting into one cell.
    const cleaned = digit.replace(/\D/g, '').slice(-1)
    if (!cleaned) return

    const chars = value.split('')
    chars[index] = cleaned
    const newValue = chars.join('').slice(0, length)
    onChange(newValue)

    // Shift focus forward after entry. Maintains smooth typing flow.
    if (index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      const chars = value.split('')
      if (chars[index]) {
        // Wipe current cell. Let user retype without extra keystrokes.
        chars[index] = ''
        onChange(chars.join(''))
      } else if (index > 0) {
        // Step back to previous cell. Clear it so user can retype.
        const prevChars = value.split('')
        prevChars[index - 1] = ''
        onChange(prevChars.join(''))
        inputRefs.current[index - 1]?.focus()
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    event.preventDefault()
    // Allow full-code paste. Users expect to paste the entire code at once.
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    if (pasted) {
      onChange(pasted)
      // Jump to last filled cell. User can continue typing from there.
      const nextIndex = Math.min(pasted.length, length - 1)
      inputRefs.current[nextIndex]?.focus()
    }
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
          maxLength={1}
          value={value[i] || ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={() => handleFocus(i)}
          onBlur={() => setFocusedIndex(null)}
          className={`bg-background h-14 w-12 rounded-md border text-center text-2xl font-semibold transition-colors ${
            focusedIndex === i ? 'border-primary ring-primary/20 ring-2' : 'border-border hover:border-primary/50'
          } ${value[i] ? 'border-primary/50' : ''} ${className || ''}`}
          aria-label={`Digit ${i + 1} of ${length}`}
          {...props}
        />
      ))}
    </div>
  )
}
