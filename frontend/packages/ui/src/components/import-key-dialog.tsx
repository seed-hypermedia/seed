import {useEffect, useState, type FormEvent, type ReactNode} from 'react'
import {Button} from '../button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './dialog'
import {Input} from './input'
import {Label} from './label'

/**
 * Shared, cross-platform UI for importing an account `.hmkey.json` key file.
 *
 * The dialog chrome, optional password field, error display, and submit/loading
 * flow are shared between the desktop app and the web vault. The two platforms
 * acquire the key file and perform the import very differently (desktop hands a
 * file path to the daemon over gRPC; the web vault reads the file contents in
 * the browser and writes to the server vault), so those parts are injected:
 *
 * - `renderFileField` renders the platform-specific file picker UI.
 * - `hasFile` gates the submit button until a file has been selected.
 * - `onImport` performs the actual import; throw an Error to surface a message.
 */
export function ImportKeyDialog({
  open,
  onOpenChange,
  renderFileField,
  hasFile,
  onImport,
  title = 'Import Key File',
  description = 'Choose an exported `.hmkey.json` file. Enter a password only if the key file was exported with encryption.',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  renderFileField: (api: {clearError: () => void}) => ReactNode
  hasFile: boolean
  onImport: (password: string | undefined) => Promise<void>
  title?: string
  description?: string
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  useEffect(() => {
    if (!open) {
      setPassword('')
      setError(null)
      setIsImporting(false)
    }
  }, [open])

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault()
    if (!hasFile) {
      setError('Key file is required')
      return
    }
    setError(null)
    setIsImporting(true)
    try {
      await onImport(password.length > 0 ? password : undefined)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to import account')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {renderFileField({clearError: () => setError(null)})}
          <div className="flex flex-col gap-2">
            <Label htmlFor="import-key-password">Password (optional)</Label>
            <Input
              id="import-key-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete="off"
              placeholder="Only needed for encrypted files"
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isImporting}>
              {isImporting ? 'Importing…' : 'Import Key'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
