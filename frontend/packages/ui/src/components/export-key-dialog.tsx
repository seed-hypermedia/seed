import {useEffect, useState, type FormEvent} from 'react'
import {Button} from '../button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './dialog'
import {Input} from './input'
import {Label} from './label'

/**
 * Shared password-protected key-export dialog. Controlled (open/onOpenChange).
 * The caller performs the actual export in `onExport(password)` — the export
 * mechanism differs per platform (desktop hands a path to the daemon; the web
 * vault builds a blob and triggers a download) — and may throw to surface an
 * error inline. An empty password means an unencrypted export.
 */
export function ExportKeyDialog({
  open,
  onOpenChange,
  onExport,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExport: (password: string) => Promise<void>
  busy?: boolean
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setPassword('')
      setError(null)
    }
  }, [open])

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault()
    setError(null)
    try {
      await onExport(password)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export account key')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Export Key File</DialogTitle>
          <DialogDescription>Choose whether to protect the exported key file with a password.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="text-muted-foreground rounded-lg border p-3 text-sm">
            Exported key files can grant full account control. Use a password whenever possible and store the file
            securely.
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="export-key-password">Password (optional)</Label>
            <Input
              id="export-key-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete="off"
              placeholder="Leave empty for plaintext export"
              disabled={busy}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Exporting…' : 'Export Key'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
