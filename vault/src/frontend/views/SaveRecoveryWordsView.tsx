import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {FlowHeader} from '@/frontend/components/FlowHeader'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import * as localCrypto from '@/frontend/crypto'
import {useActions, useAppState} from '@/frontend/store'
import {Check, Copy, Download} from 'lucide-react'
import {useEffect, useState} from 'react'

/**
 * Recovery words step of password sign-up.
 */
export function SaveRecoveryWordsView() {
  const {recoveryWords, email, loading, error} = useAppState()
  const actions = useActions()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    actions.prepareRecoveryWords()
  }, [actions])

  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timeout)
  }, [copied])

  async function handleCopy() {
    try {
      // Space separated, so pasting into the recovery form fills every field.
      await navigator.clipboard.writeText(recoveryWords.join(' '))
      setCopied(true)
    } catch (e) {
      console.error('Failed to copy recovery words:', e)
      actions.setError("We couldn't copy your recovery words. Please write them down or download them.")
    }
  }

  function handleDownload() {
    try {
      const contents = localCrypto.formatRecoveryDocument(recoveryWords, email)
      const url = URL.createObjectURL(new Blob([contents], {type: 'text/plain'}))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'hypermedia-recovery-words.txt'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Failed to download recovery words:', e)
      actions.setError("We couldn't download your recovery words. Please try again.")
    }
  }

  return (
    <Card>
      <CardHeader>
        <FlowHeader step={3} />
        <CardTitle className="text-left text-xl">Save your recovery words</CardTitle>
        <CardDescription className="text-left">
          If you ever forget your password, you can use these words to recover your account. Save them somewhere safe.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorMessage message={error} />

        <div className="space-y-2">
          <ol className="bg-brand/10 grid grid-cols-3 gap-2 rounded-lg p-3">
            {recoveryWords.map((word, i) => (
              <li key={i} className="bg-background/70 rounded-md px-3 py-2 text-sm font-medium">
                <span className="text-muted-foreground mr-1">{i + 1}.</span>
                {word}
              </li>
            ))}
          </ol>
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">Hypermedia does not have access to these words.</p>
            <Button
              variant="ghost"
              size="sm"
              className="text-brand shrink-0"
              disabled={!recoveryWords.length}
              onClick={handleCopy}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy words'}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="w-full border-black/10 dark:border-white/10"
            disabled={!recoveryWords.length || loading}
            onClick={handleDownload}
          >
            Download recovery document
            <Download className="size-4" />
          </Button>
          <Button
            className="w-full"
            loading={loading}
            disabled={!recoveryWords.length}
            onClick={actions.saveRecoveryCredential}
          >
            I've saved my words
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
