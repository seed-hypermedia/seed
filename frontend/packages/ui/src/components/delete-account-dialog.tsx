import {Button} from '../button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogPortal,
  AlertDialogTitle,
} from './alert-dialog'

/**
 * Shared delete-account confirmation. Controlled (open/onOpenChange). The caller
 * removes the account key from the vault in `onDelete`.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  accountName,
  onDelete,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountName: string
  onDelete: () => Promise<void> | void
  busy?: boolean
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPortal>
        <AlertDialogContent className="max-w-[600px] gap-4">
          <AlertDialogTitle className="text-2xl font-bold">Delete account</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the key for <span className="font-medium">{accountName}</span> from your cloud
            vault, and it will be removed from all devices where you are signed in. Make sure you have saved this
            account's Secret Recovery Phrase if you want to recover it later — this cannot be undone.
          </AlertDialogDescription>
          <div className="flex justify-end gap-3">
            <AlertDialogCancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onClick={() => void onDelete()} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete Permanently'}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialog>
  )
}
