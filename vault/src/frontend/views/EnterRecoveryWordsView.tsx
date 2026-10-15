import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import * as crypto from '@/frontend/crypto'
import * as navigation from '@/frontend/navigation'
import {useActions, useAppState} from '@/frontend/store'
import {cn} from '@/frontend/utils'
import {Upload, X} from 'lucide-react'
import type React from 'react'
import {useRef, useState} from 'react'

/**
 * Sign-in with the recovery words for a user who forgot their password.
 */
export function EnterRecoveryWordsView() {
  const {email, loading, error, sessionChecked} = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()
  const [words, setWords] = useState<string[]>(() => Array(crypto.RECOVERY_WORD_COUNT).fill(''))
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wordInputRefs = useRef<(HTMLInputElement | null)[]>([])

  if (!sessionChecked) {
    return null
  }
  if (!email) {
    return <navigation.HashNavigate to="/" replace />
  }

  // Selecting the word lets the user retype it, and lets the arrow keys keep moving.
  function focusWord(index: number) {
    const input = wordInputRefs.current[index]
    if (!input) return false
    input.focus()
    input.select()
    return true
  }

  // Several words at once (paste of the whole phrase) fill this field and the ones after
  // it. A space or a paste moves on, so the whole phrase can be typed without leaving the keyboard.
  function handleWordChange(index: number, value: string) {
    const typed = value.trim().toLowerCase().split(/\s+/)
    setWords((current) => {
      const next = [...current]
      typed.forEach((word, offset) => {
        if (index + offset < next.length) next[index + offset] = word
      })
      return next
    })
    if (error) actions.setError('')
    if (typed[0] && (typed.length > 1 || /\s$/.test(value))) {
      focusWord(Math.min(index + typed.length, words.length - 1))
    }
  }

  // Arrow keys move around the grid once the caret reaches the edge of a word (or the whole word is
  // selected), and Backspace in an empty field goes back to the previous one.
  function handleWordKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    const input = e.currentTarget
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
    const target = targets[e.key]
    if (target != null && focusWord(target)) e.preventDefault()
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Clear the input so choosing the same file again still fires a change.
    e.target.value = ''
    if (!file) return
    let uploaded: string[] | null = null
    try {
      uploaded = crypto.parseRecoveryDocument(await file.text())
    } catch (err) {
      console.error('Failed to read recovery document:', err)
    }
    if (!uploaded) {
      actions.setError("This file isn't a Hypermedia recovery document. Choose the file you downloaded at sign-up.")
      return
    }
    setWords(uploaded)
    actions.setError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void actions.handleRecoveryLogin(words)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-left text-xl">Forgot your password?</CardTitle>
          <button
            type="button"
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground -mr-1 cursor-pointer transition-colors"
            onClick={() => navigate('/')}
          >
            <X className="size-5" />
          </button>
        </div>
        <CardDescription className="text-left">
          Enter the <span className="text-foreground font-semibold">recovery words</span> that you saved when you
          created the account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Add your recovery words</p>
            <div className="bg-brand/10 grid grid-cols-3 gap-2 rounded-lg p-3">
              {words.map((word, i) => (
                <label
                  key={i}
                  className={cn(
                    'bg-background/70 focus-within:ring-brand/40 flex items-center gap-1 rounded-md border px-3 py-2 text-sm focus-within:ring-2',
                    word ? 'border-brand' : 'border-black/10 dark:border-white/10',
                  )}
                >
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <input
                    ref={(input) => {
                      wordInputRefs.current[i] = input
                    }}
                    aria-label={`Recovery word ${i + 1}`}
                    className="w-full min-w-0 bg-transparent font-medium outline-none"
                    value={word}
                    onChange={(e) => handleWordChange(i, e.target.value)}
                    onKeyDown={(e) => handleWordKeyDown(i, e)}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={loading}
                  />
                </label>
              ))}
            </div>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full border-black/10 dark:border-white/10"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload recovery document
            <Upload className="size-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            aria-label="Recovery document"
            className="hidden"
            onChange={handleUpload}
          />

          <Button type="submit" loading={loading} disabled={words.some((word) => !word)} className="w-full">
            Continue
          </Button>
        </form>

        <Button
          variant="link"
          className="mt-2 w-full"
          disabled={loading}
          onClick={() => {
            actions.setError('')
            navigate('/login/password')
          }}
        >
          ← Back
        </Button>

        <Button
          variant="link"
          className="mt-4 w-full"
          disabled={loading}
          onClick={() => {
            actions.setError('')
            navigate('/login/no-recovery')
          }}
        >
          Don't have recovery words?
        </Button>
      </CardContent>
    </Card>
  )
}
