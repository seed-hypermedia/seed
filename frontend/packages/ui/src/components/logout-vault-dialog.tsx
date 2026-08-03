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
 * Shared "log out of remote vault" confirmation, used everywhere a log-out is
 * offered (account dropdown, Identity Settings) so the copy and behavior stay
 * identical. Controlled (open/onOpenChange). The dialog stays open while `busy`
 * (and on failure, so the error toast has context); the caller performs the
 * logout in `onLogOut` and closes the dialog on success.
 */
export function LogoutVaultDialog({
  open,
  onOpenChange,
  onLogOut,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLogOut: () => void
  busy?: boolean
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Log out?</AlertDialogTitle>
          <AlertDialogDescription>
            Your identity will no longer be active on this device. You can sign back in at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-stretch">
          <AlertDialogCancel size="lg" className="flex-1" disabled={busy}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            size="lg"
            className="flex-1"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              onLogOut()
            }}
          >
            {busy ? 'Logging out…' : 'Log out'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
