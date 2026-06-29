import {Copy, KeyRound, Trash} from 'lucide-react'
import {useState, type ReactNode} from 'react'
import {Button} from '../button'
import {SizableText} from '../text'
import {DeleteAccountDialog} from './delete-account-dialog'
import {ExportKeyDialog} from './export-key-dialog'

/**
 * Shared, cross-platform Account tab content: the identity card (avatar + name +
 * account ID), the action buttons (view public profile / copy ID / export key /
 * edit profile), and a delete "danger zone". The password-protected export
 * dialog and the delete confirmation are the shared ExportKeyDialog /
 * DeleteAccountDialog (also used by the account sidebar's options menu).
 *
 * Routing- and backend-agnostic. The two platforms acquire/produce the key file
 * very differently (desktop hands a path to the daemon; the web vault builds a
 * blob and triggers a browser download), and have different profile-edit and
 * delete plumbing, so those are injected as callbacks:
 *
 * - `avatar` is the platform-rendered icon (desktop HMIcon, web <img>/initial).
 * - `onExport(password)` performs the export; throw an Error to surface it.
 * - `onDelete()` removes the account key from the vault.
 * - `onEditProfile` is an optional platform action.
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
}) {
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)

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
        <Button variant="destructive" className="self-start" onClick={() => setIsDeleteOpen(true)}>
          <Trash className="size-4" />
          Delete account
        </Button>
      </div>

      <ExportKeyDialog open={isExportOpen} onOpenChange={setIsExportOpen} onExport={onExport} busy={exportBusy} />
      <DeleteAccountDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        accountName={name}
        onDelete={onDelete}
        busy={deleteBusy}
      />
    </div>
  )
}
