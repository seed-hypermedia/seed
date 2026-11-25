import {Button} from '@/frontend/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/frontend/components/ui/dialog'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import {RecoveryWordInputs} from '@/frontend/components/RecoveryWordInputs'
import {useActions} from '@/frontend/store'
import * as radix from 'radix-ui'
import * as React from 'react'

const ACCOUNT_WORD_COUNTS = [12, 15, 18, 21, 24]

/** Imports an existing account from a key file or its original recovery phrase. */
export function ImportAccountDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (principal: string) => void
}) {
  const actions = useActions()
  const [method, setMethod] = React.useState('file')
  const [file, setFile] = React.useState<File | null>(null)
  const [password, setPassword] = React.useState('')
  const [words, setWords] = React.useState<string[]>(() => Array(12).fill(''))
  const [wordInputError, setWordInputError] = React.useState('')
  const [passphrase, setPassphrase] = React.useState('')
  const [error, setError] = React.useState('')
  const [importing, setImporting] = React.useState(false)
  const submitting = React.useRef(false)

  function clearFields() {
    setFile(null)
    setPassword('')
    setWords(Array(12).fill(''))
    setWordInputError('')
    setPassphrase('')
    setError('')
  }

  React.useEffect(() => {
    if (!open) {
      clearFields()
      setMethod('file')
    }
  }, [open])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting.current || !canImport) return
    submitting.current = true
    setImporting(true)
    setError('')
    try {
      let principal: string
      if (method === 'phrase') {
        principal = await actions.importAccountFromMnemonic(words.join(' '), passphrase)
      } else {
        if (!file) throw new Error('Choose a key file to import.')
        principal = await actions.importAccount(await file.text(), password || undefined)
      }
      clearFields()
      onImported(principal)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to import account')
    } finally {
      submitting.current = false
      setImporting(false)
    }
  }

  const canImport = method === 'phrase' ? words.every((word) => word.length > 0) && !wordInputError : !!file

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submitting.current) onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[480px]"
        showCloseButton={!importing}
      >
        <DialogHeader>
          <DialogTitle>Import identity</DialogTitle>
          <DialogDescription>Add an existing account to your vault.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} aria-busy={importing}>
          <fieldset disabled={importing} className="flex min-w-0 flex-col gap-4">
            <radix.Tabs.Root
              value={method}
              onValueChange={(value) => {
                clearFields()
                setMethod(value)
              }}
            >
              <radix.Tabs.List aria-label="Import method" className="bg-muted mb-4 flex gap-1 rounded-lg p-1">
                {[
                  ['file', 'Key file'],
                  ['phrase', 'Recovery phrase'],
                ].map(([value, label]) => (
                  <radix.Tabs.Trigger
                    key={value}
                    value={value!}
                    disabled={importing}
                    className="text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground focus-visible:ring-ring flex-1 rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 disabled:opacity-50 data-[state=active]:shadow-sm"
                  >
                    {label}
                  </radix.Tabs.Trigger>
                ))}
              </radix.Tabs.List>
              <radix.Tabs.Content value="file" className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="import-key-file">Key file</Label>
                  <Input
                    id="import-key-file"
                    type="file"
                    accept=".hmkey.json,application/json"
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null)
                      setError('')
                    }}
                  />
                  <p className="text-muted-foreground text-sm">Choose an exported .hmkey.json file.</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="import-key-password">Password (optional)</Label>
                  <Input
                    id="import-key-password"
                    type="password"
                    autoComplete="off"
                    value={password}
                    placeholder="Only needed for encrypted files"
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setError('')
                    }}
                  />
                </div>
              </radix.Tabs.Content>
              <radix.Tabs.Content value="phrase" className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <p id="import-phrase-label" className="text-sm font-medium">
                      Account recovery phrase
                    </p>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="import-word-count" className="sr-only">
                        Word count
                      </Label>
                      <select
                        id="import-word-count"
                        value={words.length}
                        className="bg-background rounded-md border px-2 py-1 text-sm"
                        onChange={(event) => {
                          const count = Number(event.target.value)
                          setWords(Array.from({length: count}, (_, index) => words[index] ?? ''))
                          setWordInputError('')
                          setError('')
                        }}
                      >
                        {ACCOUNT_WORD_COUNTS.map((count) => (
                          <option key={count} value={count}>
                            {count} words
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div role="group" aria-labelledby="import-phrase-label">
                    <RecoveryWordInputs
                      words={words}
                      wordCounts={ACCOUNT_WORD_COUNTS}
                      disabled={importing}
                      describedBy="import-phrase-help"
                      onChange={(next) => {
                        setWords(next)
                        setWordInputError('')
                        setError('')
                      }}
                      onError={setWordInputError}
                    />
                  </div>
                  <p id="import-phrase-help" className="text-muted-foreground text-sm">
                    Type one word per box, or paste the whole account recovery phrase into any box. Vault recovery words
                    are for signing in to your vault.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="import-account-passphrase">Passphrase (optional)</Label>
                  <Input
                    id="import-account-passphrase"
                    type="password"
                    autoComplete="off"
                    value={passphrase}
                    aria-describedby="import-passphrase-help"
                    placeholder="Only if you originally used one"
                    onChange={(event) => {
                      setPassphrase(event.target.value)
                      setError('')
                    }}
                  />
                  <p id="import-passphrase-help" className="text-muted-foreground text-sm">
                    This is the passphrase used when creating this account.
                  </p>
                </div>
              </radix.Tabs.Content>
            </radix.Tabs.Root>
            {wordInputError || error ? (
              <p role="alert" className="text-destructive text-sm">
                {wordInputError || error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={importing} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={importing || !canImport}>
                {importing ? 'Importing…' : 'Import account'}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}
