import {useEffect, useState, type FormEvent} from 'react'
import {Button} from '../button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './dialog'
import {Input} from './input'
import {Label} from './label'

/**
 * Shared "change notification server URL" dialog used by both the desktop app
 * and the web vault. The dialog owns the form state, URL validation, and the
 * error/loading display; the platform persists the value inside `onSave` (the
 * web vault stores it in the encrypted vault data, the desktop app in its local
 * settings), so the UX stays identical. An empty value falls back to the
 * server default.
 */
export function NotificationServerDialog({
  open,
  onOpenChange,
  currentUrl,
  defaultUrl,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The current override (empty string means "use the server default"). */
  currentUrl: string
  /** The server default, shown as a hint. */
  defaultUrl: string
  /** Persist the normalized URL ('' = use default). Throw to surface an error. */
  onSave: (url: string) => Promise<void>
}) {
  const [value, setValue] = useState(currentUrl)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setValue(currentUrl)
    setError(null)
    setIsSaving(false)
  }, [open, currentUrl])

  const hasChanges = value.trim() !== currentUrl.trim()
  const effectiveUrl = currentUrl.trim() || defaultUrl

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault()
    const trimmed = value.trim()
    let normalized = ''
    if (trimmed) {
      try {
        normalized = new URL(trimmed).toString()
      } catch {
        setError(`Invalid notification server URL: ${trimmed}`)
        return
      }
    }
    setError(null)
    setIsSaving(true)
    try {
      await onSave(normalized)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save notification server URL')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Change Notify Server URL</DialogTitle>
          <DialogDescription>
            Current URL: <span className="font-medium">{effectiveUrl}</span>
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="notify-server-url">Notify Server URL</Label>
            <Input
              id="notify-server-url"
              type="url"
              placeholder="Leave empty to use the server default"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={isSaving}
              autoFocus
            />
            <p className="text-muted-foreground text-xs">
              Server default: <span className="text-foreground font-mono break-all">{defaultUrl}</span>
            </p>
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || !hasChanges}>
              {isSaving ? 'Saving…' : 'Save Notify Server URL'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
