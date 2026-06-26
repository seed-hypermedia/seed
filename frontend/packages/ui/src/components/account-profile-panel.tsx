import {Copy, ExternalLink, KeyRound, Trash, User} from 'lucide-react'
import {useEffect, useState, type FormEvent, type ReactNode} from 'react'
import {Button} from '../button'
import {SizableText} from '../text'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './dialog'
import {Input} from './input'
import {Label} from './label'

/**
 * Shared, cross-platform Account tab content: the identity card (avatar + name +
 * account ID), the action buttons (view public profile / copy ID / export key /
 * edit profile), a delete "danger zone" with confirmation, and the password-
 * protected key-export dialog.
 *
 * Routing- and backend-agnostic. The two platforms acquire/produce the key file
 * very differently (desktop hands a path to the daemon; the web vault builds a
 * blob and triggers a browser download), and have different profile-edit and
 * delete plumbing, so those are injected as callbacks:
 *
 * - `avatar` is the platform-rendered icon (desktop HMIcon, web <img>/initial).
 * - `onExport(password)` performs the export; throw an Error to surface it.
 * - `onDelete()` removes the account key from the vault.
 * - `onEditProfile` / `onViewPublicProfile` are optional platform actions.
 */
export function AccountProfilePanel({
  name,
  accountId,
  avatar,
  onCopyId,
  onExport,
  exportBusy,
  canExport = true,
  onDelete,
  deleteBusy,
  onEditProfile,
  editProfileLabel = 'Edit Profile',
  editProfileDisabled,
  onViewPublicProfile,
}: {
  name: string
  accountId: string
  avatar: ReactNode
  onCopyId: () => void
  onExport: (password: string) => Promise<void>
  exportBusy?: boolean
  canExport?: boolean
  onDelete: () => Promise<void> | void
  deleteBusy?: boolean
  onEditProfile?: () => void
  editProfileLabel?: string
  editProfileDisabled?: boolean
  onViewPublicProfile?: () => void
}) {
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [exportPassword, setExportPassword] = useState('')
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    if (!isExportOpen) {
      setExportPassword('')
      setExportError(null)
    }
  }, [isExportOpen])

  async function handleExport(event?: FormEvent) {
    event?.preventDefault()
    setExportError(null)
    try {
      await onExport(exportPassword)
      setIsExportOpen(false)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to export account key')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Identity card */}
      <div className="flex items-center gap-4 rounded-xl border border-black/10 p-4 dark:border-white/10">
        <div className="shrink-0">{avatar}</div>
        <div className="min-w-0 flex-1">
          <SizableText size="lg" weight="bold" className="truncate">
            {name}
          </SizableText>
          <SizableText size="sm" color="muted" className="truncate">
            {accountId}
          </SizableText>
        </div>
        {onEditProfile ? (
          <Button variant="outline" onClick={onEditProfile} disabled={editProfileDisabled}>
            {editProfileLabel}
          </Button>
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        {onViewPublicProfile ? (
          <Button variant="outline" className="justify-start" onClick={onViewPublicProfile}>
            <User className="size-4" />
            View public profile
            <ExternalLink className="ml-auto size-4" />
          </Button>
        ) : null}
        <Button variant="outline" className="justify-start" onClick={onCopyId}>
          <Copy className="size-4" />
          Copy account ID
        </Button>
        <Button variant="outline" className="justify-start" onClick={() => setIsExportOpen(true)} disabled={!canExport}>
          <KeyRound className="size-4" />
          Export key
        </Button>
      </div>

      {/* Danger zone */}
      <div className="border-destructive/30 mt-2 flex flex-col gap-3 rounded-xl border p-4">
        <div>
          <SizableText weight="bold" color="destructive">
            Delete account
          </SizableText>
          <SizableText size="sm" color="muted">
            Permanently remove this account's key from your cloud vault and all your devices.
          </SizableText>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="self-start">
              <Trash className="size-4" />
              Delete account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogPortal>
            <AlertDialogContent className="max-w-[600px] gap-4">
              <AlertDialogTitle className="text-2xl font-bold">Delete account</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the key for <span className="font-medium">{name}</span> from your cloud
                vault, and it will be removed from all devices where you are signed in. Make sure you have saved this
                account's Secret Recovery Phrase if you want to recover it later — this cannot be undone.
              </AlertDialogDescription>
              <div className="flex justify-end gap-3">
                <AlertDialogCancel asChild>
                  <Button variant="ghost">Cancel</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="destructive" onClick={() => void onDelete()} disabled={deleteBusy}>
                    {deleteBusy ? 'Deleting…' : 'Delete Permanently'}
                  </Button>
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialogPortal>
        </AlertDialog>
      </div>

      <Dialog open={isExportOpen} onOpenChange={(open) => !exportBusy && setIsExportOpen(open)}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Export Key File</DialogTitle>
            <DialogDescription>Choose whether to protect the exported key file with a password.</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={handleExport}>
            <div className="text-muted-foreground rounded-lg border p-3 text-sm">
              Exported key files can grant full account control. Use a password whenever possible and store the file
              securely.
            </div>
            {exportError ? <p className="text-destructive text-sm">{exportError}</p> : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="export-key-password">Password (optional)</Label>
              <Input
                id="export-key-password"
                type="password"
                value={exportPassword}
                onChange={(event) => setExportPassword(event.currentTarget.value)}
                autoComplete="off"
                placeholder="Leave empty for plaintext export"
                disabled={exportBusy}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setIsExportOpen(false)} disabled={exportBusy}>
                Cancel
              </Button>
              <Button type="submit" disabled={exportBusy}>
                {exportBusy ? 'Exporting…' : 'Export Key'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
