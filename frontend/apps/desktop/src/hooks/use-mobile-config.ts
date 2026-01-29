import {useMyAccounts} from '@/models/daemon'
import {hmId} from '@shm/shared'
import type {MobileConfig} from '@shm/ui/resource-page-common'
import {useMemo} from 'react'

/**
 * Hook that provides mobile-specific configuration for ResourcePage on desktop.
 * Desktop doesn't need account creation flow - accounts are managed separately.
 */
export function useDesktopMobileConfig(): MobileConfig {
  const myAccounts = useMyAccounts()

  // Get first account (primary account)
  const primaryAccount = myAccounts?.[0]

  const account = useMemo(() => {
    if (!primaryAccount?.data) return null
    if (primaryAccount.data.type !== 'document') return null

    // For accounts, the 'account' field contains the uid
    const doc = primaryAccount.data.document
    return {
      id: hmId(doc.account),
      metadata: doc.metadata ?? undefined,
    }
  }, [primaryAccount?.data])

  return {
    account,
    // Desktop doesn't need onAvatarClick - account management is separate
    onAvatarClick: undefined,
    extraContent: undefined,
  }
}
