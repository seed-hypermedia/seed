import {useChangeVaultEmailStart, useChangeVaultEmailVerify} from '@/models/daemon'
import {ChangeEmailDialog} from '@shm/ui/components/change-email-dialog'
import {toast} from '@shm/ui/toast'
import {useRef} from 'react'

/**
 * Desktop wrapper around the shared ChangeEmailDialog, backed by the daemon
 * vault-email RPCs. The daemon returns an anti-phishing binding from the start
 * call which we hold and pass back on verify.
 */
export function ChangeVaultEmailDialog({
  open,
  onOpenChange,
  currentEmail,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentEmail?: string
}) {
  const startMutation = useChangeVaultEmailStart()
  const verifyMutation = useChangeVaultEmailVerify()
  const bindingRef = useRef('')

  return (
    <ChangeEmailDialog
      open={open}
      onOpenChange={onOpenChange}
      currentEmail={currentEmail}
      onStart={async (newEmail) => {
        const result = await startMutation.mutateAsync({newEmail})
        bindingRef.current = result.binding
        return {expireTimeMs: result.expireTimeMs}
      }}
      onVerify={async (code) => {
        const updatedEmail = await verifyMutation.mutateAsync({code, binding: bindingRef.current})
        toast.success(`Email changed to ${updatedEmail}`)
      }}
    />
  )
}
