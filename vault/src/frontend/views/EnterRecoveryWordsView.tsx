import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import * as crypto from '@/frontend/crypto'
import * as navigation from '@/frontend/navigation'
import {useActions, useAppState} from '@/frontend/store'
import {RecoveryWordInputs} from '@/frontend/components/RecoveryWordInputs'
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
  const [wordInputError, setWordInputError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!sessionChecked) {
    return null
  }
  if (!email) {
    return <navigation.HashNavigate to="/" replace />
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
    setWordInputError('')
    actions.setError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (wordInputError) return
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
            <RecoveryWordInputs
              words={words}
              onChange={(next) => {
                setWords(next)
                setWordInputError('')
                actions.setError('')
              }}
              onError={setWordInputError}
              disabled={loading}
            />
            {wordInputError || error ? <p className="text-destructive text-sm">{wordInputError || error}</p> : null}
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

          <Button
            type="submit"
            loading={loading}
            disabled={!!wordInputError || words.some((word) => !word)}
            className="w-full"
          >
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
