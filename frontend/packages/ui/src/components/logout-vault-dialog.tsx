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
          <AlertDialogTitle>Log out of remote vault?</AlertDialogTitle>
          <AlertDialogDescription>
            This will disconnect the remote vault and delete all vault keys from this device.
          </AlertDialogDescription>
          <AlertDialogDescription>
            You will be able to log in with your passkey to use your accounts again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
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
