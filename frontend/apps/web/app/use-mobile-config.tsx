import {useMemo} from 'react'
import {hmId} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import type {MobileConfig} from '@shm/ui/resource-page-common'
import {useLocalKeyPair} from './auth'
import {useCreateAccount} from './auth'

/**
 * Hook that provides mobile-specific configuration for ResourcePage.
 * Uses web-specific auth hooks for account data.
 */
export function useMobileConfig(): MobileConfig {
  const keyPair = useLocalKeyPair()

  // Fetch account data with retry for newly created accounts
  const myAccount = useAccount(keyPair?.id || undefined, {
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    refetchOnWindowFocus: false,
  })

  // Account creation dialog
  const {content: createAccountContent, createAccount} = useCreateAccount({
    onClose: () => {
      setTimeout(() => {
        myAccount.refetch()
      }, 500)
    },
  })

  // Only show createAccount action if user is not logged in
  const handleAvatarClick = useMemo(() => {
    if (!keyPair) {
      return createAccount
    }
    return undefined
  }, [keyPair, createAccount])

  // Build account object for display
  const account = useMemo(() => {
    if (!myAccount.data?.id) return null
    return {
      id: hmId(myAccount.data.id.uid, {latest: true}),
      metadata: myAccount.data.metadata ?? undefined,
    }
  }, [myAccount.data])

  return {
    account,
    onAvatarClick: handleAvatarClick,
    extraContent: createAccountContent,
  }
}
