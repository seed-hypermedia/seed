import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
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
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete account</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the key for <span className="font-medium">{accountName}</span> from your cloud
            vault, and it will be removed from all devices where you are signed in. Make sure you have saved this
            account's Secret Recovery Phrase if you want to recover it later — this cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void onDelete()} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete Permanently'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
